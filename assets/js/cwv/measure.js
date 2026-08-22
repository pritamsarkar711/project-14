/* Core Web Vitals & INP Auditor, measurement script.
 *
 * Injected as the FIRST element of <head> in the sandboxed page (either
 * the server-proxied page or the browser-direct srcdoc fallback). It:
 *   - hardens the sandbox (isolated storage, no service worker, no cookies)
 *   - registers all PerformanceObservers before anything renders
 *   - measures LCP / CLS (raw shifts) / FCP / long tasks / INP interactions
 *   - runs SAFE synthetic interactions (menus, tabs, accordions, search,
 *     modal triggers, never forms, never destructive actions)
 *   - collects DOM / image / font / JS / CSS evidence
 *   - posts the raw measurement bundle to the parent page (same origin)
 *
 * Nothing here fabricates values: anything unmeasurable is reported as
 * unavailable with a reason. */
(function () {
  'use strict';
  if (window.__CWVM) return;
  var M = window.__CWVM = { hardened: true, startedAt: Date.now() };
  var QS = {};
  try { location.search.slice(1).split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) QS[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); }); } catch (e) {}
  var NONCE = null;
  try {
    var cs = document.currentScript;
    if (cs && cs.src) {
      var sm = cs.src.match(/[?&](n|settle|maxIx)=([^&]+)/g) || [];
      sm.forEach(function (kv) {
        var p = kv.slice(1).split('=');
        if (p[0] === 'n') NONCE = p[1];
        else QS[p[0]] = p[1];
      });
    }
  } catch (e) {}
  if (!NONCE) NONCE = QS.n || null;
  var SETTLE_MS = Math.max(1500, Math.min(10000, parseInt(QS.settle, 10) || 7000));
  var MAX_INTERACTIONS = Math.max(0, Math.min(8, parseInt(QS.maxIx, 10) || 8));

  var PROXY_MODE = /\/api\/cwv-page\?sid=/.test(location.href);
  // Relay mode: the HTML was fetched server-side via a public relay; the page
  // is served same-origin but subresources load cross-origin (direct URLs).
  var RELAY_MODE = /[?&]mode=relay/.test(location.href);
  var SID = null;
  try { var sm = location.href.match(/[?&]sid=([^&]+)/); if (sm) SID = sm[1]; } catch (e) {}
  var PAGE_URL = null;
  try { if (QS.u) PAGE_URL = decodeURIComponent(QS.u); } catch (e) {}

  function parentOrigin() {
    try { return window.parent.location.origin || '*'; } catch (e) { return '*'; }
  }
  function post(stage, payload) {
    try {
      window.parent.postMessage({ source: 'cwv-measure', nonce: NONCE, stage: stage, payload: payload || null }, parentOrigin());
    } catch (e) {}
  }
  function dec(u) {
    try { return decodeURIComponent(u); } catch (e) { return u; }
  }
  // Map proxied resource names back to real URLs.
  function realUrl(name) {
    if (!name) return name;
    var idx = name.indexOf('/api/cwv-proxy?sid=');
    if (idx < 0) return name;
    var m = name.match(/[?&]u=([^&]+)/);
    return m ? dec(m[1]) : name;
  }
  function round(n, d) { return typeof n === 'number' && isFinite(n) ? Math.round(n * Math.pow(10, d || 1)) / Math.pow(10, d || 1) : null; }
  function capArr(a, n) { return (a || []).slice(0, n); }

  /* ---------------- sandbox hardening ---------------- */
  try {
    try { Object.defineProperty(navigator, 'serviceWorker', { get: function () { return undefined; } }); } catch (e) {}
    var mem = {};
    function mkStorage() {
      return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? String(mem[k]) : null; },
        setItem: function (k, v) { mem[k] = String(v); }, removeItem: function (k) { delete mem[k]; },
        clear: function () { mem = {}; }, key: function (i) { return Object.keys(mem)[i] || null; },
        get length() { return Object.keys(mem).length; }
      };
    }
    try { Object.defineProperty(window, 'localStorage', { get: function () { return mkStorage(); } }); } catch (e) {}
    try { Object.defineProperty(window, 'sessionStorage', { get: function () { return mkStorage(); } }); } catch (e) {}
    try { Object.defineProperty(document, 'cookie', { get: function () { return ''; }, set: function () {} }); } catch (e) {}
    try { window.open = function () { return null; }; } catch (e) {}
  } catch (e) { M.hardened = false; }

  /* ---------------- observers (registered immediately) ---------------- */
  var paintEntries = [], lcpEntries = [], shiftEntries = [], longTasks = [], eventEntries = [], firstInput = null, loafEntries = [], resourceEntries = [];
  var lcpFinal = null;
  function supported(type) {
    try { return typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.indexOf(type) >= 0; } catch (e) { return false; }
  }
  function observe(type, fn, extra) {
    if (!supported(type)) return;
    try {
      var po = new PerformanceObserver(function (list) { list.getEntries().forEach(fn); });
      po.observe(Object.assign({ type: type, buffered: true }, extra || {}));
      return po;
    } catch (e) { return null; }
  }
  observe('paint', function (e) { if (e.name === 'first-contentful-paint') paintEntries.push({ name: e.name, startTime: e.startTime }); });
  observe('largest-contentful-paint', function (e) { lcpEntries.push(e); lcpFinal = e; });
  observe('layout-shift', function (e) {
    shiftEntries.push({
      value: e.value, startTime: e.startTime, hadRecentInput: e.hadRecentInput,
      lastInputTime: e.lastInputTime,
      sources: e.sources ? Array.prototype.map.call(e.sources, function (s) {
        return { selector: s.node ? sel(s.node) : null, tag: s.node ? s.node.tagName : null, prevRect: s.previousRect || null, curRect: s.currentRect || null };
      }) : []
    });
  });
  observe('longtask', function (e) {
    longTasks.push({
      startTime: e.startTime, duration: e.duration,
      attribution: e.attribution ? Array.prototype.map.call(e.attribution, function (a) {
        return { name: a.name || null, containerType: a.containerType || null, containerName: a.containerName || null, containerSrc: a.containerSrc || null };
      }) : []
    });
  });
  observe('event', function (e) {
    eventEntries.push({ name: e.name, target: e.target || null, startTime: e.startTime, duration: e.duration, processingStart: e.processingStart, processingEnd: e.processingEnd, interactionId: e.interactionId });
  });
  observe('first-input', function (e) { firstInput = { startTime: e.startTime, processingStart: e.processingStart, processingEnd: e.processingEnd, duration: e.duration }; });
  observe('resource', function (e) {
    if (!e.name || e.name.indexOf('/api/cwv-page') >= 0 || e.name.indexOf('/assets/js/cwv/measure.js') >= 0) return;
    resourceEntries.push(e);
  });
  if (supported('long-animation-frame')) {
    try {
      var poLoaf = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (e) {
          loafEntries.push({
            duration: e.duration, startTime: e.startTime, renderStart: e.renderStart || null,
            styleAndLayoutStart: e.styleAndLayoutStart || null,
            scripts: e.scripts ? Array.prototype.map.call(e.scripts, function (s) { return { name: s.name || null, duration: s.duration || null }; }) : []
          });
        });
      });
      poLoaf.observe({ type: 'long-animation-frame', buffered: true });
    } catch (e) {}
  }

  function sel(node) {
    try {
      if (!node || node.nodeType !== 1) return null;
      if (node.id) return node.tagName.toLowerCase() + '#' + node.id;
      var s = node.tagName.toLowerCase();
      if (node.classList && node.classList.length) s += '.' + Array.prototype.slice.call(node.classList, 0, 2).join('.');
      var p = node.parentElement;
      if (p) {
        var same = Array.prototype.filter.call(p.children, function (c) { return c.tagName === node.tagName; }).length;
        if (same > 1) {
          var idx = Array.prototype.indexOf.call(p.children, node) + 1;
          s += ':nth-of-type(' + idx + ')';
        }
      }
      return s;
    } catch (e) { return null; }
  }
  function rectOf(node) {
    try { var r = node.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }; } catch (e) { return null; }
  }

  /* ---------------- utilities ---------------- */
  function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  function raf() { return new Promise(function (res) { requestAnimationFrame(function () { res(); }); }); }
  function doubleRaf() { return raf().then(raf); }

  var mutationCount = 0;
  try {
    var mo = new MutationObserver(function (recs) { mutationCount += recs.length; });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: false });
  } catch (e) {}

  var out = {
    v: 1,
    meta: {
      requestedUrl: null,
      finalUrl: PROXY_MODE ? (RELAY_MODE ? PAGE_URL : null) : location.href,
      transport: PROXY_MODE ? (RELAY_MODE ? 'server-relay' : 'server-proxy') : 'browser-direct',
      relay: null, htmlStatus: null, htmlContentType: 'text/html', htmlBytes: null, htmlTruncated: false,
      challenge: false, challengeGuard: null, redirects: [], protocolDoc: RELAY_MODE ? null : undefined,
      userAgent: navigator.userAgent,
      startedAt: M.startedAt, completedAt: null, notes: [], sid: SID
    },
    docPhases: null, docHeaders: {},
    nav: { ttfb: null, domInteractive: null, domContentLoaded: null, load: null },
    vitals: {
      lcp: { status: 'unavailable', value: null, entry: null, candidates: [], reason: null },
      fcp: { status: 'unavailable', value: null, reason: null },
      cls: { status: 'measured', value: null, entries: [], excluded: [], reason: null },
      inp: { status: 'unavailable', value: null, interactions: [], reason: null },
      tbt: { status: 'measured', value: 0, reason: null },
      si: { status: 'unavailable', reason: 'Not measurable without screenshot/video capture.' }
    },
    longTasks: [], resources: [], dom: null, images: [], fonts: [], cssFiles: [], jsFiles: [],
    linkHints: { preload: [], preconnect: [], dnsPrefetch: [], modulepreload: [] },
    internalLinks: [], interactives: { tested: [], excluded: [] }, loafs: [],
    hardening: { storage: true, serviceWorker: true, cookies: true, windowOpen: true },
    warnings: [], notes: []
  };

  /* ---------------- small CSS parser (mirrors lib/cwv/rewriter.js parseCss) ---------------- */
  function parseCss(text) {
    var o = { imports: [], fontFaces: [], urlRefs: [] };
    var t = String(text || '');
    var im, re = /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^)"'\s;]+))\s*\)?\s*([^;]*);/gi;
    while ((im = re.exec(t))) o.imports.push({ url: im[1] != null ? im[1] : (im[2] != null ? im[2] : im[3]), media: (im[4] || '').trim() });
    var fm, fre = /@font-face\s*\{([^}]*)\}/gi;
    while ((fm = fre.exec(t))) {
      var b = fm[1];
      var fam = (b.match(/font-family\s*:\s*(?:"([^"]+)"|'([^']+)'|([^;,"']+))/i) || []);
      var srcs = [];
      var sr, sre = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)"']+))\s*\)/gi;
      while ((sr = sre.exec(b))) srcs.push(sr[1] != null ? sr[1] : (sr[2] != null ? sr[2] : sr[3]));
      o.fontFaces.push({
        family: (fam[1] != null ? fam[1] : (fam[2] != null ? fam[2] : (fam[3] || ''))).trim(),
        display: (b.match(/font-display\s*:\s*([a-z-]+)/i) || [])[1] || null,
        weight: ((b.match(/font-weight\s*:\s*([^;]+)/i) || [])[1] || '400').trim(),
        style: ((b.match(/font-style\s*:\s*([^;]+)/i) || [])[1] || 'normal').trim(),
        srcs: srcs
      });
    }
    var um, ure = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)"']+))\s*\)/gi;
    while ((um = ure.exec(t))) o.urlRefs.push(um[1] != null ? um[1] : (um[2] != null ? um[2] : um[3]));
    return o;
  }

  /* ---------------- page-level collection ---------------- */
  function resourceFor(name) {
    if (!name) return null;
    var rn = name.replace(/^https?:\/\//, '');
    for (var i = 0; i < resourceEntries.length; i++) {
      var r = resourceEntries[i];
      if (realUrl(r.name).replace(/^https?:\/\//, '') === rn) return r;
    }
    return null;
  }

  function collectResources() {
    out.resources = capArr(resourceEntries.map(function (r) {
      return {
        name: realUrl(r.name),
        startTime: round(r.startTime, 1),
        duration: r.duration > 0 ? round(r.duration, 1) : null,
        initiatorType: r.initiatorType || 'other',
        transferSize: r.transferSize || null,
        encodedBodySize: r.encodedBodySize || null,
        decodedBodySize: r.decodedBodySize || null,
        protocol: r.nextHopProtocol || null,
        redirectCount: r.redirectCount || 0,
        timingAvailable: r.duration > 0 && r.responseEnd > 0
      };
    }), 400);
    var tbt = 0;
    longTasks.forEach(function (t) { if (t.duration > 50) tbt += t.duration - 50; });
    out.vitals.tbt.value = Math.round(tbt);
    out.longTasks = capArr(longTasks.map(function (t) {
      var src = null;
      if (t.attribution && t.attribution.length) {
        var a = t.attribution[0];
        src = a.containerSrc || a.name || null;
      }
      if (src && PROXY_MODE) src = realUrl(src);
      return { startTime: round(t.startTime, 1), duration: round(t.duration, 1), url: src, attribution: t.attribution || [] };
    }), 60);
    out.loafs = capArr(loafEntries.map(function (f) {
      return { duration: round(f.duration, 1), startTime: round(f.startTime, 1), renderStart: f.renderStart, styleAndLayoutStart: f.styleAndLayoutStart, scripts: f.scripts || [] };
    }), 20);
  }

  function collectNav() {
    var nav = null;
    try { nav = performance.getEntriesByType('navigation')[0] || null; } catch (e) {}
    if (nav) {
      out.nav.ttfb = nav.responseStart > 0 ? round(nav.responseStart, 1) : null;
      out.nav.domInteractive = round(nav.domInteractive, 1);
      out.nav.domContentLoaded = round(nav.domContentLoaded, 1);
      out.nav.load = round(nav.loadEventEnd, 1);
      // The iframe navigation protocol is the auditor's own connection, it
      // says nothing about the target site in relay/direct modes.
      if (!RELAY_MODE) out.meta.protocolDoc = nav.nextHopProtocol || null;
    }
    var fcp = paintEntries.filter(function (p) { return p.name === 'first-contentful-paint'; })[0];
    if (fcp) { out.vitals.fcp.status = 'measured'; out.vitals.fcp.value = round(fcp.startTime, 1); }
    else out.vitals.fcp.reason = 'No first-contentful-paint entry was emitted by the browser.';

    if (lcpFinal) {
      var e = lcpFinal;
      var entry = {
        startTime: round(e.startTime, 1), size: e.size, url: e.url ? realUrl(e.url) : null,
        tag: e.element ? e.element.tagName.toLowerCase() : null,
        selector: e.element ? sel(e.element) : null,
        rect: e.element ? rectOf(e.element) : null
      };
      try {
        if (e.element) {
          var txt = (e.element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
          entry.text = txt || null;
        }
      } catch (err) {}
      out.vitals.lcp.status = 'measured';
      out.vitals.lcp.value = round(e.startTime, 1);
      out.vitals.lcp.entry = entry;
      out.vitals.lcp.candidates = capArr(lcpEntries.map(function (c) {
        return { startTime: round(c.startTime, 1), size: c.size, tag: c.element ? c.element.tagName.toLowerCase() : null, url: c.url ? realUrl(c.url) : null };
      }), 10);
    } else {
      out.vitals.lcp.reason = 'No largest-contentful-paint entry (page may have no content, or the browser did not emit one).';
    }

    // CLS raw entries + excluded (recent input).
    shiftEntries.forEach(function (s) {
      if (s.hadRecentInput) out.vitals.cls.excluded.push({ value: round(s.value, 4), startTime: round(s.startTime, 1), reason: 'Excluded: occurred within 500 ms of user input (per CLS spec).' });
      else out.vitals.cls.entries.push({ value: round(s.value, 4), startTime: round(s.startTime, 1), sources: s.sources, duration: null });
    });
    // quick single-window sum for progress display only (server computes the official value)
    var sum = 0;
    out.vitals.cls.entries.forEach(function (s) { sum += s.value; });
    out.vitals.cls.value = round(sum, 4);
  }

  function collectDom() {
    var root = document.documentElement;
    var nodeCount = 0, maxDepth = 0, textNodes = 0;
    var tagCounts = {}, subtree = [];
    function walk(node, depth) {
      if (node.nodeType === 1) {
        nodeCount++;
        if (depth > maxDepth) maxDepth = depth;
        var t = node.tagName.toLowerCase();
        tagCounts[t] = (tagCounts[t] || 0) + 1;
        var children = node.children || [];
        if (children.length) {
          if (subtree.length < 40) subtree.push({ node: node, count: children.length, depth: depth });
        }
        for (var i = 0; i < children.length; i++) walk(children[i], depth + 1);
      } else if (node.nodeType === 3) {
        textNodes++;
      }
    }
    try { walk(root, 0); } catch (e) {}
    var sorted = subtree.sort(function (a, b) { return b.count - a.count; }).slice(0, 5);
    var bodyBytes = 0;
    try { bodyBytes = document.body ? document.body.innerHTML.length : 0; } catch (e) {}
    var tagList = Object.keys(tagCounts).map(function (k) { return { tag: k, n: tagCounts[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 20);
    var tagObj = {};
    tagList.forEach(function (t) { tagObj[t.tag] = t.n; });
    out.dom = {
      nodeCount: nodeCount, maxDepth: maxDepth, textNodeCount: textNodes, tagCounts: tagObj,
      bodyBytes: bodyBytes, dynamicAdded: mutationCount,
      largestSubtrees: sorted.map(function (s) { return { selector: sel(s.node), count: s.count, depth: s.depth }; }),
      iframes: document.querySelectorAll('iframe').length,
      scripts: document.querySelectorAll('script').length,
      styles: document.querySelectorAll('link[rel~="stylesheet"],style').length,
      images: document.querySelectorAll('img').length
    };
  }

  function inViewport(el) {
    try {
      var r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
    } catch (e) { return false; }
  }

  function collectImages() {
    var imgs = [];
    Array.prototype.forEach.call(document.querySelectorAll('img'), function (img) {
      var src = img.currentSrc || img.src || '';
      if (src.indexOf('data:') === 0) return;
      src = realUrl(src);
      var rr = img.getBoundingClientRect();
      var entry = resourceFor(src);
      imgs.push({
        src: src,
        renderedW: Math.round(rr.width) || null, renderedH: Math.round(rr.height) || null,
        naturalW: img.naturalWidth || null, naturalH: img.naturalHeight || null,
        bytes: (entry && (entry.transferSize || entry.encodedBodySize)) || null,
        loading: img.getAttribute('loading') || null,
        fetchpriority: img.getAttribute('fetchpriority') || null,
        decoding: img.getAttribute('decoding') || null,
        srcset: !!img.getAttribute('srcset'),
        sizes: !!img.getAttribute('sizes'),
        hasDimensions: !!(img.getAttribute('width') && img.getAttribute('height')),
        inViewport: inViewport(img)
      });
    });
    out.images = capArr(imgs, 250);
  }

  function collectFonts() {
    var fonts = [];
    try {
      if (document.fonts && document.fonts.forEach) {
        document.fonts.forEach(function (f) {
          fonts.push({ family: f.family || null, weight: f.weight || '400', style: f.style || 'normal', status: f.status || 'unloaded', url: null });
        });
      }
    } catch (e) {}
    out.fonts = capArr(fonts, 60);
  }

  function collectCssJs() {
    // JS files
    var seenJs = {};
    var js = [];
    Array.prototype.forEach.call(document.querySelectorAll('script[src]'), function (s) {
      var src = realUrl(s.src || '');
      if (!src || seenJs[src]) return;
      seenJs[src] = true;
      var entry = resourceFor(src);
      js.push({
        url: src,
        bytes: (entry && (entry.transferSize || entry.encodedBodySize)) || null,
        async: s.hasAttribute('async'), defer: s.hasAttribute('defer'), module: s.type === 'module',
        inHead: !!(s.closest && s.closest('head')),
        blocking: !(s.hasAttribute('async') || s.hasAttribute('defer') || s.type === 'module')
      });
    });
    out.jsFiles = capArr(js, 80);

    // CSS files
    var seenCss = {};
    var css = [];
    var links = document.querySelectorAll('link[rel~="stylesheet"]');
    Array.prototype.forEach.call(links, function (l) {
      var rawHref = l.href || '';
      var href = realUrl(rawHref);            // real URL for reporting/matching
      var fetchHref = PROXY_MODE ? rawHref : href; // fetch through the proxy (same-origin) in proxy mode
      if (!href || seenCss[href]) return;
      seenCss[href] = true;
      var entry = resourceFor(href);
      css.push({ url: href, fetchUrl: fetchHref, bytes: (entry && (entry.transferSize || entry.encodedBodySize)) || null, blocking: true, inline: false, media: l.getAttribute('media') || null, imports: [], fontFaces: [], urlRefs: [] });
    });
    var inlineBytes = 0;
    Array.prototype.forEach.call(document.querySelectorAll('style'), function (s) {
      inlineBytes += (s.textContent || '').length;
    });
    out.inlineCssBytes = inlineBytes;
    out.cssFiles = capArr(css, 60);

    // Link hints
    Array.prototype.forEach.call(document.querySelectorAll('link'), function (l) {
      var rel = (l.getAttribute('rel') || '').toLowerCase();
      var href = realUrl(l.href || '');
      if (!href) return;
      if (rel.indexOf('preload') >= 0) out.linkHints.preload.push({ href: href, as: l.getAttribute('as') || '' });
      else if (rel.indexOf('preconnect') >= 0) out.linkHints.preconnect.push({ href: href });
      else if (rel.indexOf('dns-prefetch') >= 0) out.linkHints.dnsPrefetch.push({ href: href });
      else if (rel.indexOf('modulepreload') >= 0) out.linkHints.modulepreload.push({ href: href });
    });

    // Internal links (for optional crawl mode)
    var host = null;
    try { host = (location.hostname || '').replace(/^www\./, ''); } catch (e) {}
    if (!host) { try { host = new URL(QS.u || '').hostname.replace(/^www\./, ''); } catch (e) {} }
    var linksSeen = {};
    var internal = [];
    Array.prototype.forEach.call(document.querySelectorAll('a[href]'), function (a) {
      try {
        var u = new URL(a.href);
        var h = u.hostname.replace(/^www\./, '');
        if (host && h === host && /^https?:$/.test(u.protocol)) {
          u.hash = '';
          var key = u.href;
          if (!linksSeen[key]) { linksSeen[key] = true; internal.push(u.href); }
        }
      } catch (e) {}
      if (internal.length >= 400) return;
    });
    out.internalLinks = internal;

    // CSS text parsing (same-origin fetch; works in proxy mode, fails gracefully in direct mode)
    if (PROXY_MODE && css.length) {
      var jobs = css.slice(0, 6).map(function (c) {
        return fetch(c.fetchUrl || c.url, { credentials: 'omit' }).then(function (r) { return r.text(); }).then(function (text) {
          var parsed = parseCss(text);
          c.imports = parsed.imports.map(function (i) { return { url: realUrl(i.url), media: i.media }; });
          c.fontFaces = parsed.fontFaces.map(function (f) { return { family: f.family, display: f.display, weight: f.weight, style: f.style, srcs: f.srcs.map(realUrl) }; });
          c.urlRefs = parsed.urlRefs.map(realUrl);
        }, function () {});
      });
      return Promise.all(jobs).then(function () { return css; });
    }
    return Promise.resolve(css);
  }

  /* ---------------- interaction testing (SAFE synthetic only) ---------------- */
  function visible(el) {
    try {
      var r = el.getBoundingClientRect();
      var st = getComputedStyle(el);
      return r.width > 4 && r.height > 4 && st.display !== 'none' && st.visibility !== 'hidden' && r.bottom > 0 && r.top < window.innerHeight && r.left < window.innerWidth && r.right > 0;
    } catch (e) { return false; }
  }
  function inForm(el) { try { return !!el.closest('form'); } catch (e) { return false; } }
  function interactable(el) {
    try {
      if (el.disabled === true) return false;
      var aria = (el.getAttribute('aria-disabled') || '').toLowerCase();
      if (aria === 'true') return false;
      return true;
    } catch (e) { return false; }
  }

  function classifyTarget(el) {
    var tag = el.tagName.toLowerCase();
    var role = (el.getAttribute('role') || '').toLowerCase();
    var cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
    var aria = ((el.getAttribute('aria-expanded') || '') + (el.getAttribute('aria-haspopup') || '')).toLowerCase();
    var data = ((el.getAttribute('data-toggle') || '') + (el.getAttribute('data-bs-toggle') || '') + (el.getAttribute('data-target') || '')).toLowerCase();
    if (tag === 'summary') return 'accordion';
    if (/accordion/i.test(cls) || (aria.indexOf('true') >= 0 && /accordion|collapse|expand/i.test(cls))) return 'accordion';
    if (role === 'tab' || /tab-button|tabs?/i.test(cls)) return 'tab';
    if (/dropdown|drop-down|menu-toggle|hamburger|navbar-toggler|nav-toggle|burger|drawer|offcanvas/i.test(cls) || data.indexOf('dropdown') >= 0) return 'menu';
    if (aria.indexOf('menu') >= 0 || aria.indexOf('listbox') >= 0) return 'menu';
    if (data.indexOf('modal') >= 0 || /modal-trigger|open-modal|dialog-trigger/i.test(cls) || role === 'dialog-trigger') return 'modal';
    if (role === 'switch' || role === 'checkbox') return 'toggle';
    if (/search/i.test(cls) || el.getAttribute('aria-label') && /search/i.test(el.getAttribute('aria-label'))) return 'search';
    if (role === 'button') return 'button';
    if (tag === 'button') return 'button';
    return null;
  }

  function findTargets() {
    var seen = new Set();
    var targets = [];
    var excluded = [];
    var pool = document.querySelectorAll('button, [role="tab"], [role="button"], summary, [aria-haspopup], [aria-expanded], [data-toggle], [data-bs-toggle], input[type="search"]');
    Array.prototype.forEach.call(pool, function (el) {
      if (inForm(el)) {
        if (excluded.length < 12) excluded.push({ selector: sel(el), reason: 'Inside a <form>, never triggered (could submit).' });
        return;
      }
      var type = (el.tagName.toLowerCase() === 'button' && /submit/i.test(el.type || '')) ? null : classifyTarget(el);
      if (!type && el.tagName.toLowerCase() !== 'input') return;
      if (!type && el.tagName.toLowerCase() === 'input' && el.type === 'search') type = 'search';
      if (!type) return;
      if (seen.has(el)) return;
      seen.add(el);
      if (!visible(el) || !interactable(el)) {
        if (excluded.length < 12) excluded.push({ selector: sel(el), reason: 'Not visible or disabled.' });
        return;
      }
      var rect = el.getBoundingClientRect();
      var text = (el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      targets.push({ el: el, kind: type, selector: sel(el), text: text, top: rect.top });
    });
    // Prefer distinct kinds, above-the-fold first, cap at 8.
    var kinds = {};
    var chosen = [];
    var sorted = targets.sort(function (a, b) { return a.top - b.top; });
    sorted.forEach(function (t) {
      var k = t.kind;
      var want = { menu: 2, tab: 1, accordion: 1, search: 1, modal: 1, toggle: 1, button: 2 }[k] || 1;
      if ((kinds[k] || 0) >= want) return;
      if (chosen.length >= MAX_INTERACTIONS) return;
      kinds[k] = (kinds[k] || 0) + 1;
      chosen.push(t);
    });
    return { targets: chosen, excluded: excluded };
  }

  function snapshot(el) {
    var r = el.getBoundingClientRect();
    var details = el.closest('details');
    return {
      rect: Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width) + ',' + Math.round(r.height),
      cls: typeof el.className === 'string' ? el.className : '',
      aria: (el.getAttribute('aria-expanded') || '') + '|' + (el.getAttribute('aria-selected') || '') + '|' + (el.getAttribute('aria-checked') || ''),
      open: details ? details.open : null,
      mutations: mutationCount
    };
  }

  function responded(before, el) {
    var after = snapshot(el);
    if (after.rect !== before.rect) return true;
    if (after.cls !== before.cls) return true;
    if (after.aria !== before.aria) return true;
    if (after.open !== before.open) return true;
    if (after.mutations > before.mutations) return true;
    return false;
  }

  var interactionId = 0;
  function dispatch(el, type) {
    var before = snapshot(el);
    var t0 = performance.now();
    var handled = { a: false };
    function marker(e) { try { e.__cwv = true; } catch (x) {} }
    function onClickCapture(e) { if (e.__cwv) { try { var a = e.target.closest && e.target.closest('a'); if (a) { e.preventDefault(); handled.a = true; } } catch (x) {} } }
    try { document.addEventListener('click', onClickCapture, true); } catch (e) {}
    try {
      if (type === 'click') {
        var pe = function (name) {
          var ev;
          try { ev = new PointerEvent(name, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: 'mouse' }); }
          catch (e) { ev = new MouseEvent(name, { bubbles: true, cancelable: true }); }
          marker(ev);
          el.dispatchEvent(ev);
        };
        pe('pointerover'); pe('pointerdown'); pe('pointerup');
        var ce = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        marker(ce);
        el.dispatchEvent(ce);
      } else if (type === 'keydown') {
        try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} }
        var ke = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
        marker(ke);
        el.dispatchEvent(ke);
      }
    } finally {
      try { document.removeEventListener('click', onClickCapture, true); } catch (e) {}
    }
    // Let handler work drain, then measure presentation via double rAF.
    return new Promise(function (resolve) {
      var tProc = null, tPres = null;
      setTimeout(function () {
        tProc = performance.now();
        doubleRaf().then(function () {
          tPres = performance.now();
          var latency = tPres - t0;
          var processing = tProc - t0;
          var presentation = tPres - tProc;
          // Prefer the browser's own event-timing entry when present.
          var entry = null;
          for (var i = eventEntries.length - 1; i >= 0; i--) {
            var e = eventEntries[i];
            if (e.startTime >= t0 - 5 && e.startTime <= t0 + 5 && (e.target === el || (el.contains && el.contains(e.target)))) { entry = e; break; }
          }
          var breakdown = { inputDelay: 0, processing: processing, presentation: presentation, latency: latency, measuredVia: 'synthetic-instrumentation' };
          if (entry && entry.processingStart != null && entry.processingEnd != null) {
            breakdown = {
              inputDelay: Math.max(0, entry.processingStart - entry.startTime),
              processing: Math.max(0, entry.processingEnd - entry.processingStart),
              presentation: Math.max(0, entry.duration - (entry.processingEnd - entry.startTime)),
              latency: entry.duration,
              measuredVia: 'event-timing'
            };
          }
          var out2 = {
            id: interactionId++,
            type: type,
            target: { tag: el.tagName.toLowerCase(), selector: sel(el), text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60), rect: rectOf(el) },
            latency: Math.round(breakdown.latency * 10) / 10,
            inputDelay: Math.round(breakdown.inputDelay * 10) / 10,
            processing: Math.round(breakdown.processing * 10) / 10,
            presentation: Math.round(breakdown.presentation * 10) / 10,
            startTime: Math.round(t0 * 10) / 10,
            responded: responded(before, el) && !handled.a,
            note: handled.a ? 'Target is a link, navigation was suppressed; only the handler ran.' : null,
            measuredVia: breakdown.measuredVia
          };
          resolve(out2);
        });
      }, 0);
    });
  }

  function runInteractions() {
    if (MAX_INTERACTIONS === 0) {
      out.vitals.inp.status = 'unavailable';
      out.vitals.inp.reason = 'Interaction testing was disabled for this run (crawl mode).';
      return Promise.resolve();
    }
    var found = findTargets();
    out.interactives.excluded = found.excluded;
    var targets = found.targets;
    if (!targets.length) {
      out.vitals.inp.status = 'unavailable';
      out.vitals.inp.reason = 'No safe interactive elements (menus, tabs, accordions, search controls, modal triggers) were found outside forms. INP was not measured, never guessed.';
      return Promise.resolve();
    }
    var run = Promise.resolve();
    var results = [];
    targets.forEach(function (t, i) {
      run = run.then(function () { return dispatch(t.el, 'click'); }).then(function (r) {
        results.push(r);
        return wait(300);
      });
    });
    // Keyboard interaction on the first safe focusable target.
    run = run.then(function () {
      var kb = targets.filter(function (t) { return t.kind !== 'search'; })[0];
      if (!kb) return null;
      return dispatch(kb.el, 'keydown');
    }).then(function (r) {
      if (r) results.push(r);
      out.vitals.inp.interactions = results;
      out.interactives.tested = results.map(function (r) {
        return { id: r.id, type: r.type, selector: r.target.selector, latency: r.latency, responded: r.responded };
      });
      var respondedList = results.filter(function (r) { return r.responded && r.latency != null; });
      if (respondedList.length) {
        var worst = respondedList.reduce(function (m, r) { return r.latency > m.latency ? r : m; }, respondedList[0]);
        out.vitals.inp.status = 'measured';
        out.vitals.inp.value = worst.latency;
      } else {
        out.vitals.inp.status = 'unavailable';
        out.vitals.inp.reason = 'Interactions ran but none produced a measurable response.';
      }
    });
    return run;
  }

  /* ---------------- main flow ---------------- */
  function isQuiet() {
    var last = 0;
    longTasks.forEach(function (t) { last = Math.max(last, t.startTime + t.duration); });
    return performance.now() - last > 2000;
  }

  function settle(maxMs) {
    var start = Date.now();
    return new Promise(function (resolve) {
      (function tick() {
        if (isQuiet() && Date.now() - start > 1500) { resolve(); return; }
        if (Date.now() - start > maxMs) { resolve(); return; }
        setTimeout(tick, 400);
      })();
    });
  }

  function finalize() {
    collectNav();
    collectResources();
    collectDom();
    collectImages();
    collectFonts();
    return collectCssJs().then(function () {
      out.meta.completedAt = Date.now();
      post('done', out);
    });
  }

  post('ready', { transport: PROXY_MODE ? 'server-proxy' : 'browser-direct' });

  function start() {
    var loadTimer = null;
    var started = false;
    var hard = setTimeout(function () {
      if (!started) { started = true; out.warnings.push('Hard timeout: measurement window ended before the page finished loading.'); post('timeout'); finalize(); }
    }, 60000);
    function go() {
      if (started) return;
      started = true;
      clearTimeout(loadTimer);
      post('loaded');
      settle(SETTLE_MS).then(function () {
        post('settled');
        return runInteractions();
      }).then(function () {
        post('interactions');
        clearTimeout(hard);
        finalize();
      }, function () {
        clearTimeout(hard);
        finalize();
      });
    }
    if (document.readyState === 'complete') { loadTimer = setTimeout(go, 250); }
    else window.addEventListener('load', function () { loadTimer = setTimeout(go, 250); });
    loadTimer = setTimeout(go, 15000); // never hang if load stalls
  }
  start();
})();
