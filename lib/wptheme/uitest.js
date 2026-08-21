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
function fakeDocFromHtml(html) {
  const links = [];
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const tag = m[0];
    const href = (tag.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) || [])[1] || '';
    const rel = /rel\s*=\s*(?:"stylesheet"|'stylesheet'|stylesheet\b)/i.test(tag);
    const id = ((tag.match(/\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) || [])[1] || '');
    if (href && rel) links.push({ getAttribute: k => (k === 'href' ? href : (k === 'id' ? id : null)) });
  }
  return {
    documentElement: { innerHTML: String(html || '') },
    querySelectorAll(sel) {
      if (sel === 'link[rel~="stylesheet"]') return links;
      return [];
    },
    title: 'ok'
  };
}
const doc = {
  getElementById(id) { if (!elements[id]) elements[id] = fakeEl(id); return elements[id]; },
  createElement() { return fakeEl('tmp'); },
  body: fakeEl('body'),
  querySelectorAll() { return []; },
  addEventListener() {},
  implementation: { createHTMLDocument: () => fakeDocFromHtml('') }
};
const sseChunks = [];
global.__serverScanMode = 'server-ok';
async function sseResponse(events) {
  let text = '';
  events.forEach(({ ev, data }) => { text += 'event: ' + ev + '\ndata: ' + JSON.stringify(data) + '\n\n'; });
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
}
const fakeFetch = async (url, opt) => {
  opt = opt || {};
  if (url === '/api/wptheme-scan') {
    const body = JSON.parse(opt.body);
    if (global.__serverScanMode === 'server-tls-blocked') {
      return sseResponse([
        { ev: 'progress', data: { stage: 'validate', message: 'Validating…' } },
        { ev: 'error', data: { code: 'tls_blocked', message: 'The secure connection was reset before TLS completed.', scan: null } }
      ]);
    }
    if (global.__serverScanMode === 'server-blocked') {
      return sseResponse([
        { ev: 'progress', data: { stage: 'validate', message: 'Validating…' } },
        { ev: 'error', data: { code: 'blocked', message: 'The website blocked this scanner (403).', scan: null } }
      ]);
    }
    let result, error;
    const progress = [];
    try { result = await runScan(body.url, { transport: global.__fixtureTransport, onProgress: s => progress.push(s) }); }
    catch (e) { error = { code: e.code, message: e.message, scan: e.scan || null }; }
    const events = progress.map(p => ({ ev: 'progress', data: p }));
    if (result) events.push({ ev: 'result', data: result });
    if (error) events.push({ ev: 'error', data: error });
    return sseResponse(events);
  }
  if (url === '/api/wptheme-analyze') {
    const body = JSON.parse(opt.body);
    try {
      const report = analyzeCollected(body.bundle);
      return { ok: true, status: 200, json: async () => report };
    } catch (e) {
      return { ok: false, status: 422, json: async () => ({ code: e.code, message: e.message }) };
    }
  }
  // Relay-chain simulation: allorigins / corsproxy / codetabs / archive.org
  async function targetResponse(u) {
    return global.__fixtureTransport(new URL(u), null, {});
  }
  if (url.startsWith('https://api.allorigins.win/get?')) {
    const target = decodeURIComponent(url.split('url=')[1]);
    const r = await targetResponse(target);
    return { ok: true, status: 200, json: async () => ({ contents: r.status < 400 ? r.text : '', status: { http_code: r.status, url: target, content_type: (r.headers && r.headers['content-type']) || '' } }) };
  }
  if (url.startsWith('https://corsproxy.io/')) {
    const target = decodeURIComponent(url.split('url=')[1]);
    const r = await targetResponse(target);
    return { ok: r.status < 400, status: r.status, url: target, text: async () => r.text, headers: { forEach() {} } };
  }
  if (url.startsWith('https://api.codetabs.com/v1/proxy/')) {
    const target = decodeURIComponent(url.split('quest=')[1]);
    const r = await targetResponse(target);
    if (r.status >= 400) throw new Error('Relay refused the request');
    return { ok: true, status: 200, url: target, text: async () => r.text, headers: { forEach() {} } };
  }
  if (url.startsWith('https://archive.org/wayback/available')) {
    return { ok: true, status: 200, json: async () => (global.__wayback || { archived_snapshots: {} }) };
  }
  if (url.startsWith('https://web.archive.org/web/')) {
    return { ok: true, status: 200, url, text: async () => (global.__snapshotHtml || ''), headers: { forEach() {} } };
  }
  // Direct browser fetch served by the fixture transport
  const href = new URL(url).href;
  const res = await targetResponse(url);
  return { ok: res.status >= 200 && res.status < 300, status: res.status, url: href, text: async () => res.text, headers: { forEach() {} } };
};

const { analyzeCollected } = require('./orchestrate');
const ctx = {
  document: doc, navigator: { clipboard: { writeText: async () => {} } },
  window: {}, location: { search: '', href: 'https://huvanti.test/wordpress-theme-detector' }, URLSearchParams, TextDecoder,
  fetch: fakeFetch, setTimeout, console, Math, Date, JSON, Array, String, Object,
  URL, DOMParser: function DomParserShim() { this.parseFromString = t => fakeDocFromHtml(t); },
  Image: function () { const self = this; setTimeout(() => { if (self.onload) self.onload(); }, 1); },
  clearTimeout
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

const collectorCode = fs.readFileSync(__dirname + '/../../assets/js/wptheme/collector.js', 'utf8');
const code = fs.readFileSync(__dirname + '/../../assets/js/wptheme/ui.js', 'utf8');
vm.createContext(ctx);
vm.runInContext(collectorCode, ctx);
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
  console.log(ok ? 'UI smoke test: PASS (' + html.length + ' chars)' : 'UI smoke test: FAILED');

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

  /* Scenario 4: server TLS-blocked → automatic browser-relay fallback */
  global.__serverScanMode = 'server-tls-blocked';
  global.__fixtureTransport = async (u) => {
    const h = u.href;
    if (h.endsWith('/robots.txt')) return { status: 200, headers: { 'content-type': 'text/plain' }, text: 'User-agent: *\nDisallow: /wp-admin/', bytes: 40, ms: 3 };
    if (h === 'https://astra.test/') return { status: 200, headers: { 'content-type': 'text/html' }, text: home, bytes: home.length, ms: 9 };
    if (h.includes('/themes/astra/style.css')) return { status: 200, headers: { 'content-type': 'text/css' }, text: ASTRA, bytes: ASTRA.length, ms: 4 };
    return { status: 404, headers: {}, text: '', bytes: 0, ms: 1 };
  };
  elements['wptheme-results'].innerHTML = '';
  await form.listeners.submit({ preventDefault() {} });
  await new Promise(r => setTimeout(r, 600));
  html = elements['wptheme-results'].innerHTML;
  if (!html.includes('WordPress Detected') || !html.includes('Astra') || !html.includes('collected through your browser')) {
    console.error('FAIL: browser fallback did not produce a report');
    console.error(html.slice(0, 400));
    ok = false;
  } else {
    console.log('Browser-relay fallback UI: PASS');
  }
  /* Scenario 5: server blocked (403) → browser fallback → homepage blocked on every
     transport → public REST proves WordPress → Wayback snapshot finds the theme */
  global.__serverScanMode = 'server-blocked';
  const wpHomeArchived = home.replace(/https:\/\/astra\.test/g, 'https://blocky.test');
  global.__wayback = { archived_snapshots: { closest: { available: true, url: 'https://web.archive.org/web/20240601000000/https://blocky.test/', timestamp: '20240601000000' } } };
  global.__snapshotHtml = wpHomeArchived;
  global.__fixtureTransport = async (u) => {
    const h = u.href;
    if (h.startsWith('https://web.archive.org/')) return { status: 200, headers: { 'content-type': 'text/html' }, text: wpHomeArchived, bytes: wpHomeArchived.length, ms: 30 };
    if (h === 'https://blocky.test/' || h === 'https://blocky.test/robots.txt') return { status: 403, headers: { 'content-type': 'text/html' }, text: '403 Forbidden', bytes: 13, ms: 5 };
    if (h.startsWith('https://blocky.test/wp-json/')) return { status: 200, headers: { 'content-type': 'application/json' }, text: JSON.stringify({ name: 'Blocky', namespaces: ['wp/v2', 'oembed/1.0'] }), bytes: 120, ms: 8 };
    if (h.startsWith('https://blocky.test/?rest_route=')) return { status: 403, headers: {}, text: '', bytes: 0, ms: 2 };
    if (h.includes('/themes/astra/style.css')) return { status: 200, headers: { 'content-type': 'text/css' }, text: ASTRA, bytes: ASTRA.length, ms: 6 };
    return { status: 404, headers: {}, text: '', bytes: 0, ms: 1 };
  };
  elements['wptheme-results'].innerHTML = '';
  elements['wptheme-url'].value = 'blocky.test';
  await form.listeners.submit({ preventDefault() {} });
  await new Promise(r => setTimeout(r, 900));
  html = elements['wptheme-results'].innerHTML;
  var checks5 = [html.includes('WordPress Detected'), html.includes('Astra'), html.includes('archived snapshot'), html.includes('4.6.12')];
  if (!checks5.every(Boolean)) {
    console.error('FAIL: blocked-homepage fallback did not produce a partial report');
    console.error(html.slice(0, 500));
    ok = false;
  } else {
    console.log('Blocked-homepage → REST + Wayback fallback UI: PASS');
  }
  process.exit(ok ? 0 : 1);
})();
