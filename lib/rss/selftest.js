'use strict';

/*
 * RSS Feed Generator, offline self-test.
 * Run: node lib/rss/selftest.js
 * Exercises the deterministic engine end-to-end without network: escaping,
 * date parsing, feed parsing, sanitization, metadata priorities,
 * classification, dedup, RSS/Atom generation, XML validation, quality
 * scoring, comparison and the full analysis pipeline on fixture pages.
 */

const assert = require('assert');
const { escapeXml, escapeAttr, cdata } = require('./xmlEscaper');
const { parseDate, toRfc822, isValidRfc822 } = require('./dateExtractor');
const { wellFormed, findElements, textOf, attrOf } = require('./xmlParser');
const { parseFeed } = require('./feedParser');
const { sanitizeHtml, cleanDescription } = require('./contentSanitizer');
const { extractArticle, pickTitle, pickDate, pickDescription } = require('./articleExtractor');
const { classify, isFeedable } = require('./pageClassifier');
const { dedupeItems } = require('./duplicateDetector');
const { generateRss } = require('./rssGenerator');
const { generateAtom } = require('./atomGenerator');
const { validateRss } = require('./xmlValidator');
const { scoreFeed } = require('./feedQualityScorer');
const { compareFeeds } = require('./feedComparator');
const { analyzeAndReport, parseOptions } = require('./crawler');
const { feedLinkTags } = require('./feedDetector');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  \u2713 ' + name); }
  catch (e) { fail++; console.log('  \u2717 ' + name + '\n    ' + (e && e.message)); }
}

const ROOT = 'https://acme.test/';
const HOST = 'acme.test';

console.log('\nRSS Feed Generator, selftest');

/* ---- escaping ---- */
t('escape: Tom & Jerry → valid XML', () => {
  assert.strictEqual(escapeXml('Tom & Jerry'), 'Tom &amp; Jerry');
  assert.strictEqual(escapeXml('<b>"quotes" & \'apostrophes\'</b>'), '&lt;b&gt;"quotes" &amp; \'apostrophes\'&lt;/b&gt;');
  assert.ok(escapeXml('<x>').includes('&lt;x&gt;'));
  assert.strictEqual(escapeAttr('a"b'), 'a&quot;b');
  assert.strictEqual(cdata('<p>hi</p>'), '<![CDATA[<p>hi</p>]]>');
  assert.ok(!cdata('x]]>y').includes('x]]>y'));
  // control chars removed
  assert.ok(!escapeXml('a\u0000b').includes('\u0000'));
});

/* ---- dates ---- */
t('dates: ISO / RFC822 / human formats parse', () => {
  assert.ok(parseDate('2026-08-21', 'structured-data'));
  assert.ok(parseDate('2026-08-21T12:00:00Z', 'structured-data'));
  assert.ok(parseDate('2026-08-21T14:00:00+02:00', 'structured-data'));
  assert.ok(parseDate('Fri, 21 Aug 2026 12:00:00 GMT', 'article-published-time'));
  assert.ok(parseDate('August 21, 2026', 'visible'));
  assert.ok(parseDate('21 August 2026', 'visible'));
  const d = parseDate('2026-02-30', 'structured-data');
  assert.strictEqual(d, null); // impossible date rejected
  assert.strictEqual(parseDate('yesterday', 'visible'), null);
  assert.strictEqual(parseDate('', 'structured-data'), null);
});
t('dates: RFC822 round-trip + validation', () => {
  const s = toRfc822(new Date(Date.UTC(2026, 7, 21, 12, 0, 0)));
  assert.strictEqual(s, 'Fri, 21 Aug 2026 12:00:00 GMT');
  assert.ok(isValidRfc822(s));
  assert.ok(!isValidRfc822('2026-08-21'));
});
t('dates: priority, structured data wins over sitemap lastmod', () => {
  const x = { structuredRaw: '2026-01-02', metaRaw: '2026-03-03', timeInfo: null, visibleInfo: null };
  assert.strictEqual(pickDate(x, null).source, 'structured-data');
  const y = { structuredRaw: '', metaRaw: '', timeInfo: null, visibleInfo: null };
  const d = pickDate(y, '2025-06-01T00:00:00Z');
  assert.strictEqual(d.source, 'sitemap-lastmod');
  assert.strictEqual(d.reliable, false);
  assert.strictEqual(pickDate({ structuredRaw: '', metaRaw: '', timeInfo: null, visibleInfo: null }, null), null);
});

/* ---- xml parser ---- */
t('xml: well-formedness detects broken docs', () => {
  assert.strictEqual(wellFormed('<rss><channel><title>a</title></channel></rss>').ok, true);
  assert.strictEqual(wellFormed('<rss><channel><title>a</title></rss>').ok, false); // unclosed
  assert.strictEqual(wellFormed('<rss><title>a & b</title></rss>').ok, false); // unescaped &
  assert.strictEqual(wellFormed('').ok, false);
});
t('xml: element extraction + CDATA text', () => {
  const els = findElements('<x><a t="1">one</a><a><![CDATA[<b>two</b>]]></a></x>', 'a');
  assert.strictEqual(els.length, 2);
  assert.strictEqual(textOf(els[1]), '<b>two</b>');
  assert.strictEqual(attrOf(els[0], 't'), '1');
});

/* ---- feed parser ---- */
const RSS_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
<title>Acme News &amp; Views</title>
<link>https://acme.test/</link>
<description>Testing feed</description>
<item>
<title>Tom &amp; Jerry</title>
<link>https://acme.test/blog/tom-and-jerry</link>
<guid isPermaLink="true">https://acme.test/blog/tom-and-jerry</guid>
<description><![CDATA[<p>A classic.</p>]]></description>
<pubDate>Fri, 21 Aug 2026 12:00:00 GMT</pubDate>
<media:content url="https://acme.test/img/tj.jpg" medium="image"/>
</item>
<item><title>Plain</title><link>https://acme.test/blog/plain</link><description>text</description></item>
</channel>
</rss>`;
t('feedparser: RSS 2.0 with entities + CDATA + media', () => {
  const f = parseFeed(RSS_SAMPLE);
  assert.ok(f);
  assert.strictEqual(f.format, 'rss2');
  assert.strictEqual(f.title, 'Acme News & Views');
  assert.strictEqual(f.items.length, 2);
  assert.strictEqual(f.items[0].title, 'Tom & Jerry');
  assert.strictEqual(f.items[0].description, '<p>A classic.</p>');
  assert.strictEqual(f.items[0].image, 'https://acme.test/img/tj.jpg');
  assert.strictEqual(f.items[0].pubDate, 'Fri, 21 Aug 2026 12:00:00 GMT');
});
t('feedparser: Atom 1.0', () => {
  const f = parseFeed('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>A</title><link rel="alternate" href="https://acme.test/"/><id>urn:acme</id><updated>2026-08-21T00:00:00Z</updated><entry><title>E1</title><link rel="alternate" href="https://acme.test/e1"/><id>urn:e1</id><published>2026-08-01T00:00:00Z</published><summary>s1</summary><author><name>Ann</name></author></entry></feed>');
  assert.ok(f);
  assert.strictEqual(f.format, 'atom');
  assert.strictEqual(f.items[0].author, 'Ann');
  assert.strictEqual(f.items[0].pubDate, '2026-08-01T00:00:00Z');
});
t('feedparser: rejects HTML at /feed/', () => {
  assert.strictEqual(parseFeed('<html><body><div>not a feed</div></body></html>'), null);
});

/* ---- feed link tags ---- */
t('feedlinktags: rel=alternate RSS/Atom discovered', () => {
  const refs = feedLinkTags('<link rel="alternate" type="application/rss+xml" title="Acme" href="/feed/"><link rel="alternate" type="application/atom+xml" href="https://acme.test/atom.xml"><link rel="canonical" href="/">', ROOT);
  assert.strictEqual(refs.length, 2);
  assert.strictEqual(refs[0].url, 'https://acme.test/feed/');
});

/* ---- sanitizer ---- */
t('sanitize: removes scripts/iframes/forms, keeps content', () => {
  const dirty = '<h2>Head</h2><p>Para <a href="https://acme.test/x">link</a></p><script>evil()</script><style>.x{}</style><iframe src="https://evil"></iframe><form><input></form><div class="cookie-banner">We use cookies!</div><p onclick="x()">Two</p><a href="javascript:alert(1)">bad</a><img src="/ok.jpg" alt="ok">';
  const clean = sanitizeHtml(dirty);
  assert.ok(!/script/i.test(clean));
  assert.ok(!/iframe/i.test(clean));
  assert.ok(!/form/i.test(clean));
  assert.ok(!/onclick/i.test(clean));
  assert.ok(!/javascript:/i.test(clean));
  assert.ok(!/cookie-banner/i.test(clean));
  assert.ok(/<h2>Head<\/h2>/.test(clean));
  assert.ok(/<a href="https:\/\/acme\.test\/x">/.test(clean));
  assert.ok(/<img src="\/ok\.jpg"/.test(clean));
});
t('sanitize: description cleaning strips boilerplate', () => {
  const d = cleanDescription('Cookie notice: we use cookies. Real description follows here and it is meaningful enough to survive the cut. ');
  assert.ok(!/cookie/i.test(d));
  assert.ok(d.startsWith('Real description'));
  const long = cleanDescription('word '.repeat(200), { maxLength: 100 });
  assert.ok(long.length <= 105);
});

/* ---- article extraction ---- */
const ARTICLE_HTML = `<!doctype html><html lang="en"><head>
<title>Great Post | Acme</title>
<meta name="description" content="A meta description for the great post.">
<meta property="og:title" content="OG Great Post">
<meta property="og:image" content="/img/great.jpg">
<meta property="article:published_time" content="2026-07-04T09:30:00Z">
<link rel="canonical" href="https://acme.test/blog/great-post">
<script type="application/ld+json">{"@type":"NewsArticle","headline":"JSONLD Great Post","datePublished":"2026-07-04T09:30:00Z","author":{"@type":"Person","name":"Ann Author"},"articleSection":"Technology","image":"https://acme.test/img/great.jpg"}</script>
</head><body><header>nav</header>
<article>
<h1>Great Post</h1>
<p>Published by Ann Author on 4 July 2026</p>
<p>The first paragraph of the great post explains why it matters to readers and why the team wrote it down. It has enough words to be meaningful.</p>
<p>Second paragraph with details about the implementation and the results.</p>
<script>track()</script>
<img src="/img/great.jpg" alt="great">
<a href="/author/ann">Ann Author</a>
</article>
<footer>© 2026 Acme</footer></body></html>`;

t('extract: title priority JSON-LD headline → OG → title → H1', () => {
  const x = extractArticle(ARTICLE_HTML, ROOT + 'blog/great-post');
  const full = { ...x, headline: x.headline, ogTitle: x.ogTitle, titleTag: x.titleTag, h1: x.h1 };
  assert.strictEqual(pickTitle(full, 'Acme'), 'JSONLD Great Post');
  const noJl = { ...full, headline: null };
  assert.strictEqual(pickTitle(noJl, 'Acme'), 'OG Great Post');
  const noOg = { ...full, headline: null, ogTitle: '' };
  assert.strictEqual(pickTitle(noOg, 'Acme'), 'Great Post'); // trailing "| Acme" stripped
});
t('extract: description priority meta → OG → first paragraph', () => {
  const x = extractArticle(ARTICLE_HTML, ROOT + 'blog/great-post');
  assert.ok(pickDescription(x).startsWith('A meta description'));
  const noMeta = { ...x, metaDescription: '' };
  const noOg = { ...noMeta, ogDescription: '' };
  assert.ok(pickDescription(noOg).startsWith('The first paragraph'));
});
t('extract: date priority + author + image + canonical', () => {
  const x = extractArticle(ARTICLE_HTML, ROOT + 'blog/great-post');
  const d = pickDate(x, null);
  assert.strictEqual(d.source, 'structured-data'); // JSON-LD datePublished beats meta
  assert.strictEqual(x.author, 'Ann Author');
  assert.strictEqual(x.image, 'https://acme.test/img/great.jpg');
  assert.strictEqual(x.canonical, 'https://acme.test/blog/great-post');
  assert.strictEqual(x.articleSection, 'Technology');
  assert.ok(x.articleHtml.includes('<p>Second paragraph'));
  assert.ok(!/track\(\)/.test(x.articleHtml));
});

/* ---- classifier ---- */
function mkPage(o) {
  return Object.assign({
    url: ROOT, depth: 1, status: 200, types: [], ogType: '', breadcrumbs: [],
    wordCount: 300, dateSource: null, hasArticleTag: false, links: []
  }, o);
}
t('classify: article with JSON-LD + date', () => {
  const c = classify(mkPage({ url: ROOT + 'stories/anything', types: ['BlogPosting'], dateSource: 'structured-data', hasArticleTag: true }));
  assert.strictEqual(c.type, 'Blog Post');
  assert.strictEqual(c.feedable, true);
});
t('classify: /blog/ slug with content = Blog Post', () => {
  const c = classify(mkPage({ url: ROOT + 'blog/my-article' }));
  assert.strictEqual(c.type, 'Blog Post');
  assert.strictEqual(c.feedable, true);
});
t('classify: category index is not feedable', () => {
  const c = classify(mkPage({ url: ROOT + 'category/technology', links: Array(12).fill('https://acme.test/x' + Math.random()) }));
  assert.strictEqual(c.type, 'Category');
  assert.strictEqual(c.feedable, false);
});
t('classify: docs / product / homepage / tag', () => {
  assert.strictEqual(classify(mkPage({ url: ROOT + 'docs/getting-started' })).type, 'Documentation');
  assert.strictEqual(classify(mkPage({ url: ROOT + 'product/widget' })).type, 'Product');
  assert.strictEqual(classify(mkPage({ url: ROOT })).type, 'Homepage');
  assert.strictEqual(classify(mkPage({ url: ROOT + 'tag/cool' })).type, 'Tag');
  assert.strictEqual(isFeedable('Guide'), true);
  assert.strictEqual(isFeedable('Documentation'), false);
});

/* ---- dedup ---- */
t('dedup: tracking params + canonical + identical title', () => {
  const items = [
    { url: ROOT + 'blog/a', canonical: null, title: 'Hello World' },
    { url: ROOT + 'blog/a?utm_source=x', canonical: null, title: 'Hello World' },
    { url: ROOT + 'blog/a/', canonical: ROOT + 'blog/a', title: 'Hello World' },
    { url: ROOT + 'blog/b', canonical: null, title: 'Hello World' }, // same title, different path stem → dup
    { url: ROOT + 'blog/c', canonical: null, title: 'Other' }
  ];
  const r = dedupeItems(items);
  assert.strictEqual(r.removed, 3);
  assert.ok(items[1]._removed);
  assert.ok(items[2]._removed);
  assert.ok(items[3]._removed);
  assert.ok(!items[4]._removed);
});

/* ---- generator + validator round trip ---- */
t('rss: generates valid feed with escaping + CDATA + no unused namespaces', () => {
  const channel = { title: 'Acme & Sons', link: 'https://acme.test/', description: 'A "test" feed' };
  const items = [
    { title: 'Tom & Jerry <the classic>', link: 'https://acme.test/blog/tj', guid: 'https://acme.test/blog/tj', description: 'A classic. <b>bold</b>', descriptionHtml: '<p>A classic. <b>bold</b></p>', excerptHtml: '<p>x</p>', descriptionMode: 'full', pubDate: new Date(Date.UTC(2026, 7, 21, 12, 0, 0)), author: 'Ann', categories: ['Tech', 'Culture'], image: 'https://acme.test/tj.jpg' },
    { title: 'No date', link: 'https://acme.test/blog/nd', guid: 'https://acme.test/blog/nd', description: 'plain', descriptionHtml: '', excerptHtml: '', descriptionMode: 'description', pubDate: null, author: null, categories: [], image: null }
  ];
  const xml = generateRss(channel, items, { includeImages: true, includeAuthors: true, includeCategories: true, includePubDate: true, podcast: false });
  const v = validateRss(xml);
  assert.strictEqual(v.valid, true, JSON.stringify(v.errors));
  assert.ok(xml.includes('&lt;the classic&gt;'));
  assert.ok(xml.includes('<![CDATA[<p>A classic.'));
  assert.ok(xml.includes('xmlns:media='));
  assert.ok(xml.includes('xmlns:dc='));
  assert.ok(xml.includes('<dc:creator>Ann</dc:creator>'));
  assert.ok(xml.includes('Fri, 21 Aug 2026 12:00:00 GMT'));
  // no unused namespace when features off
  const xml2 = generateRss(channel, items.map(i => ({ ...i, image: null, author: null, categories: [] })), { includeImages: true, includeAuthors: true, includeCategories: true, podcast: false });
  assert.ok(!/xmlns:media/.test(xml2));
  assert.ok(!/xmlns:dc/.test(xml2));
  // relative image URLs are never emitted
  const xml3 = generateRss(channel, [{ ...items[0], image: '/relative.jpg' }], { includeImages: true });
  assert.ok(!xml3.includes('/relative.jpg'));
  assert.ok(!/xmlns:media/.test(xml3)); // no image used → no namespace
  const v3 = validateRss(xml3);
  assert.strictEqual(v3.valid, true, JSON.stringify(v3.errors));
});
t('rss: podcast enclosure only when media + length known', () => {
  const xml = generateRss({ title: 'P', link: 'https://acme.test/', description: '' }, [
    { title: 'Ep 1', link: 'https://acme.test/ep1', guid: 'https://acme.test/ep1', description: 'd', descriptionHtml: '', excerptHtml: '', descriptionMode: 'description', pubDate: new Date(Date.UTC(2026, 0, 1)), author: null, categories: [], image: null, enclosure: { url: 'https://cdn.acme.test/ep1.mp3', type: 'audio/mpeg', length: 123456 } }
  ], { podcast: true });
  assert.ok(xml.includes('<enclosure url="https://cdn.acme.test/ep1.mp3" type="audio/mpeg" length="123456"/>'));
});
t('validator: catches missing guid / duplicate guid / relative link / bad date', () => {
  const bad = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><link>https://acme.test/</link><description>d</description><lastBuildDate>Fri, 21 Aug 2026 12:00:00 GMT</lastBuildDate>
  <item><title>a</title><link>https://acme.test/a</link><guid>g1</guid><pubDate>not-a-date</pubDate></item>
  <item><title>b</title><link>/relative</link><guid>g1</guid></item>
  <item><title>c</title><link>https://acme.test/c</link></item>
  </channel></rss>`;
  const v = validateRss(bad);
  assert.strictEqual(v.valid, false);
  const names = v.checks.map(c => c.name).join(',');
  assert.ok(/duplicate/i.test(names) || v.errors.join(' ').includes('duplicate GUID'));
  assert.ok(v.errors.some(e => /duplicate GUID/i.test(e)));
  assert.ok(v.errors.some(e => /relative/i.test(e) || /absolute/i.test(e)));
  assert.ok(v.errors.some(e => /pubDate/i.test(e)));
});
t('validator: flags unescaped ampersand as malformed', () => {
  const v = validateRss('<?xml version="1.0"?><rss version="2.0"><channel><title>A & B</title><link>https://acme.test/</link><description>d</description><item><title>x</title><link>https://acme.test/x</link><guid>g</guid></item></channel></rss>');
  assert.strictEqual(v.valid, false);
});

/* ---- atom ---- */
t('atom: generates genuine Atom 1.0', () => {
  const xml = generateAtom({ title: 'A & B', link: 'https://acme.test/', description: 'd' }, [
    { title: 'E1', link: 'https://acme.test/e1', guid: 'https://acme.test/e1', description: 'summary', pubDate: new Date(Date.UTC(2026, 7, 1)), author: 'Ann', categories: ['Tech'] }
  ], { includeAuthors: true, includeCategories: true, includePubDate: true });
  assert.ok(xml.includes('<feed xmlns="http://www.w3.org/2005/Atom">'));
  assert.ok(xml.includes('<entry>'));
  assert.ok(xml.includes('<published>2026-08-01T00:00:00Z</published>'));
  assert.ok(xml.includes('<category term="Tech"/>'));
  assert.ok(!/<rss/.test(xml));
  assert.ok(xml.includes('A &amp; B'));
});

/* ---- quality + comparison ---- */
t('quality: full score on a perfect feed, drops with problems', () => {
  const items = [{ link: 'https://acme.test/a', canonical: 'https://acme.test/a', title: 'T', description: 'D', pubDate: new Date(), dateReliable: true, feedable: true, hasContent: true }];
  const good = scoreFeed({ validation: { valid: true, errors: [] }, items, stats: { duplicatesRemoved: 0, brokenExcluded: 0 } });
  assert.strictEqual(good.score, 100);
  assert.strictEqual(good.label, 'Tool-generated RSS quality score');
  const bad = scoreFeed({ validation: { valid: false, errors: ['x'] }, items: [{ link: 'relative', title: 'T', description: '', pubDate: null, canonical: 'https://acme.test/a', feedable: false }], stats: { duplicatesRemoved: 5, brokenExcluded: 3 } });
  assert.ok(bad.score < 40);
  assert.ok(bad.components.length >= 8);
});
t('compare: counts, duplicates, missing, metadata diffs', () => {
  const existing = [
    { link: 'https://acme.test/a', guid: 'https://acme.test/a', title: 'Same', description: 'd1', pubDate: 'X' },
    { link: 'https://acme.test/only-existing', guid: 'https://acme.test/only-existing', title: 'OE', description: '', pubDate: '' }
  ];
  const generated = [
    { link: 'https://acme.test/a', guid: 'https://acme.test/a', title: 'Same', description: 'd2', pubDate: 'X' },
    { link: 'https://acme.test/only-generated', guid: 'https://acme.test/only-generated', title: 'OG', description: '', pubDate: '' }
  ];
  const c = compareFeeds(existing, generated);
  assert.strictEqual(c.existingCount, 2);
  assert.strictEqual(c.generatedCount, 2);
  assert.strictEqual(c.duplicates.count, 1);
  assert.strictEqual(c.missingFromGenerated.count, 1);
  assert.strictEqual(c.missingFromExisting.count, 1);
  assert.strictEqual(c.metadataDifferences.count, 1);
});

/* ---- full pipeline on fixture pages ---- */
function mkFullPage(o) {
  return Object.assign({
    url: ROOT, requestedUrl: ROOT, depth: 1, status: 200, contentType: 'text/html',
    base: {
      title: '', metaDescription: '', ogTitle: '', ogDescription: '', ogType: '', ogSiteName: '',
      canonical: null, noindex: false, h1: '', h2: [], types: [], breadcrumbs: [],
      text: '', wordCount: 300, paragraphs: [], links: [], linkObjects: [], jsHeavy: false
    },
    _article: {
      headline: null, ogTitle: '', titleTag: '', h1: '',
      metaDescription: '', ogDescription: '', firstParagraph: '',
      structuredRaw: '', metaRaw: '', timeInfo: null, visibleInfo: null,
      author: null, image: null, articleSection: null,
      articleHtml: '<p>Body content that is long enough to be useful for a feed reader.</p>',
      wordCount: 300, breadcrumbs: [], canonical: null, noindex: false, audioUrl: null
    }
  }, o);
}

function runPipeline(pages, options) {
  return analyzeAndReport(pages, {
    mode: 'website', input: ROOT, root: ROOT, host: HOST,
    siteName: 'Acme', siteDescription: 'Acme description',
    platform: ['Static'], robots: { exists: true, url: ROOT + 'robots.txt', sitemaps: [] },
    sitemaps: { sitemaps: [] }, lastmodMap: new Map(),
    existingFeed: null, discovered: pages.length, started: Date.now(),
    options: parseOptions(options || {}), progress: () => {}
  });
}

t('pipeline: end-to-end selects dated articles, dedups, validates', () => {
  const pages = [
    mkFullPage({ url: ROOT + 'blog/new-post', base: { title: 'New Post', metaDescription: 'New post description', types: ['BlogPosting'], wordCount: 400 }, _article: { metaDescription: 'New post description', headline: 'New Post', structuredRaw: '2026-08-20T10:00:00Z', firstParagraph: 'New post paragraph with enough words to stand on its own.' }, canonical: null }),
    mkFullPage({ url: ROOT + 'blog/new-post?utm_source=x', status: 200 }),
    mkFullPage({ url: ROOT + 'blog/old-post', base: { title: 'Old Post', metaDescription: 'Old post description', types: [], wordCount: 400 }, _article: { metaDescription: 'Old post description', titleTag: 'Old Post', h1: 'Old Post', metaRaw: '2026-01-15T08:00:00Z', firstParagraph: 'Old post paragraph with enough words to stand on its own here.' } }),
    mkFullPage({ url: ROOT + 'blog/no-date', base: { title: 'No Date', metaDescription: 'Undated', wordCount: 400 }, _article: { metaDescription: 'Undated description', titleTag: 'No Date', h1: 'No Date', firstParagraph: 'Undated post paragraph with enough words to stand alone.' } }),
    mkFullPage({ url: ROOT + 'docs/manual', base: { title: 'Manual', wordCount: 900 }, _article: { titleTag: 'Manual', h1: 'Manual' } }),
    mkFullPage({ url: ROOT + 'blog/broken', status: 404 }),
    mkFullPage({ url: ROOT + 'blog/robots', blocked: true })
  ];
  pages[1].base = { ...pages[1].base, title: 'New Post', wordCount: 400 };
  pages[1]._article = { ...pages[0]._article };
  const r = runPipeline(pages, { maxItems: 20, excludeUndated: true });
  assert.strictEqual(r.stats.duplicatesRemoved, 1, JSON.stringify(r.stats));
  assert.strictEqual(r.stats.brokenExcluded, 1);
  assert.strictEqual(r.stats.robotsBlocked, 1);
  assert.strictEqual(r.items.length, 2); // undated excluded by default
  assert.strictEqual(r.items[0].title, 'New Post'); // newest first
  assert.strictEqual(r.stats.missingDates, 1);
  const v = validateRss(r.rssXml);
  assert.strictEqual(v.valid, true, JSON.stringify(v.errors));
  assert.ok(r.rssXml.includes('<pubDate>'));
  assert.ok(r.quality.score > 60);
  // XML preview shows escaped content + guid
  assert.ok(r.rssXml.includes('<guid isPermaLink="true">'));
});
t('pipeline: excludeUndated off keeps undated items without pubDate', () => {
  const pages = [mkFullPage({ url: ROOT + 'blog/undated', base: { title: 'Undated', wordCount: 400 }, _article: { titleTag: 'Undated', h1: 'Undated', firstParagraph: 'Undated paragraph with plenty of words so it passes the content check.' } })];
  const r = runPipeline(pages, { excludeUndated: false, includePubDate: true });
  assert.strictEqual(r.items.length, 1);
  assert.ok(!r.rssXml.includes('<pubDate>'));
  assert.strictEqual(r.stats.missingDates, 1);
  assert.strictEqual(validateRss(r.rssXml).valid, true);
});
t('pipeline: sitemap lastmod used only as labelled fallback', () => {
  const pages = [mkFullPage({ url: ROOT + 'blog/lm', base: { title: 'LM', wordCount: 400 }, _article: { titleTag: 'LM', h1: 'LM', firstParagraph: 'LM paragraph with enough words to be considered real content.' } })];
  const r = analyzeAndReport(pages, {
    mode: 'website', input: ROOT, root: ROOT, host: HOST, siteName: 'Acme', siteDescription: 'd',
    platform: [], robots: { exists: false, url: null, sitemaps: [] },
    sitemaps: { sitemaps: [] }, lastmodMap: new Map([[ROOT + 'blog/lm', '2026-02-02T00:00:00Z']]),
    existingFeed: null, discovered: 1, started: Date.now(), options: parseOptions({ excludeUndated: false }), progress: () => {}
  });
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.items[0].dateSource, 'sitemap-lastmod');
  assert.strictEqual(r.items[0].dateReliable, false);
  assert.ok(r.rssXml.includes('<pubDate>')); // included (fallback allowed, labelled)
});
t('pipeline: news mode forces dates, full content uses CDATA', () => {
  const pages = [
    mkFullPage({ url: ROOT + 'blog/n1', base: { title: 'N1', wordCount: 400 }, _article: { headline: 'N1', structuredRaw: '2026-08-01T00:00:00Z', firstParagraph: 'N1 paragraph with enough words to be meaningful content.', articleHtml: '<p>N1 body with enough words to be meaningful content for the feed.</p>' } }),
    mkFullPage({ url: ROOT + 'blog/n2', base: { title: 'N2', wordCount: 400 }, _article: { headline: 'N2', firstParagraph: 'N2 paragraph with enough words to be meaningful content.', articleHtml: '<p>N2 body with enough words to be meaningful content for the feed.</p>' } })
  ];
  const r = runPipeline(pages, { feedMode: 'news', contentMode: 'full', maxItems: 10 });
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.stats.undatedExcluded, 1);
  assert.ok(r.rssXml.includes('<![CDATA['));
});
t('pipeline: existing feed comparison is produced when present', () => {
  const pages = [mkFullPage({ url: ROOT + 'blog/a', base: { title: 'A', wordCount: 400 }, _article: { headline: 'A', structuredRaw: '2026-08-01T00:00:00Z', firstParagraph: 'A paragraph with enough words to be considered real content.', articleHtml: '<p>A body with enough words to be considered real content.</p>' } })];
  const r = analyzeAndReport(pages, {
    mode: 'website', input: ROOT, root: ROOT, host: HOST, siteName: 'Acme', siteDescription: 'd',
    platform: [], robots: { exists: false, url: null, sitemaps: [] },
    sitemaps: { sitemaps: [] }, lastmodMap: new Map(),
    existingFeed: { url: ROOT + 'feed/', format: 'rss2', title: 'Acme', itemCount: 2, items: [{ link: 'https://acme.test/blog/a', guid: 'https://acme.test/blog/a', title: 'A', description: 'd', pubDate: 'Fri, 01 Aug 2026 00:00:00 GMT' }, { link: 'https://acme.test/blog/b', guid: 'https://acme.test/blog/b', title: 'B', description: '', pubDate: '' }] },
    discovered: 1, started: Date.now(), options: parseOptions({}), progress: () => {}
  });
  assert.ok(r.comparison);
  assert.strictEqual(r.comparison.duplicates.count, 1); // /blog/a in both
  assert.strictEqual(r.comparison.missingFromGenerated.count, 1); // /blog/b only in existing
  assert.strictEqual(r.comparison.missingFromExisting.count, 0);
});
t('pipeline: canonical preferred, external canonical ignored', () => {
  const pages = [
    mkFullPage({ url: ROOT + 'blog/canon?print=1', base: { title: 'C', wordCount: 400, canonical: 'https://acme.test/blog/canon' }, _article: { headline: 'C', structuredRaw: '2026-08-01T00:00:00Z', firstParagraph: 'C paragraph with enough words to be considered real content.', canonical: 'https://acme.test/blog/canon' } })
  ];
  const r = runPipeline(pages, {});
  assert.strictEqual(r.items[0].link, 'https://acme.test/blog/canon');
  assert.strictEqual(r.items[0].canonical, 'https://acme.test/blog/canon');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
