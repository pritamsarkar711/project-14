/* huvanti WordPress Theme Detector — browser-relay collector.
 *
 * Used when the scanner server cannot reach a website directly (blocked
 * egress, TLS reset, firewall). Collects the same small set of resources the
 * server pipeline would fetch, using the visitor's own connection:
 *   direct fetch first → free public CORS relays as fallback
 *   (identical relay chain to the site's other checkers — no paid APIs).
 *
 * The collected bundle is POSTed to /api/wptheme-analyze where the SAME
 * deterministic detection engine runs. Nothing is detected in the browser
 * beyond URL/path discovery, which needs the raw HTML anyway.
 */
(function (global) {
  'use strict';
  var WP = global.WpThemeCollector = global.WpThemeCollector || {};

  var TIMEOUT = 15000;
  var MAX_HTML = 400000;
  var MAX_TEXT = 300000;
  var MAX_FETCHES = 16;
  var PRIVATE = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|\[?::1\]?$|fc00:|fd[0-9a-f]{2}:|fe80:|metadata\.google\.internal)/i;

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

  /* ---- fetch chain: direct → allorigins → corsproxy → codetabs ---- */
  function fetchOnce(url, opt) {
    opt = opt || {};
    if (fetchCount >= MAX_FETCHES) return Promise.reject(makeError('budget', 'Browser collection budget reached.'));
    fetchCount++;
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, TIMEOUT);
    if (opt.signal) opt.signal.addEventListener('abort', function () { ctrl.abort(); }, { once: true });
    var bytes = 0;
    function ok(text, via, extra) {
      clearTimeout(to);
      extra = extra || {};
      if (text && text.length > (opt.cap || MAX_HTML)) text = text.slice(0, opt.cap || MAX_HTML);
      return { url: url, finalUrl: extra.finalUrl || url, status: extra.status != null ? extra.status : 200, headers: extra.headers || {}, text: text || '', via: via, bytes: (text || '').length };
    }
    return fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { Accept: opt.accept || 'text/html,application/xhtml+xml,*/*;q=0.5' } })
      .then(function (res) {
        return res.text().then(function (text) { return ok(text, 'direct', { status: res.status, finalUrl: res.url || url }); });
      })
      .catch(function () {
        if (opt.signal && opt.signal.aborted) { clearTimeout(to); throw makeError('cancelled', 'Scan cancelled.'); }
        // Free public relays — same chain as the site's other checkers
        return fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(url), { signal: ctrl.signal })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            var h = {};
            if (j.status) {
              if (j.status.content_type) h['content-type'] = j.status.content_type;
              if (j.status.http_code) h[':status'] = String(j.status.http_code);
            }
            return ok(j.contents || '', 'allorigins', { status: (j.status && j.status.http_code) || 200, finalUrl: (j.status && j.status.url) || url, headers: h });
          })
          .catch(function () {
            if (opt.signal && opt.signal.aborted) { clearTimeout(to); throw makeError('cancelled', 'Scan cancelled.'); }
            return fetch('https://corsproxy.io/?url=' + encodeURIComponent(url), { signal: ctrl.signal })
              .then(function (r) { return r.text().then(function (t) { return ok(t, 'corsproxy', { status: r.status }); }); })
              .catch(function () {
                if (opt.signal && opt.signal.aborted) { clearTimeout(to); throw makeError('cancelled', 'Scan cancelled.'); }
                return fetch('https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(url), { signal: ctrl.signal })
                  .then(function (r) { return r.text().then(function (t) { if (/^[A-Za-z ]+Error/i.test(t.slice(0, 80))) throw new Error(t.slice(0, 80)); return ok(t, 'codetabs', { status: r.status }); }); })
                  .catch(function (err) {
                    clearTimeout(to);
                    var m = String((err && err.message) || err || '').toLowerCase();
                    if (/abort/.test(m)) throw makeError('timeout', 'A resource took too long to fetch.');
                    if (/just a moment|cloudflare|challenge/.test(m)) throw makeError('challenge', 'The site appears to be behind a bot challenge.');
                    throw makeError('unreachable', 'Could not fetch ' + url + ' from this browser either.');
                  });
              });
          });
      });
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
    function bumpSlug(raw, patch, example) {
      var m = String(raw || '').match(/\/wp-content\/themes\/([A-Za-z0-9_.-]+)\//);
      if (!m) return null;
      var slug = m[1].toLowerCase();
      if (!/^[a-z0-9][a-z0-9_.-]{0,78}$/.test(slug) || slug.includes('..')) return null;
      var c = get(slug);
      Object.keys(patch).forEach(function (k) { c[k] = patch[k] === true ? true : (c[k] || 0) + patch[k]; });
      if (example && c.examples.length < 4 && c.examples.indexOf(example) < 0) c.examples.push(example);
      return c;
    }
    var html = doc.documentElement ? doc.documentElement.innerHTML : '';
    var re = /\/wp-content\/themes\/([A-Za-z0-9_.-]+)\//g, m;
    while ((m = re.exec(html))) {
      var slug = m[1].toLowerCase();
      if (/^[a-z0-9][a-z0-9_.-]{0,78}$/.test(slug) && !slug.includes('..')) {
        var c = get(slug); c.htmlRefs += 1;
        if (c.examples.length < 4 && c.examples.indexOf(m[0]) < 0) c.examples.push(m[0]);
      }
    }
    Array.prototype.forEach.call(doc.querySelectorAll('link[rel~="stylesheet"]'), function (l) {
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
    Array.prototype.forEach.call(doc.querySelectorAll('script[src]'), function (sc) {
      var href = sc.getAttribute('src') || '';
      var mm = href.match(/\/wp-content\/themes\/([A-Za-z0-9_.-]+)\//);
      if (mm) bumpSlug(href, { jsRef: true }, href);
    });
    (extraTexts || []).forEach(function (txt) {
      var r2 = /\/wp-content\/themes\/([A-Za-z0-9_.-]+)\//g, m2;
      while ((m2 = r2.exec(String(txt || '')))) {
        var s2 = m2[1].toLowerCase();
        if (/^[a-z0-9][a-z0-9_.-]{0,78}$/.test(s2)) { var cc = get(s2); cc.restRef += 1; }
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
    var doc = new DOMParser().parseFromString(String(text || ''), 'text/html');
    // A bot-wall page is not the site
    if (/parse error/i.test(doc.title)) return null;
    return doc;
  }

  function wpVersionFromHtml(html) {
    var m = String(html || '').match(/<meta[^>]+name\s*=\s*["']?generator["']?[^>]*>/i);
    if (!m) return null;
    var c = m[0].match(/content\s*=\s*["']([^"']*)["']/i);
    var vm = c && c[1].match(/wordpress\s+([\d.]+)/i);
    return vm ? vm[1] : null;
  }

  /*
   * Collect the full bundle. Returns a promise for the bundle object that
   * /api/wptheme-analyze understands.
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
    var probes = { rest: null, posts: null, oembed: null };
    var origin = urlObj.origin;
    var home = null;

    function fetchText(u, fo) {
      return fetchOnce(u, Object.assign({ signal: signal }, fo || {})).then(function (res) {
        scanInfo.requests += 1;
        scanInfo.bytes += res.bytes || 0;
        return res;
      });
    }

    function robotsAndHome() {
      onProgress({ stage: 'connect', message: 'Fetching the homepage through your browser…' });
      return fetchText(urlObj.href).then(function (res) {
        if (looksLikeChallenge(res.status, res.text)) throw makeError('challenge', 'The site is protected by a bot challenge and could not be read.');
        if (res.status === 404) throw makeError('not_found', 'The page returned 404 Not Found — check the URL.');
        if (res.status === 401 || res.status === 403) throw makeError('blocked', 'The website blocked the request (HTTP ' + res.status + ').');
        if (res.status === 429) throw makeError('rate_limited_target', 'The website rate-limited the request (HTTP 429).');
        if (res.status >= 500) throw makeError('server_error', 'The website returned a server error (HTTP ' + res.status + ').');
        if (res.status >= 300) throw makeError('unreachable', 'Unexpected HTTP status ' + res.status + '.');
        home = res;
        scanInfo.finalUrl = res.finalUrl || urlObj.href;
        scanInfo.status = res.status;
        try { origin = new URL(scanInfo.finalUrl).origin; } catch (e) {}
        if (res.via !== 'direct') scanInfo.notes.push('Homepage fetched via public relay (' + res.via + ') — exact HTTP headers were not available.');
        if (res.via === 'direct' && res.finalUrl && res.finalUrl !== urlObj.href) scanInfo.notes.push('Redirected to ' + res.finalUrl);
        return fetchText(origin + '/robots.txt', { cap: 64000 }).catch(function () { return null; });
      }).then(function (robotsRes) {
        var robotsText = '';
        if (robotsRes && robotsRes.status === 200 && robotsRes.text && !/^\s*</.test(robotsRes.text)) {
          robotsText = robotsRes.text;
          scanInfo.robots.checked = true;
          var wpPaths = [/wp-admin/i, /wp-content/i, /wp-includes/i].filter(function (re) { return re.test(robotsText); }).length;
          if (wpPaths) scanInfo.robots.notes.push('robots.txt references WordPress paths (' + wpPaths + ' distinct) — supporting signal.');
        }
        return robotsText;
      });
    }

    function wpSignals(robotsText) {
      onProgress({ stage: 'wordpress', message: 'Analysing WordPress signals…' });
      var html = home ? home.text : '';
      var cands = rankCandidates(parseDoc(html) || document.implementation.createHTMLDocument(''), []);
      var hasWpRef = /\/wp-(content|includes|json|admin)\//i.test(html) || /<meta[^>]+generator[^>]+wordpress/i.test(html);
      var doRest = !hasWpRef || !cands.length || (opt.alwaysProbeRest !== false);
      var p = Promise.resolve(null);
      if (doRest) {
        p = fetchText(origin + '/wp-json/', { cap: 262144, accept: 'application/json,*/*;q=0.5' }).then(function (r) {
          if (r.status === 200 && /"namespaces"/.test(r.text)) { probes.rest = { status: r.status, text: r.text }; methodsUsed.push('WordPress REST API'); }
          else if (r.status !== 404) probes.rest = { status: r.status, text: r.text };
          return r;
        }).catch(function () { return null; });
      }
      return p.then(function () { return { robotsText: robotsText, cands0: cands }; });
    }

    function themePhase(ctx) {
      onProgress({ stage: 'theme', message: 'Locating the active theme…' });
      var doc = parseDoc(home.text);
      var cands = ctx.cands0 && ctx.cands0.length ? ctx.cands0 : rankCandidates(doc || document.implementation.createHTMLDocument(''), []);
      var chain = Promise.resolve(cands);
      if (!cands.length) {
        scanInfo.notes.push('No /wp-content/themes/ path in the homepage HTML.');
        chain = fetchText(origin + '/wp-json/wp/v2/posts?per_page=5&_fields=content,link', { cap: 512000, accept: 'application/json,*/*;q=0.5' })
          .then(function (r) {
            if (r.status === 200 && /"content"/.test(r.text.slice(0, 400))) { probes.posts = { status: r.status, text: r.text }; methodsUsed.push('WordPress REST API'); }
            return null;
          }).catch(function () { return null; })
          .then(function () {
            var extra = [];
            if (probes.posts) {
              try {
                var j = JSON.parse(probes.posts.text);
                extra.push((Array.isArray(j) ? j.map(function (p) { return p.content && p.content.rendered || ''; }).join(' ') : ''));
              } catch (e) { extra.push(probes.posts.text); }
            }
            var c2 = rankCandidates(doc || document.implementation.createHTMLDocument(''), extra);
            if (c2.length) return c2;
            return fetchText(origin + '/wp-json/oembed/1.0/embed?url=' + encodeURIComponent(scanInfo.finalUrl), { cap: 131072, accept: 'application/json,*/*;q=0.5' })
              .then(function (r) {
                if (r.status === 200) { probes.oembed = { status: r.status, text: r.text }; methodsUsed.push('WordPress REST API'); }
                var oeExtra = [];
                if (probes.oembed) { try { oeExtra.push(JSON.parse(probes.oembed.text).html || ''); } catch (e) {} }
                return rankCandidates(doc || document.implementation.createHTMLDocument(''), extra.concat(oeExtra));
              }).catch(function () { return c2; });
          });
      }
      return chain.then(function (candidates) {
        if (!candidates.length) return { candidates: [] };
        var cand = candidates[0];
        methodsUsed.push('HTML source analysis', 'CSS URLs', 'JavaScript URLs', 'Enqueued assets');
        // style.css
        onProgress({ stage: 'stylesheet', message: 'Reading the theme stylesheet header…' });
        return fetchText(origin + '/wp-content/themes/' + cand.slug + '/style.css', { cap: 262144, accept: 'text/css,*/*;q=0.1' })
          .catch(function (e) { return { url: '', status: 0, text: '', via: 'error', error: e.code, bytes: 0 }; })
          .then(function (styleRes) {
            var out = { candidates: candidates, cand: cand, themeCssRes: { attempted: true, status: styleRes.status || 0, text: styleRes.text || '', error: styleRes.error } };
            methodsUsed.push('style.css header');
            return out;
          });
      });
    }

    function parentAndCss(phase) {
      if (!phase.cand) return phase;
      var tmpl = null;
      if (phase.themeCssRes && phase.themeCssRes.status === 200 && phase.themeCssRes.text) {
        var mm = phase.themeCssRes.text.match(/^\s*\/\*[\s\S]*?\*\//);
        var tm = mm && mm[0].match(/^\s*Template\ *:\s*(.+)$/mi) || phase.themeCssRes.text.match(/^Template\ *:\s*(.+)$/mi);
        if (tm) tmpl = tm[1].trim().toLowerCase();
      }
      var chain = Promise.resolve(phase);
      if (tmpl && /^[a-z0-9][a-z0-9 _.-]{0,78}$/.test(tmpl) && tmpl.indexOf('..') < 0) {
        onProgress({ stage: 'parent', message: 'Child theme found — reading the parent theme…' });
        phase.templateSlug = tmpl.replace(/ /g, '-');
        chain = fetchText(origin + '/wp-content/themes/' + phase.templateSlug + '/style.css', { cap: 262144, accept: 'text/css,*/*;q=0.1' })
          .then(function (r) { phase.parentCssRes = { attempted: true, status: r.status, text: r.text }; return phase; })
          .catch(function (e) { phase.parentCssRes = { attempted: true, status: 0, text: '', error: e.code }; return phase; });
      }
      return chain.then(function (ph) {
        // main enqueued theme CSS (different from style.css) for fingerprints
        var doc = parseDoc(home.text);
        var mainHref = null;
        if (doc) {
          var links = doc.querySelectorAll('link[rel~="stylesheet"]');
          var slugRe = new RegExp('/wp-content/themes/' + ph.cand.slug.replace(/[^a-z0-9_.-]/gi, '') + '/', 'i');
          for (var i = 0; i < links.length; i++) {
            var href = links[i].getAttribute('href') || '';
            if (slugRe.test(href)) { mainHref = href; if (/\/style\.css/i.test(href)) break; }
          }
        }
        if (!mainHref) return ph;
        var abs = mainHref;
        try { abs = new URL(mainHref, scanInfo.finalUrl).toString(); } catch (e) {}
        if (abs === origin + '/wp-content/themes/' + ph.cand.slug + '/style.css') return ph;
        onProgress({ stage: 'fingerprints', message: 'Matching theme fingerprints…' });
        return fetchText(abs, { cap: 300000, accept: 'text/css,*/*;q=0.1' })
          .then(function (r) {
            if (r.status === 200 && r.text) { ph.mainCss = { url: abs, status: 200, text: r.text }; methodsUsed.push('CSS analysis'); }
            return ph;
          }).catch(function () { return ph; });
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
          return fetchText(d.url, { cap: 2048 }).then(function (r) {
            return { key: d.key, label: d.label, note: d.note, url: d.url, status: r.status, ct: (r.headers && (r.headers['content-type'] || r.headers[':ct'])) || '', text: (r.text || '').slice(0, 2048) };
          }).catch(function (e) {
            return { key: d.key, label: d.label, note: d.note, url: d.url, status: 0, ct: '', text: '', error: e.code || 'error' };
          });
        })).then(function (raw) {
          ph.exposureRaw = raw;
          return ph;
        });
      });
    }

    return robotsAndHome()
      .then(wpSignals)
      .then(function (ctx) { return themePhase(ctx).then(function (phase) { phase.robotsText = ctx.robotsText; return phase; }); })
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
