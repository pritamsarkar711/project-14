/* huvanti WordPress Theme Detector — browser-relay collector.
 *
 * Used when the scanner server cannot reach a website directly (blocked
 * egress, TLS reset, firewall, or the site refusing datacenter IPs).
 * Collects the same small set of resources the server pipeline would fetch,
 * through the visitor's own connection:
 *
 *   direct fetch → free public CORS relays (allorigins → corsproxy → codetabs)
 *
 * Resilience rules (a 403 from ONE path is never a verdict):
 *   - a 401/403/429/5xx response from one relay triggers the next relay —
 *     different relays exit from different IPs and WAF rules differ
 *   - if the live homepage stays blocked, REST (?rest_route=) and robots.txt
 *     are still probed — WordPress can be provable without the homepage
 *   - last resort: a clearly-labelled Wayback Machine snapshot (free, no key)
 *
 * The collected bundle is POSTed to /api/wptheme-analyze where the SAME
 * deterministic detection engine runs.
 */
(function (global) {
  'use strict';
  var WP = global.WpThemeCollector = global.WpThemeCollector || {};

  var TIMEOUT = 15000;
  var MAX_HTML = 400000;
  var MAX_FETCHES = 18;
  var PRIVATE = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|\[?::1\]?$|fc00:|fd[0-9a-f]{2}:|fe80:|metadata\.google\.internal)/i;
  /* Statuses that mean "this path was refused" — try the next transport. */
  var RETRY_STATUSES = [401, 403, 429, 500, 502, 503, 504];

  var fetchCount = 0;

  function makeError(code, msg) { var e = new Error(msg); e.code = code; return e; }

  function normalizeInput(raw) {
    var s = String(raw == null ? '' : raw).trim().replace(/\s+/g, '');
    if (!s) throw makeError('invalid_url', 'Please enter a website URL.');
    if (s.length > 2000) throw makeError('invalid_url', 'That URL is too long.');
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      if (/^(https?|ftp|file|data|javascript):/i.test(s)) throw makeError('invalid_url', 'Only http:// and https:// URLs are supported.');
      s = 'https://' + s;
    }
    var u;
    try { u = new URL(s); } catch (e) { throw makeError('invalid_url', 'Please enter a valid website URL (e.g. https://example.com).'); }
    if (!/^https?:$/.test(u.protocol)) throw makeError('invalid_url', 'Only http:// and https:// URLs are supported.');
    if (u.username || u.password) throw makeError('invalid_url', 'URLs with credentials are not allowed.');
    var host = u.hostname.toLowerCase();
    if (!host || PRIVATE.test(host)) throw makeError('ssrf', 'Private, local or metadata addresses cannot be scanned.');
    if (/\.(local|internal|lan|home|localhost)$/i.test(host)) throw makeError('ssrf', 'Internal hostnames cannot be scanned.');
    if (!host.includes('.')) throw makeError('invalid_url', 'Please enter a full domain such as example.com.');
    u.hash = '';
    return u;
  }

  function withTimeout(signal, cb) {
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, TIMEOUT);
    if (signal) signal.addEventListener('abort', function () { ctrl.abort(); }, { once: true });
    var done = function () { clearTimeout(to); };
    return { ctrl: ctrl, done: done };
  }

  function relayError(err) {
    var m = String((err && err.message) || err || '').toLowerCase();
    if (/abort/.test(m)) return makeError('timeout', 'A resource took too long to fetch.');
    if (/just a moment|cloudflare|challenge|attention required/.test(m)) return makeError('challenge', 'The site appears to be behind a bot challenge.');
    return makeError('unreachable', 'Could not fetch the resource.');
  }

  /* Direct fetch — works when the site sends CORS headers. */
  function fetchDirect(url, opt, signal) {
    var t = withTimeout(signal);
    return fetch(url, { redirect: 'follow', signal: t.ctrl.signal, headers: { Accept: opt.accept || 'text/html,*/*;q=0.5' } })
      .then(function (res) {
        return res.text().then(function (text) { t.done(); return { status: res.status, text: text, via: 'direct', headers: {}, finalUrl: res.url || url, bytes: (text || '').length }; });
      })
      .catch(function (e) { t.done(); throw e; });
  }

  function fetchAllOrigins(url, opt, signal) {
    var t = withTimeout(signal);
    return fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(url), { signal: t.ctrl.signal })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        t.done();
        var code = (j.status && j.status.http_code) || 200;
        var h = {};
        if (j.status && j.status.content_type) h['content-type'] = j.status.content_type;
        return { status: code, text: j.contents || '', via: 'allorigins', headers: h, finalUrl: (j.status && j.status.url) || url, bytes: ((j.contents || '')).length };
      })
      .catch(function (e) { t.done(); throw e; });
  }

  function fetchCorsProxy(url, opt, signal) {
    var t = withTimeout(signal);
    return fetch('https://corsproxy.io/?url=' + encodeURIComponent(url), { signal: t.ctrl.signal })
      .then(function (r) { return r.text().then(function (text) { t.done(); return { status: r.status, text: text, via: 'corsproxy', headers: {}, finalUrl: url, bytes: (text || '').length }; }); })
      .catch(function (e) { t.done(); throw e; });
  }

  function fetchCodetabs(url, opt, signal) {
    var t = withTimeout(signal);
    return fetch('https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(url), { signal: t.ctrl.signal })
      .then(function (r) {
        return r.text().then(function (text) {
          t.done();
          if (/^[A-Za-z ]+Error\b/.test(text.slice(0, 60))) throw new Error(text.slice(0, 60));
          return { status: r.status, text: text, via: 'codetabs', headers: {}, finalUrl: url, bytes: (text || '').length };
        });
      })
      .catch(function (e) { t.done(); throw e; });
  }

  var TRANSPORTS = [fetchDirect, fetchAllOrigins, fetchCorsProxy, fetchCodetabs];

  /*
   * Fetch one URL through every transport until one returns a usable
   * response. "Usable" = not 401/403/429/5xx (those mean the path was
   * refused, so the next transport/IP is worth trying) and not a challenge
   * wall. A 404 is a legitimate answer and is returned immediately.
   */
  function fetchOnce(url, opt) {
    opt = opt || {};
    var cap = opt.cap || MAX_HTML;
    if (fetchCount >= MAX_FETCHES) return Promise.reject(makeError('budget', 'Browser collection budget reached.'));
    fetchCount++;
    var attempts = [];
    var sawChallenge = false;
    var idx = 0;
    function attempt() {
      if (idx >= TRANSPORTS.length) {
        if (sawChallenge) return Promise.reject(makeError('challenge', 'The site is protected by a bot challenge that defeats every transport (direct fetch + public relays).'));
        return Promise.reject(makeError('blocked', 'Every transport was refused (direct fetch + public relays' + (attempts.length ? '; last status ' + attempts[attempts.length - 1].status : '') + ').'));
      }
      var fn = TRANSPORTS[idx++];
      return fn(url, opt, opt.signal).then(function (res) {
        var text = res.text || '';
        if (text.length > cap) text = text.slice(0, cap);
        res.text = text;
        res.bytes = text.length;
        // A challenge wall is a challenge wall whatever status it ships with —
        // remember it and try the next transport/IP.
        if (looksLikeChallenge(res.status, text)) {
          sawChallenge = true;
          attempts.push({ via: res.via, status: res.status });
          if (idx < TRANSPORTS.length) return attempt();
          return Promise.reject(makeError('challenge', 'The site is protected by a bot challenge that defeats every transport (direct fetch + public relays).'));
        }
        if (RETRY_STATUSES.indexOf(res.status) >= 0) {
          attempts.push({ via: res.via, status: res.status });
          return attempt(); // refused on this path → next transport
        }
        return res;
      }, function (err) {
        if (opt.signal && opt.signal.aborted) return Promise.reject(makeError('cancelled', 'Scan cancelled.'));
        attempts.push({ via: 'transport', status: 0, err: relayError(err) });
        return attempt();
      });
    }
    return attempt();
  }

  function looksLikeChallenge(status, text) {
    var body = String(text || '').slice(0, 4000).toLowerCase();
    if (/just a moment|attention required|cf-browser-verification|challenge-platform|cdn-cgi\/challenge|_cf_chl/.test(body)) return true;
    if (/checking your browser before accessing|enable javascript and cookies to continue/i.test(body)) return true;
    return false;
  }

  /* ---- DOM-based candidate ranking (browser advantage: real DOM) ---- */
  function verOf(u) {
    try { var q = new URL(u, location.href).searchParams; return q.get('ver') || q.get('v') || null; } catch (e) { return null; }
  }
  function rankCandidates(doc, extraTexts) {
    var map = {};
    function get(slug) {
      if (!map[slug]) map[slug] = { slug: slug, htmlRefs: 0, stylesheetRef: false, styleCssRef: false, jsRef: false, restRef: 0, firstIndex: 0, examples: [], styleCssHrefVer: null, score: 0 };
      return map[slug];
    }
    var html = doc && doc.documentElement ? doc.documentElement.innerHTML : '';
    var re = /\/wp-content\/themes\/([A-Za-z0-9_.-]+)\//g, m;
    while ((m = re.exec(html))) {
      var slug = m[1].toLowerCase();
      if (/^[a-z0-9][a-z0-9_.-]{0,78}$/.test(slug) && !slug.includes('..')) {
        var c = get(slug); c.htmlRefs += 1;
        if (c.examples.length < 4 && c.examples.indexOf(m[0]) < 0) c.examples.push(m[0]);
      }
    }
    Array.prototype.forEach.call((doc && doc.querySelectorAll ? doc.querySelectorAll('link[rel~="stylesheet"]') : []), function (l) {
      var href = l.getAttribute('href') || '';
      var mm = href.match(/\/wp-content\/themes\/([A-Za-z0-9_.-]+)\//);
      if (!mm) return;
      var s = mm[1].toLowerCase();
      var c = get(s);
      var isStyleCss = /\/style\.css(\?|$)/i.test(href);
      var id = (l.id || '').toLowerCase();
      if (isStyleCss || new RegExp('(^|-)' + s + '(-css|-style-css)$').test(id)) c.styleCssRef = true;
      c.stylesheetRef = true;
      var v = verOf(href);
      if (v && (isStyleCss || !c.styleCssHrefVer)) c.styleCssHrefVer = v;
      if (c.examples.length < 4 && c.examples.indexOf(href) < 0) c.examples.push(href);
    });
    Array.prototype.forEach.call((doc && doc.querySelectorAll ? doc.querySelectorAll('script[src]') : []), function (sc) {
      var href = sc.getAttribute('src') || '';
      var mm = href.match(/\/wp-content\/themes\/([A-Za-z0-9_.-]+)\//);
      if (mm) { var c2 = get(mm[1].toLowerCase()); c2.jsRef = true; }
    });
    (extraTexts || []).forEach(function (txt) {
      var r2 = /\/wp-content\/themes\/([A-Za-z0-9_.-]+)\//g, m2;
      while ((m2 = r2.exec(String(txt || '')))) {
        var s2 = m2[1].toLowerCase();
        if (/^[a-z0-9][a-z0-9_.-]{0,78}$/.test(s2)) { get(s2).restRef += 1; }
      }
    });
    return Object.keys(map).map(function (k) {
      var c = map[k];
      var score = 0;
      if (c.styleCssRef) score += 45;
      if (c.stylesheetRef) score += 15;
      if (c.jsRef) score += 6;
      score += Math.min(c.htmlRefs, 12) * 2;
      score += Math.min(c.restRef, 6) * 2;
      c.score = score;
      return c;
    }).sort(function (a, b) { return b.score - a.score; });
  }

  function imageExists(url, signal) {
    return new Promise(function (resolve) {
      var img = new Image();
      var to = setTimeout(function () { img.src = ''; resolve(false); }, 8000);
      if (signal) signal.addEventListener('abort', function () { clearTimeout(to); resolve(false); }, { once: true });
      img.onload = function () { clearTimeout(to); resolve(true); };
      img.onerror = function () { clearTimeout(to); resolve(false); };
      img.src = url;
    });
  }

  function parseDoc(text) {
    try {
      var doc = new DOMParser().parseFromString(String(text || ''), 'text/html');
      return doc;
    } catch (e) { return null; }
  }

  function emptyDoc() {
    try { return document.implementation.createHTMLDocument('x'); } catch (e) { return null; }
  }

  /*
   * Collect the full bundle for /api/wptheme-analyze.
   */
  WP.collect = function (rawUrl, opt) {
    opt = opt || {};
    var signal = opt.signal;
    var onProgress = opt.onProgress || function () {};
    var started = Date.now();
    var urlObj;
    try { urlObj = normalizeInput(rawUrl); } catch (e) { return Promise.reject(e); }
    fetchCount = 0;

    var scanInfo = {
      url: urlObj.href, finalUrl: null, status: 0, ip: null,
      durationMs: 0, requests: 0, bytes: 0, methods: [], signals: 0,
      robots: { checked: false, notes: [] }, redirects: [], notes: ['Collected through the browser because the scanner server could not reach the site directly.']
    };
    var methodsUsed = ['URL validation', 'Browser-relayed fetch'];
    var probes = { rest: null, restRoute: null, posts: null, oembed: null };
    var origin = urlObj.origin;
    var home = null;
    var homeBlocked = null;   // {status, code} when the live homepage was refused
    var homeArchived = null;  // {timestamp} when discovery used a Wayback snapshot

    function fetchText(u, fo) {
      return fetchOnce(u, Object.assign({ signal: signal }, fo || {})).then(function (res) {
        scanInfo.requests += 1;
        scanInfo.bytes += res.bytes || 0;
        return res;
      });
    }
    function softFetch(u, fo) {
      return fetchText(u, fo).catch(function (e) {
        if (e.code === 'cancelled' || e.code === 'budget') throw e;
        return { url: u, status: 0, text: '', via: 'error', error: e.code, bytes: 0, headers: {} };
      });
    }

    /* ---- homepage (with cross-relay retry inside fetchOnce) ---- */
    function getHome() {
      onProgress({ stage: 'connect', message: 'Fetching the homepage through your browser…' });
      return fetchText(urlObj.href).then(function (res) {
        if (looksLikeChallenge(res.status, res.text)) {
          homeBlocked = { status: res.status, code: 'challenge', message: 'bot challenge page' };
          scanInfo.status = res.status;
          scanInfo.notes.push('Live homepage serves a bot-challenge wall — continuing with other public endpoints.');
          onProgress({ stage: 'connect', message: 'Homepage shows a bot challenge — probing other endpoints…' });
          return null;
        }
        home = res;
        scanInfo.finalUrl = res.finalUrl || urlObj.href;
        scanInfo.status = res.status;
        try { origin = new URL(scanInfo.finalUrl).origin; } catch (e) {}
        if (res.via !== 'direct') scanInfo.notes.push('Homepage fetched via public relay (' + res.via + ') — exact HTTP headers were not available.');
        else if (res.finalUrl && res.finalUrl !== urlObj.href) scanInfo.notes.push('Redirected to ' + res.finalUrl);
        return null;
      }, function (err) {
        if (['cancelled', 'budget', 'invalid_url', 'ssrf'].indexOf(err.code) >= 0) throw err;
        // Homepage refused on every transport — do NOT give up yet.
        homeBlocked = { status: err.code === 'challenge' ? 403 : 403, code: err.code, message: err.message };
        scanInfo.status = 403;
        scanInfo.notes.push('Live homepage refused every automated reader (' + err.message + ') — continuing with other public endpoints.');
        onProgress({ stage: 'connect', message: 'Homepage blocked — probing REST and robots endpoints instead…' });
        return null;
      });
    }

    /* ---- wayback snapshot (clearly-labelled last resort) ---- */
    function tryWayback() {
      if (!homeBlocked) return Promise.resolve(null);
      onProgress({ stage: 'connect', message: 'Trying a public archived snapshot of the homepage…' });
      return fetch('https://archive.org/wayback/available?url=' + encodeURIComponent(urlObj.href), { signal: signal })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var snap = j && j.archived_snapshots && j.archived_snapshots.closest;
          if (!snap || !snap.available || !snap.url) return null;
          return softFetch(snap.url, { cap: MAX_HTML }).then(function (res) {
            if (res.status !== 200 || !res.text || looksLikeChallenge(res.status, res.text)) return null;
            homeArchived = { timestamp: snap.timestamp || '', url: snap.url };
            home = { url: snap.url, finalUrl: scanInfo.finalUrl || urlObj.href, status: 200, text: res.text, via: 'wayback(' + res.via + ')', bytes: res.bytes };
            scanInfo.notes.push('Homepage discovery used an archived snapshot (Wayback Machine' + (snap.timestamp ? ', ' + snap.timestamp.slice(0, 8) : '') + ') because the live site refused readers. Theme details were still read from the LIVE site — the discovered folder may lag behind reality.');
            return home;
          });
        })
        .catch(function () { return null; });
    }

    function robotsAndRest() {
      onProgress({ stage: 'wordpress', message: 'Analysing WordPress signals…' });
      var chain = softFetch(origin + '/robots.txt', { cap: 64000 }).then(function (robotsRes) {
        var robotsText = '';
        if (robotsRes && robotsRes.status === 200 && robotsRes.text && !/^\s*</.test(robotsRes.text)) {
          robotsText = robotsRes.text;
          scanInfo.robots.checked = true;
          var wpPaths = [/wp-admin/i, /wp-content/i, /wp-includes/i].filter(function (re) { return re.test(robotsText); }).length;
          if (wpPaths) scanInfo.robots.notes.push('robots.txt references WordPress paths (' + wpPaths + ' distinct) — supporting signal.');
        } else if (homeBlocked && robotsRes && robotsRes.status === 403) {
          scanInfo.robots.notes.push('robots.txt was also blocked (HTTP 403).');
        }
        return robotsText;
      });
      return chain.then(function (robotsText) {
        var html = home ? home.text : '';
        var hasWpRef = /\/wp-(content|includes|json|admin)\//i.test(html) || /<meta[^>]+generator[^>]+wordpress/i.test(html);
        var doRest = !hasWpRef || opt.alwaysProbeRest !== false;
        if (!doRest) return robotsText;
        return fetchText(origin + '/wp-json/', { cap: 262144, accept: 'application/json,*/*;q=0.5' })
          .then(function (r) {
            if (r.status === 200 && /"namespaces"/.test(r.text)) { probes.rest = { status: r.status, text: r.text }; methodsUsed.push('WordPress REST API'); return robotsText; }
            // ?rest_route= works when pretty permalinks are off / wp-json filtered
            return fetchText(origin + '/?rest_route=', { cap: 262144, accept: 'application/json,*/*;q=0.5' })
              .then(function (r2) {
                if (r2.status === 200 && /"namespaces"/.test(r2.text)) { probes.rest = { status: r2.status, text: r2.text }; methodsUsed.push('WordPress REST API'); }
                return robotsText;
              })
              .catch(function () { return robotsText; });
          })
          .catch(function () { return robotsText; });
      });
    }

    function themePhase(robotsText) {
      onProgress({ stage: 'theme', message: 'Locating the active theme…' });
      var doc = home ? parseDoc(home.text) : null;
      var cands = rankCandidates(doc || emptyDoc(), []);
      var chain = Promise.resolve(cands);
      if (!cands.length) {
        scanInfo.notes.push('No /wp-content/themes/ path in the readable HTML.');
        chain = softFetch(origin + '/wp-json/wp/v2/posts?per_page=5&_fields=content,link', { cap: 512000, accept: 'application/json,*/*;q=0.5' })
          .then(function (r) {
            if (r.status === 200 && /"content"/.test(r.text.slice(0, 400))) { probes.posts = { status: r.status, text: r.text }; methodsUsed.push('WordPress REST API'); }
            var extra = [];
            if (probes.posts) {
              try { var j = JSON.parse(probes.posts.text); extra.push(Array.isArray(j) ? j.map(function (p) { return p.content && p.content.rendered || ''; }).join(' ') : ''); } catch (e) { extra.push(probes.posts.text); }
            }
            var c2 = rankCandidates(doc || emptyDoc(), extra);
            if (c2.length) return c2;
            return softFetch(origin + '/wp-json/oembed/1.0/embed?url=' + encodeURIComponent(scanInfo.finalUrl || urlObj.href), { cap: 131072, accept: 'application/json,*/*;q=0.5' })
              .then(function (r3) {
                if (r3.status === 200) { probes.oembed = { status: r3.status, text: r3.text }; methodsUsed.push('WordPress REST API'); }
                var oeExtra = [];
                if (probes.oembed) { try { oeExtra.push(JSON.parse(probes.oembed.text).html || ''); } catch (e) {} }
                return rankCandidates(doc || emptyDoc(), extra.concat(oeExtra));
              });
          });
      }
      return chain.then(function (candidates) {
        if (!candidates.length) return { candidates: [], robotsText: robotsText };
        var cand = candidates[0];
        methodsUsed.push('HTML source analysis', 'CSS URLs', 'JavaScript URLs', 'Enqueued assets');
        onProgress({ stage: 'stylesheet', message: 'Reading the theme stylesheet header…' });
        return softFetch(origin + '/wp-content/themes/' + cand.slug + '/style.css', { cap: 262144, accept: 'text/css,*/*;q=0.1' })
          .then(function (styleRes) {
            methodsUsed.push('style.css header');
            return { candidates: candidates, cand: cand, themeCssRes: { attempted: true, status: styleRes.status || 0, text: styleRes.text || '', error: styleRes.error }, robotsText: robotsText };
          });
      });
    }

    function parentAndCss(phase) {
      if (!phase.cand) return phase;
      var tmpl = null;
      if (phase.themeCssRes && phase.themeCssRes.status === 200 && phase.themeCssRes.text) {
        var block = phase.themeCssRes.text.slice(0, 16384);
        var open = block.indexOf('/*');
        var close = open >= 0 ? block.indexOf('*/', open) : -1;
        var head = close >= 0 ? block.slice(open + 2, close) : '';
        var tm = head.match(/^\s*Template\s*:\s*(.+)$/mi);
        if (tm) tmpl = tm[1].trim().toLowerCase();
      }
      var chain = Promise.resolve(phase);
      if (tmpl && /^[a-z0-9][a-z0-9 _.-]{0,78}$/.test(tmpl) && tmpl.indexOf('..') < 0) {
        onProgress({ stage: 'parent', message: 'Child theme found — reading the parent theme…' });
        phase.templateSlug = tmpl.replace(/ /g, '-');
        chain = softFetch(origin + '/wp-content/themes/' + phase.templateSlug + '/style.css', { cap: 262144, accept: 'text/css,*/*;q=0.1' })
          .then(function (r) { phase.parentCssRes = { attempted: true, status: r.status, text: r.text || '' }; return phase; });
      }
      return chain.then(function (ph) {
        var doc = home ? parseDoc(home.text) : null;
        var mainHref = null;
        if (doc && doc.querySelectorAll) {
          var links = doc.querySelectorAll('link[rel~="stylesheet"]');
          var slugRe = new RegExp('/wp-content/themes/' + ph.cand.slug.replace(/[^a-z0-9_.-]/gi, '') + '/', 'i');
          for (var i = 0; i < links.length; i++) {
            var href = links[i].getAttribute('href') || '';
            if (slugRe.test(href)) { mainHref = href; if (/\/style\.css/i.test(href)) break; }
          }
        }
        if (!mainHref) return ph;
        var abs = mainHref;
        try { abs = new URL(mainHref, scanInfo.finalUrl || urlObj.href).toString(); } catch (e) {}
        if (abs === origin + '/wp-content/themes/' + ph.cand.slug + '/style.css') return ph;
        onProgress({ stage: 'fingerprints', message: 'Matching theme fingerprints…' });
        return softFetch(abs, { cap: 300000, accept: 'text/css,*/*;q=0.1' })
          .then(function (r) {
            if (r.status === 200 && r.text) { ph.mainCss = { url: abs, status: 200, text: r.text }; methodsUsed.push('CSS analysis'); }
            return ph;
          });
      });
    }

    function screenshotAndExposure(phase) {
      if (!phase.cand) return phase;
      onProgress({ stage: 'fingerprints', message: 'Checking the theme screenshot…' });
      var slug = phase.cand.slug;
      var shotUrl = origin + '/wp-content/themes/' + slug + '/screenshot.png';
      return imageExists(shotUrl, signal).then(function (okShot) {
        if (okShot) { phase.screenshot = { attempted: true, available: true, url: shotUrl }; return phase; }
        if (phase.templateSlug) {
          var pUrl = origin + '/wp-content/themes/' + phase.templateSlug + '/screenshot.png';
          return imageExists(pUrl, signal).then(function (okP) {
            phase.screenshot = okP ? { attempted: true, available: true, url: pUrl, fromParent: true } : { attempted: true, available: false };
            return phase;
          });
        }
        phase.screenshot = { attempted: true, available: false };
        return phase;
      }).then(function (ph) {
        onProgress({ stage: 'exposure', message: 'Checking public theme exposure…' });
        var base = origin + '/wp-content/themes/' + slug + '/';
        var defs = [
          { key: 'readme', label: 'Theme readme.txt', url: base + 'readme.txt', note: 'Development/readme file inside the theme folder.' },
          { key: 'sourcemap', label: 'CSS source map', url: (ph.mainCss ? ph.mainCss.url : base + 'style.css') + '.map', note: 'Source map for the main theme stylesheet.' },
          { key: 'dirindex', label: 'Theme directory listing', url: base, note: 'Whether the web server returns an auto-index of the theme folder.' },
          { key: 'devfile', label: 'Development file exposure (.git)', url: base + '.git/HEAD', note: 'A leftover VCS folder inside the theme directory.' },
          { key: 'changelog', label: 'Changelog file', url: base + 'changelog.txt', note: 'Changelog that may reveal precise versions.' }
        ];
        return Promise.all(defs.map(function (d) {
          return softFetch(d.url, { cap: 2048 }).then(function (r) {
            return { key: d.key, label: d.label, note: d.note, url: d.url, status: r.status, ct: (r.headers && r.headers['content-type']) || '', text: (r.text || '').slice(0, 2048) };
          });
        })).then(function (raw) {
          ph.exposureRaw = raw;
          return ph;
        });
      });
    }

    return getHome()
      .then(tryWayback)
      .then(robotsAndRest)
      .then(themePhase)
      .then(parentAndCss)
      .then(screenshotAndExposure)
      .then(function (phase) {
        onProgress({ stage: 'report', message: 'Analysing the collected evidence…' });
        scanInfo.durationMs = Date.now() - started;
        var bundle = {
          via: 'browser',
          startUrl: scanInfo.url,
          finalUrl: scanInfo.finalUrl || scanInfo.url,
          origin: origin,
          status: scanInfo.status,
          headers: {},
          headersAvailable: false,
          homeHtml: home ? home.text : '',
          homeBlocked: homeBlocked,
          homeArchived: homeArchived,
          robotsText: phase.robotsText || '',
          probes: probes,
          candidates: phase.candidates || [],
          themeCssRes: phase.themeCssRes || null,
          parentCssRes: phase.parentCssRes || null,
          mainCss: phase.mainCss || null,
          screenshot: phase.screenshot || { attempted: false, available: false },
          exposureRaw: phase.exposureRaw || null,
          scanInfo: scanInfo,
          methodsUsed: methodsUsed
        };
        return bundle;
      })
      .catch(function (e) {
        e.scan = scanInfo;
        throw e;
      });
  };
})(window);
