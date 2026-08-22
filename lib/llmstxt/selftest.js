'use strict';

/*
 * LLMs.txt Generator, offline self-test.
 * Run: node lib/llmstxt/selftest.js
 * Exercises the deterministic engine end-to-end (no network): parsing,
 * classification, suitability, scoring, description generation, canonical/
 * noindex/duplicate handling, llms.txt generation, validation and quality.
 */

const assert = require('assert');
const { analyzeAndReport, parseOptions } = require('./crawler');
const { parsePage } = require('./pageParser');
const { classify } = require('./pageClassifier');
const { suitability } = require('./suitabilityFilter');
const { score } = require('./importanceScorer');
const { pageDescription, websiteDescription } = require('./descriptionGenerator');
const { validateLlmsTxt } = require('./llmsTxtValidator');
const { parseRobots } = require('./robotsParser');
const { canonicalKey, normalizeUrl, hasTrackingParams } = require('./urlNormalizer');
const { extractLocs } = require('./sitemapDiscovery');
const { selectPages, renderSections } = require('./llmsTxtGenerator');
const { dedupePages } = require('./duplicateAnalyzer');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  \u2713 ' + name); }
  catch (e) { fail++; console.log('  \u2717 ' + name + '\n    ' + (e && e.message)); }
}

const ROOT = 'https://acme.test';

function mkPage(o) {
  return Object.assign({
    url: ROOT + '/', depth: 1, status: 200, headers: { 'content-type': 'text/html' }, contentType: 'text/html',
    redirected: false, redirects: [], challenge: null, title: 'Page', metaDescription: '', ogTitle: '', ogDescription: '',
    ogType: '', ogSiteName: '', canonical: null, noindex: false, h1: '', h2: [], types: [], breadcrumbs: [],
    text: 'This is a meaningful page with enough words to be useful and informative for readers and machines alike.',
    wordCount: 20, paragraphs: [], publishedDate: null, modifiedDate: null, jsHeavy: false, isPdf: false,
    links: [], linkObjects: [], fromSitemap: false, inSitemap: false, inlinks: 0, navLinked: false, footerLinked: false, navLabels: [],
    indexable: true, statusNote: 'included', canonicalized: false, included: true
  }, o);
}

function ctx(pages, o) {
  return {
    input: new URL(ROOT), root: ROOT, host: 'acme.test',
    homeParsed: { metaDescription: 'Acme builds widgets for teams.', ogDescription: '', paragraphs: [], title: 'Acme Inc' },
    platform: ['Static'], robots: { exists: true, url: ROOT + '/robots.txt', sitemaps: [], crawlDelay: null },
    sitemaps: { sitemaps: [] }, existingLlmsTxt: null,
    discovered: pages.length, started: Date.now(), externalCandidates: [], inlinks: null,
    options: parseOptions(o || {}), progress: () => {}
  };
}

console.log('\nLLMs.txt Generator, selftest');

/* ---- robots.txt parser ---- */
t('robots: disallow rule blocks path', () => {
  const r = parseRobots('User-agent: *\nDisallow: /private/\nSitemap: https://acme.test/sitemap.xml');
  assert.strictEqual(r.allowed('https://acme.test/private/x'), false);
  assert.strictEqual(r.allowed('https://acme.test/public/x'), true);
  assert.deepStrictEqual(r.sitemaps, ['https://acme.test/sitemap.xml']);
});
t('robots: allow overrides disallow (more specific)', () => {
  const r = parseRobots('User-agent: *\nDisallow: /\nAllow: /public/\n');
  assert.strictEqual(r.allowed('https://acme.test/public/x'), true);
  assert.strictEqual(r.allowed('https://acme.test/other'), false);
});

/* ---- url normalisation ---- */
t('url: tracking params stripped', () => {
  assert.ok(hasTrackingParams('https://acme.test/a?utm_source=x&id=1'));
  assert.strictEqual(normalizeUrl('https://acme.test/a?utm_source=x&id=1', ROOT), 'https://acme.test/a?id=1');
});
t('url: canonical key collapses www/trailing slash/tracking', () => {
  assert.strictEqual(canonicalKey('https://www.acme.test/a/?utm_medium=x'), canonicalKey('https://acme.test/a'));
});

/* ---- sitemap loc extraction ---- */
t('sitemap: extracts locs including index children', () => {
  const xml = '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://acme.test/sitemap-1.xml</loc></sitemap></sitemapindex>';
  const locs = extractLocs(xml, ROOT);
  assert.deepStrictEqual(locs, ['https://acme.test/sitemap-1.xml']);
});

/* ---- parsePage ---- */
t('parsePage: extracts title/meta/og/canonical/h1/h2/wordcount/links', () => {
  const html = '<html><head><title>Docs | Acme</title><meta name="description" content="Installation docs."><meta property="og:description" content="OG docs desc."><link rel="canonical" href="https://acme.test/docs"></head><body><main><h1>Documentation</h1><h2>Install</h2><h2>API</h2><p>Learn how to install and configure Acme widgets in your project step by step with examples and code snippets.</p><a href="/docs/install">Install</a><a href="https://other.test/x">External</a></main></body></html>';
  const p = parsePage(html, 'https://acme.test/docs', {});
  assert.strictEqual(p.title, 'Docs | Acme');
  assert.strictEqual(p.metaDescription, 'Installation docs.');
  assert.strictEqual(p.ogDescription, 'OG docs desc.');
  assert.strictEqual(p.canonical, 'https://acme.test/docs');
  assert.strictEqual(p.h1, 'Documentation');
  assert.strictEqual(p.h2.length, 2);
  assert.ok(p.wordCount >= 10);
  assert.ok(p.links.includes('https://acme.test/docs/install'));
  assert.ok(p.links.includes('https://other.test/x'));
});

/* ---- classification ---- */
t('classify: /docs/ -> Documentation', () => {
  assert.strictEqual(classify(mkPage({ url: ROOT + '/docs/install' }), { root: ROOT, ecommerce: false }).category, 'Documentation');
});
t('classify: /blog/ + article type -> Blog', () => {
  assert.strictEqual(classify(mkPage({ url: ROOT + '/blog/post', types: ['BlogPosting'], ogType: 'article' }), { root: ROOT, ecommerce: false }).category, 'Blog');
});
t('classify: /product/ -> Products', () => {
  assert.strictEqual(classify(mkPage({ url: ROOT + '/product/widget', types: ['Product'] }), { root: ROOT, ecommerce: true }).category, 'Products');
});
t('classify: root -> Home', () => {
  assert.strictEqual(classify(mkPage({ url: ROOT + '/' }), { root: ROOT, ecommerce: false }).category, 'Home');
});

/* ---- suitability ---- */
t('suitability: excludes login/cart/tag/search', () => {
  assert.strictEqual(suitability(mkPage({ url: ROOT + '/login' }), {}, {}).ok, false);
  assert.strictEqual(suitability(mkPage({ url: ROOT + '/cart' }), {}, {}).ok, false);
  assert.strictEqual(suitability(mkPage({ url: ROOT + '/tag/x' }), {}, {}).ok, false);
  assert.strictEqual(suitability(mkPage({ url: ROOT + '/?s=hello' }), {}, {}).ok, false);
});
t('suitability: category/author gated by toggles', () => {
  assert.strictEqual(suitability(mkPage({ url: ROOT + '/category/x' }), {}, { includeCategories: false }).ok, false);
  assert.strictEqual(suitability(mkPage({ url: ROOT + '/category/x' }), {}, { includeCategories: true }).ok, true);
  assert.strictEqual(suitability(mkPage({ url: ROOT + '/author/jane' }), {}, { includeAuthors: false }).ok, false);
});

/* ---- scoring ---- */
t('score: homepage = 100, deep utility lower', () => {
  assert.strictEqual(score({ category: 'Home', url: ROOT + '/' }), 100);
  const deep = score(mkPage({ category: 'Other', depth: 4, wordCount: 10 }));
  assert.ok(deep < 55, 'deep utility page should score low, got ' + deep);
});

/* ---- descriptions ---- */
t('description: priority meta > og > paragraph > title', () => {
  const p = mkPage({ title: 'Fallback title', metaDescription: 'Meta description here.', ogDescription: 'OG desc.', paragraphs: ['A long meaningful paragraph that describes what this page is about in detail.'] });
  assert.strictEqual(pageDescription(p), 'Meta description here.');
  assert.strictEqual(pageDescription(mkPage({ title: 'Fallback title', paragraphs: ['A long meaningful paragraph that describes what this page is about in detail.'] })), 'A long meaningful paragraph that describes what this page is about in detail.');
});
t('description: website description uses homepage meta', () => {
  assert.strictEqual(websiteDescription({ metaDescription: 'Site meta desc here.', ogDescription: '', paragraphs: [] }, 'Acme'), 'Site meta desc here.');
});

/* ---- duplicate detection ---- */
t('dedupe: canonical-key duplicates excluded', () => {
  const pages = [mkPage({ url: ROOT + '/a' }), mkPage({ url: 'https://www.acme.test/a/' })];
  dedupePages(pages);
  assert.ok(pages[1].duplicateOf);
});

/* ---- full pipeline: docs + blog + products site ---- */
t('pipeline: generates valid llms.txt with sections', () => {
  const pages = [
    mkPage({ url: ROOT + '/', title: 'Acme Inc', category: 'Home', navLinked: true, inSitemap: true }),
    mkPage({ url: ROOT + '/about', title: 'About Acme', h1: 'About', wordCount: 120 }),
    mkPage({ url: ROOT + '/contact', title: 'Contact', h1: 'Contact us', wordCount: 90 }),
    mkPage({ url: ROOT + '/docs/install', title: 'Install guide', h1: 'Installation', h2: ['Step 1', 'Step 2'], wordCount: 500, navLinked: true, inSitemap: true }),
    mkPage({ url: ROOT + '/docs/api', title: 'API reference', h1: 'API', wordCount: 400, inSitemap: true }),
    mkPage({ url: ROOT + '/blog/post-1', title: 'First post', types: ['BlogPosting'], ogType: 'article', wordCount: 600 }),
    mkPage({ url: ROOT + '/product/widget', title: 'Widget', types: ['Product'], wordCount: 150 }),
    mkPage({ url: ROOT + '/login', title: 'Login' })
  ];
  const report = analyzeAndReport(pages, ctx(pages, {}));
  assert.ok(report.llmsTxt.includes('# Acme'), 'has H1');
  assert.ok(report.llmsTxt.includes('> Acme builds widgets for teams.'), 'has blockquote');
  assert.ok(report.llmsTxt.includes('## Important Pages'), 'important pages section');
  assert.ok(report.llmsTxt.includes('## Documentation'), 'docs section');
  assert.ok(report.llmsTxt.includes('## Blog'), 'blog section');
  assert.ok(report.llmsTxt.includes('## Products'), 'products section');
  assert.strictEqual(report.validation.valid, true);
  assert.ok(report.quality >= 0 && report.quality <= 100);
  assert.ok(report.pages.some(p => p.url.includes('/login') && !p.included), 'login excluded');
});

t('pipeline: noindex + canonical + broken handled', () => {
  const pages = [
    mkPage({ url: ROOT + '/', title: 'Acme', category: 'Home' }),
    mkPage({ url: ROOT + '/hidden', noindex: true, indexable: false, statusNote: 'excluded', reason: 'Excluded: noindex' }),
    mkPage({ url: ROOT + '/dup', canonical: ROOT + '/new-home', canonicalized: true, canonical: ROOT + '/new-home', reason: 'Excluded: Canonical points to another URL', excludeReason: 'Non-canonical' }),
    mkPage({ url: ROOT + '/gone', status: 404, indexable: false, statusNote: 'excluded', reason: 'Excluded: HTTP 404', excludeReason: 'Broken' })
  ];
  const report = analyzeAndReport(pages, ctx(pages, {}));
  assert.strictEqual(report.stats.noindex, 1);
  assert.strictEqual(report.stats.canonicalized, 1);
  assert.strictEqual(report.stats.broken, 1);
  assert.ok(report.validation.valid);
});

t('pipeline: respect robots-restricted pages', () => {
  const pages = [
    mkPage({ url: ROOT + '/', title: 'Acme', category: 'Home' }),
    mkPage({ url: ROOT + '/admin/x', blocked: true, status: 0, reason: 'Excluded: robots.txt restriction', excludeReason: 'Robots', indexable: false, included: false })
  ];
  const report = analyzeAndReport(pages, ctx(pages, {}));
  assert.ok(report.warnings.robotsRestricted);
  assert.ok(report.pages.some(p => p.blocked && !p.included));
});

/* ---- validator ---- */
t('validator: rejects missing H1 / duplicate URLs / bad heading', () => {
  assert.strictEqual(validateLlmsTxt('# A\n\n> desc\n\n## Docs\n- [x](https://a.test/b): d').valid, true);
  assert.strictEqual(validateLlmsTxt('> desc\n\n## Docs\n- [x](https://a.test/b): d').valid, false); // no H1
  assert.strictEqual(validateLlmsTxt('# A\n\n> d\n\n## Docs\n- [x](https://a.test/b): d\n- [y](https://a.test/b/): e').valid, false); // duplicate URL (trailing slash)
  assert.strictEqual(validateLlmsTxt('# A\n\n> d\n\n### Bad\n- [x](https://a.test/b)').valid, false); // H3
});

/* ---- generator selection ---- */
t('generator: user order respected within a section', () => {
  const pages = [
    mkPage({ url: ROOT + '/docs/a', title: 'A', category: 'Documentation', included: true, score: 90, order: 2 }),
    mkPage({ url: ROOT + '/docs/b', title: 'B', category: 'Documentation', included: true, score: 95, order: 1 })
  ];
  const { sections } = selectPages(pages, { root: ROOT, ecommerce: false }, { includeDocs: true, includeBlog: true, includeCategories: false, includeAuthors: false, includePdfs: true, maxBlogUrls: 25, maxProducts: 50 });
  const docs = sections['Documentation'];
  assert.strictEqual(docs[0].url, ROOT + '/docs/b'); // order 1 first despite lower score
});

t('generator: no arbitrary empty sections', () => {
  const pages = [mkPage({ url: ROOT + '/', title: 'Acme', category: 'Home', included: true })];
  const out = renderSections(selectPages(pages, { root: ROOT, ecommerce: false }, { includeDocs: true, includeBlog: true, includeCategories: false, includeAuthors: false, includePdfs: true, maxBlogUrls: 25, maxProducts: 50 }).sections, { name: 'Acme', description: 'd' });
  assert.ok(!out.includes('## Documentation'));
  assert.ok(!out.includes('## Blog'));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
