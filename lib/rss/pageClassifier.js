'use strict';

/*
 * RSS Feed Generator — page classification.
 * Deterministic signal voting. Classifies every discovered page as one of:
 *   Article | Blog Post | News Article | Guide | Documentation | Product |
 *   Category | Tag | Author | Homepage | Static Page | Other
 * and whether it belongs in a content feed by default (articles, posts,
 * guides, news). Never assumes a URL is an article purely from its path —
 * structural metadata (JSON-LD types, <article>, dates, content length)
 * carries the strongest weight.
 */

const { pathOf, segmentsOf } = require('../llmstxt/urlNormalizer');

const ARTICLE_TYPES = new Set(['article', 'blogposting', 'newsarticle', 'techarticle', 'review', 'report']);
const GUIDE_TYPES = new Set(['howto', 'tutorial', 'recipe', 'course', 'learningresource']);
const DOC_TYPES = new Set(['softwareapplication', 'webapplication', 'api', 'databasetable']);
const PRODUCT_TYPES = new Set(['product', 'offer', 'course']);

/* Explicit taxonomy paths: /category/x, /tag/x, /author/x — these are
 * indexes, not articles. */
const PATH_TAXONOMY = [
  { type: 'Tag', re: /^\/(tag|tags)\//i },
  { type: 'Author', re: /^\/(author|authors|writers?|staff)\//i },
  { type: 'Author', re: /^\/by\/[^/]+\/?$/i },
  { type: 'Category', re: /^\/(category|categories|section|sections|topic|topics|c)\//i }
];

/* Content section prefixes: /blog/my-article, /news/story — articles live
 * here; a single slug under them may be a section index (detected below). */
const PATH_SECTIONS = [
  { type: 'Blog Post', re: /^\/(blog|post|posts|article|articles|news|press|updates|insights|journal|stories|story|media)\//i },
  { type: 'Guide', re: /^\/(guide|guides|how-to|howto|tutorial|tutorials|resources)\//i }
];

const SECTION_INDEX_RE = /^\/(blog|post|posts|article|articles|news|press|updates|insights|journal|stories|story|media|guide|guides|how-to|howto|tutorial|tutorials|resources)\/[^/]+\/?$/i;

/* Product / documentation path hints. */
const PATH_MISC = [
  { type: 'Product', re: /^\/(product|products|shop|store|item|items|cart|checkout|account|wishlist)\//i },
  { type: 'Documentation', re: /^\/(docs|documentation|reference|api|developer|developers|manual|knowledge-base|kb|help|support|faq|faqs)\//i }
];
const STATIC_PATHS = new Set([
  'about', 'about-us', 'contact', 'contact-us', 'privacy', 'privacy-policy', 'terms', 'terms-of-service',
  'cookies', 'cookie-policy', 'disclaimer', 'sitemap', 'search', 'login', 'log-in', 'signin', 'sign-in',
  'register', 'signup', 'sign-up', 'cart', 'checkout', 'account', 'pricing', 'careers', 'jobs', 'imprint',
  'legal', 'licensing', 'media-kit', '404', 'home'
]);

function classify(page) {
  const url = page.url || '';
  const path = pathOf(url);
  const segs = segmentsOf(url);
  const types = (page.types || []).map(t => String(t || '').toLowerCase());
  const signals = [];
  const hasArticleTag = !!page.hasArticleTag;
  const hasDate = !!(page.dateSource && page.dateSource !== 'sitemap-lastmod');
  const wordCount = page.wordCount || 0;
  const crumbs = (page.breadcrumbs || []).map(s => String(s || '').toLowerCase());

  // Homepage.
  if (path === '/') return { type: 'Homepage', feedable: false, signals: ['homepage'] };

  // Explicit taxonomy paths (/category/x, /tag/x, /author/x) are indexes.
  let taxType = null;
  for (const r of PATH_TAXONOMY) { if (r.re.test(path)) { taxType = r.type; break; } }
  if (taxType) return { type: taxType, feedable: false, signals: ['url-taxonomy'] };

  // Content section prefixes (/blog/my-article …). A single slug under a
  // section may still be a section index: detect from listing signals
  // (many links, thin content, no article structure, no date).
  let pathType = null;
  for (const r of PATH_SECTIONS) { if (r.re.test(path)) { pathType = r.type; break; } }
  if (pathType && SECTION_INDEX_RE.test(path)) {
    const isIndex = (page.linkCount || 0) >= 8 && !hasArticleTag && !hasDate && wordCount < 120;
    if (isIndex) return { type: 'Category', feedable: false, signals: ['section-index'] };
  }

  // Product / documentation paths (deterministic, checked before date-based
  // article inference so dated docs pages are not fed as articles).
  let miscType = null;
  for (const r of PATH_MISC) { if (r.re.test(path)) { miscType = r.type; break; } }

  // Structured data (strongest).
  const articleType = types.find(t => ARTICLE_TYPES.has(t));
  const guideType = types.find(t => GUIDE_TYPES.has(t));
  const productType = types.find(t => PRODUCT_TYPES.has(t));
  const docType = types.find(t => DOC_TYPES.has(t));

  if (articleType) {
    const isNews = articleType === 'newsarticle';
    return { type: isNews ? 'News Article' : 'Blog Post', feedable: true, signals: ['jsonld:' + articleType] };
  }
  if (guideType) return { type: 'Guide', feedable: true, signals: ['jsonld:' + guideType] };
  if (productType) return { type: 'Product', feedable: false, signals: ['jsonld:' + productType] };
  if (miscType === 'Documentation' || docType) {
    return { type: 'Documentation', feedable: false, signals: docType ? ['jsonld:' + docType] : ['url-docs-path'] };
  }
  if (miscType === 'Product') return { type: 'Product', feedable: false, signals: ['url-product-path'] };

  // Article tag + date + substantive content = Article (even without path hints).
  if (hasArticleTag && hasDate && wordCount >= 80) return { type: 'Article', feedable: true, signals: ['article-tag', 'date', 'content-length'] };
  if (hasArticleTag && wordCount >= 150) return { type: 'Article', feedable: true, signals: ['article-tag', 'content-length'] };
  if (hasDate && wordCount >= 150) return { type: 'Article', feedable: true, signals: ['date', 'content-length'] };

  // Path hints combined with some content.
  if (pathType === 'Blog Post' && wordCount >= 60) return { type: 'Blog Post', feedable: true, signals: ['url-blog-path', 'content-length'] };
  if (pathType === 'Guide' && wordCount >= 60) return { type: 'Guide', feedable: true, signals: ['url-guide-path', 'content-length'] };

  // Breadcrumb hints: "Home > Blog > Post".
  const crumbText = crumbs.join(' > ');
  if (/blog|news|articles?|posts?|press/i.test(crumbText) && wordCount >= 80) return { type: 'Blog Post', feedable: true, signals: ['breadcrumb', 'content-length'] };
  if (/guide|how[- ]?to|tutorial/i.test(crumbText) && wordCount >= 80) return { type: 'Guide', feedable: true, signals: ['breadcrumb', 'content-length'] };

  // Static/utility pages by well-known paths.
  if (segs.length && STATIC_PATHS.has(segs[0].toLowerCase())) return { type: 'Static Page', feedable: false, signals: ['static-path'] };

  // Substantive standalone page with a date but nothing else: likely an article.
  if (hasDate && wordCount >= 200) return { type: 'Article', feedable: true, signals: ['date', 'content-length'] };
  if (wordCount >= 400 && hasArticleTag) return { type: 'Article', feedable: true, signals: ['article-tag', 'content-length'] };

  // og:type fallback.
  if (/^article$/i.test(page.ogType || '')) return { type: 'Article', feedable: wordCount >= 50, signals: ['og-type'] };

  if (wordCount < 60) return { type: 'Other', feedable: false, signals: ['thin-content'] };
  return { type: 'Other', feedable: false, signals: [] };
}

/* Map a classified type to the default feed inclusion set. */
const DEFAULT_FEEDABLE_TYPES = new Set(['Article', 'Blog Post', 'News Article', 'Guide']);

function isFeedable(type) {
  return DEFAULT_FEEDABLE_TYPES.has(type);
}

module.exports = { classify, isFeedable, DEFAULT_FEEDABLE_TYPES, ARTICLE_TYPES };
