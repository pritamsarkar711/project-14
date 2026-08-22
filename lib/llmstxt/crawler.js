'use strict';

/*
 * LLMs.txt Generator, website crawler.
 * URL validation → robots.txt → sitemap discovery → page discovery →
 * metadata extraction → canonical analysis → noindex detection → dedup →
 * classification → scoring → selection → generation.
 * SSRF-safe, bounded concurrency, no AI, no paid APIs.
 *
 * `crawlSite` performs the full server-side fetch + analysis. `analyzeAndReport`
 * runs the deterministic analysis + generation on already-collected pages, so the
 * browser fallback can reuse the exact same classification/scoring/generation
 * logic without duplicating it.
 */

const { validateUrl } = require('./urlValidator');
const { safeFetch } = require('./safeFetcher');
const { fetchRobots } = require('./robotsParser');
const { discoverSitemaps } = require('./sitemapDiscovery');
const { normalizeUrl, isInternal, canonicalKey, isPdfUrl, isAssetUrl, isBinaryUrl, isFeedUrl, hostOf } = require('./urlNormalizer');
const { parsePage } = require('./pageParser');
const { analyzeIndexability } = require('./indexabilityAnalyzer');
const { canonicalDecision } = require('./canonicalAnalyzer');
const { dedupePages } = require('./duplicateAnalyzer');
const { classify } = require('./pageClassifier');
const { suitability } = require('./suitabilityFilter');
const { score, priorityBand } = require('./importanceScorer');
const { pageDescription, websiteDescription } = require('./descriptionGenerator');
const { renderSections, selectPages } = require('./llmsTxtGenerator');
const { validateLlmsTxt } = require('./llmsTxtValidator');
const { scoreQuality } = require('./qualityScorer');
const { summarize, groupReasons } = require('./reportEngine');

function detectPlatform(homeBody, headers) {
  const b = String(homeBody || '').slice(0, 200000);
  const h = headers || {};
  const found = [];
  if (/wp-content\/|\/wp-includes\/|<meta[^>]+generator[^>]+WordPress/i.test(b)) found.push('WordPress');
  if (/cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i.test(b)) found.push('Shopify');
  if (/__NEXT_DATA__|_next\/static/i.test(b)) found.push('Next.js');
  if (/data-reactroot|react-root/i.test(b)) found.push('React');
  if (/drupal|Drupal\.settings/i.test(b)) found.push('Drupal');
  if (/joomla|Joomla!/i.test(b)) found.push('Joomla');
  if (/webflow|data-wf-site/i.test(b)) found.push('Webflow');
  if (/laravel_session|XSRF-TOKEN/i.test((h['set-cookie'] || '') + ' ' + b)) found.push('Laravel');
  return found;
}

function detectEcommerce(pages) {
  return pages.some(p => {
    try { return (p.types || []).includes('product') || /^product/i.test(p.ogType || '') || /(product-category|collections?|shop|store)\b/.test(new URL(p.url).pathname.toLowerCase()); }
    catch { return false; }
  });
}

async function detectExistingLlmsTxt(origin, homePage, opts) {
  const result = { exists: false, url: new URL('/llms.txt', origin).toString(), markdownAlternates: [], describedBy: [] };
  try {
    const r = await safeFetch(result.url, { ...opts, accept: 'text/markdown,text/plain,*/*', maxBytes: 200 * 1024 });
    result.exists = r.status === 200;
    result.status = r.status;
    if (result.exists) result.sample = r.body.slice(0, 400);
  } catch (e) { result.error = e.message; }
  const html = homePage && homePage.body ? homePage.body : '';
  const linkRe = /<link\b[^>]*rel=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = linkRe.exec(html))) {
    const rel = m[1].toLowerCase();
    const tag = m[0];
    const href = (tag.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    if (/\balternate\b/.test(rel) && /type=["']text\/markdown["']/i.test(tag)) result.markdownAlternates.push(normalizeUrl(href, origin) || href);
    if (/\bdescribedby\b/.test(rel)) result.describedBy.push(normalizeUrl(href, origin) || href);
  }
  return result;
}

function parseOptions(options) {
  return {
    maxPages: Math.min(Number(options.maxPages) || 500, 10000),
    maxDepth: options.maxDepth === 'unlimited' ? 10 : Math.min(Number(options.maxDepth) || 3, 10),
    includeSubdomains: !!options.includeSubdomains,
    includeExternal: !!options.includeExternal,
    includePdfs: options.includePdfs !== false,
    includeBlog: options.includeBlog !== false,
    includeDocs: options.includeDocs !== false,
    includeCategories: !!options.includeCategories,
    includeAuthors: !!options.includeAuthors,
    includeNoindex: !!options.includeNoindex,
    maxBlogUrls: options.maxBlogUrls || 25,
    maxProducts: options.maxProducts || 50,
    websiteDescription: options.websiteDescription || '',
    concurrency: Math.min(Number(options.concurrency) || 4, 6)
  };
}

async function crawlSite(raw, options = {}) {
  const started = Date.now();
  const progress = options.onProgress || (() => {});
  const o = parseOptions(options);

  progress({ stage: 'validate', message: 'Validating domain…' });
  const input = await validateUrl(raw);
  progress({ stage: 'connect', message: 'Website connected' });

  const home = await safeFetch(input.toString(), options);
  const root = home.finalUrl;
  const origin = new URL(root).origin;
  const host = hostOf(root);

  progress({ stage: 'robots', message: 'Analyzing robots.txt…' });
  const robots = await fetchRobots(origin, options);
  if (!robots.allowed(root)) { const e = new Error('Crawling restricted by robots.txt'); e.code = 'robots'; throw e; }

  progress({ stage: 'sitemaps', message: 'Discovering sitemaps…' });
  const sitemaps = await discoverSitemaps(origin, robots, { ...options, onProgress: progress });
  const sitemapUrlSet = new Set(sitemaps.pageUrls.map(u => canonicalKey(u)));

  const homeParsed = /html/i.test(home.contentType) ? parsePage(home.body, root, home.headers) : { links: [], linkObjects: [], pdfLinks: [], types: [], text: '', wordCount: 0, paragraphs: [], h1: '', h2: [], breadcrumbs: [], title: '' };
  homeParsed.body = home.body;

  const platform = detectPlatform(home.body, home.headers);
  const existingLlmsTxt = await detectExistingLlmsTxt(origin, { body: home.body }, options);

  const queue = [{ url: root, depth: 0, fromSitemap: false }];
  const qSeen = new Set([canonicalKey(root)]);
  let discovered = 1;
  for (const loc of sitemaps.pageUrls) {
    if (queue.length >= o.maxPages) break;
    if (!isInternal(loc, root, o.includeSubdomains)) continue;
    const k = canonicalKey(loc);
    if (!qSeen.has(k)) { qSeen.add(k); queue.push({ url: loc, depth: 1, fromSitemap: true }); discovered++; }
  }

  const inlinks = new Map();
  function addInlinks(linkObjects) {
    for (const lo of (linkObjects || [])) {
      if (!isInternal(lo.url, root, o.includeSubdomains)) continue;
      const k = canonicalKey(lo.url);
      const e = inlinks.get(k) || { count: 0, nav: new Set(), footer: false };
      e.count++; if (lo.nav && lo.text) e.nav.add(lo.text); if (lo.footer) e.footer = true;
      inlinks.set(k, e);
    }
  }

  const pages = [];
  const externalCandidates = [];
  const externalSeen = new Set();
  let idx = 0;

  function collectExternal(link) {
    if (externalSeen.has(link) || externalCandidates.length >= 80) return;
    externalSeen.add(link);
    externalCandidates.push({ url: link, host: hostOf(link), external: true, included: false, inFile: false, status: null, title: hostOf(link), description: '', category: 'Other', kind: 'external', priority: 'Low' });
  }

  async function worker() {
    while (idx < queue.length && pages.length < o.maxPages) {
      const item = queue[idx++];
      const blocked = !robots.allowed(item.url);
      if (blocked) {
        pages.push({ url: item.url, depth: item.depth, status: 0, blocked: true, indexable: false, included: false, inFile: false, excludeReason: 'Robots', reason: 'Excluded: robots.txt restriction', fromSitemap: item.fromSitemap, inSitemap: item.fromSitemap || sitemapUrlSet.has(canonicalKey(item.url)) });
        continue;
      }
      const page = { url: item.url, requestedUrl: item.url, depth: item.depth, fromSitemap: item.fromSitemap, inSitemap: item.fromSitemap || sitemapUrlSet.has(canonicalKey(item.url)), status: 0, included: false, inFile: false, indexable: false, reason: '', canonicalized: false, broken: false };
      try {
        const r = await safeFetch(item.url, { ...options, maxBytes: 900 * 1024 });
        page.url = r.finalUrl;
        page.status = r.status;
        page.headers = r.headers;
        page.contentType = r.contentType;
        page.redirected = r.redirects.length > 0;
        page.redirects = r.redirects;
        page.challenge = r.challenge;
        const ct = String(r.contentType || '').toLowerCase();
        const isHtml = ct.includes('text/html') || ct.includes('application/xhtml');
        const isPdf = ct.includes('application/pdf') || isPdfUrl(r.finalUrl);

        if (isHtml) {
          const parsed = parsePage(r.body, r.finalUrl, r.headers);
          Object.assign(page, parsed);
          page.body = r.body;
          addInlinks(parsed.linkObjects);
        } else {
          page.isPdf = isPdf;
          page.wordCount = 0;
          page.types = [];
          page.h2 = [];
          page.paragraphs = [];
          page.breadcrumbs = [];
          page.linkObjects = [];
        }

        const ix = analyzeIndexability(page, { includeNoindex: o.includeNoindex, includePdfs: o.includePdfs });
        page.indexable = ix.indexable;
        page.statusNote = ix.status;

        const cd = canonicalDecision(page, root, o.includeSubdomains);
        page.canonicalFinal = cd.canonical;
        page.canonicalized = cd.canonicalized;
        if (cd.canonicalized) {
          page.canonical = cd.canonical;
          page.reason = 'Excluded: ' + cd.reason;
          page.excludeReason = 'Non-canonical';
          page.included = false;
          if (cd.canonical && isInternal(cd.canonical, root, o.includeSubdomains) && !qSeen.has(canonicalKey(cd.canonical)) && queue.length < o.maxPages) {
            qSeen.add(canonicalKey(cd.canonical));
            queue.push({ url: cd.canonical, depth: item.depth + 1, fromSitemap: false });
            discovered++;
          }
        } else {
          page.canonical = cd.canonical;
        }

        if (!page.canonicalized && ix.indexable && page.status !== 0) {
          if (item.depth < o.maxDepth) {
            for (const link of (page.links || [])) {
              if (queue.length >= o.maxPages) break;
              if (!isInternal(link, root, o.includeSubdomains)) { if (o.includeExternal) collectExternal(link); continue; }
              if (!robots.allowed(link)) continue;
              if (isAssetUrl(link) || isBinaryUrl(link) || isFeedUrl(link)) continue;
              const k = canonicalKey(link);
              if (!qSeen.has(k)) { qSeen.add(k); queue.push({ url: link, depth: item.depth + 1, fromSitemap: false }); discovered++; }
            }
          } else if (o.includeExternal) {
            for (const link of (page.links || [])) if (!isInternal(link, root, o.includeSubdomains)) collectExternal(link);
          }
        }
      } catch (e) {
        page.status = 0;
        page.broken = e.code === 'too_large' || e.code === 'unreachable' || e.code === 'dns' || e.code === 'timeout';
        page.indexable = false;
        page.included = false;
        if (e.code === 'too_large') { page.excludeReason = 'Unsupported'; page.reason = 'Excluded: oversized or unsupported response'; }
        else if (e.code === 'dns') { page.excludeReason = 'Broken'; page.reason = 'Excluded: DNS resolution failed'; }
        else if (e.code === 'timeout') { page.excludeReason = 'Broken'; page.reason = 'Excluded: request timed out'; }
        else if (e.code === 'cancelled') throw e;
        else { page.excludeReason = 'Broken'; page.reason = 'Excluded: ' + (e.message || 'fetch failed'); }
      }
      pages.push(page);
      progress({ stage: 'crawl', message: pages.length + ' pages analyzed', discovered, crawled: pages.length });
    }
  }

  await Promise.all(Array.from({ length: o.concurrency }, worker));

  if (o.includeExternal && externalCandidates.length) {
    progress({ stage: 'external', message: 'Checking external URLs…' });
    await Promise.all(externalCandidates.slice(0, 40).map(async (p) => {
      try {
        const r = await safeFetch(p.url, { ...options, maxBytes: 100 * 1024, accept: 'text/html,*/*;q=0.5' });
        p.status = r.status;
        p.reason = r.status === 200 ? 'External URL (available)' : 'External URL (HTTP ' + r.status + ')';
        p.excludeReason = 'External';
      } catch (e) {
        p.status = 0; p.reason = 'External URL (unreachable)'; p.excludeReason = 'External';
      }
    }));
  }

  return analyzeAndReport(pages, {
    input, root, host, homeParsed, platform, robots, sitemaps, existingLlmsTxt,
    discovered, started, externalCandidates, inlinks, options: o, progress
  });
}

/* Deterministic analysis + generation over already-collected pages. */
function analyzeAndReport(pages, ctx) {
  const o = ctx.options;
  const progress = ctx.progress || (() => {});

  progress({ stage: 'metadata', message: 'Analyzing metadata and relevance…' });

  // Inlink-derived signals (server crawl passes an inlinks map; browser pages arrive pre-populated).
  if (ctx.inlinks) {
    for (const p of pages) {
      const e = ctx.inlinks.get(canonicalKey(p.canonical || p.url)) || ctx.inlinks.get(canonicalKey(p.url));
      p.inlinks = e ? e.count : 0;
      p.navLinked = !!(e && e.nav && e.nav.size);
      p.footerLinked = !!(e && e.footer);
      p.navLabels = e ? [...e.nav] : [];
    }
  }

  dedupePages(pages);

  const site = { root: ctx.root, host: ctx.host, ecommerce: detectEcommerce(pages) };
  for (const p of pages) {
    if (p.blocked || p.duplicateOf) continue;
    const cl = classify(p, site);
    p.category = cl.category;
    p.signals = cl.signals;
  }

  for (const p of pages) {
    p.kind = p.kind || 'normal';
    if (p.blocked || p.duplicateOf) continue;
    const su = suitability(p, site, { includeAuthors: o.includeAuthors, includeCategories: o.includeCategories, includePdfs: o.includePdfs });
    p.kind = su.kind;
    p.score = score(p);
    p.priority = priorityBand(p.score);
    p.description = pageDescription(p);

    if (p.canonicalized) { /* already excluded */ }
    else if (p.statusNote === 'unverifiable') {
      p.included = false; p.excludeReason = 'Unable to verify'; p.reason = 'Unable to verify: ' + (p.reason || 'access restricted');
    }
    else if (!p.indexable) {
      if (p.excludeReason === undefined) p.excludeReason = mapIndexReason(p.reason);
      p.included = false;
    }
    else if (!su.ok) {
      p.included = false; p.excludeReason = su.reason; p.reason = 'Excluded: ' + su.reason;
    }
    else {
      p.included = true;
      if (p.category === 'Blog' && !o.includeBlog) { p.included = false; p.excludeReason = 'Blog (disabled)'; p.reason = 'Excluded: blog posts disabled'; }
      else if ((p.category === 'Documentation' || p.category === 'Knowledge Base') && !o.includeDocs) { p.included = false; p.excludeReason = 'Documentation (disabled)'; p.reason = 'Excluded: documentation disabled'; }
      else { p.excludeReason = null; p.reason = 'Included: indexable, relevant page'; }
    }
  }

  const unableToVerify = pages.filter(p => p.statusNote === 'unverifiable');
  progress({ stage: 'generate', message: 'Generating llms.txt…' });

  const homePageForDesc = pages.find(p => p.category === 'Home') || ctx.homeParsed || {};
  const siteTitle = homePageForDesc.title || (ctx.homeParsed && ctx.homeParsed.title) || ctx.host;
  const autoDescription = o.websiteDescription ? o.websiteDescription : websiteDescription({
    metaDescription: ctx.homeParsed ? ctx.homeParsed.metaDescription : '',
    ogDescription: ctx.homeParsed ? ctx.homeParsed.ogDescription : '',
    paragraphs: ctx.homeParsed ? ctx.homeParsed.paragraphs : [],
    title: ctx.homeParsed ? ctx.homeParsed.title : ''
  }, siteTitle);

  const includedPages = pages.filter(p => p.included && !p.external);
  const selectionOptions = { includeDocs: o.includeDocs, includeBlog: o.includeBlog, includeCategories: o.includeCategories, includeAuthors: o.includeAuthors, includePdfs: o.includePdfs, maxBlogUrls: o.maxBlogUrls, maxProducts: o.maxProducts };
  const { sections } = selectPages(includedPages, site, selectionOptions);
  const llmsTxt = renderSections(sections, { name: siteTitle, title: siteTitle, host: ctx.host, description: autoDescription });

  progress({ stage: 'validate', message: 'Validating output…' });
  const validation = validateLlmsTxt(llmsTxt);

  const allPagesForTable = pages.concat(ctx.externalCandidates || []);
  const stats = summarize(pages, ctx.discovered, ctx.started);
  stats.external = (ctx.externalCandidates || []).length;
  const quality = scoreQuality({ included: allPagesForTable.filter(p => p.inFile || p.included), validation, stats, site });

  progress({ stage: 'done', message: 'LLMs.txt generated' });

  return {
    mode: 'generate',
    input: ctx.input.toString(),
    finalUrl: ctx.root,
    host: ctx.host,
    site: {
      name: siteTitle, title: siteTitle, host: ctx.host, description: autoDescription,
      descriptionAuto: !o.websiteDescription, platform: ctx.platform || [],
      ecommerce: site.ecommerce, jsHeavy: pages.some(p => p.jsHeavy)
    },
    robots: {
      exists: ctx.robots ? ctx.robots.exists : false,
      url: ctx.robots ? ctx.robots.url : null,
      crawlDelay: ctx.robots ? ctx.robots.crawlDelay : null,
      sitemaps: ctx.robots ? ctx.robots.sitemaps : [],
      restrictedCount: pages.filter(p => p.blocked).length
    },
    sitemaps: (ctx.sitemaps && ctx.sitemaps.sitemaps ? ctx.sitemaps.sitemaps : []).map(s => ({ url: s.url, isIndex: s.isIndex, count: s.count })),
    existingLlmsTxt: ctx.existingLlmsTxt || null,
    pages: allPagesForTable.map(p => ({
      url: p.url,
      title: p.title || '',
      description: p.description || '',
      category: p.category || 'Other',
      kind: p.kind || 'normal',
      priority: p.priority || priorityBand(p.score || 0),
      status: p.status,
      canonical: p.canonical || '',
      canonicalized: !!p.canonicalized,
      included: !!p.included,
      inFile: !!p.inFile,
      section: p.section || null,
      reason: p.reason || '',
      excludeReason: p.excludeReason || null,
      depth: p.depth,
      wordCount: p.wordCount || 0,
      noindex: !!p.noindex,
      duplicateOf: p.duplicateOf || null,
      redirected: !!p.redirected,
      isPdf: !!p.isPdf,
      external: !!p.external,
      publishedDate: p.publishedDate || null,
      modifiedDate: p.modifiedDate || null,
      blocked: !!p.blocked
    })),
    llmsTxt,
    validation,
    quality,
    stats,
    exclusionReasons: groupReasons(pages),
    unableToVerify: unableToVerify.length,
    warnings: {
      robotsRestricted: pages.some(p => p.blocked),
      jsHeavy: pages.some(p => p.jsHeavy),
      unableToVerify: unableToVerify.length,
      truncated: ctx.discovered > pages.length
    }
  };
}

function mapIndexReason(reason) {
  const r = String(reason || '');
  if (/noindex/i.test(r)) return 'Noindex';
  if (/404|410/i.test(r)) return 'Broken';
  if (/5xx/i.test(r)) return 'Broken';
  if (/content type/i.test(r)) return 'Unsupported';
  if (/redirect/i.test(r)) return 'Redirect';
  return 'Other';
}

module.exports = { crawlSite, analyzeAndReport, parseOptions };
