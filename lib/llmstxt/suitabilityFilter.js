'use strict';

/*
 * LLMs.txt Generator, suitability filter ("intelligent URL selection").
 * Excludes pages that are not useful in a curated llms.txt, with accurate
 * reasons. Never assumes a URL should be included just because it exists.
 */

const { pathOf, segmentsOf, hasTrackingParams } = require('./urlNormalizer');

const EXCLUDED_SEGMENTS = [
  'login', 'log-in', 'signin', 'sign-in', 'signup', 'sign-up', 'register', 'registration',
  'logout', 'log-out', 'cart', 'basket', 'checkout', 'check-out', 'account', 'my-account',
  'admin', 'wp-admin', 'dashboard', 'wp-login.php', 'xmlrpc.php', 'wp-json', 'search',
  'tag', 'tags', 'author', 'authors', 'members', 'profile', 'settings', 'wishlist',
  'compare', 'order', 'orders', 'tracking', 'track-order', 'reset-password', 'lost-password',
  'print', 'preview', 'amp', 'embed', 'feed', 'comments', 'replytocom', 'add-to-cart',
  'wishlist', 'download-manager', 'api-docs'
];

const EXCLUDED_PREFIX = ['/wp-content/', '/wp-includes/', '/wp-admin/', '/cgi-bin/'];

const SESSION_PARAMS = new Set(['phpsessid', 'jsessid', 'jsessionid', 'sessionid', 'sid', 'sessid', 'aspxauth', 'cfid', 'cftoken']);

const SEARCH_PARAMS = new Set(['s', 'q', 'search', 'query', 'search_query', 'searchword', 'keyword']);

function hasExcludedPrefix(path) {
  return EXCLUDED_PREFIX.some(p => path.startsWith(p));
}

function queryParams(url) {
  try { return [...new URL(url).searchParams.keys()]; } catch { return []; }
}

function hasSearchParam(url) {
  try {
    const sp = new URL(url).searchParams;
    return [...sp.keys()].some(k => SEARCH_PARAMS.has(k.toLowerCase()) && sp.get(k));
  } catch { return false; }
}

function hasSessionParam(url) {
  try {
    const sp = new URL(url).searchParams;
    return [...sp.keys()].some(k => SESSION_PARAMS.has(k.toLowerCase()));
  } catch { return false; }
}

function isPagination(url) {
  const path = pathOf(url);
  if (/\/(?:page|paged|pagina)\/\d+\/?$/.test(path)) return true;
  try {
    const sp = new URL(url).searchParams;
    for (const k of ['page', 'paged', 'p', 'pg']) {
      const v = sp.get(k);
      if (v && /^\d+$/.test(v) && parseInt(v, 10) > 1) return true;
    }
  } catch {}
  return false;
}

/* Detect page kinds that affect sectioning. */
function detectKind(page, site) {
  const path = pathOf(page.url);
  const segs = segmentsOf(page.url);
  if (page.category === 'Home') return 'home';
  if (page.isPdf || /\.pdf([?#]|$)/i.test(path)) return 'pdf';
  // WooCommerce / Shopify / WordPress style categories.
  if (/(product-category|collections?|categories?|category)\/?$/.test(path) || segs.includes('product-category') || segs.includes('category') || segs.includes('categories') || segs.includes('collection') || segs.includes('collections')) {
    return 'category';
  }
  // WordPress /author/ archives.
  if (segs.includes('author') || segs.includes('authors')) return 'author';
  // Pagination.
  if (isPagination(page.url)) return 'pagination';
  // Structured-data product / article.
  if ((page.types || []).includes('product')) return 'product';
  if ((page.types || []).some(t => ['article', 'newsarticle', 'blogposting', 'techarticle'].includes(t))) return 'article';
  if (/^product/i.test(page.ogType || '')) return 'product';
  return 'normal';
}

/* Excluded pages get an accurate reason; everything else passes. */
function suitability(page, site, options) {
  const path = pathOf(page.url);
  const segs = segmentsOf(page.url);
  const kind = detectKind(page, site);

  if (kind === 'home') return { ok: true, kind };

  if (hasExcludedPrefix(path)) return { ok: false, reason: 'Utility path (assets/internal)', kind };
  if (kind === 'pagination') return { ok: false, reason: 'Pagination page', kind };

  const hit = segs.filter(s => EXCLUDED_SEGMENTS.includes(s));
  if (hit.length) {
    const s = hit[0];
    if (['login', 'log-in', 'signin', 'sign-in', 'signup', 'sign-up', 'register', 'registration', 'logout', 'log-out', 'reset-password', 'lost-password'].includes(s)) return { ok: false, reason: 'Login/registration page', kind };
    if (['cart', 'basket', 'checkout', 'check-out', 'add-to-cart', 'wishlist', 'order', 'orders'].includes(s)) return { ok: false, reason: 'Cart/checkout/transaction page', kind };
    if (['account', 'my-account', 'profile', 'settings', 'members'].includes(s)) return { ok: false, reason: 'Account page', kind };
    if (['search'].includes(s)) return { ok: false, reason: 'Search results page', kind };
    if (['tag', 'tags'].includes(s)) return { ok: false, reason: 'Tag archive', kind };
    if (['author', 'authors'].includes(s)) return options.includeAuthors ? { ok: true, kind } : { ok: false, reason: 'Author page (disabled)', kind };
    if (['admin', 'wp-admin', 'dashboard', 'wp-login.php', 'xmlrpc.php', 'wp-json'].includes(s)) return { ok: false, reason: 'Admin/internal page', kind };
    if (['feed', 'comments', 'replytocom', 'print', 'preview', 'amp', 'embed'].includes(s)) return { ok: false, reason: 'Utility page', kind };
    if (['tracking', 'track-order'].includes(s)) return { ok: false, reason: 'Tracking page', kind };
    return { ok: false, reason: 'Utility page', kind };
  }

  if (hasTrackingParams(page.url)) return { ok: false, reason: 'Tracking URL', kind };
  if (hasSessionParam(page.url)) return { ok: false, reason: 'Session URL', kind };
  if (hasSearchParam(page.url)) return { ok: false, reason: 'Search results URL', kind };

  // Category / collection pages depend on the includeCategories toggle.
  if (kind === 'category') return options.includeCategories ? { ok: true, kind } : { ok: false, reason: 'Category page (disabled)', kind };

  // PDFs depend on the includePdfs toggle.
  if (kind === 'pdf') return options.includePdfs ? { ok: true, kind } : { ok: false, reason: 'PDF (disabled)', kind };

  // Filter combinations: many query params that aren't a product/session/search.
  const params = queryParams(page.url).filter(k => !k.toLowerCase().startsWith('utm'));
  if (params.length >= 3) return { ok: false, reason: 'Filter combination URL', kind };

  return { ok: true, kind };
}

module.exports = { suitability, detectKind, isPagination, EXCLUDED_SEGMENTS };
