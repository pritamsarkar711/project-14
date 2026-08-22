'use strict';
/* Submit smoke test: fires each simplified hero form's submit handler in a
   DOM harness and captures the payload the tool would send to its API. */
const fs = require('fs');
const vm = require('vm');
const { execFileSync } = require('child_process');

const BASE = 'http://localhost:3000';
const PAGES = {
  '/xml-sitemap-generator': {
    scripts: ['/assets/js/progress.js', '/assets/js/common.js', '/assets/js/sitemap/browser.js', '/assets/js/sitemap/ui.js'],
    urlId: 'sitemap-url', formId: 'sitemap-form',
    cases: [
      { url: 'https://example.com', expect: { mode: 'generate', maxUrls: 500, depth: 3 } },
      { url: 'https://example.com/sitemap.xml', expect: { mode: 'analyze' } }
    ]
  },
  '/broken-link-checker': {
    scripts: ['/assets/js/progress.js', '/assets/js/common.js', '/assets/js/brokenlink/crawler.js', '/assets/js/brokenlink/ui.js'],
    urlId: 'bl-url', formId: 'brokenlink-form',
    cases: [
      { url: 'https://example.com', expect: { maxPages: 500, maxDepth: '5', scanScope: 'internal+external', checkExternal: true, checkImages: false, checkDocuments: false, checkAnchors: false, respectRobots: true } }
    ]
  },
  '/llms-txt-generator': {
    scripts: ['/assets/js/progress.js', '/assets/js/common.js', '/assets/js/llmstxt/browser.js', '/assets/js/llmstxt/ui.js'],
    urlId: 'llmstxt-url', formId: 'llmstxt-form',
    cases: [
      { url: 'https://example.com', expect: { maxPages: 500, maxDepth: 3, includePdfs: true, includeBlog: true, includeDocs: true } }
    ]
  },
  '/rss-feed-generator': {
    scripts: ['/assets/js/progress.js', '/assets/js/common.js', '/assets/js/rss/browser.js', '/assets/js/rss/ui.js'],
    urlId: 'rss-url', formId: 'rss-form',
    cases: [
      { url: 'https://example.com', expect: { mode: 'website', maxItems: 20, contentMode: 'excerpt', feedMode: 'standard' } },
      { url: 'https://example.com/sitemap.xml', expect: { mode: 'sitemap' } }
    ]
  },
  '/core-web-vitals-auditor': {
    scripts: ['/assets/js/progress.js', '/assets/js/common.js', '/lib/cwv/rewriter.js', '/assets/js/cwv/report.js', '/assets/js/cwv/ui.js'],
    urlId: 'cwv-url', formId: 'cwv-form',
    cases: [{ url: 'https://example.com', expectFirstFetch: /^\/api\/cwv-/ }]
  },
  '/ai-crawler-blocker': {
    scripts: ['/assets/js/progress.js', '/assets/js/common.js',
      '/lib/botblocker/botDatabase.js', '/lib/botblocker/botClassifier.js', '/lib/botblocker/botPatternMatcher.js',
      '/lib/botblocker/robotsParser.js', '/lib/botblocker/robotsSimulator.js', '/lib/botblocker/robotsGenerator.js',
      '/lib/botblocker/ruleConflictDetector.js', '/lib/botblocker/userAgentAnalyzer.js', '/lib/botblocker/nginxGenerator.js',
      '/lib/botblocker/apacheGenerator.js', '/lib/botblocker/cloudflareGenerator.js', '/lib/botblocker/middlewareGenerator.js',
      '/lib/botblocker/configurationValidator.js', '/lib/botblocker/protectionScore.js', '/lib/botblocker/coverageAnalyzer.js',
      '/lib/botblocker/securityChecker.js', '/lib/botblocker/index.js', '/assets/js/botblocker/ui.js'],
    urlId: 'botblocker-url', formId: 'botblocker-form', local: true
  }
};

function makeSandbox() {
  const ids = new Set();
  const elements = {};
  const fetches = [];
  function fakeEl(id) {
    const el = {
      id, name: '', value: '', checked: false, innerHTML: '', textContent: '', hidden: false,
      className: '', style: {}, files: [], options: null,
      listeners: {}, onclick: null, oninput: null, onchange: null, onsubmit: null,
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      removeEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      appendChild() {}, removeChild() {}, remove() {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      setAttribute() {}, getAttribute() { return ''; }, hasAttribute() { return false; },
      closest() { return null; }, focus() {}, blur() {}, select() {}, click() {},
      requestSubmit() {}, scrollIntoView() {},
      dispatchEvent() { return true; }
    };
    Object.defineProperty(el, 'innerHTML', {
      get() { return this._html || ''; },
      set(v) {
        this._html = String(v == null ? '' : v);
        const re = /id="([^"]+)"/g;
        let m;
        while ((m = re.exec(this._html))) if (!elements[m[1]]) { elements[m[1]] = fakeEl(m[1]); ids.add(m[1]); }
      }
    });
    return el;
  }
  const doc = {
    getElementById(id) { return elements[id] || null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) { return fakeEl('tmp-' + tag); },
    addEventListener() {}, removeEventListener() {},
    body: fakeEl('body'),
    documentElement: fakeEl('html')
  };
  const sandbox = {
    scrollY: 0, scrollTo() {}, addEventListener() {}, removeEventListener() {},
    innerWidth: 1280, innerHeight: 900,
    document: doc,
    navigator: {},
    location: { search: '', href: BASE + '/', reload() {}, hash: '' },
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    URL: URL, URLSearchParams: URLSearchParams,
    Blob: function () { this.size = 0; },
    FileReader: function () { this.readAsText = function () {}; },
    fetch(url, opts) {
      fetches.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null });
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream' },
        body: { getReader: () => ({ read: () => new Promise(() => {}) }) }
      });
    },
    AbortController,
    performance: { now: () => Date.now() },
    setTimeout, clearTimeout, setInterval, clearInterval,
    console, Math, Date, JSON, RegExp, Object, Array, String, Number, Boolean, Error, Promise,
    parseInt, parseFloat, isNaN
  };
  // Minimal FormData: reads named controls from the registered fake elements.
  class FormData {
    constructor(form) {
      this._map = {};
      const els = Object.values(elements).filter(e => e.name);
      for (const e of els) {
        if (e.type === 'checkbox') { if (e.checked) this._map[e.name] = 'on'; }
        else if (e.type === 'radio') { if (e.checked) this._map[e.name] = e.value; }
        else this._map[e.name] = e.value;
      }
    }
    get(n) { return Object.prototype.hasOwnProperty.call(this._map, n) ? this._map[n] : null; }
  }
  sandbox.FormData = FormData;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  sandbox.document = doc;
  return { sandbox, elements, fakeEl, fetches };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
(async () => {
  for (const [page, cfg] of Object.entries(PAGES)) {
    const html = execFileSync('curl', ['-s', BASE + page], { encoding: 'utf8' });
    const { sandbox, elements, fakeEl, fetches } = makeSandbox();
    const re = /id="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) if (!elements[m[1]]) { elements[m[1]] = fakeEl(m[1]); }
    // Hydrate named form controls (name/type/value/checked) from the static markup.
    let anon = 0;
    for (const tag of html.match(/<(?:input|select|textarea)\b[^>]*>/g) || []) {
      const idM = tag.match(/id="([^"]+)"/);
      let el = idM ? elements[idM[1]] : null;
      if (!el) { el = fakeEl('anon-' + (anon++)); elements[el.id] = el; }
      const nameM = tag.match(/name="([^"]*)"/); if (nameM) el.name = nameM[1];
      const typeM = tag.match(/type="([^"]*)"/); if (typeM) el.type = typeM[1];
      const valM = tag.match(/value="([^"]*)"/); if (valM) el.value = valM[1];
      if (/checked/.test(tag)) el.checked = true;
      if (/^<(?!input)/.test(tag) && /<option value="([^"]*)"[^>]*selected/.test(tag)) {
        const selM = tag.match(/<option value="([^"]*)"[^>]*selected/); if (selM) el.value = selM[1];
      }
    }
    const ctx = vm.createContext(sandbox);
    try {
      for (const s of cfg.scripts) vm.runInContext(fs.readFileSync('.' + s, 'utf8'), ctx, { filename: s });
      const form = elements[cfg.formId];
      const urlEl = elements[cfg.urlId];
      if (!form || !urlEl) throw new Error('form/url element missing in harness');
      for (const c of (cfg.cases || [{ url: 'https://example.com' }])) {
        fetches.length = 0;
        urlEl.value = c.url;
        const submit = (form.listeners['submit'] || [])[0];
        if (!submit) throw new Error('no submit listener');
        submit({ preventDefault() {} });
        await sleep(60);
        if (cfg.local) {
          // botblocker generates locally: the report DOM must have been rendered
          const out = elements['botblocker-results'];
          if (!out || !/Generated Configuration/.test(out.innerHTML)) throw new Error('botblocker report not rendered after submit');
          console.log('  ✓ ' + page + ' (local generation re-renders on submit)');
          continue;
        }
        const first = fetches.find(f => f.body);
        if (!first) throw new Error('no API payload captured for ' + c.url);
        const body = first.body;
        for (const [k, v] of Object.entries(c.expect || {})) {
          const got = body[k];
          if (typeof v === 'function') {
            if (!v(got)) throw new Error(`payload.${k} = ${JSON.stringify(got)} failed check`);
          } else if (got !== v) {
            throw new Error(`payload.${k} = ${JSON.stringify(got)}, expected ${JSON.stringify(v)}`);
          }
        }
        if (c.expectFirstFetch && !c.expectFirstFetch.test(first.url)) {
          throw new Error('first fetch was ' + first.url);
        }
        console.log('  ✓ ' + page + '  ' + c.url + '  →  ' + JSON.stringify(Object.entries(c.expect || {}).reduce((a, [k, v]) => (a[k] = body[k], a), {})));
      }
    } catch (e) {
      failures++;
      console.log('  ✗ ' + page + '  →  ' + (e && e.message));
    }
  }
  console.log(failures ? '\n' + failures + ' submit case(s) failed' : '\nAll submit payloads correct');
  process.exit(failures ? 1 : 0);
})();
