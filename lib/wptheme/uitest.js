'use strict';
/* UI smoke test: drives assets/js/wptheme/ui.js with a fake DOM + fake SSE fetch. */
const fs = require('fs');
const vm = require('vm');
const dns = require('dns');
dns.promises.lookup = async (h, o) => { const r = { address: '93.184.216.34', family: 4 }; return o && o.all ? [r] : r; };
const { runScan } = require('./orchestrate');

function fakeEl(id) {
  return {
    id, value: 'astra.test', innerHTML: '', className: '',
    listeners: {},
    addEventListener(t, fn) { this.listeners[t] = fn; },
    onclick: null, focus() {}, select() {},
    scrollIntoView() {},
    setAttribute() {}, getAttribute() { return ''; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    appendChild() {}, remove() {}, classList: { add() {}, remove() {} },
    style: {}
  };
}
const elements = {};
const doc = {
  getElementById(id) { if (!elements[id]) elements[id] = fakeEl(id); return elements[id]; },
  createElement() { return fakeEl('tmp'); },
  body: fakeEl('body'),
  querySelectorAll() { return []; },
  addEventListener() {}
};
const sseChunks = [];
const fakeFetch = async (url, opt) => {
  const body = JSON.parse(opt.body);
  let result, error;
  const progress = [];
  try { result = await runScan(body.url, { transport: global.__fixtureTransport, onProgress: s => progress.push(s) }); }
  catch (e) { error = { code: e.code, message: e.message, scan: e.scan || null }; }
  let text = '';
  for (const p of progress) text += 'event: progress\ndata: ' + JSON.stringify(p) + '\n\n';
  if (result) text += 'event: result\ndata: ' + JSON.stringify(result) + '\n\n';
  if (error) text += 'event: error\ndata: ' + JSON.stringify(error) + '\n\n';
  // Split into awkward chunk boundaries to exercise the stream parser
  const chunks = [];
  let i = 0;
  while (i < text.length) { const n = Math.floor(Math.random() * 97) + 3; chunks.push(text.slice(i, i + n)); i += n; }
  return {
    ok: true, status: 200, body: {
      getReader() {
        let idx = 0;
        return { read: async () => idx < chunks.length ? { done: false, value: new Uint8Array(Buffer.from(chunks[idx++], 'utf8')) } : { done: true } };
      }
    },
    json: async () => ({})
  };
};

const ctx = {
  document: doc, navigator: { clipboard: { writeText: async () => {} } },
  window: {}, location: { search: '' }, URLSearchParams, TextDecoder,
  fetch: fakeFetch, setTimeout, console, Math, Date, JSON, Array, String, Object
};
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.AbortController = AbortController;

/* fixture transport — an Astra-style WordPress site */
const cssHeader = f => '/*\n' + Object.keys(f).map(k => k + ': ' + f[k]).join('\n') + '\n*/\n.ast-container{max-width:1px}';
const ASTRA = cssHeader({ 'Theme Name': 'Astra', 'Theme URI': 'https://wpastra.com/', 'Author': 'Brainstorm Force', 'Author URI': 'https://wpastra.com/about/', 'Version': '4.6.12', 'License': 'GPLv2', 'Text Domain': 'astra', 'Tags': 'blog, one-column' });
const home = `<!doctype html><html><head><meta name="generator" content="WordPress 6.8">
<link rel="stylesheet" id="astra-css" href="https://astra.test/wp-content/themes/astra/style.css?ver=4.6.12">
<link rel="stylesheet" href="https://astra.test/wp-includes/css/dist/block-library/style.min.css?ver=6.8">
</head><body class="home blog ast-desktop ast-header-break-point"><main><p>${'content '.repeat(60)}</p></main></body></html>`;
global.__fixtureTransport = async (u) => {
  const h = u.href;
  if (h.endsWith('/robots.txt')) return { status: 200, headers: { 'content-type': 'text/plain' }, text: 'User-agent: *\nDisallow: /wp-admin/', bytes: 40, ms: 3 };
  if (h === 'https://astra.test/') return { status: 200, headers: { 'content-type': 'text/html' }, text: home, bytes: home.length, ms: 9 };
  if (h.includes('/themes/astra/style.css')) return { status: 200, headers: { 'content-type': 'text/css' }, text: ASTRA, bytes: ASTRA.length, ms: 4 };
  if (h.includes('screenshot.png')) return { status: 200, headers: { 'content-type': 'image/png' }, text: 'X'.repeat(2000), bytes: 2000, ms: 4 };
  return { status: 404, headers: {}, text: '', bytes: 0, ms: 1 };
};

const code = fs.readFileSync(__dirname + '/../../assets/js/wptheme/ui.js', 'utf8');
vm.createContext(ctx);
vm.runInContext(code, ctx);

(async () => {
  const form = elements['wptheme-form'];
  if (!form) { console.error('FAIL: form not bound'); process.exit(1); }
  await form.listeners.submit({ preventDefault() {} });
  await new Promise(r => setTimeout(r, 300));
  let html = elements['wptheme-results'].innerHTML;
  const must = [
    'WordPress Detected', 'score-card', 'Active theme', 'Astra', 'astra',
    '4.6.12', 'exact', 'Brainstorm Force', 'Standard theme',
    'Detection evidence', 'audit-fold', 'Theme exposure', 'Scan details',
    'WordPress.org', 'Copy summary'
  ];
  let ok = true;
  for (const m of must) {
    if (!html.includes(m)) { console.error('FAIL: report missing: ' + m); ok = false; }
  }
  const forbidden = ['undefined', '[object Object]', 'null<'];
  for (const f of forbidden) {
    if (new RegExp(f.replace(/[[\]]/g, '\\$&')).test(html.replace(/undefined-safe/g, ''))) {
      // 'undefined' check: allow none
      if (f === 'undefined' && html.includes('undefined')) { console.error('FAIL: report contains "undefined"'); ok = false; }
      if (f === '[object Object]' && html.includes('[object Object]')) { console.error('FAIL: report contains [object Object]'); ok = false; }
    }
  }
  console.log('HTML HEAD:', html.slice(0,300)); console.log(ok ? 'UI smoke test: PASS (' + html.length + ' chars)' : 'UI smoke test: FAILED');

  /* Scenario 2: Cloudflare challenge → Unable to determine error card */
  global.__fixtureTransport = async () => ({ status: 503, headers: { server: 'cloudflare', 'cf-ray': 'x' }, text: '<!doctype html><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/h/b/x"></script>', bytes: 120, ms: 4 });
  elements['wptheme-results'].innerHTML = '';
  await form.listeners.submit({ preventDefault() {} });
  await new Promise(r => setTimeout(r, 300));
  html = elements['wptheme-results'].innerHTML;
  if (!html.includes('Unable to determine') || !html.includes('challenge') || html.includes('Not Detected')) {
    console.error('FAIL: challenge path should show Unable to determine');
    console.error(html.slice(0, 300));
    ok = false;
  } else {
    console.log('Challenge error UI: PASS');
  }

  /* Scenario 3: Shopify site → Not Detected + platform hint */
  const shopHtml = '<!doctype html><html><head><title>Shop</title><script>window.Shopify={theme:{}};</script><link rel="stylesheet" href="https://cdn.shopify.com/s/files/1/x/t/2/assets/theme.css"></head><body class="template-index"><p>' + 'Buy wonderful products online. '.repeat(30) + '</p></body></html>';
  global.__fixtureTransport = async (u) => {
    if (u.href.endsWith('/robots.txt')) return { status: 404, headers: {}, text: '', bytes: 0, ms: 1 };
    if (u.href.endsWith('/wp-json/')) return { status: 404, headers: {}, text: '', bytes: 0, ms: 1 };
    return { status: 200, headers: { 'content-type': 'text/html' }, text: shopHtml, bytes: shopHtml.length, ms: 6 };
  };
  elements['wptheme-results'].innerHTML = '';
  await form.listeners.submit({ preventDefault() {} });
  await new Promise(r => setTimeout(r, 300));
  html = elements['wptheme-results'].innerHTML;
  if (!html.includes('WordPress Not Detected') || !html.includes('Shopify')) {
    console.error('FAIL: not-detected path missing Shopify hint');
    console.error(html.slice(0, 300));
    ok = false;
  } else {
    console.log('Not-detected + platform hint UI: PASS');
  }
  process.exit(ok ? 0 : 1);
})();
