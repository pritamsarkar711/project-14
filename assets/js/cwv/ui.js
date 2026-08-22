/* Core Web Vitals & INP Auditor: UI orchestration.
 *
 * Flow: validate → server-proxied fetch (SSE) → measurement iframe →
 * (or: browser-direct relay fallback → srcdoc iframe) → measurement
 * bundle → /api/cwv-analyze → report → render. Includes the optional
 * multi-page crawl mode and JSON/CSV/print exports. */
(function () {
  'use strict';
  var form = document.getElementById('cwv-form');
  if (!form) return;
  var CWV = window.CwvUi = window.CwvUi || {};
  var R = window.CwvUi.Report;
  var rewriter = window.CwvRewriter || null;
  var urlInput = document.getElementById('cwv-url');
  var out = document.getElementById('cwv-results');

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function toast(msg) { var t = el('div', 'toast', esc(msg)); document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600); }
  function download(name, text, mime) {
    try {
      var blob = new Blob([text], { type: mime || 'application/octet-stream' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    } catch (e) { toast('Download failed in this browser.'); }
  }

  /* ---------------- profiles ---------------- */
  var PROFILES = {
    mobile: {
      id: 'mobile', label: 'Mobile',
      viewport: { w: 412, h: 823 }, dpr: null,
      network: { label: 'Slow 4G (150 ms RTT, 1.6 Mbps via auditor proxy)', latencyMs: 150, downKbps: 1600 },
      note: 'Emulated viewport + auditor-proxy network throttle. CPU is not throttled, this does not represent every real device.'
    },
    desktop: {
      id: 'desktop', label: 'Desktop',
      viewport: { w: 1350, h: 940 }, dpr: null, network: null,
      note: 'Desktop viewport, no throttle.'
    },
    custom: { id: 'custom', label: 'Custom', viewport: { w: 1280, h: 800 }, dpr: null, network: null, note: 'User-defined viewport and network.' }
  };
  var NETWORKS = [
    { id: 'none', label: 'No throttle', latencyMs: 0, downKbps: 0 },
    { id: 'slow4g', label: 'Slow 4G (150 ms RTT, 1.6 Mbps)', latencyMs: 150, downKbps: 1600 },
    { id: 'fast3g', label: 'Fast 3G (563 ms RTT, 1.44 Mbps)', latencyMs: 563, downKbps: 1440 }
  ];

  /* ---------------- validation (client mirror; server re-validates) ---------------- */
  var PRIVATE_RE = /^(localhost|localhost\.localdomain|ip6-localhost|ip6-loopback)$|\.(local|internal|lan|home|localhost)$|metadata\.google|instance-data|kubernetes\.default/i;
  function validateInput(raw) {
    var s = String(raw || '').trim().replace(/\s+/g, '');
    if (!s) return { ok: false, message: 'Please enter a website URL.' };
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
    var u;
    try { u = new URL(s); } catch (e) { return { ok: false, message: 'Please enter a valid website URL (e.g. https://example.com).' }; }
    if (!/^https?:$/.test(u.protocol)) return { ok: false, message: 'Only http:// and https:// URLs are supported.' };
    if (u.username || u.password) return { ok: false, message: 'URLs with credentials are not allowed.' };
    var host = String(u.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) return { ok: false, message: 'Please enter a valid website URL.' };
    if (PRIVATE_RE.test(host) || /^(127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|198\.1[89]\.)/.test(host)) {
      return { ok: false, message: 'Private, local or internal addresses cannot be audited.' };
    }
    return { ok: true, url: u.href };
  }

  /* ---------------- progress ---------------- */
  var STEPS = [
    ['validate', 'URL validated'],
    ['browser', 'Browser initialized'],
    ['loaded', 'Page loaded'],
    ['captured', 'Network requests captured'],
    ['lcp', 'LCP measured'],
    ['inp', 'INP interactions analyzed'],
    ['cls', 'CLS calculated'],
    ['js', 'JavaScript analyzed'],
    ['images', 'Images analyzed'],
    ['fonts', 'Fonts analyzed'],
    ['report', 'Performance report generated']
  ];
    function progressUI(message) {
    var ICONS = {'loaded': 'download_done', 'captured': 'swap_vert', 'lcp': 'image', 'inp': 'touch_app', 'cls': 'swap_vert', 'js': 'code', 'images': 'image', 'fonts': 'text_fields', 'report': 'grading', 'validate': 'rule', 'browser': 'travel_explore'};
    var steps = STEPS.map(function (s) { return { key: s[0], label: s[1], icon: ICONS[s[0]] || 'radio_button_unchecked' }; });
    out._cwvScan = window.ScanProgress.create(out, {
      title: 'Analyzing website performance', target: (urlInput && urlInput.value) || '', icon: 'speed', steps: steps,
      note: message || 'Working\u2026',
      onCancel: function () { if (CWV.abort) CWV.abort(); }
    });
    var states0 = {};
    steps.forEach(function (s, i) { states0[s.key] = i === 0 ? 'active' : 'wait'; });
    out._cwvScan.set(states0, message, 4);
  }
  function markStep(key) {
    if (!out._cwvScan || !out._cwvScan.card || !out._cwvScan.card.isConnected) return;
    var map = { browser: 'loaded', validate: 'loaded' };
    var k = map[key] || key;
    var idx = STEPS.findIndex(function (s) { return s[0] === k; });
    if (idx < 0) return;
    var states = {};
    STEPS.forEach(function (s, i) { states[s[0]] = i < idx ? 'done' : i === idx ? 'active' : 'wait'; });
    out._cwvScan.set(states, null, 8 + Math.round(idx / STEPS.length * 88));
  }

  function progressMsg(msg) {
    if (out._cwvScan && out._cwvScan.note) out._cwvScan.note(msg);
  }

  /* ---------------- transports ---------------- */
  function readSSE(res, onEvent) {
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buf = '';
    function parseChunks(text) {
      var ev = null, data = [];
      text.split('\n').forEach(function (line) {
        if (line.indexOf('event:') === 0) ev = line.slice(6).trim();
        else if (line.indexOf('data:') === 0) data.push(line.slice(5).trim());
      });
      if (ev && data.length) {
        try { onEvent(ev, JSON.parse(data.join('\n'))); } catch (e) {}
      }
    }
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) { if (buf.trim()) parseChunks(buf); return; }
        buf += decoder.decode(r.value, { stream: true });
        var idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          var chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          parseChunks(chunk);
        }
        return pump();
      });
    }
    return pump();
  }

  function fetchViaServer(url, profile, onStage, signal) {
    var result = null;
    var attempt = fetch('/api/cwv-fetch', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: url, profile: profile }), signal: signal
    }).then(function (res) {
      if (!res.ok) {
        return res.json().then(function (j) { var e = new Error(j.message || 'Server fetch failed.'); e.code = j.code; throw e; },
          function () { var e = new Error('The server rejected the request (HTTP ' + res.status + ').'); e.code = 'network'; throw e; });
      }
      return readSSE(res, function (ev, data) {
        if (ev === 'progress') onStage && onStage('server-progress', data);
        else if (ev === 'result') result = data;
        else if (ev === 'error') { var e = new Error(data.message || 'Fetch failed.'); e.code = data.code; throw e; }
      }).then(function () {
        if (!result) { var e2 = new Error('The server returned no result.'); e2.code = 'empty'; throw e2; }
        return result;
      });
    });
    // Overall deadline: a stalled SSE stream (proxy buffering, dropped
    // connection) must not hang the audit, fail over to browser-direct.
    return new Promise(function (resolve, reject) {
      var settled = false;
      var t = setTimeout(function () {
        if (!settled) {
          settled = true;
          var e = new Error('The server did not respond in time, switching to browser-direct measurement.');
          e.code = 'empty';
          reject(e);
        }
      }, 35000);
      attempt.then(function (r) { if (!settled) { settled = true; clearTimeout(t); resolve(r); } },
        function (e) { if (!settled) { settled = true; clearTimeout(t); reject(e); } });
    });
  }

  /* ---------------- browser-side relays (last-resort fetch) ---------------- */
  var BROWSER_RELAYS = [
    { id: 'allorigins', label: 'AllOrigins', run: function (u, o) { return fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(u), o).then(function (r) { return r.text().then(function (t) { return { html: t, status: r.status }; }); }); } },
    { id: 'codetabs', label: 'CodeTabs', run: function (u, o) { return fetch('https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u), o).then(function (r) { return r.text().then(function (t) { return { html: t, status: r.status }; }); }); } },
    { id: 'corsproxy', label: 'CORSProxy', run: function (u, o) { return fetch('https://corsproxy.io/?url=' + encodeURIComponent(u), o).then(function (r) { return r.text().then(function (t) { return { html: t, status: r.status }; }); }); } },
    { id: 'corseu', label: 'CORS.EU', run: function (u, o) { return fetch('https://cors.eu.org/' + u, o).then(function (r) { return r.text().then(function (t) { return { html: t, status: r.status }; }); }); } },
    { id: 'corslol', label: 'CORS.LOL', run: function (u, o) { return fetch('https://api.cors.lol/?url=' + encodeURIComponent(u), o).then(function (r) { return r.text().then(function (t) { return { html: t, status: r.status }; }); }); } },
    { id: 'allorigins-json', label: 'AllOrigins (JSON)', run: function (u, o) { return fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(u), o).then(function (r) { return r.json().then(function (j) { return { html: j.contents || '', status: (j.status && j.status.http_code) || 200 }; }); }); } }
  ];

  function relayUsable(res) {
    var s = String(res.html || '');
    if (CHALLENGE_RE.test(s.slice(0, 8000))) return false;
    if (res.status >= 400 && res.status !== 403 && res.status !== 429) return false;
    var looksHtml = /<(!doctype\s*html|html|head|body|title|meta|div|span|p\b|a\b|img|script|link|style|main|section|article)/i.test(s);
    if (looksHtml && s.length >= 60) return true;
    if (s.length >= 200) return true;
    return false;
  }

  function relayFetch(url, signal, onProgress) {
    var i = 0;
    function one(rl, tries) {
      if (signal && signal.aborted) return Promise.reject(Object.assign(new Error('Cancelled.'), { code: 'cancelled' }));
      if (onProgress) onProgress('Trying relay ' + (i + 1) + '/' + BROWSER_RELAYS.length + ' (' + rl.label + ')…');
      return rl.run(url, { signal: signal }).then(function (res) {
        if (relayUsable(res)) return { html: res.html, status: res.status, relay: rl.id, label: rl.label };
        if (tries > 0) return one(rl, tries - 1);
        return null; // this relay produced junk, move on
      }, function () {
        if (tries > 0) return one(rl, tries - 1);
        return null;
      });
    }
    function next() {
      if (signal && signal.aborted) return Promise.reject(Object.assign(new Error('Cancelled.'), { code: 'cancelled' }));
      if (i >= BROWSER_RELAYS.length) {
        return Promise.reject(Object.assign(new Error('No public relay returned a readable page (' + BROWSER_RELAYS.length + ' relays tried).'), { code: 'unreachable' }));
      }
      var rl = BROWSER_RELAYS[i++];
      return one(rl, 1).then(function (res) {
        if (res) return res;
        return next();
      });
    }
    return next();
  }

  function buildSrcdoc(html, url, profile, nonce, measureOpts) {
    if (!rewriter) throw new Error('The page rewriter did not load.');
    var q = '?n=' + nonce + (measureOpts && measureOpts.settleMs ? '&settle=' + measureOpts.settleMs : '') + (measureOpts && measureOpts.maxIx ? '&maxIx=' + measureOpts.maxIx : '');
    var rewritten = rewriter.rewriteHtml(html, {
      sid: null,
      baseUrl: url,
      injectScript: '/assets/js/cwv/measure.js' + q,
      addViewport: profile.viewport && profile.viewport.w < 600
    });
    return rewritten.html;
  }

  /* ---------------- measurement iframe ---------------- */
  function measurePage(src, profile, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
      var iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.setAttribute('tabindex', '-1');
      // opacity:0 keeps the document fully laid-out and painted (so LCP/CLS/
      // rAF/LoAF all fire normally) while staying invisible and click-proof.
      iframe.style.cssText = 'position:fixed;left:0;top:0;width:' + (profile.viewport.w || 1000) + 'px;height:' + (profile.viewport.h || 800) + 'px;border:0;opacity:0;pointer-events:none;z-index:-1;';
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals');
      var settled = false;
      var timer = setTimeout(function () { finish(null, Object.assign(new Error('The measurement timed out (page did not finish).'), { code: 'timeout' })); }, opts.timeout || 75000);
      function onMsg(e) {
        if (!e.data || e.data.source !== 'cwv-measure' || e.data.nonce !== nonce) return;
        if (opts.onStage) opts.onStage(e.data.stage, e.data.payload);
        if (e.data.stage === 'done') finish(e.data.payload, null);
      }
      function finish(payload, err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        try { iframe.remove(); } catch (e) {}
        if (CWV._lastFrame === iframe) CWV._lastFrame = null;
        if (err) reject(err); else resolve(payload);
      }
      window.addEventListener('message', onMsg);
      document.body.appendChild(iframe);
      CWV._lastFrame = iframe;
      if (opts.srcdocBuilder) {
        try { iframe.srcdoc = opts.srcdocBuilder(nonce); } catch (e) { finish(null, e); return; }
      } else if (opts.srcdoc) {
        iframe.srcdoc = opts.srcdoc;
      } else {
        var qs = 'n=' + encodeURIComponent(nonce) + (opts.qs ? '&' + opts.qs : '');
        iframe.src = src + (src.indexOf('?') >= 0 ? '&' : '?') + qs;
      }
    });
  }

  /* ---------------- analysis ---------------- */
  function analyzeBundle(payload, ctx) {
    if (ctx.serverInfo) {
      payload.meta.requestedUrl = ctx.serverInfo.requestedUrl;
      payload.meta.finalUrl = ctx.serverInfo.finalUrl;
      payload.meta.htmlStatus = ctx.serverInfo.status;
      payload.meta.htmlBytes = ctx.serverInfo.htmlBytes;
      payload.meta.htmlTruncated = !!ctx.serverInfo.truncated;
      payload.meta.protocolDoc = ctx.serverInfo.protocol;
      payload.meta.relay = ctx.serverInfo.relay || null;
      payload.meta.redirects = (ctx.serverInfo.redirects || []).map(function (h) { return { from: h.from, status: h.status, to: h.to }; });
      payload.docHeaders = ctx.serverInfo.headers || {};
      payload.docPhases = ctx.serverInfo.phases || null;
      if (Array.isArray(ctx.serverInfo.notes) && ctx.serverInfo.notes.length) {
        payload.meta.notes = payload.meta.notes || [];
        ctx.serverInfo.notes.forEach(function (n) { payload.meta.notes.push(n); });
      }
    }
    if (ctx.relayInfo) {
      payload.meta.requestedUrl = ctx.relayInfo.requestedUrl;
      payload.meta.finalUrl = ctx.relayInfo.finalUrl || ctx.relayInfo.requestedUrl;
      payload.meta.htmlStatus = ctx.relayInfo.status;
      payload.meta.htmlBytes = ctx.relayInfo.bytes;
      payload.meta.relay = ctx.relayInfo.label || ctx.relayInfo.relay;
      payload.docHeaders = {};
      payload.docPhases = { relayMs: ctx.relayInfo.ms };
      payload.meta.notes = payload.meta.notes || [];
      payload.meta.notes.push('HTML fetched through the public relay ' + (ctx.relayInfo.label || ctx.relayInfo.relay) + ' in ' + Math.round(ctx.relayInfo.ms) + ' ms (relay timing, not a TTFB measurement). Subresources loaded cross-origin; timing/sizes hidden by timing-allow-origin are marked unavailable.');
    }
    if (ctx.sessionMeta) {
      payload.resourceMeta = { mode: 'server-proxy', items: ctx.sessionMeta.resources || [] };
      payload.docHeaders = ctx.sessionMeta.docHeaders || payload.docHeaders;
      payload.docPhases = ctx.sessionMeta.docPhases || payload.docPhases;
      payload.meta.protocolDoc = ctx.sessionMeta.docProtocol || payload.meta.protocolDoc;
      payload.meta.htmlBytes = ctx.sessionMeta.docBytes != null ? ctx.sessionMeta.docBytes : payload.meta.htmlBytes;
      payload.meta.htmlStatus = ctx.sessionMeta.docStatus != null ? ctx.sessionMeta.docStatus : payload.meta.htmlStatus;
      payload.meta.redirects = (ctx.sessionMeta.docRedirects || []).map(function (h) { return { from: h.from, status: h.status, to: h.to }; });
    }
    payload.profile = {
      id: ctx.profile.id, label: ctx.profile.label,
      viewport: { w: ctx.profile.viewport.w, h: ctx.profile.viewport.h }, dpr: ctx.profile.dpr || null,
      network: ctx.profile.network ? { label: ctx.profile.network.label, latencyMs: ctx.profile.network.latencyMs, downKbps: ctx.profile.network.downKbps } : null,
      note: ctx.profile.note || null
    };
    return fetch('/api/cwv-analyze', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bundle: payload })
    }).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok) { var e = new Error(j.message || 'Analysis failed.'); e.code = j.code; throw e; }
        return j;
      });
    });
  }

  /* ---------------- single-profile run ---------------- */
  var abortCtl = null;
  CWV.abort = function () {
    if (abortCtl) abortCtl.abort();
    if (CWV._lastFrame) {
      try { CWV._lastFrame.remove(); } catch (e) {}
      CWV._lastFrame = null;
    }
  };

  // Errors that are real audit results (target-site or usage problems) ,
  // anything else is transport trouble and triggers the browser-direct path.
  var HARD_CODES = ['ratelimit', 'busy', 'invalid_url', 'ssrf', 'not_found', 'blocked', 'challenge', 'not_html', 'dns'];
  var CHALLENGE_RE = /just a moment|attention required|cf-browser-verification|challenge-platform|cdn-cgi\/challenge|checking your browser|enable javascript and cookies|access denied|perimeterx|datadome/i;

  function mapStages(stage) {
    if (stage === 'ready') markStep('browser');
    else if (stage === 'loaded') markStep('loaded');
    else if (stage === 'settled') { markStep('captured'); markStep('lcp'); }
    else if (stage === 'interactions') { markStep('inp'); markStep('cls'); progressMsg('Analyzing the captured data…'); }
    else if (stage === 'timeout') progressMsg('The page did not finish loading, using partial data.');
  }

  // Browser-direct measurement through public relays (used when the server
  // transport is unavailable).
  function relayRun(url, profile, measureOpts, serverErr) {
    progressMsg('The server could not reach the site, trying public relays from your browser…');
    var t0 = performance.now();
    return relayFetch(url, abortCtl ? abortCtl.signal : null, function (msg) { progressMsg(msg); }).then(function (res) {
      if (abortCtl && abortCtl.signal.aborted) throw Object.assign(new Error('Cancelled.'), { code: 'cancelled' });
      return measurePage(null, profile, {
        srcdocBuilder: function (nonce) { return buildSrcdoc(res.html, url, profile, nonce, measureOpts); },
        onStage: mapStages, timeout: 80000
      }).then(function (payload) {
        if (payload && payload.internalLinks && payload.internalLinks.length && !CWV._internalLinks) CWV._internalLinks = payload.internalLinks;
        if (/^http:\/\//i.test(url)) {
          payload.meta.notes = payload.meta.notes || [];
          payload.meta.notes.push('The page is HTTP-only. In browser-direct mode the browser may block its HTTP subresources as mixed content, results can be incomplete. The server-proxy transport (production) does not have this limitation.');
        }
        return analyzeBundle(payload, {
          profile: profile,
          relayInfo: { requestedUrl: url, finalUrl: url, status: res.status, bytes: res.html.length, relay: res.relay, label: res.label, ms: performance.now() - t0 }
        });
      });
    }).catch(function (e) {
      if (e.code === 'cancelled' || (abortCtl && abortCtl.signal.aborted)) {
        throw Object.assign(new Error('Cancelled.'), { code: 'cancelled' });
      }
      if (e.code === 'challenge') throw e;
      // FINAL RESORT: direct iframe load (limited, cross-origin pages cannot
      // be instrumented, but the load itself is a real measurement).
      progressMsg('All relays failed, trying a direct (limited) page load…');
      return directLimitedRun(url, profile).then(function (payload) {
        if (payload.internalLinks && payload.internalLinks.length && !CWV._internalLinks) CWV._internalLinks = payload.internalLinks;
        payload.profile = {
          id: profile.id, label: profile.label,
          viewport: { w: profile.viewport.w, h: profile.viewport.h }, dpr: profile.dpr || null,
          network: profile.network || null, note: profile.note || null
        };
        payload.meta.notes = payload.meta.notes || [];
        if (serverErr) payload.meta.notes.push('Server transport failed: ' + (serverErr.message || serverErr.code || 'unknown') + '. All public relays also failed (' + BROWSER_RELAYS.length + ' tried).');
        return analyzeBundle(payload, { profile: profile, relayInfo: null });
      }, function (e2) {
        var msg = 'The page could not be loaded directly in an iframe either, the site may be unreachable or may block framing entirely.';
        throw Object.assign(new Error(msg), { code: e2.code || 'unreachable' });
      });
    });
  }

  // Direct cross-origin iframe load: no page internals are accessible, so
  // the only real measurement is the iframe load event time. Everything else
  // is honestly reported as Not Available.
  function directLimitedRun(url, profile) {
    return new Promise(function (resolve, reject) {
      var t0 = performance.now();
      var iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.setAttribute('tabindex', '-1');
      iframe.style.cssText = 'position:fixed;left:0;top:0;width:' + (profile.viewport.w || 1000) + 'px;height:' + (profile.viewport.h || 800) + 'px;border:0;opacity:0;pointer-events:none;z-index:-1;';
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals');
      var settled = false;
      var timer = setTimeout(function () { finish(true); }, 30000);
      function finish(timedOut) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        var ms = Math.round(performance.now() - t0);
        try { iframe.remove(); } catch (e) {}
        if (timedOut) {
          reject(Object.assign(new Error('The page did not finish loading within 30 s.'), { code: 'timeout' }));
          return;
        }
        resolve({
          v: 1,
          meta: {
            requestedUrl: url, finalUrl: url, transport: 'direct-iframe', relay: null,
            htmlStatus: null, htmlContentType: 'text/html', htmlBytes: null, htmlTruncated: false,
            challenge: false, challengeGuard: null, redirects: [], protocolDoc: null,
            userAgent: navigator.userAgent, startedAt: Date.now(), completedAt: Date.now(), sid: null,
            notes: [
              'Limited measurement mode: the page was loaded directly in a cross-origin iframe. Browsers block access to page internals, so no Core Web Vitals, interactions or resources can be measured from this transport.',
              'The iframe load event fired ' + ms + ' ms after navigation started (real measurement). If the site blocks framing, an error page may have loaded instead.'
            ]
          },
          docPhases: null, docHeaders: {},
          nav: { ttfb: null, domInteractive: null, domContentLoaded: null, load: ms },
          vitals: {
            lcp: { status: 'unavailable', value: null, entry: null, candidates: [], reason: 'Cross-origin page, cannot be instrumented from a direct iframe load.' },
            fcp: { status: 'unavailable', value: null, reason: 'Cross-origin page, first paint cannot be observed from a direct iframe load.' },
            cls: { status: 'unavailable', value: null, entries: [], excluded: [], reason: 'Cross-origin page, layout shifts cannot be observed from a direct iframe load.' },
            inp: { status: 'unavailable', value: null, interactions: [], reason: 'Cross-origin page, interactions cannot be tested from a direct iframe load.' },
            tbt: { status: 'unavailable', value: null, reason: 'Cross-origin page, main-thread tasks cannot be observed from a direct iframe load.' },
            si: { status: 'unavailable', reason: 'Not measurable without screenshot/video capture.' }
          },
          longTasks: null, resources: [], dom: null, images: [], fonts: [], cssFiles: [], jsFiles: [],
          linkHints: { preload: [], preconnect: [], dnsPrefetch: [], modulepreload: [] },
          internalLinks: [], interactives: { tested: [], excluded: [] }, loafs: [],
          hardening: { storage: true, serviceWorker: true, cookies: true, windowOpen: true },
          warnings: [], notes: [], resourceMeta: null
        });
      }
      iframe.addEventListener('load', function () { finish(false); });
      document.body.appendChild(iframe);
      iframe.src = url;
    });
  }

  function runProfile(url, profile, measureOpts) {
    abortCtl = new AbortController();
    var signal = abortCtl.signal;
    markStep('validate');
    return new Promise(function (resolve, reject) {
      var done = false;
      function ok(report, note) { if (!done) { done = true; resolve({ report: report, note: note }); } }
      function fail(e) { if (!done) { done = true; reject(e); } }

      // Path 1: server-proxied measurement.
      var attempt;
      if (CWV._serverNoEgress) {
        attempt = Promise.reject(Object.assign(new Error('Server transport skipped: no server egress in this environment.'), { code: 'no_egress' }));
      } else {
        attempt = fetchViaServer(url, profile, function (stage, data) {
          progressMsg('Server: ' + (data && data.message || 'working…'));
        }, signal);
      }

      attempt
        .then(function (info) {
          if (signal.aborted) throw Object.assign(new Error('Cancelled.'), { code: 'cancelled' });
          progressMsg('Browser sandbox initialized, loading the page…');
          return measurePage(info.pageUrl, profile, { onStage: mapStages, timeout: 80000 }).then(function (payload) {
            if (payload && payload.internalLinks && payload.internalLinks.length && !CWV._internalLinks) CWV._internalLinks = payload.internalLinks;
            return fetch('/api/cwv-meta?sid=' + encodeURIComponent(info.sid)).then(function (r) { return r.json(); }).catch(function () { return null; })
              .then(function (meta) {
                return analyzeBundle(payload, { serverInfo: info, sessionMeta: meta, profile: profile });
              });
          });
        })
        .then(function (report) {
          markStep('js'); markStep('images'); markStep('fonts'); markStep('report');
          ok(report);
        })
        .catch(function (e) {
          if (signal.aborted) return fail(Object.assign(new Error('Cancelled.'), { code: 'cancelled' }));
          if (HARD_CODES.indexOf(e.code) >= 0) return fail(e);
          // Transport trouble (no egress, empty/truncated SSE stream, stalled
          // connection…) → browser-direct measurement.
          CWV._serverNoEgress = true;
          relayRun(url, profile, measureOpts, e).then(function (report) {
            markStep('js'); markStep('images'); markStep('fonts'); markStep('report');
            ok(report, { fallback: true });
          }, fail);
        });
    });
  }

  /* ---------------- render + tabs ---------------- */
  var state = { reports: {}, order: [], crawl: null, currentProfile: null };

  function renderAll() {
    if (!state.order.length) return;
    var tabs = '<div class="tabs cwv-tabs" role="tablist">' + state.order.map(function (p, i) {
      var r = state.reports[p];
      var label = (r.lab.profile && r.lab.profile.label) || p;
      return '<button type="button" class="' + (i === 0 ? 'active' : '') + '" data-profile="' + esc(p) + '">' + esc(label) + ' <small>Lab</small></button>';
    }).join('') + '</div>';
    var actions = '<div class="report-actions">' +
      '<button class="btn" type="button" id="cwv-export-json">Download Report (JSON)</button>' +
      '<button class="btn" type="button" id="cwv-export-csv">Download Resources (CSV)</button>' +
      '<button class="btn" type="button" id="cwv-print">Print Report</button>' +
      '<button class="btn" type="button" id="cwv-rerun">Run Again</button></div>';
    var panels = state.order.map(function (p, i) {
      var wrap = el('div', 'cwv-report-slot');
      R.render(wrap, state.reports[p]);
      return '<div class="cwv-tabpanel" data-profile-panel="' + esc(p) + '"' + (i ? ' hidden' : '') + '>' + wrap.innerHTML + '</div>';
    }).join('');
    out.innerHTML = '<div class="cwv-results-wrap">' + actions + tabs + panels + crawlSectionHtml() + '</div>';
    bindTabs();
    bindActions();
    bindCrawl();
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function bindTabs() {
    var btns = out.querySelectorAll('.cwv-tabs button');
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        btns.forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        var p = b.getAttribute('data-profile');
        out.querySelectorAll('.cwv-tabpanel').forEach(function (pan) {
          pan.hidden = pan.getAttribute('data-profile-panel') !== p;
        });
        state.currentProfile = p;
      });
    });
  }

  function bindActions() {
    var j = out.querySelector('#cwv-export-json');
    var c = out.querySelector('#cwv-export-csv');
    var pr = out.querySelector('#cwv-print');
    var rr = out.querySelector('#cwv-rerun');
    if (j) j.onclick = function () {
      var p = state.currentProfile || state.order[0];
      var doc = { tool: 'huvanti Core Web Vitals & INP Auditor', exportedAt: new Date().toISOString(), report: state.reports[p], crawl: state.crawl ? state.crawl.summaries : null };
      download('cwv-report-' + slug(state.reports[p].meta.finalUrl) + '.json', JSON.stringify(doc, null, 2), 'application/json');
    };
    if (c) c.onclick = function () {
      var p = state.currentProfile || state.order[0];
      var wf = state.reports[p].lab.waterfall;
      var rows = [['url', 'type', 'start_ms', 'duration_ms', 'transfer_bytes', 'protocol', 'status']];
      wf.rows.forEach(function (r) {
        rows.push([r.url, r.type, r.startTime == null ? '' : r.startTime, r.duration == null ? '' : r.duration, r.transferSize == null ? '' : r.transferSize, r.protocol || '', r.status == null ? '' : r.status]);
      });
      download('cwv-resources-' + slug(state.reports[p].meta.finalUrl) + '.csv', rows.map(function (r2) { return r2.map(function (x) { return '"' + String(x).replace(/"/g, '""') + '"'; }).join(','); }).join('\n'), 'text/csv');
    };
    if (pr) pr.onclick = function () { window.print(); };
    if (rr) rr.onclick = function () { location.reload(); };
  }
  function slug(u) {
    try { return new URL(u).hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '-'); } catch (e) { return 'site'; }
  }

  /* ---------------- crawl (multi-page) ---------------- */
  function crawlSectionHtml() {
    var html = '<section class="audit-panel cwv-wide cwv-crawl"><h3><span class="material-icons" aria-hidden="true">travel_explore</span>Multi-Page Audit (Crawl Website)</h3>';
    if (!state.crawl || !state.crawl.queue.length) {
      html += '<p class="muted">No internal links were discovered on the audited page, so a multi-page crawl has nothing to test. A crawl is only started when you explicitly choose it.</p>';
      return html + '</section>';
    }
    html += '<p class="muted">Optional multi-page mode: ' + state.crawl.queue.length + ' internal URL(s) discovered on the audited page. Each page gets its own lab measurement, nothing is merged into the single-page report above.</p>';
    html += '<div class="cwv-crawl-controls">' +
      '<label>Pages <select id="cwv-crawl-limit" class="select cwv-crawl-select"><option value="10">10 pages</option><option value="25">25 pages</option><option value="50">50 pages</option><option value="100">100 pages</option></select></label>' +
      '<button class="btn" type="button" id="cwv-crawl-start">' + (state.crawl.running ? 'Crawling…' : 'Crawl Website') + '</button>' +
      (state.crawl.running ? '<button class="btn" type="button" id="cwv-crawl-cancel">Stop</button>' : '') +
      '</div><div id="cwv-crawl-progress"></div>';
    if (state.crawl.summaries.length) html += '<div id="cwv-crawl-results">' + crawlTableHtml() + '</div>';
    html += '<p class="muted">Crawl mode measures one page at a time with a reduced measurement window. "Worst" rows are the worst measured in this crawl, not a site-wide verdict.</p>';
    return html + '</section>';
  }

  function crawlTableHtml() {
    var rows = state.crawl.summaries;
    var sortKey = state.crawl.sortKey || 'score';
    var sorted = rows.slice().sort(function (a, b) {
      var av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'url') return String(av || '').localeCompare(String(bv || ''));
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av - bv;
    });
    var html = '<div class="cwv-crawl-toolbar">' +
      '<input id="cwv-crawl-search" class="text-input cwv-crawl-search" placeholder="Search URL…" aria-label="Search URLs">' +
      '<div class="tabs cwv-crawl-filter" role="tablist"><button type="button" class="active" data-f="all">All</button><button type="button" data-f="poor">Poor</button><button type="button" data-f="ni">Needs improvement</button><button type="button" data-f="good">Good</button></div></div>';
    html += '<div class="page-table-wrap"><table class="page-table cwv-crawl-table"><thead><tr>' +
      '<th data-sort="url">Page</th><th data-sort="lcp">LCP</th><th data-sort="inp">INP</th><th data-sort="cls">CLS</th><th data-sort="fcp">FCP</th><th data-sort="ttfb">TTFB</th><th data-sort="score">Score</th><th>Compare</th></tr></thead><tbody>';
    sorted.forEach(function (s) {
      var isWorst = state.crawl.worst.some(function (w) { return w.url === s.url; });
      var checked = state.crawl.compare && state.crawl.compare.indexOf(s.url) >= 0;
      html += '<tr class="' + (isWorst ? 'cwv-worst' : '') + '"><td class="pt-url cwv-crawl-url" title="' + esc(s.url) + '">' + esc(short(s.url)) + '</td>' +
        metricCell(s.lcp, 'ms') + metricCell(s.inp, 'ms') + metricCell(s.cls, '') + metricCell(s.fcp, 'ms') + metricCell(s.ttfb, 'ms') +
        '<td><b>' + (s.score != null ? s.score : ',') + '</b>' + (isWorst ? ' <span class="badge critical">worst</span>' : '') + '</td>' +
        '<td><label class="cwv-compare-check"><input type="checkbox" data-cmp="' + esc(s.url) + '"' + (checked ? ' checked' : '') + '> compare</label> <button class="row-detail" type="button" data-url="' + esc(s.url) + '">Details</button></td></tr>';
    });
    html += '</tbody></table></div>';
    if (state.crawl.compare && state.crawl.compare.length === 2) {
      var a = state.crawl.summaries.find(function (x) { return x.url === state.crawl.compare[0]; });
      var b = state.crawl.summaries.find(function (x) { return x.url === state.crawl.compare[1]; });
      if (a && b) {
        html += '<div class="cwv-compare"><h6>Page comparison</h6><div class="mini-table-wrap"><table class="mini-table"><thead><tr><th>Metric</th><th>' + esc(short(a.url)) + '</th><th>' + esc(short(b.url)) + '</th><th>Better</th></tr></thead><tbody>' +
          compareRow('LCP (ms)', a.lcp, b.lcp, -1) + compareRow('INP (ms)', a.inp, b.inp, -1) + compareRow('CLS', a.cls, b.cls, -1) +
          compareRow('FCP (ms)', a.fcp, b.fcp, -1) + compareRow('TTFB (ms)', a.ttfb, b.ttfb, -1) + compareRow('Score', a.score, b.score, 1) +
          '</tbody></table></div></div>';
      }
    }
    return html;
  }
  function metricCell(v, unit) {
    if (!v || v.value == null) return '<td><span class="muted">n/a</span></td>';
    var cls = v.status === 'good' ? 's-ok' : v.status === 'poor' ? 's-err' : v.status === 'needs-improvement' ? 's-warn' : 's-unk';
    return '<td><span class="status-pill ' + cls + '">' + v.value + (unit ? ' ' + unit : '') + '</span></td>';
  }
  function compareRow(label, a, b, dir) {
    var av = a && a.value != null ? a.value : null, bv = b && b.value != null ? b.value : null;
    if (av == null || bv == null) return '<tr><td>' + esc(label) + '</td><td>' + (av == null ? 'n/a' : av) + '</td><td>' + (bv == null ? 'n/a' : bv) + '</td><td>,</td></tr>';
    var better = av === bv ? 'tie' : (av * dir > bv * dir ? 'a' : 'b');
    return '<tr><td>' + esc(label) + '</td><td class="' + (better === 'a' ? 'up' : '') + '">' + av + '</td><td class="' + (better === 'b' ? 'up' : '') + '">' + bv + '</td><td>' + (better === 'tie' ? 'tie' : better === 'a' ? 'first' : 'second') + '</td></tr>';
  }
  function short(u) {
    try { var p = new URL(u); return p.hostname.replace(/^www\./, '') + (p.pathname !== '/' ? p.pathname : ''); } catch (e) { return String(u); }
  }

  function bindCrawl() {
    var start = out.querySelector('#cwv-crawl-start');
    var cancel = out.querySelector('#cwv-crawl-cancel');
    var search = out.querySelector('#cwv-crawl-search');
    var filterBtns = out.querySelectorAll('.cwv-crawl-filter button');
    var headers = out.querySelectorAll('.cwv-crawl-table th[data-sort]');
    var cmpBoxes = out.querySelectorAll('.cwv-crawl-table input[data-cmp]');
    var detailBtns = out.querySelectorAll('.cwv-crawl-table .row-detail');
    if (start) start.onclick = function () { if (!state.crawl.running) startCrawl(parseInt(out.querySelector('#cwv-crawl-limit').value, 10) || 10); };
    if (cancel) cancel.onclick = function () { state.crawl.abort = true; };
    if (search) search.oninput = applyCrawlFilters;
    filterBtns.forEach(function (b) {
      b.onclick = function () {
        filterBtns.forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        state.crawl.filter = b.getAttribute('data-f');
        applyCrawlFilters();
      };
    });
    headers.forEach(function (h) {
      h.onclick = function () { state.crawl.sortKey = h.getAttribute('data-sort'); refreshCrawlTable(); };
    });
    cmpBoxes.forEach(function (cb) {
      cb.onchange = function () {
        var u = cb.getAttribute('data-cmp');
        state.crawl.compare = state.crawl.compare || [];
        var i = state.crawl.compare.indexOf(u);
        if (cb.checked && i < 0) {
          if (state.crawl.compare.length >= 2) state.crawl.compare.shift();
          state.crawl.compare.push(u);
        } else if (!cb.checked && i >= 0) state.crawl.compare.splice(i, 1);
        refreshCrawlTable();
      };
    });
    detailBtns.forEach(function (b) {
      b.onclick = function () { showCrawlDetail(b.getAttribute('data-url'), b); };
    });
  }
  function applyCrawlFilters() {
    var q = (out.querySelector('#cwv-crawl-search').value || '').toLowerCase();
    var f = state.crawl.filter || 'all';
    out.querySelectorAll('.cwv-crawl-table tbody tr').forEach(function (tr) {
      if (tr.classList.contains('cwv-crawl-detail')) return;
      var name = (tr.querySelector('.cwv-crawl-url') || {}).textContent || '';
      var okQ = !q || name.toLowerCase().indexOf(q) >= 0;
      var status = 'good';
      tr.querySelectorAll('.status-pill').forEach(function (p) {
        if (p.classList.contains('s-err')) status = 'poor';
        else if (p.classList.contains('s-warn') && status === 'good') status = 'ni';
      });
      var okF = f === 'all' || f === status;
      tr.style.display = okQ && okF ? '' : 'none';
    });
  }
  function refreshCrawlTable() {
    var box = out.querySelector('#cwv-crawl-results');
    if (box) { box.innerHTML = crawlTableHtml(); bindCrawl(); }
  }
  function showCrawlDetail(url, btn) {
    var rep = state.crawl.reports[url];
    if (!rep) { toast('Full report not stored for this page.'); return; }
    var existing = btn.closest('tr').nextElementSibling;
    if (existing && existing.classList.contains('cwv-crawl-detail')) { existing.remove(); return; }
    var tr = btn.closest('tr');
    var drow = document.createElement('tr');
    drow.className = 'cwv-crawl-detail';
    var td = document.createElement('td');
    td.colSpan = 8;
    var wrap = el('div', 'cwv-report-slot');
    R.render(wrap, rep);
    td.appendChild(wrap);
    drow.appendChild(td);
    tr.parentNode.insertBefore(drow, tr.nextSibling);
  }

  function startCrawl(limit) {
    var queue = (state.crawl.queue || []).slice(0, limit);
    if (!queue.length) return;
    state.crawl.running = true;
    state.crawl.abort = false;
    state.crawl.summaries = [];
    state.crawl.reports = {};
    state.crawl.compare = [];
    state.crawl.worst = [];
    state.crawl.progress = { done: 0, total: queue.length, failed: 0 };
    var progressBox = out.querySelector('#cwv-crawl-progress');
    progressBox.innerHTML = '<div class="progress-bar"><i id="cwv-crawl-bar" style="width:0%"></i></div><p class="muted" id="cwv-crawl-msg">Starting crawl…</p>';
    var profile = currentProfile();
    var run = Promise.resolve();
    queue.forEach(function (u) {
      run = run.then(function () {
        if (state.crawl.abort) return null;
        var msg = out.querySelector('#cwv-crawl-msg');
        if (msg) msg.textContent = 'Page ' + (state.crawl.progress.done + 1) + '/' + state.crawl.progress.total + ', ' + short(u);
        return crawlOne(u, profile).then(function (summary) {
          state.crawl.progress.done++;
          state.crawl.summaries.push(summary);
          var bar = out.querySelector('#cwv-crawl-bar');
          if (bar) bar.style.width = (state.crawl.progress.done / state.crawl.progress.total * 100) + '%';
          refreshCrawlTable();
        }, function () {
          state.crawl.progress.done++;
          state.crawl.progress.failed++;
          var bar = out.querySelector('#cwv-crawl-bar');
          if (bar) bar.style.width = (state.crawl.progress.done / state.crawl.progress.total * 100) + '%';
        });
      });
    });
    run.then(function () {
      state.crawl.running = false;
      state.crawl.worst = state.crawl.summaries.filter(function (s) { return s.score != null; }).sort(function (a, b) { return a.score - b.score; }).slice(0, 5);
      var msg = out.querySelector('#cwv-crawl-msg');
      if (msg) msg.textContent = 'Crawl finished: ' + (state.crawl.progress.done - state.crawl.progress.failed) + ' measured, ' + state.crawl.progress.failed + ' failed.';
      refreshCrawlTable();
      var startBtn = out.querySelector('#cwv-crawl-start');
      if (startBtn) startBtn.textContent = 'Crawl Again';
    });
  }

  function crawlOne(url, profile) {
    var measureOpts = { settleMs: 2500, maxIx: 4 };
    var attempt;
    if (CWV._serverNoEgress) {
      attempt = Promise.reject(Object.assign(new Error('Server transport skipped.'), { code: 'no_egress' }));
    } else {
      attempt = fetchViaServer(url, profile, null, null).then(function (info) {
        return measurePage(info.pageUrl, profile, { onStage: function () {}, timeout: 60000, qs: 'settle=2500&maxIx=4' }).then(function (payload) {
          return analyzeBundle(payload, { serverInfo: info, sessionMeta: null, profile: profile });
        });
      });
    }
    return attempt.catch(function (e) {
      if (HARD_CODES.indexOf(e.code) >= 0) throw e;
      CWV._serverNoEgress = true;
      var t0 = performance.now();
      return relayFetch(url, null).then(function (res) {
        if (CHALLENGE_RE.test(String(res.html || '').slice(0, 8000))) {
          throw Object.assign(new Error('Bot challenge on this page.'), { code: 'challenge' });
        }
        if (String(res.html || '').length < 200) throw Object.assign(new Error('Relay returned no readable HTML.'), { code: 'unreachable' });
        return measurePage(null, profile, {
          srcdocBuilder: function (nonce) { return buildSrcdoc(res.html, url, profile, nonce, measureOpts); },
          onStage: function () {}, timeout: 60000
        }).then(function (payload) {
          return analyzeBundle(payload, { profile: profile, relayInfo: { requestedUrl: url, finalUrl: url, status: res.status, bytes: res.html.length, relay: res.relay, ms: performance.now() - t0 } });
        });
      });
    }).then(function (report) {
      var v = report.lab.vitals || [];
      function pick(key) {
        var row = v.find(function (r) { return r.key === key; }) || {};
        return row.value == null ? null : { value: row.value, status: row.status };
      }
      var summary = {
        url: url,
        lcp: pick('lcp'), inp: pick('inp'), cls: pick('cls'), fcp: pick('fcp'), ttfb: pick('ttfb'),
        score: report.lab.score && report.lab.score.value != null ? report.lab.score.value : null,
        issues: report.issueCounts || {}
      };
      state.crawl.reports[url] = report;
      return summary;
    });
  }

  /* ---------------- main submit ---------------- */
  function currentProfile() {
    var sel = document.getElementById('cwv-profile');
    var id = sel ? sel.value : 'mobile';
    var p = JSON.parse(JSON.stringify(PROFILES[id] || PROFILES.mobile));
    if (id === 'custom') {
      var w = parseInt(document.getElementById('cwv-cw').value, 10) || 1280;
      var h = parseInt(document.getElementById('cwv-ch').value, 10) || 800;
      p.viewport = { w: Math.max(320, Math.min(2560, w)), h: Math.max(320, Math.min(1800, h)) };
      var net = NETWORKS.find(function (n) { return n.id === (document.getElementById('cwv-net').value || 'none'); }) || NETWORKS[0];
      p.network = net.latencyMs ? { label: net.label, latencyMs: net.latencyMs, downKbps: net.downKbps } : null;
    }
    return p;
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var checked = validateInput(urlInput.value);
    if (!checked.ok) {
      out.innerHTML = '<div class="paper paper-padded cwv-error"><span class="material-icons" aria-hidden="true">error</span><b>' + esc(checked.message) + '</b></div>';
      return;
    }
    var url = checked.url;
    var profile = currentProfile();
    var alsoOther = document.getElementById('cwv-both') && document.getElementById('cwv-both').checked;
    var profiles = [profile];
    if (alsoOther) {
      var otherId = profile.id === 'desktop' ? 'mobile' : 'desktop';
      profiles.push(JSON.parse(JSON.stringify(PROFILES[otherId])));
    }
    state = { reports: {}, order: [], crawl: null, currentProfile: null };
    CWV._internalLinks = null;

    var run = Promise.resolve();
    profiles.forEach(function (p) {
      run = run.then(function () {
        progressUI('Starting the ' + p.label + ' lab run…');
        return runProfile(url, p, null).then(function (res) {
          state.reports[p.id] = res.report;
          state.order.push(p.id);
          state.currentProfile = state.currentProfile || p.id;
          if (res.note && res.note.fallback) toast('Browser-direct measurement used (the server could not reach the site directly).');
        });
      });
    });
    run.then(function () {
      if (!state.order.length) return;
      if (CWV._internalLinks && CWV._internalLinks.length) {
        state.crawl = { queue: CWV._internalLinks.slice(0, 100), summaries: [], reports: {}, worst: [], compare: [], sortKey: 'score', filter: 'all', running: false };
      }
      renderAll();
    }, function (e) {
      out.innerHTML = '<div class="paper paper-padded cwv-error"><span class="material-icons" aria-hidden="true">error_outline</span><b>' + esc((e && e.message) || 'The audit failed.') + '</b>' +
        '<p class="muted">' + (e && e.code === 'cancelled' ? 'Cancelled.' : 'Check the URL, then try again. Both measurement transports were attempted (server proxy, then your browser via public relays). Sites behind bot protection or with unreachable servers cannot be measured.') + '</p>' +
        '<button class="btn" type="button" onclick="location.reload()">Try Again</button></div>';
    });
  });

  // Profile select → custom fields visibility
  var profileSel = document.getElementById('cwv-profile');
  if (profileSel) {
    profileSel.addEventListener('change', function () {
      var custom = document.getElementById('cwv-custom-fields');
      if (custom) custom.hidden = profileSel.value !== 'custom';
    });
  }

  // Prefill from ?url=
  try {
    var q = new URLSearchParams(location.search);
    if (q.get('url')) urlInput.value = q.get('url');
  } catch (e) {}
})();
