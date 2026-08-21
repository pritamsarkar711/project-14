'use strict';

/*
 * Core Web Vitals & INP Auditor — offline self-test.
 * Run: node lib/cwv/selftest.js
 *
 * Covers the deterministic analysis pipeline with fixture data (no
 * network): URL/SSRF validation, HTML/CSS rewriting, CLS session windows,
 * INP breakdown + root causes, LCP phases and image rules, TTFB/FCP,
 * long tasks, waterfall, dependency tree, JS/CSS/image/font/cache/
 * third-party/DOM/rendering audits, recommendations (evidence-bound,
 * no fabricated savings), transparent score (reproducible) and the
 * full report (lab/field separation, no fabricated metrics).
 */

const assert = require('assert');

/* ---------- fixtures ---------- */

function makeBundle(overrides) {
  const bundle = {
    v: 1,
    meta: {
      requestedUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      transport: 'server-proxy',
      relay: null, htmlStatus: 200, htmlContentType: 'text/html', htmlBytes: 42000,
      htmlTruncated: false, challenge: false, challengeGuard: null, redirects: [],
      protocolDoc: 'h2', userAgent: 'selftest', startedAt: 1000, completedAt: 2000, notes: []
    },
    docPhases: { dnsMs: 38, dnsCached: false, connectMs: 71, tlsMs: 84, requestMs: 0, ttfbMs: 605, serverMs: 412, downloadMs: 40, totalMs: 645 },
    docHeaders: { 'cache-control': 'no-cache', 'content-encoding': 'br', server: 'nginx' },
    nav: { ttfb: 640, domInteractive: 900, domContentLoaded: 1200, load: 1400 },
    vitals: {
      lcp: {
        status: 'measured', value: 2900,
        entry: { startTime: 2900, size: 180000, url: 'https://example.com/images/hero.webp', tag: 'img', selector: 'img.hero-image', text: null, rect: { w: 640, h: 420, x: 0, y: 0 } },
        candidates: [{ startTime: 1200, size: 12000, tag: 'h1', url: null }]
      },
      fcp: { status: 'measured', value: 1500, reason: null },
      cls: {
        status: 'measured', value: 0.12,
        entries: [
          { value: 0.08, startTime: 1800, hadRecentInput: false, duration: 0, sources: [{ selector: 'img.hero', tag: 'img', prevRect: { x: 0, y: 0, w: 100, h: 100 }, curRect: { x: 0, y: 160, w: 100, h: 100 } }] },
          { value: 0.04, startTime: 2100, hadRecentInput: false, duration: 0, sources: [] }
        ],
        excluded: [{ value: 0.02, startTime: 500, reason: 'recent input' }]
      },
      inp: {
        status: 'measured', value: 184,
        interactions: [
          { id: 0, type: 'click', target: { tag: 'button', selector: 'button.menu', text: 'Menu button', rect: { w: 100, h: 40, x: 10, y: 10 } }, latency: 184, inputDelay: 42, processing: 61, presentation: 81, startTime: 5200, responded: true, measuredVia: 'event-timing' },
          { id: 1, type: 'click', target: { tag: 'button', selector: 'button.tab', text: 'Tab', rect: { w: 90, h: 40, x: 10, y: 60 } }, latency: 96, inputDelay: 8, processing: 60, presentation: 28, startTime: 5900, responded: true, measuredVia: 'synthetic-instrumentation' }
        ]
      },
      tbt: { status: 'measured', value: 260 },
      si: { status: 'unavailable', reason: 'Not measurable without screenshot/video capture.' }
    },
    longTasks: [
      { startTime: 300, duration: 210, url: 'https://example.com/assets/app.js', attribution: [{ name: 'app.js', containerType: 'window', containerName: 'window', containerSrc: 'https://example.com/assets/app.js' }] },
      { startTime: 5250, duration: 287, url: 'https://example.com/js/navigation-menu.js', attribution: [{ name: 'navigation-menu.js', containerType: 'window', containerSrc: 'https://example.com/js/navigation-menu.js' }] }
    ],
    resources: [
      { name: 'https://example.com/', startTime: 0, duration: 640, initiatorType: 'navigation', transferSize: 42000, encodedBodySize: 9000, decodedBodySize: 42000, protocol: 'h2', redirectCount: 0, timingAvailable: true },
      { name: 'https://example.com/css/main.css', startTime: 700, duration: 900, initiatorType: 'link', transferSize: 145000, encodedBodySize: 30000, decodedBodySize: 145000, protocol: 'h2', redirectCount: 0, timingAvailable: true },
      { name: 'https://example.com/assets/app.js', startTime: 720, duration: 1200, initiatorType: 'script', transferSize: 400000, encodedBodySize: 90000, decodedBodySize: 400000, protocol: 'h2', redirectCount: 0, timingAvailable: true },
      { name: 'https://example.com/images/hero.webp', startTime: 800, duration: 1700, initiatorType: 'img', transferSize: 184320, encodedBodySize: 184320, decodedBodySize: 184320, protocol: 'h2', redirectCount: 0, timingAvailable: true },
      { name: 'https://fonts.googleapis.com/css2?family=Roboto', startTime: 750, duration: 300, initiatorType: 'link', transferSize: 2000, encodedBodySize: 1000, decodedBodySize: 2000, protocol: 'h2', redirectCount: 0, timingAvailable: true },
      { name: 'https://fonts.gstatic.com/s/roboto.woff2', startTime: 2000, duration: 400, initiatorType: 'css', transferSize: 30000, encodedBodySize: 30000, decodedBodySize: 30000, protocol: 'h2', redirectCount: 0, timingAvailable: true }
    ],
    dom: { nodeCount: 5400, maxDepth: 42, textNodeCount: 3000, tagCounts: { div: 2000, span: 900, a: 300, img: 40, script: 12 }, bodyBytes: 380000, dynamicAdded: 120, largestSubtrees: [{ selector: 'div.grid', count: 1800, depth: 6 }], iframes: 1, scripts: 12, styles: 3, images: 40 },
    images: [
      { src: 'https://example.com/images/hero.webp', renderedW: 640, renderedH: 420, naturalW: 1920, naturalH: 1260, bytes: 184320, loading: 'lazy', fetchpriority: null, decoding: 'async', srcset: false, sizes: false, hasDimensions: true, inViewport: true },
      { src: 'https://example.com/images/card.jpg', renderedW: 300, renderedH: 200, naturalW: 1200, naturalH: 800, bytes: 320000, loading: 'lazy', fetchpriority: null, decoding: null, srcset: false, sizes: false, hasDimensions: false, inViewport: false }
    ],
    fonts: [
      { family: 'Roboto', weight: '400', style: 'normal', status: 'loaded', url: null },
      { family: 'Roboto', weight: '700', style: 'normal', status: 'loaded', url: null }
    ],
    cssFiles: [
      { url: 'https://example.com/css/main.css', bytes: 145000, blocking: true, inline: false, media: null, imports: [{ url: 'https://example.com/css/theme.css', media: '' }], fontFaces: [{ family: 'Roboto', display: 'swap', weight: '400', style: 'normal', srcs: ['https://fonts.gstatic.com/s/roboto.woff2'] }], urlRefs: ['https://example.com/images/bg.png'] }
    ],
    jsFiles: [
      { url: 'https://example.com/assets/app.js', bytes: 400000, async: false, defer: false, module: false, inHead: true, blocking: true },
      { url: 'https://example.com/js/navigation-menu.js', bytes: 50000, async: false, defer: true, module: false, inHead: false, blocking: false }
    ],
    linkHints: { preload: [{ href: 'https://example.com/images/hero.webp', as: 'image' }], preconnect: [{ href: 'https://fonts.gstatic.com' }], dnsPrefetch: [], modulepreload: [] },
    internalLinks: ['https://example.com/page-a', 'https://example.com/page-b'],
    interactives: { tested: [], excluded: [] },
    loafs: [],
    hardening: { storage: true, serviceWorker: true, cookies: true, windowOpen: true },
    warnings: [], notes: [],
    resourceMeta: {
      mode: 'server-proxy',
      items: [
        { url: 'https://example.com/css/main.css', status: 200, headers: { 'cache-control': 'public, max-age=31536000, immutable', 'content-encoding': 'br' }, contentType: 'text/css', protocol: 'h2', ttfbMs: 40, totalMs: 900, bytes: 30000 },
        { url: 'https://example.com/assets/app.js', status: 200, headers: { 'cache-control': 'public, max-age=86400' }, contentType: 'application/javascript', protocol: 'h2', ttfbMs: 50, totalMs: 1200, bytes: 90000 },
        { url: 'https://example.com/js/navigation-menu.js', status: 200, headers: { 'cache-control': 'no-cache' }, contentType: 'application/javascript', protocol: 'h2', ttfbMs: 30, totalMs: 200, bytes: 50000 },
        { url: 'https://example.com/images/hero.webp', status: 200, headers: { 'cache-control': 'public, max-age=86400' }, contentType: 'image/webp', protocol: 'h2', ttfbMs: 60, totalMs: 1700, bytes: 184320 },
        { url: 'https://example.com/images/card.jpg', status: 200, headers: {}, contentType: 'image/jpeg', protocol: 'h2', ttfbMs: 30, totalMs: 500, bytes: 320000 }
      ]
    }
  };
  if (overrides) {
    for (const k of Object.keys(overrides)) {
      if (overrides[k] === undefined) delete bundle[k];
      else bundle[k] = overrides[k];
    }
  }
  return JSON.parse(JSON.stringify(bundle));
}

let passed = 0, failed = 0;
const TESTS = [];
function t(name, fn) { TESTS.push({ name, fn }); }

/* ================= urlValidator / SSRF ================= */
const V = require('./urlValidator');
t('urlValidator accepts a normal https URL', () => {
  const u = V.validate('https://example.com/path');
  assert.strictEqual(u.href, 'https://example.com/path');
});
t('urlValidator adds scheme to bare domains', () => {
  assert.strictEqual(V.validate('example.com').href, 'https://example.com/');
});
t('urlValidator rejects credentials', () => {
  assert.throws(() => V.validate('https://user:pass@example.com/'), e => e.code === 'invalid_url');
});
t('urlValidator rejects non-http schemes', () => {
  assert.throws(() => V.validate('ftp://example.com/'), e => e.code === 'invalid_url');
  assert.throws(() => V.validate('file:///etc/passwd'), e => e.code === 'invalid_url');
});
t('urlValidator rejects loopback / private / metadata hosts', () => {
  ['http://localhost/', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://0.0.0.0/',
    'https://metadata.google.internal/', 'http://kubernetes.default.svc/',
    'http://2130706433/', 'http://0177.0.0.1/', 'http://0x7f000001/'].forEach(h => {
    assert.throws(() => V.validate(h), e => e.code === 'ssrf' || e.code === 'invalid_url', 'should refuse ' + h);
  });
});
t('urlValidator client mirror mirrors server rules', () => {
  assert.strictEqual(V.clientMirror('https://example.com').ok, true);
  assert.strictEqual(V.clientMirror('http://localhost').ok, false);
  assert.strictEqual(V.clientMirror('http://127.0.0.1').ok, false);
  assert.strictEqual(V.clientMirror('ftp://x.com').ok, false);
  assert.strictEqual(V.clientMirror('').ok, false);
});

/* ================= rewriter ================= */
const RW = require('./rewriter');
const HTML = `<!doctype html><html><head><base href="https://evil.example/"><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><meta http-equiv="refresh" content="0;url=https://evil.example"><link rel="stylesheet" href="/css/main.css" integrity="sha384-x"><link rel="preconnect" href="https://fonts.gstatic.com"><link rel="preload" href="/img/hero.webp" as="image"><script src="/assets/app.js" nonce="abc" crossorigin="anonymous"></script></head><body><img src="pic.jpg" srcset="pic-1x.jpg 1x, pic-2x.jpg 2x" loading="lazy"><style>.a{background:url(bg.png)}@import "theme.css";</style></body></html>`;
t('rewriter wraps subresource URLs in the proxy and strips hazards', () => {
  const r = RW.rewriteHtml(HTML, { sid: 's1', baseUrl: 'https://example.com/', injectScript: '/assets/js/cwv/measure.js' });
  assert.ok(r.html.indexOf('/api/cwv-proxy?sid=s1&u=') >= 0);
  assert.ok(r.html.indexOf('https://example.com/css/main.css') === -1, 'stylesheet rewritten');
  assert.ok(r.html.indexOf('integrity=') === -1, 'integrity stripped');
  assert.ok(r.html.indexOf('nonce=') === -1, 'nonce stripped');
  assert.ok(r.html.indexOf('crossorigin') === -1, 'crossorigin stripped');
  assert.ok(r.html.indexOf('<base') === -1, 'base stripped');
  assert.ok(r.html.indexOf('Content-Security-Policy') === -1, 'CSP meta stripped');
  assert.ok(r.html.indexOf('http-equiv="refresh"') === -1, 'refresh stripped');
  assert.ok(r.html.indexOf('preconnect') === -1 || r.html.indexOf('href="https://fonts.gstatic.com"') === -1, 'preconnect removed');
  assert.ok(r.html.indexOf('/assets/js/cwv/measure.js') < r.html.indexOf('<link'), 'measure script injected first in head');
  assert.ok(r.html.indexOf('srcset="') >= 0 && r.html.indexOf('pic-2x.jpg') >= 0 && r.html.indexOf('/api/cwv-proxy') >= 0, 'srcset rewritten');
});
t('rewriter resolves relative URLs against the page base', () => {
  const r = RW.rewriteHtml('<img src="/i/a.jpg">', { sid: 's', baseUrl: 'https://example.com/dir/page' });
  assert.ok(r.html.indexOf(encodeURIComponent('https://example.com/i/a.jpg')) >= 0);
});
t('rewriter direct mode keeps original absolute URLs', () => {
  const r = RW.rewriteHtml('<img src="/i/a.jpg">', { sid: null, baseUrl: 'https://example.com/' });
  assert.ok(r.html.indexOf('https://example.com/i/a.jpg') >= 0);
  assert.ok(r.html.indexOf('/api/cwv-proxy') === -1);
});
t('rewriter adds viewport meta when requested', () => {
  const r = RW.rewriteHtml('<html><head><title>x</title></head><body></body></html>', { sid: null, baseUrl: 'https://example.com/', addViewport: true });
  assert.ok(r.html.indexOf('name="viewport"') >= 0);
});
t('rewriter rewrites CSS url() and @import', () => {
  const css = RW.rewriteCssText('body{background:url(../img/bg.png)}@import "theme.css";', 'https://example.com/css/main.css', { sid: 's' });
  assert.ok(css.indexOf('/api/cwv-proxy?sid=s&u=') >= 0);
  assert.ok(css.indexOf('@import') >= 0);
});
t('parseCss extracts @font-face and imports', () => {
  const p = RW.parseCss('@import "a.css"; @font-face{font-family:"Roboto";src:url(r.woff2);font-display:swap;font-weight:700} .x{background:url(i.png)}');
  assert.strictEqual(p.imports.length, 1);
  assert.strictEqual(p.fontFaces.length, 1);
  assert.strictEqual(p.fontFaces[0].family, 'Roboto');
  assert.strictEqual(p.fontFaces[0].display, 'swap');
  assert.strictEqual(p.fontFaces[0].weight, '700');
  assert.strictEqual(p.urlRefs.length, 2);
});

/* ================= safeFetcher (fixture transport) ================= */
const { createFetcher } = require('./safeFetcher');
t('safeFetcher follows and records redirects via fixture transport', async () => {
  const transport = async (u) => {
    if (u.href === 'https://example.com/start') {
      return { status: 301, headers: { location: 'https://example.com/final', 'content-type': 'text/html' }, text: '', buffer: Buffer.alloc(0), bytes: 0 };
    }
    return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, text: '<html>ok</html>', bytes: 14, ms: 12 };
  };
  const f = createFetcher({ transport });
  const r = await f.fetchUrl('https://example.com/start');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.finalUrl, 'https://example.com/final');
  assert.strictEqual(r.redirects.length, 1);
  assert.strictEqual(r.hops.length, 2);
});
t('safeFetcher refuses private redirect targets', async () => {
  const transport = async (u) => {
    if (u.href === 'https://example.com/start') {
      return { status: 301, headers: { location: 'http://169.254.169.254/meta' }, text: '', buffer: Buffer.alloc(0), bytes: 0 };
    }
    return { status: 200, headers: {}, text: 'x', bytes: 1 };
  };
  const f = createFetcher({ transport });
  await assert.rejects(() => f.fetchUrl('https://example.com/start'), e => e.code === 'ssrf');
});

/* ================= CLS ================= */
const { analyzeCls } = require('./clsAnalyzer');
t('CLS: one session window sums its shifts', () => {
  const r = analyzeCls({ cls: { status: 'measured', value: 0.12, entries: [
    { value: 0.06, startTime: 1000 }, { value: 0.04, startTime: 1500 }, { value: 0.02, startTime: 2100 }
  ], excluded: [] } });
  assert.strictEqual(r.status, 'measured');
  assert.strictEqual(r.windows.length, 1);
  assert.strictEqual(r.value, 0.12);
});
t('CLS: a >1 s gap after >5 s open starts a new window — shifts are not summed indefinitely', () => {
  const r = analyzeCls({ cls: { status: 'measured', value: 0.3, entries: [
    { value: 0.1, startTime: 1000 }, { value: 0.1, startTime: 1600 },   // window 1: open 0.6 s
    { value: 0.2, startTime: 7000 }, { value: 0.1, startTime: 7500 }    // gap 5.4 s but window open < 5 s → same window
  ], excluded: [] } });
  // window 1 spans 1000–1600 (0.6 s open). Gap to 7000 is 5.4 s.
  // Rule: a gap > 1 s closes a window only if it has been open > 5 s → same window → 0.5.
  assert.strictEqual(r.windows.length, 1);
  assert.strictEqual(r.value, 0.5);
});
t('CLS: window closes on gap > 1 s once open > 5 s — final CLS = largest window', () => {
  const r = analyzeCls({ cls: { status: 'measured', value: 0.4, entries: [
    { value: 0.1, startTime: 1000 },
    { value: 0.1, startTime: 6500 },   // gap 5.5 s > 1 s, but window open 0 s → same window A (value 0.2, end 6500)
    { value: 0.2, startTime: 9000 }    // gap 2.5 s > 1 s, window A open 5.5 s > 5 s → new window B (value 0.2)
  ], excluded: [] } });
  assert.strictEqual(r.windows.length, 2);
  assert.strictEqual(r.value, 0.2); // max(0.2, 0.2) — largest window, not the 0.4 naive sum
  assert.ok(r.note.indexOf('not summed') >= 0);
});
t('CLS: excluded shifts are reported separately', () => {
  const r = analyzeCls({ cls: { status: 'measured', value: 0.05, entries: [{ value: 0.05, startTime: 1000 }], excluded: [{ value: 0.3, startTime: 900, reason: 'recent input' }] } });
  assert.strictEqual(r.excludedShifts.length, 1);
  assert.strictEqual(r.value, 0.05);
});
t('CLS: unavailable when not measured (never 0-substituted)', () => {
  const r = analyzeCls({ cls: { status: 'unavailable', reason: 'no entries' } });
  assert.strictEqual(r.status, 'unavailable');
  assert.strictEqual(r.value, null);
});

/* ================= INP ================= */
const { analyzeInp } = require('./inpAnalyzer');
t('INP: value from slowest interaction with full breakdown', () => {
  const r = analyzeInp({ inp: { status: 'measured', value: 640, interactions: [
    { id: 0, type: 'click', latency: 120, inputDelay: 10, processing: 60, presentation: 50, startTime: 5000, responded: true },
    { id: 1, type: 'click', latency: 640, inputDelay: 42, processing: 517, presentation: 81, startTime: 6000, responded: true }
  ] } }, [{ startTime: 6020, duration: 287, url: 'https://x.test/js/navigation-menu.js', attribution: [] }]);
  assert.strictEqual(r.value, 640);
  assert.strictEqual(r.classification.status, 'poor');
  assert.ok(r.rootCauses.length >= 1, 'root cause when long task overlaps');
  assert.ok(JSON.stringify(r.rootCauses).indexOf('Likely contributor') >= 0 || JSON.stringify(r.rootCauses).indexOf('likely contributor') >= 0);
  assert.strictEqual(r.interactions[1].inputDelay, 42);
  assert.strictEqual(r.interactions[1].processing, 517);
  assert.strictEqual(r.interactions[1].presentation, 81);
});
t('INP: unavailable when no interactions responded — never invented', () => {
  const r = analyzeInp({ inp: { status: 'measured', value: null, interactions: [{ id: 0, latency: 50, responded: false }] } }, []);
  assert.strictEqual(r.status, 'unavailable');
  assert.strictEqual(r.value, null);
  assert.ok(r.reason);
});
t('INP: poor classification at > 500 ms', () => {
  const r = analyzeInp({ inp: { status: 'measured', value: 640, interactions: [{ id: 0, latency: 640, processing: 600, presentation: 40, startTime: 1000, responded: true }] } }, []);
  assert.strictEqual(r.classification.status, 'poor');
  assert.ok(r.rootCauses.length >= 1, 'processing-dominant root cause');
});

/* ================= LCP ================= */
const { analyzeLcp } = require('./lcpAnalyzer');
t('LCP: element attribution + phases + bottleneck', () => {
  const r = analyzeLcp(
    { lcp: { status: 'measured', value: 2900, entry: { startTime: 2900, size: 100, url: 'https://x.test/hero.webp', tag: 'img', selector: 'img.hero', text: null, rect: { w: 1, h: 1 } }, candidates: [] } },
    [{ name: 'https://x.test/hero.webp', startTime: 900, duration: 1700, initiatorType: 'img', transferSize: 184320, timingAvailable: true }],
    [{ src: 'https://x.test/hero.webp', renderedW: 640, renderedH: 420, naturalW: 1920, naturalH: 1260, bytes: 184320, loading: 'lazy', inViewport: true, hasDimensions: true }],
    { ttfbMs: 600 }, { ttfb: 640 }, { preload: [] });
  assert.strictEqual(r.element.tag, 'img');
  assert.strictEqual(r.element.selector, 'img.hero');
  assert.strictEqual(r.resource.url, 'https://x.test/hero.webp');
  assert.strictEqual(r.resource.sizeBytes, 184320);
  assert.strictEqual(r.phases.ttfb, 600);
  assert.strictEqual(r.phases.loadDelay, 260);
  assert.strictEqual(r.phases.loadDuration, 1700);
  assert.strictEqual(r.phases.renderDelay, 300);
  assert.strictEqual(r.bottleneck.phase, 'Load duration');
  assert.ok(r.issues.some(i => i.id === 'lcp-lazy' && i.severity === 'critical'), 'lazy LCP image is critical');
  assert.ok(r.issues.some(i => i.id === 'lcp-priority'), 'missing priority flagged');
  assert.ok(r.issues.some(i => i.id === 'lcp-oversized'), 'oversized flagged');
});
t('LCP: unavailable reported honestly', () => {
  const r = analyzeLcp({ lcp: { status: 'unavailable', reason: 'none' } });
  assert.strictEqual(r.status, 'unavailable');
  assert.strictEqual(r.value, null);
});

/* ================= TTFB / FCP ================= */
const { analyzeTtfb } = require('./ttfbAnalyzer');
t('TTFB: server-measured phase breakdown', () => {
  const r = analyzeTtfb({ dnsMs: 38, connectMs: 71, tlsMs: 84, serverMs: 412, ttfbMs: 605 }, {}, null, 'server-proxy');
  assert.strictEqual(r.value, 605);
  assert.strictEqual(r.phases.dns, 38);
  assert.strictEqual(r.phases.connect, 71);
  assert.strictEqual(r.phases.tls, 84);
  assert.strictEqual(r.phases.server, 412);
  assert.ok(r.notes.some(n => /server-side latency/.test(n)));
  assert.strictEqual(r.classification.status, 'good');
});
t('TTFB: unavailable without evidence — not 0', () => {
  const r = analyzeTtfb(null, null, null, 'browser-direct');
  assert.strictEqual(r.status, 'unavailable');
  assert.strictEqual(r.value, null);
  assert.ok(r.reason);
});
t('TTFB: proxied-navigation fallback labelled approximate', () => {
  const r = analyzeTtfb(null, null, { ttfb: 700 }, 'server-proxy');
  assert.strictEqual(r.source, 'proxied-navigation');
  assert.strictEqual(r.value, 700);
});
const { analyzeFcp } = require('./fcpAnalyzer');
t('FCP: slow FCP lists measured causes; advisory label', () => {
  const r = analyzeFcp({ fcp: { status: 'measured', value: 2600 } }, { ttfbMs: 1200 }, [{ url: 'x.css', bytes: 60000, blocking: true }], [{ url: 'y.js', bytes: 90000, blocking: true }], [], null);
  assert.strictEqual(r.classification.status, 'needs-improvement');
  assert.ok(r.advisory);
  assert.ok(r.causes.some(c => c.kind === 'ttfb'));
  assert.ok(r.causes.some(c => c.kind === 'css'));
  assert.ok(r.causes.some(c => c.kind === 'js'));
});

/* ================= long tasks ================= */
const { analyzeLongTasks } = require('./longTaskAnalyzer');
t('Long tasks: TBT, grouping, INP impact', () => {
  const r = analyzeLongTasks([
    { startTime: 300, duration: 200, url: 'https://x.test/a.js' },
    { startTime: 900, duration: 120, url: 'https://x.test/a.js' },
    { startTime: 5000, duration: 80, url: 'https://x.test/b.js' }
  ], [{ startTime: 4950, latency: 400 }]);
  assert.strictEqual(r.total, 3);
  assert.strictEqual(r.tbt, 250); // (200−50) + (120−50) + (80−50)
  assert.strictEqual(r.groups[0].source, 'https://x.test/a.js');
  assert.strictEqual(r.groups[0].occurrences, 2);
  assert.ok(r.potentialInpImpact.length >= 1, 'task overlapping interaction flagged');
});

/* ================= waterfall / resources ================= */
const { buildWaterfall } = require('./waterfallBuilder');
const { analyzeResources } = require('./resourceAnalyzer');
t('Waterfall: types, sizes, timingOK flags, sortability', () => {
  const wf = buildWaterfall(makeBundle().resources, makeBundle().resourceMeta);
  assert.strictEqual(wf.rows.length, 6);
  assert.ok(wf.rows.some(r => r.type === 'font'));
  assert.ok(wf.rows.some(r => r.type === 'stylesheet'));
  assert.strictEqual(wf.requestCount, 6);
  assert.ok(wf.totalBytes > 0);
  assert.ok(wf.sortable.indexOf('duration') >= 0);
});
t('Waterfall: cross-origin timing holes are flagged, not filled', () => {
  const wf = buildWaterfall([{ name: 'https://cdn.test/x.js', startTime: 100, duration: 0, timingAvailable: false, initiatorType: 'script' }], null);
  assert.strictEqual(wf.rows[0].timingOK, false);
  assert.strictEqual(wf.rows[0].duration, null);
});
t('Resources: compression coverage and protocol from observed headers', () => {
  const wf = buildWaterfall(makeBundle().resources, makeBundle().resourceMeta);
  const r = analyzeResources(wf, makeBundle().resourceMeta, makeBundle().docHeaders, 'h2');
  assert.strictEqual(r.compression.status, 'measured');
  assert.ok(r.compression.textResources >= 1);
  assert.ok(r.compression.uncompressed.length >= 1, 'uncompressed text flagged');
  assert.ok(r.protocol.observed.indexOf('h2') >= 0);
});

/* ================= dependency tree ================= */
const { buildDependencyTree } = require('./dependencyAnalyzer');
t('Dependency tree: HTML → CSS → font chain with longest-chain info', () => {
  const b = makeBundle();
  const tree = buildDependencyTree(b.meta, b.cssFiles, b.jsFiles, b.resources, b.linkHints);
  const cssNode = tree.root.children.find(n => n.kind === 'stylesheet');
  assert.ok(cssNode, 'css node present');
  assert.ok(cssNode.children.some(n => n.kind === 'font'), 'font under css');
  assert.ok(tree.longestChain.length >= 3);
  assert.ok(tree.limitation.indexOf('not traced') >= 0 || tree.limitation.length > 10);
});

/* ================= JS / CSS / images / fonts ================= */
const { analyzeJavaScript } = require('./javascriptAnalyzer');
const { analyzeCss } = require('./cssAnalyzer');
const { analyzeImages } = require('./imageAnalyzer');
const { analyzeFonts } = require('./fontAnalyzer');
t('JS audit: totals, blocking, duplicates, no unused-JS fabrication', () => {
  const b = makeBundle();
  const r = analyzeJavaScript(b.jsFiles, b.resources, [{ source: 'https://x.test/a.js', totalDuration: 300, maxDuration: 200, occurrences: 2 }], 'example.com');
  assert.strictEqual(r.fileCount, 2);
  assert.strictEqual(r.totalBytes, 450000);
  assert.strictEqual(r.blockingCount, 1);
  assert.strictEqual(r.coverage.status, 'not-measured');
  assert.ok(r.coverage.note.length > 10);
});
t('CSS audit: totals, blocking, imports', () => {
  const b = makeBundle();
  const r = analyzeCss(b.cssFiles, b.resources);
  assert.strictEqual(r.stylesheetCount, 1);
  assert.strictEqual(r.totalBytes, 145000);
  assert.strictEqual(r.importCount, 1);
  assert.strictEqual(r.blockingCount, 1);
});
t('Image audit: lazy above fold, oversized, legacy, missing dimensions', () => {
  const b = makeBundle();
  const r = analyzeImages(b.images);
  assert.ok(r.lazyAboveFold.length === 1);
  assert.ok(r.oversized.length >= 1);
  assert.ok(r.missingDimensions.length === 1);
  assert.ok(r.issues.some(i => i.id === 'img-lazy-above-fold'));
  assert.ok(r.issues.some(i => i.savings && i.savings.label.indexOf('Potentially reducible') >= 0), 'no fabricated byte savings');
});
t('Font audit: font-display rules and FOIT evidence', () => {
  const b = makeBundle();
  const r = analyzeFonts(b.fonts, b.cssFiles, b.resources, b.linkHints, 'example.com');
  assert.strictEqual(r.fontFileCount, 1);
  assert.strictEqual(r.fontDisplay.swap, 1);
});

/* ================= cache / third parties / dom / rendering ================= */
const { analyzeCache } = require('./cacheAnalyzer');
const { analyzeThirdParties } = require('./thirdPartyAnalyzer');
const { analyzeDom } = require('./domAnalyzer');
const { analyzeRendering } = require('./renderingAnalyzer');
t('Cache audit: static vs HTML separation; missing headers flagged', () => {
  const b = makeBundle();
  const r = analyzeCache(b.resourceMeta, b.docHeaders);
  assert.strictEqual(r.status, 'measured');
  assert.ok(r.static.noCacheHeaders.some(i => /card\.jpg/.test(i.url)));
  assert.strictEqual(r.html.status, 'ok');
});
t('Cache audit: long-lived HTML flagged as stale-content risk (not condemned)', () => {
  const r = analyzeCache({ mode: 'server-proxy', items: [] }, { 'cache-control': 'public, max-age=604800' });
  assert.strictEqual(r.html.status, 'long-lived');
  assert.ok(/stale content/.test(r.html.note));
});
t('Cache audit: limited mode reported honestly', () => {
  const r = analyzeCache(null, { 'cache-control': 'no-cache' });
  assert.strictEqual(r.status, 'unavailable');
  assert.ok(r.reason.length > 10);
});
t('Third parties: grouped by hostname, heuristic categories, no auto-condemnation', () => {
  const b = makeBundle();
  const r = analyzeThirdParties(b.resources, b.longTasks, 'example.com');
  assert.ok(r.parties.some(p => /fonts\.googleapis/.test(p.domain) || /fonts\.gstatic/.test(p.domain)));
  assert.ok(r.note.indexOf('not the problem') >= 0 || r.note.indexOf('alone') >= 0);
});
t('DOM audit: heuristics explained', () => {
  const b = makeBundle();
  const r = analyzeDom(b.dom);
  assert.strictEqual(r.status, 'measured');
  assert.ok(r.issues.some(i => i.id === 'dom-very-large'));
  assert.ok(r.note.indexOf('heuristic') >= 0);
});
t('Rendering audit: forced reflow honestly not observable', () => {
  const r = analyzeRendering([], { total: 2, totalDuration: 400 }, { status: 'measured', value: 0.1 }, null);
  assert.strictEqual(r.forcedReflow.status, 'not-observable');
  assert.ok(r.forcedReflow.note.length > 10);
});

/* ================= recommendations ================= */
const { buildRecommendations } = require('./recommendationEngine');
t('Recommendations: every issue has evidence; wording honest; no fabricated time savings', () => {
  const b = makeBundle();
  const ctx = {
    lcp: analyzeLcp(b.vitals, b.resources, b.images, b.docPhases, b.nav, b.linkHints),
    inp: analyzeInp(b.vitals, b.longTasks, b.jsFiles),
    cls: analyzeCls(b.vitals),
    fcp: analyzeFcp(b.vitals, b.docPhases, b.cssFiles, b.jsFiles, b.fonts, b.nav),
    ttfb: analyzeTtfb(b.docPhases, b.docHeaders, b.nav, 'server-proxy'),
    longTasks: analyzeLongTasks(b.longTasks, b.vitals.inp.interactions),
    waterfall: buildWaterfall(b.resources, b.resourceMeta),
    resources: analyzeResources(buildWaterfall(b.resources, b.resourceMeta), b.resourceMeta, b.docHeaders, 'h2'),
    css: analyzeCss(b.cssFiles), js: analyzeJavaScript(b.jsFiles, b.resources, [], 'example.com'),
    images: analyzeImages(b.images), fonts: analyzeFonts(b.fonts, b.cssFiles, b.resources, b.linkHints, 'example.com'),
    cache: analyzeCache(b.resourceMeta, b.docHeaders),
    thirdParties: analyzeThirdParties(b.resources, b.longTasks, 'example.com'),
    dom: analyzeDom(b.dom), rendering: analyzeRendering([], { total: 2, totalDuration: 400 }, { status: 'measured', value: 0.12 }, null),
    doc: b.meta, hints: b.linkHints
  };
  const recs = buildRecommendations(ctx);
  assert.ok(recs.issues.length > 0);
  recs.issues.forEach(i => {
    assert.ok(Array.isArray(i.evidence) && i.evidence.length > 0, 'issue has evidence: ' + i.id);
    assert.ok(i.fix && i.fix.length > 10, 'issue has fix: ' + i.id);
    if (i.savings) assert.ok(i.savings.label, 'savings labelled: ' + i.id);
    assert.ok(!/improve (LCP|INP|CLS) by \d/.test(i.fix + i.problem), 'no fabricated metric deltas');
  });
  assert.ok(recs.issues.some(i => i.id === 'cwv-lcp-ni'));
  assert.ok(recs.issues.some(i => i.id === 'rb-js'));
  assert.ok(recs.issues.some(i => i.id === 'rb-css'));
  assert.ok(recs.issues.some(i => i.id === 'css-imports'));
  assert.ok(recs.issues.some(i => i.id === 'compression'));
  assert.ok(recs.issues.some(i => i.id.indexOf('longtask-') === 0));
  assert.ok(recs.issues.some(i => i.id === 'cls-shift-0'));
});

/* ================= score ================= */
const { calculateScore } = require('./scoreCalculator');
t('Score: reproducible and monotonic (good bundle scores higher than bad)', () => {
  const b = makeBundle();
  function ctx(bundle) {
    return {
      lcp: analyzeLcp(bundle.vitals, bundle.resources, bundle.images, bundle.docPhases, bundle.nav, bundle.linkHints),
      inp: analyzeInp(bundle.vitals, bundle.longTasks, bundle.jsFiles),
      cls: analyzeCls(bundle.vitals),
      fcp: analyzeFcp(bundle.vitals, bundle.docPhases, bundle.cssFiles, bundle.jsFiles, bundle.fonts, bundle.nav),
      ttfb: analyzeTtfb(bundle.docPhases, bundle.docHeaders, bundle.nav, 'server-proxy'),
      longTasks: analyzeLongTasks(bundle.longTasks, bundle.vitals.inp.interactions),
      waterfall: buildWaterfall(bundle.resources, bundle.resourceMeta),
      cache: analyzeCache(bundle.resourceMeta, bundle.docHeaders),
      resources: analyzeResources(buildWaterfall(bundle.resources, bundle.resourceMeta), bundle.resourceMeta, bundle.docHeaders, 'h2'),
      dom: analyzeDom(bundle.dom)
    };
  }
  const s1 = calculateScore(ctx(b));
  const s2 = calculateScore(ctx(b));
  assert.strictEqual(s1.value, s2.value, 'deterministic score');
  assert.strictEqual(s1.label, 'Tool Performance Score');

  const good = makeBundle();
  good.vitals.lcp.value = 1200; good.vitals.lcp.entry.startTime = 1200;
  good.vitals.inp.value = 80; good.vitals.inp.interactions[0].latency = 80; good.vitals.inp.interactions[1].latency = 60;
  good.vitals.cls.value = 0.02; good.vitals.cls.entries = [{ value: 0.02, startTime: 800 }];
  good.vitals.fcp.value = 900;
  good.docPhases = { dnsMs: 10, connectMs: 20, tlsMs: 30, serverMs: 100, ttfbMs: 160, downloadMs: 10, totalMs: 170 };
  good.longTasks = [];
  good.resources = good.resources.slice(0, 2).map(r => Object.assign({}, r, { transferSize: 20000 }));
  good.resourceMeta.items = good.resourceMeta.items.slice(0, 2);
  const sg = calculateScore(ctx(good));
  assert.ok(sg.value > s1.value, 'good site scores higher: ' + sg.value + ' vs ' + s1.value);
});

/* ================= full pipeline ================= */
const { analyzeBundle } = require('./analyze');
t('analyzeBundle: full report with all required sections', () => {
  const report = analyzeBundle(makeBundle());
  assert.ok(report.engine && report.engine.thresholdsVersion);
  assert.ok(report.lab.vitals.length >= 6);
  assert.ok(report.lab.waterfall.rows.length > 0);
  assert.ok(report.lab.inp && report.lab.lcp && report.lab.cls && report.lab.fcp && report.lab.ttfb);
  assert.ok(report.lab.javascript && report.lab.css && report.lab.images && report.lab.fonts);
  assert.ok(report.lab.thirdParties && report.lab.cache && report.lab.dom && report.lab.rendering);
  assert.ok(report.lab.dependency && report.lab.longTasks);
  assert.ok(report.issues.length > 0);
  assert.ok(report.technical && report.technical.limitations.length > 0);
  assert.strictEqual(report.scope.pages, 1);
});
t('analyzeBundle: lab and field data strictly separated', () => {
  const report = analyzeBundle(makeBundle());
  assert.strictEqual(report.field.status, 'unavailable');
  assert.ok(report.field.label.indexOf('Field data unavailable') === 0);
  assert.strictEqual(report.lab.label, 'Lab Data');
  report.lab.vitals.forEach(v => assert.strictEqual(v.source, 'lab'));
});
t('analyzeBundle: missing metrics are Not Available, never 0', () => {
  const b = makeBundle();
  b.vitals.inp = { status: 'unavailable', reason: 'no interactions' };
  b.vitals.lcp = { status: 'unavailable', reason: 'no entries' };
  b.vitals.fcp = { status: 'unavailable', reason: 'none' };
  delete b.docPhases;
  const report = analyzeBundle(b);
  const inpRow = report.lab.vitals.find(v => v.key === 'inp');
  const lcpRow = report.lab.vitals.find(v => v.key === 'lcp');
  assert.strictEqual(inpRow.value, null);
  assert.strictEqual(inpRow.status, 'unavailable');
  assert.strictEqual(lcpRow.value, null);
  const score = report.lab.score;
  assert.ok(score.breakdown.some(p => p.id === 'inp' && p.score == null && p.status === 'excluded'));
});
t('analyzeBundle: browser-direct bundle handled (limited timing, no cache headers)', () => {
  const b = makeBundle();
  b.meta.transport = 'browser-direct';
  b.meta.relay = 'allorigins';
  delete b.resourceMeta;
  b.resources.forEach(r => { r.timingAvailable = false; r.duration = 0; r.transferSize = null; r.encodedBodySize = null; r.decodedBodySize = null; });
  b.docPhases = { relayMs: 1200 };
  b.nav = { ttfb: null, domInteractive: null, domContentLoaded: null, load: null };
  b.images.forEach(i => { i.bytes = null; });
  const report = analyzeBundle(b);
  assert.strictEqual(report.lab.cache.status, 'unavailable');
  assert.strictEqual(report.lab.ttfb.status, 'unavailable');
  assert.strictEqual(report.lab.images.totalBytes, null);
});
t('analyzeBundle: rejects invalid bundles', () => {
  assert.throws(() => analyzeBundle(null), e => e.code === 'invalid_bundle');
  assert.throws(() => analyzeBundle({}), e => e.code === 'invalid_bundle');
  assert.throws(() => analyzeBundle({ meta: { requestedUrl: 'https://x.test' } }), e => e.code === 'invalid_bundle');
  assert.throws(() => analyzeBundle({ meta: { requestedUrl: 'https://x.test', transport: 'ssh' }, vitals: {} }), e => e.code === 'invalid_bundle');
});

/* ================= session ================= */
const { createSession, getSession, recordResource, sessionMeta } = require('./session');
t('session: resource metadata recorded and bounded', () => {
  const s = createSession({ url: 'https://x.test/', finalUrl: 'https://x.test/', html: '<html></html>', docHeaders: {}, docPhases: null, docStatus: 200 });
  assert.ok(getSession(s.sid));
  recordResource(s.sid, { url: 'https://x.test/a.css', status: 200, headers: { 'cache-control': 'public, max-age=300', 'content-encoding': 'br' }, contentType: 'text/css', protocol: 'h2', ttfbMs: 12, bytes: 1000 });
  const m = sessionMeta(s.sid);
  assert.strictEqual(m.resourceCount, 1);
  assert.strictEqual(m.resources[0].headers['cache-control'], 'public, max-age=300');
  assert.strictEqual(sessionMeta('nope'), null);
});

/* ================= thresholds ================= */
const TH = require('./thresholds');
t('thresholds: current official CWV three-tier classification', () => {
  assert.strictEqual(TH.classify(2400, TH.cwv.lcp).status, 'good');
  assert.strictEqual(TH.classify(2500, TH.cwv.lcp).status, 'good');
  assert.strictEqual(TH.classify(2501, TH.cwv.lcp).status, 'needs-improvement');
  assert.strictEqual(TH.classify(4000, TH.cwv.lcp).status, 'needs-improvement');
  assert.strictEqual(TH.classify(4001, TH.cwv.lcp).status, 'poor');
  assert.strictEqual(TH.classify(200, TH.cwv.inp).status, 'good');
  assert.strictEqual(TH.classify(501, TH.cwv.inp).status, 'poor');
  assert.strictEqual(TH.classify(0.1, TH.cwv.cls).status, 'good');
  assert.strictEqual(TH.classify(0.26, TH.cwv.cls).status, 'poor');
  assert.strictEqual(TH.classify(null, TH.cwv.lcp).status, 'unavailable');
  assert.ok(TH.version && TH.sources.length >= 3);
});

(async function main() {
  for (const test of TESTS) {
    try {
      await test.fn();
      passed++;
      console.log('  ok — ' + test.name);
    } catch (e) {
      failed++;
      console.error('  FAIL — ' + test.name + '\n    ' + (e && e.message));
    }
  }
  console.log('\nselftest: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
