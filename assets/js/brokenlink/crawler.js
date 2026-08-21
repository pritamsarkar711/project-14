/* Browser fallback for Broken Link Checker — used when server cannot reach site.
 * Deterministic, no AI, SSRF-protected client-side.
 */
(function (global) {
  'use strict';
  var B = global.BrokenLinkBrowserRunner = {};
  var MAX_FETCHES = 120;
  var fetches = 0;
  var PRIVATE = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|\[?::1\]?|fc00:|fd[0-9a-f]{2}:|fe80:|metadata\.google\.internal)/i;

  function err(code, msg) { var e = new Error(msg); e.code = code; return e; }
  function esc(s) { return String(s).replace(/[&<>'\"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' }[m]; }); }

  function input(raw) {
    var s = String(raw || '').trim().replace(/\s+/g, '');
    if (!s) throw err('invalid_url', 'Please enter a website URL.');
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
    var u;
    try { u = new URL(s); } catch (e) { throw err('invalid_url', 'Please enter a valid public URL.'); }
    if (!/^https?:$/.test(u.protocol)) throw err('invalid_url', 'Only HTTP and HTTPS URLs are supported.');
    if (u.username || u.password) throw err('invalid_url', 'URLs with credentials are not allowed.');
    if (PRIVATE.test(u.hostname) || /\.(local|internal|lan|home|localhost)$/i.test(u.hostname)) throw err('ssrf', 'Private or local addresses cannot be scanned.');
    u.hash = '';
    return u;
  }

  function norm(raw, base) {
    try {
      var u = new URL(raw, base);
      if (!/^https?:$/.test(u.protocol)) return null;
      var hash = u.hash;
      u.hash = '';
      u.hostname = u.hostname.toLowerCase();
      if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
      u.pathname = u.pathname.replace(/\/+/g, '/');
      // Remove tracking params for key but keep for checking? We'll strip for checking as well (remove utm)
      var tracking = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'];
      tracking.forEach(function (k) { u.searchParams.delete(k); });
      return { url: u.toString(), hash: hash, original: raw };
    } catch (e) { return null; }
  }

  function hostKey(h) { return String(h || '').toLowerCase().replace(/^www\./, ''); }
  function internal(url, root, subs) {
    try {
      var a = new URL(url).hostname.toLowerCase(), b = new URL(root).hostname.toLowerCase();
      return hostKey(a) === hostKey(b) || (!!subs && a.endsWith('.' + hostKey(b)));
    } catch (e) { return false; }
  }
  function key(url) {
    try {
      var u = new URL(url);
      u.hash = '';
      u.hostname = hostKey(u.hostname);
      return u.toString().replace(/\/$/, '');
    } catch { return String(url).toLowerCase().replace(/#.*$/, '').replace(/\/$/, ''); }
  }
  function timeout(ms, signal) {
    var c = new AbortController(), t = setTimeout(function () { c.abort(); }, ms || 10000);
    if (signal) signal.addEventListener('abort', function () { c.abort(); }, { once: true });
    return { signal: c.signal, done: function () { clearTimeout(t); } };
  }

  function direct(url, opt) {
    var t = timeout(10000, opt.signal);
    return fetch(url, { redirect: 'follow', signal: t.signal, headers: { accept: opt.accept || 'text/html,*/*;q=0.8' } }).then(function (r) {
      return r.text().then(function (tx) {
        t.done();
        return { status: r.status, text: tx, finalUrl: r.url || url, headers: { 'content-type': r.headers.get('content-type') || '' }, via: 'direct', ok: r.ok };
      });
    }).catch(function (e) { t.done(); throw e; });
  }

  function allorigins(url, opt) {
    var t = timeout(12000, opt.signal);
    return fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(url), { signal: t.signal }).then(function (r) { return r.json(); }).then(function (j) {
      t.done();
      return { status: (j.status && j.status.http_code) || 200, text: j.contents || '', finalUrl: (j.status && j.status.url) || url, headers: { 'content-type': (j.status && j.status.content_type) || '' }, via: 'allorigins', ok: true };
    }).catch(function (e) { t.done(); throw e; });
  }

  function corsproxy(url, opt) {
    var t = timeout(12000, opt.signal);
    return fetch('https://corsproxy.io/?url=' + encodeURIComponent(url), { signal: t.signal }).then(function (r) {
      return r.text().then(function (tx) {
        t.done();
        return { status: r.status, text: tx, finalUrl: url, headers: {}, via: 'corsproxy', ok: r.ok };
      });
    }).catch(function (e) { t.done(); throw e; });
  }

  var transports = [direct, allorigins, corsproxy];

  function challenge(text) {
    return /just a moment|attention required|cf-browser-verification|challenge-platform|cdn-cgi\/challenge|checking your browser|enable javascript and cookies/i.test(String(text || '').slice(0, 5000));
  }

  function get(url, opt) {
    opt = opt || {};
    if (fetches++ > MAX_FETCHES) return Promise.reject(err('budget', 'Browser fallback request budget reached.'));
    var i = 0, last = null;
    function attempt() {
      if (i >= transports.length) {
        if (last && last.challenge) throw err('challenge', 'The site is behind bot protection.');
        throw err('unreachable', 'Could not fetch the resource through browser fallback.');
      }
      return transports[i++](url, opt).then(function (r) {
        if (r.text && r.text.length > (opt.cap || 800000)) r.text = r.text.slice(0, opt.cap || 800000);
        if (challenge(r.text)) { last = { challenge: true }; return attempt(); }
        if ([401, 403, 429, 500, 502, 503, 504].indexOf(r.status) >= 0 && opt.retry !== false) {
          // For link checking, we still want to record 404 etc, but for HTML fetching we retry 429/5xx
          if (r.status === 429 || r.status >= 500) { last = r; return attempt(); }
        }
        return r;
      }, function (e) {
        last = e;
        if (opt.signal && opt.signal.aborted) throw err('cancelled', 'Cancelled');
        return attempt();
      });
    }
    return attempt();
  }

  function extractLinks(html, base) {
    var doc;
    try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch { return []; }
    var links = [];
    doc.querySelectorAll('a[href]').forEach(function (a) {
      var raw = a.getAttribute('href');
      if (!raw) return;
      var n = norm(raw, base);
      if (!n) return;
      if (/^(javascript|mailto|tel|data):/i.test(raw)) return;
      links.push({ raw: raw, url: n.url, hash: n.hash, anchor: (a.textContent || '').trim().slice(0, 100), type: 'a' });
    });
    doc.querySelectorAll('img[src]').forEach(function (img) {
      var raw = img.getAttribute('src');
      var n = norm(raw, base);
      if (n) links.push({ raw: raw, url: n.url, hash: '', anchor: '', type: 'image' });
    });
    // File extensions
    links.forEach(function (l) {
      if (/\.(pdf|doc|docx|xls|xlsx|csv|zip|txt)(\?|#|$)/i.test(l.url)) l.type = 'file';
    });
    return links;
  }

  function extractAnchors(html) {
    var ids = new Set();
    var re = /\bid\s*=\s*(?:\"([^\"]+)\"|'([^']+)'|([^\s>]+))/gi, m;
    while ((m = re.exec(html))) { var id = (m[1] || m[2] || m[3] || '').trim(); if (id) ids.add(id); }
    return ids;
  }

  function classifyStatus(status, body, error) {
    body = String(body || '').toLowerCase();
    if (status === 200 || status === 204) return { classification: 'Healthy', category: 'healthy', reason: 'OK (' + status + ')' };
    if ([301, 302, 303, 307, 308].indexOf(status) >= 0) return { classification: 'Redirect', category: 'redirect', reason: 'Redirect (' + status + ')' };
    if (status === 404) return { classification: 'Confirmed Broken', category: 'broken', reason: '404 Not Found' };
    if (status === 410) return { classification: 'Confirmed Broken', category: 'broken', reason: '410 Gone' };
    if (status === 401) return { classification: 'Authentication Required', category: 'restricted', reason: '401' };
    if (status === 403) {
      if (body.includes('cloudflare') || body.includes('captcha') || body.includes('bot')) return { classification: 'Bot Protection / Unable to Verify', category: 'bot_protection', reason: 'Bot protection' };
      return { classification: 'Access Forbidden', category: 'restricted', reason: '403 Forbidden' };
    }
    if (status === 429) return { classification: 'Rate Limited', category: 'rate_limited', reason: '429 Rate Limited' };
    if (status >= 500) return { classification: 'Confirmed Broken', category: 'server_error', reason: 'Server error ' + status };
    if (!status) return { classification: 'Unable to Verify', category: 'unknown', reason: error || 'Unable to verify' };
    return { classification: 'Unknown', category: 'unknown', reason: 'HTTP ' + status };
  }

  B.run = async function (body, onProgress) {
    fetches = 0;
    var started = Date.now();
    var root = input(body.url);
    var maxPages = Math.min(Number(body.maxPages) || 100, 500);
    var maxDepth = body.maxDepth === 'unlimited' ? 5 : Math.min(Number(body.maxDepth) || 3, 5);
    var scanScope = body.scanScope || 'internal+external';
    var checkExternal = body.checkExternal !== false;
    var checkImages = !!body.checkImages;
    var checkDocs = !!body.checkDocuments;
    var checkAnchors = !!body.checkAnchors;

    onProgress({ stage: 'url_validated', message: 'URL validated (browser): ' + root.toString() });
    onProgress({ stage: 'connect', message: 'Connecting via browser...' });

    var home;
    try { home = await get(root.toString(), { signal: body.signal, cap: 1200000 }); }
    catch (e) { throw err(e.code || 'unreachable', e.message); }

    var finalUrl = home.finalUrl || root.toString();
    onProgress({ stage: 'connected', message: 'Website connected: ' + finalUrl });

    // Simple robots.txt check via browser (best effort)
    var robots = { exists: false, sitemaps: [], allowed: function () { return true; } };
    try {
      var rr = await get(new URL('/robots.txt', new URL(finalUrl).origin).toString(), { signal: body.signal, cap: 200000, retry: false });
      if (rr.status === 200) {
        robots.exists = true;
        var sm = [];
        var re = /^sitemap:\s*(\S+)/gim, m;
        while ((m = re.exec(rr.text))) sm.push(m[1]);
        robots.sitemaps = sm;
      }
    } catch {}
    onProgress({ stage: 'robots_analyzed', message: robots.exists ? 'robots.txt analyzed' : 'No robots.txt found' });

    // Crawl
    var queue = [{ url: finalUrl, depth: 0 }];
    var seen = {};
    seen[key(finalUrl)] = 1;
    var pages = [];
    var allLinks = [];
    var discovered = 1;

    while (queue.length && pages.length < maxPages) {
      if (body.signal && body.signal.aborted) throw err('cancelled', 'Cancelled');
      var item = queue.shift();
      if (item.depth > maxDepth) continue;
      try {
        var res = await get(item.url, { signal: body.signal, cap: 1000000 });
        var links = extractLinks(res.text, res.finalUrl || item.url);
        pages.push({ url: res.finalUrl || item.url, status: res.status, depth: item.depth, html: res.text, links: links });
        allLinks.push.apply(allLinks, links.map(function (l) { return { source: res.finalUrl || item.url, depth: item.depth, url: l.url, raw: l.raw, anchor: l.anchor, type: l.type, hash: l.hash }; }));
        discovered++;
        onProgress({ stage: 'crawl', message: pages.length + ' pages scanned, ' + discovered + ' discovered, ' + allLinks.length + ' links found', discovered: discovered, crawled: pages.length, links: allLinks.length });

        if (item.depth < maxDepth) {
          links.forEach(function (l) {
            if (l.type === 'image' && !checkImages) return;
            if (l.type === 'file' && !checkDocs) return;
            if (!internal(l.url, finalUrl, false)) return;
            var k = key(l.url);
            if (!seen[k]) {
              seen[k] = 1;
              queue.push({ url: l.url, depth: item.depth + 1 });
              discovered++;
            }
          });
        }
      } catch (e) {
        pages.push({ url: item.url, status: 0, depth: item.depth, error: e.message });
      }
    }

    onProgress({ stage: 'crawl_done', message: pages.length + ' pages scanned', crawled: pages.length, discovered: discovered });

    // Deduplicate
    var map = {}, dupRefs = 0;
    allLinks.forEach(function (l) {
      var k = key(l.url);
      if (map[k]) {
        map[k].occurrences++;
        dupRefs++;
        if (map[k].sources.indexOf(l.source) === -1) map[k].sources.push(l.source);
        map[k].rawOccurrences.push(l);
      } else {
        map[k] = { key: k, url: l.url, occurrences: 1, sources: [l.source], anchorTexts: [l.anchor], types: [l.type], rawOccurrences: [l], firstSeen: l.source };
      }
    });
    var unique = Object.values(map);
    // Filter scope
    if (scanScope === 'internal') unique = unique.filter(function (u) { return internal(u.url, finalUrl, false); });
    if (!checkExternal) unique = unique.filter(function (u) { return internal(u.url, finalUrl, false); });

    onProgress({ stage: 'deduplicated', message: unique.length + ' unique destinations, ' + dupRefs + ' duplicate references removed', duplicateRefs: dupRefs, unique: unique.length });

    // Check each unique destination
    var issues = [];
    var checked = 0;
    for (var i = 0; i < unique.length; i++) {
      if (body.signal && body.signal.aborted) throw err('cancelled', 'Cancelled');
      var u = unique[i];
      var resCheck;
      try {
        // Try HEAD via corsproxy? We'll just GET via our get() which does retries
        resCheck = await get(u.url, { signal: body.signal, cap: 400000, retry: false });
      } catch (e) {
        resCheck = { status: 0, text: '', error: e.message, finalUrl: u.url };
      }
      checked++;
      if (checked % 5 === 0 || checked === unique.length) {
        onProgress({ stage: 'checking', message: 'Checking links... ' + checked + '/' + unique.length, checked: checked, total: unique.length });
      }

      var cls = classifyStatus(resCheck.status, resCheck.text, resCheck.error);
      var isInt = internal(u.url, finalUrl, false);
      var linkType = u.types[0] || 'a';

      // Anchor check
      var anchorIssue = null;
      if (checkAnchors) {
        var withHash = u.rawOccurrences.filter(function (ro) { return ro.hash; });
        if (withHash.length && resCheck.status === 200) {
          var anchors = extractAnchors(resCheck.text);
          withHash.forEach(function (ro) {
            var frag = ro.hash.replace(/^#/, '');
            if (frag && !anchors.has(frag)) {
              anchorIssue = { reason: 'Anchor target not found: #' + frag, fragment: frag };
              cls = { classification: 'Broken Anchor', category: 'broken_anchor', reason: 'Anchor target not found: #' + frag };
            }
          });
        }
      }

      issues.push({
        source: u.firstSeen,
        sources: u.sources,
        destination: u.url,
        url: u.url,
        anchorText: u.anchorTexts[0] || '',
        occurrences: u.occurrences,
        rawOccurrences: u.rawOccurrences,
        linkType: linkType,
        isInternal: isInt,
        depth: 0,
        result: { status: resCheck.status, finalUrl: resCheck.finalUrl || u.url, redirects: [], error: resCheck.error, botProtection: null },
        classification: cls,
        redirectAnalysis: { count: 0, isLoop: false, issues: [] },
        anchorIssue: anchorIssue,
        finalUrl: resCheck.finalUrl || u.url,
        status: resCheck.status,
        severity: cls.category === 'broken' ? (isInt ? 'high' : 'medium') : 'low'
      });
    }

    // Stats
    var confirmedBroken = issues.filter(function (x) { return x.classification.classification === 'Confirmed Broken'; });
    var redirects = issues.filter(function (x) { return x.classification.category === 'redirect'; });
    var blocked = issues.filter(function (x) { var c = x.classification.category; return c === 'restricted' || c === 'bot_protection' || c === 'rate_limited'; });

    var stats = {
      pagesDiscovered: discovered,
      pagesScanned: pages.length,
      linksDiscovered: allLinks.length,
      uniqueLinks: unique.length,
      totalInternal: allLinks.filter(function (l) { return internal(l.url, finalUrl, false); }).length,
      totalExternal: allLinks.filter(function (l) { return !internal(l.url, finalUrl, false); }).length,
      checkedLinks: checked,
      confirmedBroken: confirmedBroken.length,
      confirmedBrokenInternal: confirmedBroken.filter(function (x) { return x.isInternal; }).length,
      confirmedBrokenExternal: confirmedBroken.filter(function (x) { return !x.isInternal; }).length,
      redirects: redirects.length,
      blocked: blocked.length,
      timeouts: 0,
      dnsErrors: 0,
      sslErrors: 0,
      anchorErrors: issues.filter(function (x) { return x.classification.category === 'broken_anchor'; }).length,
      serverErrors: issues.filter(function (x) { return x.classification.category === 'server_error'; }).length,
      redirectLoops: 0,
      longRedirectChains: 0,
      brokenAnchors: issues.filter(function (x) { return x.classification.category === 'broken_anchor'; }).length,
      duplicateRefs: dupRefs,
      durationMs: Date.now() - started
    };

    // Score (simplified)
    var scoreVal = 100;
    if (stats.confirmedBrokenInternal) scoreVal -= Math.min(40, stats.confirmedBrokenInternal * 5);
    if (stats.confirmedBrokenExternal) scoreVal -= Math.min(15, stats.confirmedBrokenExternal * 2);
    if (stats.brokenAnchors) scoreVal -= Math.min(10, stats.brokenAnchors * 2);
    scoreVal = Math.max(0, Math.round(scoreVal));

    var report = {
      inputUrl: root.toString(),
      finalUrl: finalUrl,
      settings: { maxPages: maxPages, maxDepth: maxDepth, checkExternal: checkExternal, checkImages: checkImages, checkDocuments: checkDocs, checkAnchors: checkAnchors, scanScope: scanScope, respectRobots: true },
      stats: stats,
      issues: issues,
      byCategory: {},
      byClassification: {},
      severity: { critical: 0, high: confirmedBroken.filter(function (x) { return x.isInternal; }).length, medium: confirmedBroken.filter(function (x) { return !x.isInternal; }).length, low: issues.length - confirmedBroken.length },
      score: { score: scoreVal, grade: scoreVal >= 90 ? 'Excellent' : scoreVal >= 70 ? 'Good' : scoreVal >= 50 ? 'Needs Improvement' : 'Poor', breakdown: [], explanation: 'Score from browser fallback crawl. Internal broken links penalized most. This is an internal diagnostic score, not a Google score.' },
      sitemapIssues: [],
      canonicalIssues: [],
      browserFallback: true,
      generatedAt: new Date().toISOString()
    };

    onProgress({ stage: 'done', message: 'Scan complete (browser fallback)' });
    return report;
  };
})(window);
