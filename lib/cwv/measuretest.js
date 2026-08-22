'use strict';
/* Core Web Vitals & INP Auditor, measurement-script smoke test.
 * Runs assets/js/cwv/measure.js in a VM with a fake browser environment:
 * fake DOM tree, fake PerformanceObserver entries, fake postMessage parent.
 * Verifies the raw bundle the measurement script produces: LCP element,
 * FCP, raw CLS shifts, long tasks, DOM stats, image/CSS/link collection
 * and SAFE synthetic interaction testing (forms are never touched). */

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

/* ---------- fake DOM nodes ---------- */
function node(tag, opt) {
  opt = opt || {};
  const n = {
    nodeType: 1, tagName: String(tag).toUpperCase(),
    children: opt.children || [],
    parentElement: null,
    attrs: Object.assign({}, opt.attrs || {}),
    listeners: {},
    className: typeof opt.className === 'string' ? opt.className : '',
    textContent: opt.text || '',
    id: opt.id || '',
    src: opt.src || '',
    href: opt.href || '',
    open: !!opt.open,
    disabled: !!opt.disabled,
    type: opt.type || ''
  };
  (n.children || []).forEach(c => { c.parentElement = n; });
  n.closest = function (sel) { return null; };
  n.getAttribute = function (k) { return n.attrs[k] != null ? n.attrs[k] : null; };
  n.setAttribute = function (k, v) { n.attrs[k] = String(v); };
  n.hasAttribute = function (k) { return n.attrs[k] != null; };
  n.addEventListener = function (t, fn) { (n.listeners[t] = n.listeners[t] || []).push(fn); };
  n.dispatchEvent = function (ev) {
    // document capture handlers first
    (docCaptures.click || []).forEach(fn => fn(ev));
    (n.listeners[ev.type] || []).forEach(fn => fn(ev));
    return true;
  };
  n.getBoundingClientRect = function () {
    return { width: 100, height: 40, top: 10, bottom: 50, left: 10, right: 110, x: 10, y: 10 };
  };
  n.contains = function () { return false; };
  n.focus = function () {};
  n.classList = { length: 0 };
  return n;
}
function textNode(txt, parent) {
  return { nodeType: 3, tagName: '', children: [], parentElement: parent, textContent: txt, listeners: {}, closest() { return null; }, getAttribute() { return null; }, setAttribute() {}, hasAttribute() { return false; }, addEventListener() {}, dispatchEvent() { return true; }, getBoundingClientRect() { return { width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0 }; }, contains() { return false; }, focus() {}, classList: { length: 0 } };
}

/* ---------- env ---------- */
const docCaptures = { click: [] };
const messages = [];
const perfNow = { t: 3200 };
const observers = {};

function makeEnv() {
  const heroImg = node('img', { src: '/api/cwv-proxy?sid=s1&u=' + encodeURIComponent('https://cdn.example/hero.webp'), attrs: { width: '400', height: '300' }, className: 'hero' });
  const menuBtn = node('button', { id: 'menu-btn', className: 'menu-toggle', attrs: { 'aria-expanded': 'false', 'aria-haspopup': 'true' }, text: 'Menu' });
  const tabBtn = node('button', { className: 'tab-btn', attrs: { role: 'tab' }, text: 'Tab 1' });
  const formBtn = node('button', { className: 'submit-btn', type: 'submit', text: 'Send' });
  const form = node('form', { children: [formBtn] });
  const scriptEl = node('script', { src: '/api/cwv-proxy?sid=s1&u=' + encodeURIComponent('https://example.com/app.js'), attrs: { defer: '' } });
  const cssLink = node('link', { href: '/api/cwv-proxy?sid=s1&u=' + encodeURIComponent('https://example.com/style.css'), attrs: { rel: 'stylesheet' } });
  const aLink = node('a', { href: 'https://example.com/page-a', attrs: { href: 'https://example.com/page-a' }, text: 'Page A' });
  const h1 = node('h1', { text: 'Hello', children: [textNode('Hello')] });
  const body = node('body', { children: [h1, heroImg, menuBtn, tabBtn, form, scriptEl, cssLink, aLink] });
  const head = node('head', { children: [node('title', { children: [textNode('T')] })] });
  const htmlEl = node('html', { children: [head, body] });

  const qsa = {
    'img': [heroImg],
    'button, [role="tab"], [role="button"], summary, [aria-haspopup], [aria-expanded], [data-toggle], [data-bs-toggle], input[type="search"]': [menuBtn, tabBtn, formBtn],
    'script[src]': [scriptEl],
    'link[rel~="stylesheet"]': [cssLink],
    'link[rel~="stylesheet"],style': [cssLink],
    'style': [],
    'link': [cssLink],
    'a[href]': [aLink],
    'iframe': [],
    'script': [scriptEl]
  };
  const doc = {
    nodeType: 9, readyState: 'loading',
    documentElement: htmlEl,
    body,
    head,
    currentScript: { src: '/assets/js/cwv/measure.js?n=testnonce&settle=1500' },
    title: 'T',
    querySelectorAll(sel) { return qsa[sel] || []; },
    querySelector() { return null; },
    getElementById() { return null; },
    createElement() { return node('div'); },
    addEventListener(t, fn) { if (t === 'click') docCaptures.click.push(fn); },
    removeEventListener(t, fn) {
      const i = docCaptures.click.indexOf(fn);
      if (i >= 0) docCaptures.click.splice(i, 1);
    },
    fonts: undefined,
    cookie: ''
  };
  const parent = {
    location: { origin: 'http://auditor.test' },
    postMessage(msg, origin) { messages.push({ msg, origin }); }
  };
  const win = {
    parent,
    location: { href: 'http://auditor.test/api/cwv-page?sid=s1&n=testnonce', search: '?sid=s1&n=testnonce', hostname: 'example.com' },
    innerWidth: 412, innerHeight: 823,
    document: doc,
    navigator: { userAgent: 'measuretest' },
    addEventListener(t, fn) { if (t === 'load') win.__load = fn; },
    removeEventListener() {},
    open: function () { return null; }
  };
  return { win, doc, heroImg, menuBtn, tabBtn, formBtn, aLink };
}

const navFixture = { responseStart: 640, domInteractive: 900, domContentLoaded: 1200, loadEventEnd: 1400, nextHopProtocol: 'h2' };

function makeContext(env) {
  const obsList = [];
  const t0 = Date.now();
  function POClass(fn) {
    this.fn = fn;
    this.observe = function (opts) { this._type = opts && opts.type; };
    obsList.push(this);
  }
  POClass.supportedEntryTypes = ['paint', 'largest-contentful-paint', 'layout-shift', 'longtask', 'event', 'first-input', 'resource', 'long-animation-frame', 'navigation'];
  const ctx = {
    window: env.win,
    document: env.doc,
    navigator: env.win.navigator,
    location: env.win.location,
    parent: env.win.parent,
    setTimeout, clearTimeout,
    performance: {
      timeOrigin: 1000,
      now: () => 3200 + (Date.now() - t0),
      getEntriesByType(t) { return t === 'navigation' ? [navFixture] : []; }
    },
    PerformanceObserver: POClass,
    MutationObserver: function () { this.observe = function () {}; },
    requestAnimationFrame(fn) { return setTimeout(fn, 5); },
    getComputedStyle() { return { display: 'block', visibility: 'visible' }; },
    PointerEvent: function PointerEvent(type, init) { this.type = type; this.bubbles = init.bubbles; },
    MouseEvent: function MouseEvent(type, init) { this.type = type; this.bubbles = init.bubbles; },
    KeyboardEvent: function KeyboardEvent(type, init) { this.type = type; this.bubbles = init.bubbles; },
    URL, console,
    fetch(url) {
      return Promise.resolve({ text: () => Promise.resolve('@import "theme.css"; @font-face{font-family:"Roboto";src:url(https://fonts.example/r.woff2);font-display:swap} .x{background:url(https://cdn.example/bg.png)}') });
    },
    TextDecoder, TextEncoder, AbortController, Promise,
    decodeURIComponent, encodeURIComponent, JSON, Math, Array, Object, String, Number, Date, parseInt, parseFloat, isFinite,
    setInterval, clearInterval
  };
  ctx.__obs = obsList;
  ctx.global = ctx;
  vm.createContext(ctx);
  return ctx;
}

async function run() {
  const env = makeEnv();
  const ctx = makeContext(env);
  vm.runInContext(fs.readFileSync('assets/js/cwv/measure.js', 'utf8'), ctx, { filename: 'measure.js' });

  // Feed simulated observer entries only to observers registered for that type.
  const feed = (type, entries) => {
    (ctx.__obs || []).forEach(po => {
      if (po._type === type) po.fn({ getEntries: () => entries });
    });
  };
  setTimeout(() => {
    feed('paint', [{ name: 'first-contentful-paint', startTime: 1500 }]);
    feed('largest-contentful-paint', [{ startTime: 2100, size: 80000, url: '/api/cwv-proxy?sid=s1&u=' + encodeURIComponent('https://cdn.example/hero.webp'), element: env.heroImg }]);
    feed('layout-shift', [{ value: 0.04, startTime: 900, hadRecentInput: false, lastInputTime: 0, sources: [] }]);
    feed('longtask', [{ startTime: 300, duration: 210, attribution: [{ name: 'app.js', containerType: 'window', containerSrc: 'https://example.com/app.js' }] }]);
  }, 10);

  // Menu button responds to clicks (toggles aria-expanded) → responded=true.
  env.menuBtn.addEventListener('click', function () {
    env.menuBtn.setAttribute('aria-expanded', 'true');
  });
  env.tabBtn.addEventListener('click', function () {});

  // Fire window load after a tick.
  setTimeout(() => {
    env.doc.readyState = 'complete';
    if (env.win.__load) env.win.__load();
  }, 20);

  // Wait for the done message (settle ≈ 1.5 s + interactions).
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const done = messages.find(m => m.msg && m.msg.stage === 'done');
    if (done) return { payload: done.msg.payload, messages };
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('measure.js never posted a done message');
}

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ok, ' + name); }
  catch (e) { failed++; console.error('  FAIL, ' + name + '\n    ' + (e && e.message)); }
}

(async function main() {
  let result = null;
  await t('measure.js: runs and posts a complete bundle', async () => {
    result = await run();
    const p = result.payload;
    assert.ok(p, 'payload exists');
    const stages = result.messages.map(m => m.msg.stage);
    assert.ok(stages.indexOf('ready') >= 0 && stages.indexOf('loaded') >= 0 && stages.indexOf('done') >= 0, 'stages posted: ' + stages.join(','));
    assert.strictEqual(p.meta.transport, 'server-proxy');
    assert.strictEqual(p.vitals.fcp.status, 'measured');
    assert.strictEqual(p.vitals.fcp.value, 1500);
    assert.strictEqual(p.vitals.lcp.status, 'measured');
    assert.strictEqual(p.vitals.lcp.value, 2100);
    assert.strictEqual(p.vitals.lcp.entry.tag, 'img');
    assert.strictEqual(p.vitals.lcp.entry.url, 'https://cdn.example/hero.webp');
    assert.strictEqual(p.vitals.cls.entries.length, 1);
    assert.strictEqual(p.longTasks.length, 1);
    assert.ok(p.dom.nodeCount > 5, 'DOM stats collected');
    assert.ok(p.dom.tagCounts.button >= 2);
    assert.strictEqual(p.images.length, 1);
    assert.strictEqual(p.images[0].src, 'https://cdn.example/hero.webp');
    assert.strictEqual(p.images[0].naturalW, null);
    assert.strictEqual(p.jsFiles.length, 1);
    assert.strictEqual(p.jsFiles[0].url, 'https://example.com/app.js');
    assert.strictEqual(p.cssFiles.length, 1);
    assert.strictEqual(p.cssFiles[0].url, 'https://example.com/style.css');
    assert.ok(p.internalLinks.indexOf('https://example.com/page-a') >= 0);
    assert.strictEqual(p.hardening.serviceWorker, true);
  });

  await t('measure.js: safe interaction testing (menu responds, form controls never touched)', async () => {
    const p = result.payload;
    assert.strictEqual(p.vitals.inp.status, 'measured');
    const types = p.vitals.inp.interactions.map(i => i.type);
    assert.ok(types.indexOf('click') >= 0 && types.indexOf('keydown') >= 0, 'click + keyboard tested: ' + types.join(','));
    const menuIx = p.vitals.inp.interactions.find(i => i.target && i.target.selector && i.target.selector.indexOf('menu-btn') >= 0);
    assert.ok(menuIx, 'menu button was tested');
    assert.strictEqual(menuIx.responded, true, 'menu response detected');
    assert.ok(menuIx.latency > 0 && menuIx.processing >= 0 && menuIx.presentation >= 0);
    const selectors = p.vitals.inp.interactions.map(i => i.target && i.target.selector).join('|');
    assert.ok(selectors.indexOf('submit-btn') === -1, 'form submit button never clicked');
    assert.strictEqual(p.vitals.inp.value > 0, true);
  });

  await t('measure.js: CSS parsing fills fontFaces/imports via same-origin fetch', async () => {
    const p = result.payload;
    const css = p.cssFiles[0];
    assert.ok(css.imports.some(i => /theme\.css/.test(i.url)), 'import parsed');
    assert.ok(css.fontFaces.some(f => f.family === 'Roboto' && f.display === 'swap'), 'font-face parsed');
  });

  console.log('\nmeasuretest: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
