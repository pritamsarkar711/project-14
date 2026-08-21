'use strict';

/*
 * RSS Feed Generator — UI smoke test.
 * Drives assets/js/rss/ui.js with a fake DOM + fake SSE/JSON fetch, then
 * asserts the report renders (existing-feed banner, quality score, stats,
 * settings, visual + XML previews, validation, table, installation) and
 * that untrusted page titles/URLs are HTML-escaped in the output.
 */

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const uiSource = fs.readFileSync('assets/js/rss/ui.js', 'utf8');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  \u2713 ' + name); }
  catch (e) { fail++; console.log('  \u2717 ' + name + '\n    ' + (e && e.message)); }
}

const elements = {};
function fakeEl(id) {
  return {
    id, value: '', innerHTML: '', checked: false, hidden: false, className: '', textContent: '',
    listeners: {}, onclick: null, oninput: null, onchange: null,
    addEventListener(t, fn) { this.listeners[t] = fn; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    appendChild() {}, remove() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return ''; },
    closest() { return null; },
    focus() {}, select() {}, click() {},
    style: {}
  };
}

const doc = {
  getElementById(id) { if (!elements[id]) elements[id] = fakeEl(id); return elements[id]; },
  querySelector() { return null; },
  createElement(tag) { return fakeEl('tmp-' + tag); },
  body: { appendChild() {} },
  documentElement: { innerHTML: '' }
};

const PAGES = [
  { url: 'https://example.com/blog/hello-world', title: 'Hello <b>World</b> & "Friends"', type: 'Blog Post', feedable: true, status: 200, date: '2026-08-02T09:00:00.000Z', dateSource: 'structured-data', dateReliable: true, author: 'Ann', category: 'Tech', image: 'https://example.com/img/h.jpg', canonical: 'https://example.com/blog/hello-world', noindex: false, blocked: false, challenge: false, redirected: false, jsHeavy: false, wordCount: 350, fromSitemap: true, hasArticleTag: true, included: true, reason: '', excludeReason: null, duplicateOf: null, added: false, existing: false, description: 'Our first post.', articleHtml: '', audioUrl: null, breadcrumbs: [] },
  { url: 'https://example.com/blog/undated', title: 'Undated Post<script>alert(1)</script>', type: 'Article', feedable: true, status: 200, date: null, dateSource: null, dateReliable: null, author: null, category: '', image: null, canonical: 'https://example.com/blog/undated', noindex: false, blocked: false, challenge: false, redirected: false, jsHeavy: false, wordCount: 300, fromSitemap: false, hasArticleTag: true, included: false, reason: 'Excluded: no reliable publication date', excludeReason: 'No date', duplicateOf: null, added: false, existing: false, description: 'No date here.', articleHtml: '', audioUrl: null, breadcrumbs: [] },
  { url: 'https://example.com/docs/guide', title: 'Documentation', type: 'Documentation', feedable: false, status: 200, date: null, dateSource: null, dateReliable: null, author: null, category: '', image: null, canonical: 'https://example.com/docs/guide', noindex: false, blocked: false, challenge: false, redirected: false, jsHeavy: false, wordCount: 500, fromSitemap: false, hasArticleTag: false, included: false, reason: 'Not included: classified as Documentation', excludeReason: 'Not content', duplicateOf: null, added: false, existing: false, description: '', articleHtml: '', audioUrl: null, breadcrumbs: [] }
];

const RSS_XML = '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>Example</title>\n    <item><title>Hello &lt;b&gt;World&lt;/b&gt; &amp; "Friends"</title></item>\n  </channel>\n</rss>';

const REPORT = {
  mode: 'website', transport: 'server',
  input: 'https://example.com/', finalUrl: 'https://example.com/', host: 'example.com',
  site: { name: 'Example Website', description: 'Example description.', platform: ['Static'], wordpress: false },
  channel: { title: 'Example Website', link: 'https://example.com/', description: 'Example description.' },
  pages: PAGES,
  existingFeed: { url: 'https://example.com/feed/', format: 'rss2', title: 'Example Feed', itemCount: 12, wordpress: false, candidates: [] },
  existingItems: [
    { link: 'https://example.com/blog/hello-world', guid: 'https://example.com/blog/hello-world', title: 'Hello World', description: 'Existing copy.', pubDate: 'Sun, 02 Aug 2026 09:00:00 GMT', author: 'Ann', categories: ['Tech'], image: null }
  ],
  existingFeedCheck: [
    { url: 'https://example.com/blog/hello-world', status: 200, ok: true },
    { url: 'https://example.com/old-dead-post', status: 404, ok: false }
  ],
  items: PAGES.filter(p => p.included).map(p => ({ title: p.title, link: p.url, guid: p.url, description: p.description, pubDate: p.date, dateSource: p.dateSource, dateReliable: p.dateReliable, author: p.author, categories: p.category ? [p.category] : [], image: p.image, canonical: p.canonical })),
  rssXml: RSS_XML,
  atomXml: '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Example</title></feed>',
  validation: { valid: true, checks: [
    { name: 'XML syntax', status: 'pass', message: 'Well-formed document' },
    { name: 'GUID uniqueness', status: 'pass', message: 'All 1 GUIDs unique' },
    { name: 'Item URLs', status: 'pass', message: 'All item links are absolute http(s) URLs' }
  ], errors: [], autoFixes: [] },
  quality: { score: 92, label: 'Tool-generated RSS quality score', note: 'note', components: [
    { name: 'XML validity', earned: 20, max: 20, note: 'ok' },
    { name: 'Publication dates', earned: 7, max: 15, note: '1/2 reliable' }
  ] },
  stats: { pagesDiscovered: 20, pagesCrawled: 15, contentPagesFound: 3, itemsSelected: 1, duplicatesRemoved: 2, brokenExcluded: 1, missingDates: 1, robotsBlocked: 0, challenge: 0 },
  exclusionReasons: [{ reason: 'Not content', count: 1 }, { reason: 'No date', count: 1 }],
  warnings: { robotsRestricted: false, jsHeavy: false, challenge: 0, noContent: false, undatedExcluded: 1, mediaWithoutLength: 0 },
  comparison: {
    existingCount: 12, generatedCount: 1,
    duplicates: { count: 1, items: [{ url: 'https://example.com/blog/hello-world', title: 'Hello World' }] },
    missingFromGenerated: { count: 11, items: [{ link: 'https://example.com/other', title: 'Other', url: 'https://example.com/other' }] },
    missingFromExisting: { count: 0, items: [] },
    metadataDifferences: { count: 1, items: [{ url: 'https://example.com/blog/hello-world', title: 'Hello World', diffs: ['description'] }] }
  },
  robots: { exists: true, url: 'https://example.com/robots.txt', sitemaps: ['https://example.com/sitemap.xml'], restrictedCount: 0 },
  sitemaps: [{ url: 'https://example.com/sitemap.xml', isIndex: false, count: 12 }],
  options: { mode: 'website', maxPages: 60, maxDepth: 3, maxItems: 20, includeSubdomains: false, contentMode: 'excerpt', feedMode: 'standard', includeImages: true, includeAuthors: true, includeCategories: true, includePubDate: true, excludeUndated: true, sortOrder: 'newest' }
};

let finalizeCalls = 0;
let currentFetch = null; // overridable per test
function fakeFetch(url, opts) {
  if (url === '/api/rss') {
    const chunks = [
      'event: progress\ndata: ' + JSON.stringify({ stage: 'validate', message: 'Validating URL…' }) + '\n\n',
      'event: progress\ndata: ' + JSON.stringify({ stage: 'crawl', message: '15 pages analyzed', discovered: 20, crawled: 15 }) + '\n\n',
      'event: result\ndata: ' + JSON.stringify(REPORT) + '\n\n'
    ];
    let i = 0;
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: () => 'text/event-stream' },
      body: { getReader() { return { read: () => i < chunks.length ? Promise.resolve({ done: false, value: Buffer.from(chunks[i++]) }) : Promise.resolve({ done: true }) }; } }
    });
  }
  if (url === '/api/rss-finalize') {
    finalizeCalls++;
    const body = JSON.parse(opts.body);
    const updated = Object.assign({}, REPORT, {
      rssXml: RSS_XML + '\n<!-- finalized for ' + body.pages.length + ' pages -->',
      stats: Object.assign({}, REPORT.stats, { itemsSelected: body.pages.filter(p => p.included).length })
    });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(updated) });
  }
  return Promise.reject(new Error('unexpected fetch ' + url));
}

function runUi() {
  for (const k of Object.keys(elements)) delete elements[k];
  const sandbox = {
    window: { addEventListener() {}, RssBrowserRunner: null },
    document: doc,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    fetch: (url, opts) => (currentFetch || fakeFetch)(url, opts),
    FormData: function (form) { this.form = form; },
    AbortController: function () { return { signal: {}, abort() {} }; },
    TextDecoder: function () { return { decode: (v) => Buffer.from(v).toString('utf8') }; },
    URL: URL, Blob: function () {}, TextEncoder: TextEncoder,
    setTimeout, clearTimeout, console
  };
  sandbox.FormData.prototype.get = function (name) {
    const vals = this.form.__values || {};
    return vals[name] !== undefined ? vals[name] : null;
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(uiSource, sandbox);
  const form = elements['rss-form'];
  form.__values = { mode: 'website', maxPages: '60', maxDepth: '3', maxItems: '20', contentMode: 'excerpt', feedMode: 'standard', sortOrder: 'newest', incImages: 'on', incAuthors: 'on', incCategories: 'on', incDates: 'on', excUndated: 'on' };
  doc.getElementById('rss-url').value = 'https://example.com';
  return { form, out: elements['rss-results'] };
}

function fullHtml() {
  let h = elements['rss-results'] ? elements['rss-results'].innerHTML : '';
  for (const k of Object.keys(elements)) if (k !== 'rss-results' && elements[k].innerHTML) h += elements[k].innerHTML;
  return h;
}

/* ---- async runner ---- */
const tests = [];
function at(name, fn) { tests.push([name, fn]); }

at('UI — submit flow renders the full report', async () => {
  finalizeCalls = 0;
  const { form } = runUi();
  await form.listeners.submit({ preventDefault() {} });
  await new Promise(r => setTimeout(r, 50));
  const h = fullHtml();
  assert.ok(h.includes('RSS Feed Quality Score'), 'score card');
  assert.ok(h.includes('Existing RSS feed detected'), 'existing feed banner');
  assert.ok(h.includes('https://example.com/feed/'), 'existing feed url');
  assert.ok(h.includes('Use Existing Feed'), 'use existing button');
  assert.ok(h.includes('Pages discovered'), 'stats');
  assert.ok(h.includes('Duplicates removed'), 'stats');
  assert.ok(h.includes('Feed Settings'), 'settings');
  assert.ok(h.includes('Feed Preview'), 'preview');
  assert.ok(h.includes('XML Validation'), 'validation');
  assert.ok(h.includes('Existing Feed Comparison'), 'comparison');
  assert.ok(h.includes('Broken URLs in existing feed'), 'feed spot check');
  assert.ok(h.includes('Article Selection'), 'table');
  assert.ok(h.includes('Installation'), 'installation');
  assert.ok(h.includes('/rss.xml'), 'install feed url');
  assert.ok(h.includes('rel="alternate"'), 'discovery snippet');
  // visual preview shows the item
  assert.ok(h.includes('Hello') , 'visual item title');
  assert.ok(h.includes('Tech'), 'category chip');
});

at('UI — untrusted titles are escaped in the table and preview', async () => {
  const { form } = runUi();
  await form.listeners.submit({ preventDefault() {} });
  await new Promise(r => setTimeout(r, 50));
  const h = fullHtml();
  assert.ok(!h.includes('<script>alert(1)</script>'), 'script tag must not render raw');
  assert.ok(h.includes('&lt;script&gt;alert(1)&lt;/script&gt;') || !h.includes('alert(1)</script>'), 'escaped');
  assert.ok(h.includes('Hello &lt;b&gt;World&lt;/b&gt; &amp; &quot;Friends&quot;'), 'title escaped in XML preview');
});

at('UI — regenerate posts the edited payload and refreshes outputs', async () => {
  finalizeCalls = 0;
  const { form } = runUi();
  await form.listeners.submit({ preventDefault() {} });
  await new Promise(r => setTimeout(r, 50));
  const reg = elements['rss-regenerate'];
  assert.ok(reg, 'regenerate button exists');
  reg.onclick();
  await new Promise(r => setTimeout(r, 50));
  assert.ok(finalizeCalls >= 1, 'finalize called');
  // Switch to the XML tab so the regenerated XML is in the rendered HTML.
  elements['rss-tab-xml'].onclick();
  await new Promise(r => setTimeout(r, 10));
  const h = fullHtml();
  assert.ok(h.includes('finalized for'), 'outputs refreshed');
});

at('UI — use existing feed reloads items and regenerates', async () => {
  finalizeCalls = 0;
  const { form } = runUi();
  await form.listeners.submit({ preventDefault() {} });
  await new Promise(r => setTimeout(r, 50));
  const use = elements['rss-use-existing'];
  assert.ok(use, 'use existing button');
  use.onclick();
  await new Promise(r => setTimeout(r, 50));
  const h = fullHtml();
  assert.ok(h.includes('Existing feed'), 'existing chip/row marker');
  assert.ok(finalizeCalls >= 1, 'regenerated after switching to existing feed');
});

at('UI — progress renders stage list and cancel', async () => {
  // Stream two progress events and keep the stream open.
  currentFetch = (url) => {
    const chunks = [
      'event: progress\ndata: ' + JSON.stringify({ stage: 'validate', message: 'Validating URL…' }) + '\n\n',
      'event: progress\ndata: ' + JSON.stringify({ stage: 'crawl', message: '5 pages analyzed', discovered: 9, crawled: 5 }) + '\n\n'
    ];
    let i = 0;
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: () => 'text/event-stream' },
      body: { getReader() { return { read: () => i < chunks.length ? Promise.resolve({ done: false, value: Buffer.from(chunks[i++]) }) : new Promise(() => {}) }; } }
    });
  };
  const { form } = runUi();
  form.listeners.submit({ preventDefault() {} });
  await new Promise(r => setTimeout(r, 60));
  const out = elements['rss-results'];
  assert.ok(out.innerHTML.includes('Generating RSS feed'), 'progress heading');
  assert.ok(out.innerHTML.includes('robots.txt checked'), 'stage list');
  assert.ok(out.innerHTML.includes('rss-cancel'), 'cancel button');
  currentFetch = null;
});

let pending = tests.slice();
function next() {
  const item = pending.shift();
  if (!item) { console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); return; }
  try {
    const r = item[1]();
    if (r && r.then) r.then(() => { pass++; console.log('  \u2713 ' + item[0]); next(); }, e => { fail++; console.log('  \u2717 ' + item[0] + '\n    ' + e.message); next(); });
    else { pass++; console.log('  \u2713 ' + item[0]); next(); }
  } catch (e) { fail++; console.log('  \u2717 ' + item[0] + '\n    ' + e.message); next(); }
}
console.log('\nRSS Feed Generator — uitest');
next();
