'use strict';
/* Core Web Vitals & INP Auditor — UI smoke test.
 * Drives assets/js/cwv/report.js + assets/js/cwv/ui.js in a VM with a
 * fake DOM, fake fetch (SSE + JSON), and a fake measurement iframe that
 * posts staged messages. The report rendered in the test comes from the
 * real analyzeBundle() pipeline, so the UI is exercised on real data. */

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const { analyzeBundle } = require('./analyze');

/* ---------- fixture measurement bundle (the iframe's "done" payload) ---------- */
function fixturePayload() {
  return {
    v: 1,
    meta: {
      requestedUrl: 'https://example.com/', finalUrl: 'https://example.com/',
      transport: 'server-proxy', relay: null, htmlStatus: 200, htmlContentType: 'text/html',
      htmlBytes: 20000, htmlTruncated: false, challenge: false, redirects: [],
      protocolDoc: 'h2', userAgent: 'uitest', startedAt: 1, completedAt: 2, notes: [], sid: 's1'
    },
    docPhases: null, docHeaders: {},
    nav: { ttfb: null, domInteractive: 400, domContentLoaded: 600, load: 900 },
    vitals: {
      lcp: { status: 'measured', value: 2100, entry: { startTime: 2100, size: 80000, url: 'https://example.com/hero.webp', tag: 'img', selector: 'img.hero', text: null, rect: { w: 400, h: 300, x: 0, y: 0 } }, candidates: [] },
      fcp: { status: 'measured', value: 1500, reason: null },
      cls: { status: 'measured', value: 0.04, entries: [{ value: 0.04, startTime: 900, hadRecentInput: false, sources: [] }], excluded: [] },
      inp: { status: 'measured', value: 184, interactions: [{ id: 0, type: 'click', target: { tag: 'button', selector: 'button.menu', text: 'Menu button', rect: { w: 100, h: 40, x: 0, y: 0 } }, latency: 184, inputDelay: 42, processing: 61, presentation: 81, startTime: 3000, responded: true, measuredVia: 'event-timing' }] },
      tbt: { status: 'measured', value: 0 },
      si: { status: 'unavailable', reason: 'Not measurable without screenshot/video capture.' }
    },
    longTasks: [],
    resources: [
      { name: 'https://example.com/', startTime: 0, duration: 640, initiatorType: 'navigation', transferSize: 20000, protocol: 'h2', redirectCount: 0, timingAvailable: true },
      { name: 'https://example.com/style.css', startTime: 400, duration: 300, initiatorType: 'link', transferSize: 30000, protocol: 'h2', redirectCount: 0, timingAvailable: true },
      { name: 'https://example.com/hero.webp', startTime: 500, duration: 1200, initiatorType: 'img', transferSize: 80000, protocol: 'h2', redirectCount: 0, timingAvailable: true }
    ],
    dom: { nodeCount: 900, maxDepth: 12, textNodeCount: 400, tagCounts: { div: 100 }, bodyBytes: 50000, dynamicAdded: 10, largestSubtrees: [], iframes: 0, scripts: 2, styles: 1, images: 1 },
    images: [{ src: 'https://example.com/hero.webp', renderedW: 400, renderedH: 300, naturalW: 800, naturalH: 600, bytes: 80000, loading: null, fetchpriority: null, decoding: null, srcset: false, sizes: false, hasDimensions: true, inViewport: true }],
    fonts: [], cssFiles: [{ url: 'https://example.com/style.css', bytes: 30000, blocking: true, inline: false, media: null, imports: [], fontFaces: [], urlRefs: [] }],
    jsFiles: [{ url: 'https://example.com/app.js', bytes: 90000, async: false, defer: true, module: false, inHead: false, blocking: false }],
    linkHints: { preload: [], preconnect: [], dnsPrefetch: [], modulepreload: [] },
    internalLinks: ['https://example.com/page-a', 'https://example.com/page-b'],
    interactives: { tested: [], excluded: [] },
    loafs: [], hardening: { storage: true, serviceWorker: true, cookies: true, windowOpen: true },
    warnings: [], notes: [],
    resourceMeta: null,
    profile: { id: 'mobile', label: 'Mobile', viewport: { w: 412, h: 823 }, dpr: null, network: null, note: null }
  };
}
const report = analyzeBundle(fixturePayload());

/* ---------- fake DOM ---------- */
function fakeEl(id) {
  return {
    id, value: '', innerHTML: '', className: '', hidden: false, dataset: {}, style: {}, checked: false,
    textContent: '', listeners: {}, attrs: {},
    addEventListener(t, fn) { this.listeners[t] = fn; },
    onclick: null, oninput: null, onchange: null,
    focus() {}, remove() {}, scrollIntoView() {}, appendChild() {},
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] != null ? this.attrs[k] : null; },
    hasAttribute() { return false; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; },
    classList: { add() {}, remove() {}, contains() { return false; } },
    getBoundingClientRect() { return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; }
  };
}

function makeEnv(mode) {
  const els = {};
  const doc = {
    getElementById(id) { if (!els[id]) els[id] = fakeEl(id); return els[id]; },
    createElement(tag) {
      if (tag === 'iframe') {
        const frame = fakeEl('frame');
        function nonceFrom(v) {
          const m = String(v).match(/[?&]n=([^&"' ]+)/);
          return m ? decodeURIComponent(m[1]) : null;
        }
        Object.defineProperty(frame, 'src', {
          set(v) { scheduleStages(nonceFrom(v)); }, get() { return ''; }
        });
        Object.defineProperty(frame, 'srcdoc', {
          set(v) { scheduleStages(nonceFrom(v)); }, get() { return ''; }
        });
        return frame;
      }
      return fakeEl('tmp-' + tag);
    },
    body: fakeEl('body'),
    head: { appendChild() {}, removeChild() {} },
    documentElement: fakeEl('html'),
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    currentScript: null
  };
  const msgListeners = [];
  const fakeWindow = {
    addEventListener(t, fn) { if (t === 'message') msgListeners.push(fn); },
    removeEventListener(t, fn) { const i = msgListeners.indexOf(fn); if (i >= 0) msgListeners.splice(i, 1); },
    scrollTo() {}, print() {}, open() { return null; },
    location: { search: '', reload() {} },
    CwvRewriter: require('./rewriter')
  };
  function scheduleStages(nonce) {
    const stages = ['ready', 'loaded', 'settled', 'interactions', 'done'];
    let i = 0;
    (function next() {
      if (i >= stages.length) return;
      const s = stages[i++];
      setTimeout(() => {
        msgListeners.slice().forEach(fn => fn({
          data: { source: 'cwv-measure', nonce, stage: s, payload: s === 'done' ? fixturePayload() : null }
        }));
        next();
      }, 2);
    })();
  }
  // fetch stub
  const sseChunks = (() => {
    const result = { sid: 's1', pageUrl: '/api/cwv-page?sid=s1', finalUrl: 'https://example.com/', requestedUrl: 'https://example.com/', status: 200, htmlBytes: 20000, truncated: false, protocol: 'h2', headers: { 'cache-control': 'no-cache' }, phases: { dnsMs: 10, connectMs: 20, tlsMs: 30, serverMs: 100, ttfbMs: 160, downloadMs: 40, totalMs: 200 }, redirects: [], rewriteStats: {} };
    const text = 'event: progress\ndata: ' + JSON.stringify({ stage: 'validate', message: 'Validating…' }) + '\n\n' +
      'event: result\ndata: ' + JSON.stringify(result) + '\n\n';
    const chunks = [];
    let i = 0;
    while (i < text.length) { const n = Math.floor(Math.random() * 40) + 5; chunks.push(text.slice(i, i + n)); i += n; }
    return chunks;
  })();
  global.__cwvMode = mode;
  const RELAY_HTML = '<!doctype html><html><head><title>Relayed site</title></head><body><h1>Hello relayed world</h1><p>Some content here that makes this page long enough to look like a real document instead of an error page.</p><p>A second paragraph with additional readable text for the auditor to measure.</p><button class="menu-toggle" aria-expanded="false">Menu</button><img src="https://cdn.example/hero.webp" alt="hero" width="400" height="300"></body></html>';
  const fetchStub = async (url, opt) => {
    if (String(url).indexOf('/api/cwv-fetch') === 0) {
      if (global.__cwvMode === 'ratelimited') {
        return { ok: false, status: 429, json: async () => ({ code: 'ratelimit', message: 'Too many audits from this network. Please wait a few minutes.' }) };
      }
      if (global.__cwvMode === 'netfail') {
        throw new TypeError('Failed to fetch');
      }
      if (global.__cwvMode === 'empty-sse') {
        // SSE stream that ends with only progress events — no result, no
        // error (what a truncating proxy delivers). The UI must fall back.
        const onlyProgress = 'event: progress\ndata: ' + JSON.stringify({ stage: 'validate', message: 'Validating…' }) + '\n\n';
        const chunks = [];
        let i = 0;
        while (i < onlyProgress.length) { const n = 7; chunks.push(onlyProgress.slice(i, i + n)); i += n; }
        return {
          ok: true, status: 200,
          body: { getReader() { let idx = 0; return { read: async () => idx < chunks.length ? { done: false, value: new Uint8Array(Buffer.from(chunks[idx++], 'utf8')) } : { done: true } }; } },
          json: async () => ({})
        };
      }
      return {
        ok: true, status: 200,
        body: {
          getReader() {
            let idx = 0;
            return { read: async () => idx < sseChunks.length ? { done: false, value: new Uint8Array(Buffer.from(sseChunks[idx++], 'utf8')) } : { done: true } };
          }
        },
        json: async () => ({})
      };
    }
    if (String(url).indexOf('api.allorigins.win/raw') >= 0) {
      return { text: async () => RELAY_HTML, status: 200, headers: { get: () => null } };
    }
    if (String(url).indexOf('api.codetabs.com') >= 0) {
      return { text: async () => RELAY_HTML, status: 200, headers: { get: () => null } };
    }
    if (String(url).indexOf('/api/cwv-meta') === 0) {
      return { ok: true, status: 200, json: async () => ({ sid: 's1', url: 'https://example.com/', finalUrl: 'https://example.com/', docStatus: 200, docHeaders: { 'cache-control': 'no-cache' }, docPhases: { ttfbMs: 160 }, docProtocol: 'h2', docRedirects: [], resources: [], resourceCount: 0, totalBytes: 0 }) };
    }
    if (String(url).indexOf('/api/cwv-analyze') === 0) {
      return { ok: true, status: 200, json: async () => report };
    }
    return { ok: false, status: 404, json: async () => ({ message: 'not found' }) };
  };
  return { els, doc, fakeWindow, fetchStub, msgListeners };
}

/* ---------- run scripts in VM ---------- */
async function runUi(mode) {
  const env = makeEnv(mode);
  const ctx = {
    window: env.fakeWindow,
    document: env.doc,
    navigator: { userAgent: 'uitest' },
    location: env.fakeWindow.location,
    fetch: env.fetchStub,
    setTimeout, clearTimeout,
    TextDecoder, TextEncoder, AbortController, URL, URLSearchParams, Blob: function () {}, Promise,
    performance: { now: () => Date.now() },
    console,
    getComputedStyle: () => ({}),
    MutationObserver: function () { this.observe = function () {}; },
    requestAnimationFrame: fn => setTimeout(fn, 1)
  };
  ctx.global = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('assets/js/cwv/report.js', 'utf8'), ctx, { filename: 'report.js' });
  vm.runInContext(fs.readFileSync('assets/js/cwv/ui.js', 'utf8'), ctx, { filename: 'ui.js' });
  // fill inputs
  env.els['cwv-url'] = env.doc.getElementById('cwv-url');
  env.els['cwv-url'].value = 'https://example.com';
  env.doc.getElementById('cwv-profile').value = 'mobile';
  const form = env.doc.getElementById('cwv-form');
  if (!form.listeners.submit) throw new Error('ui.js did not attach the submit handler');
  form.listeners.submit({ preventDefault() {} });
  await new Promise(res => setTimeout(res, 250));
  return { out: env.doc.getElementById('cwv-results'), ctx };
}

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ok — ' + name); }
  catch (e) { failed++; console.error('  FAIL — ' + name + '\n    ' + (e && e.message)); }
}

(async function main() {
  await t('UI: full pipeline renders the real report (score, sections, lab/field separation)', async () => {
    const { out } = await runUi('ok');
    const html = out.innerHTML;
    for (const needle of ['Tool Performance Score', 'Core Web Vitals Summary', 'INP Analysis', 'LCP Analysis',
      'CLS Auditor', 'FCP — First Contentful Paint', 'TTFB Analysis', 'Network Waterfall', 'Network Dependency Tree',
      'Long Task Detection', 'Network Efficiency — Protocol', 'Resource hints',
      'JavaScript Audit', 'CSS Audit', 'Image Audit', 'Font Audit', 'Third-Party Script Audit', 'Caching Audit',
      'Rendering Analysis', 'DOM Analysis', 'Priority Issues', 'Technical Details',
      'Field data unavailable for this URL.', 'Lab Data', 'INP: 184 ms', 'Input', 'Processing', 'Presentation']) {
      assert.ok(html.indexOf(needle) >= 0, 'missing: ' + needle);
    }
    assert.ok(html.indexOf('<td style="text-align:right">') >= 0 || html.indexOf('LCP') >= 0);
  });

  await t('UI: rate-limited server response renders the error box (no crash, no fake report)', async () => {
    const { out } = await runUi('ratelimited');
    assert.ok(out.innerHTML.indexOf('Too many audits') >= 0);
  });

  await t('UI: truncated/empty SSE stream (proxy cut) falls back to browser-direct and still reports', async () => {
    const { out } = await runUi('empty-sse');
    assert.ok(out.innerHTML.indexOf('Tool Performance Score') >= 0, 'report rendered via the relay fallback');
    assert.ok(out.innerHTML.indexOf('The server returned no result.') === -1, 'no dead-end failure box');
  });

  await t('UI: network failure on the server endpoint falls back to browser-direct', async () => {
    const { out } = await runUi('netfail');
    assert.ok(out.innerHTML.indexOf('Tool Performance Score') >= 0, 'report rendered via the relay fallback');
  });

  await t('UI: client-side URL validation rejects private targets before any fetch', async () => {
    const env = makeEnv('ok');
    const ctx = {
      window: env.fakeWindow, document: env.doc, navigator: { userAgent: 'uitest' },
      location: env.fakeWindow.location, fetch: env.fetchStub,
      setTimeout, clearTimeout, TextDecoder, TextEncoder, AbortController, URL, URLSearchParams, Blob: function () {}, Promise,
      performance: { now: () => Date.now() }, console,
      getComputedStyle: () => ({}),
      MutationObserver: function () { this.observe = function () {}; },
      requestAnimationFrame: fn => setTimeout(fn, 1)
    };
    ctx.global = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync('assets/js/cwv/ui.js', 'utf8'), ctx, { filename: 'ui.js' });
    env.doc.getElementById('cwv-url').value = 'http://127.0.0.1/';
    let fetched = false;
    ctx.fetch = async () => { fetched = true; return { ok: true, status: 200, json: async () => ({}) }; };
    env.doc.getElementById('cwv-form').listeners.submit({ preventDefault() {} });
    const out = env.doc.getElementById('cwv-results');
    assert.ok(out.innerHTML.indexOf('cannot be audited') >= 0);
    assert.strictEqual(fetched, false, 'no network call for private targets');
  });

  await t('UI: report renderer escapes untrusted report data (XSS)', async () => {
    const env = makeEnv('ok');
    const ctx = {
      window: env.fakeWindow, document: env.doc, navigator: { userAgent: 'uitest' },
      location: env.fakeWindow.location, setTimeout, clearTimeout, Promise, console
    };
    ctx.global = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync('assets/js/cwv/report.js', 'utf8'), ctx, { filename: 'report.js' });
    const evil = JSON.parse(JSON.stringify(report));
    evil.meta.finalUrl = 'https://example.com/<script>alert(1)</script>';
    evil.lab.inp.interactions[0].target.text = '<img src=x onerror=alert(1)>';
    const wrap = env.doc.createElement('div');
    ctx.window.CwvUi.Report.render(wrap, evil);
    assert.ok(wrap.innerHTML.indexOf('<script>alert(1)') === -1, 'script tag escaped');
    assert.ok(wrap.innerHTML.indexOf('<img src=x onerror') === -1, 'img/onerror tag escaped');
    assert.ok(wrap.innerHTML.indexOf('&lt;script&gt;') >= 0 || wrap.innerHTML.indexOf('&lt;img src=x') >= 0, 'escaped entity present');
  });

  console.log('\nuitest: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
