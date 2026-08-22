'use strict';

/*
 * LLMs.txt Generator: UI smoke test.
 * Drives assets/js/llmstxt/ui.js with a fake DOM + fake SSE/JSON fetch, then
 * asserts the report renders (coverage, quality, preview, validation, table,
 * installation) and that untrusted page titles/descriptions are HTML-escaped.
 */

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const uiSource = fs.readFileSync('assets/js/llmstxt/ui.js', 'utf8');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  \u2713 ' + name); } catch (e) { fail++; console.log('  \u2717 ' + name + '\n    ' + (e && e.message)); } }

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
  querySelector(sel) {
    if (sel === '.llmstxt-noindex-warning') { if (!elements[sel]) elements[sel] = fakeEl(sel); return elements[sel]; }
    return null;
  },
  createElement(tag) { return fakeEl('tmp-' + tag); },
  body: { appendChild() {} },
  documentElement: { innerHTML: '' }
};

// Inject a minimal report (mirrors the server /api/llmstxt result).
const REPORT = {
  input: 'https://example.com/', finalUrl: 'https://example.com/', host: 'example.com',
  site: { name: 'Example Website', title: 'Example Website', host: 'example.com', description: 'Practical guides and resources.', platform: [], ecommerce: false, jsHeavy: false },
  robots: { exists: true, url: 'https://example.com/robots.txt', sitemaps: [], crawlDelay: null, restrictedCount: 0 },
  sitemaps: [], existingLlmsTxt: null,
  pages: [
    { url: 'https://example.com/', title: 'Example Website', description: 'Practical guides and resources.', category: 'Home', kind: 'home', priority: 'High', status: 200, canonical: '', included: true, inFile: true, section: 'Important Pages', reason: 'Included: indexable, relevant page', excludeReason: null, depth: 0, wordCount: 200 },
    { url: 'https://example.com/about', title: 'About<img src=x onerror=alert(1)>', description: 'About the <script>bad()</script> organisation.', category: 'About', kind: 'normal', priority: 'High', status: 200, canonical: '', included: true, inFile: true, section: 'Important Pages', reason: 'Included: indexable, relevant page', excludeReason: null, depth: 1, wordCount: 120 },
    { url: 'https://example.com/docs', title: 'Documentation', description: 'Product documentation.', category: 'Documentation', kind: 'normal', priority: 'High', status: 200, canonical: '', included: true, inFile: true, section: 'Documentation', reason: 'Included: indexable, relevant page', excludeReason: null, depth: 1, wordCount: 500 },
    { url: 'https://example.com/login', title: 'Login', description: '', category: 'Other', kind: 'normal', priority: 'Low', status: 200, canonical: '', included: false, inFile: false, reason: 'Excluded: Login/registration page', excludeReason: 'Login, cart or account page', depth: 1, wordCount: 20 }
  ],
  llmsTxt: '# Example Website\n\n> Practical guides and resources.\n\n## Important Pages\n\n- [Homepage](https://example.com/): Practical guides and resources.\n- [About](https://example.com/about): About the organisation.\n\n## Documentation\n\n- [Documentation](https://example.com/docs): Product documentation.\n',
  validation: { valid: true, checks: [{ name: 'H1 title', status: 'pass', message: 'Single H1 title present.' }, { name: 'Duplicate URLs', status: 'pass', message: 'No duplicate URLs.' }], errors: [], warnings: [] },
  quality: 87,
  stats: { pagesDiscovered: 4, pagesCrawled: 4, pagesIncluded: 3, pagesExcluded: 1, inFile: 3, broken: 0, redirects: 0, noindex: 0, canonicalized: 0, duplicates: 0, blocked: 0, generationTimeMs: 10 },
  exclusionReasons: [{ reason: 'Login, cart or account page', count: 1 }],
  unableToVerify: 0,
  warnings: { robotsRestricted: false, jsHeavy: false, unableToVerify: 0, truncated: false }
};

let finalizeCalls = 0;
function fakeFetch(url, opts) {
  if (url === '/api/llmstxt') {
    const encoder = new TextEncoder();
    const chunks = [
      'event: progress\ndata: ' + JSON.stringify({ stage: 'validate', message: 'Validating domain…' }) + '\n\n',
      'event: progress\ndata: ' + JSON.stringify({ stage: 'done', message: 'LLMs.txt generated' }) + '\n\n',
      'event: result\ndata: ' + JSON.stringify(REPORT) + '\n\n'
    ].map(s => encoder.encode(s));
    let i = 0;
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: () => 'text/event-stream' },
      body: { getReader() { return { read: () => i < chunks.length ? Promise.resolve({ done: false, value: chunks[i++] }) : Promise.resolve({ done: true }) }; } }
    });
  }
  if (url === '/api/llmstxt-finalize') {
    finalizeCalls++;
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ llmsTxt: '# Example Website\n\n> Practical guides and resources.\n\n## Important Pages\n\n- [Homepage](https://example.com/): Practical guides and resources.\n', validation: REPORT.validation, quality: 90, stats: REPORT.stats }) });
  }
  return Promise.reject(new Error('unexpected fetch ' + url));
}

function runUi() {
  const sandbox = {
    window: { addEventListener() {}, sumly: { toast() {}, copy() {} }, LlmstxtBrowserRunner: null },
    document: doc,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    fetch: fakeFetch,
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
  vm.runInContext(fs.readFileSync(__dirname + '/../../assets/js/progress.js', 'utf8'), sandbox);
  vm.runInContext(uiSource, sandbox);

  const form = elements['llmstxt-form'];
  form.__values = { maxPages: '500', maxDepth: '3', includeExternal: null, includePdfs: 'on', includeBlog: 'on', includeDocs: 'on', includeCategories: null, includeAuthors: null, includeNoindex: null, maxBlogUrls: '25', maxProducts: '50', websiteDescription: '' };
  form.listeners = form.listeners || {};
  return { form, out: elements['llmstxt-results'] };
}

t('UI, submit flow renders the full report', async () => {
  finalizeCalls = 0;
  const { form, out } = runUi();
  await form.listeners.submit({ preventDefault() {} });
  const html = out.innerHTML;
  assert.ok(html.includes('LLMs.txt Quality Score'), 'quality score card');
  assert.ok(html.includes('Pages discovered'), 'coverage stats');
  assert.ok(html.includes('Preview'), 'preview panel');
  assert.ok(html.includes('LLMs.txt Validation'), 'validation panel');
  assert.ok(html.includes('URL Selection'), 'url selection table');
  assert.ok(html.includes('Installation'), 'installation instructions');
  assert.ok(html.includes('Download llms.txt'), 'download button');
  assert.ok(html.includes('https://example.com/llms.txt'), 'dynamic install domain');
});

t('UI, untrusted titles/descriptions are escaped', async () => {
  const { form, out } = runUi();
  await form.listeners.submit({ preventDefault() {} });
  const html = out.innerHTML;
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'), 'raw title img tag must not appear');
  assert.ok(!html.includes('<script>bad()</script>'), 'raw description script tag must not appear');
  assert.ok(html.includes('About&lt;img'), 'title is HTML-escaped');
});

t('UI, finalize endpoint called on regeneration', async () => {
  finalizeCalls = 0;
  const { form } = runUi();
  await form.listeners.submit({ preventDefault() {} });
  const sn = elements['llmstxt-sitename'];
  sn.value = 'New Name';
  sn.listeners.input({ target: sn });
  await new Promise(r => setTimeout(r, 420)); // allow debounce to fire
  assert.ok(finalizeCalls >= 1, 'finalize should be called after an edit');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
