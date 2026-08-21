/* Browser fallback for Broken Link Checker — deeply thorough, deterministic, no AI */
(function (global) {
  'use strict';
  var B = global.BrokenLinkBrowserRunner = {};
  var MAX_FETCHES = 200;
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
    // Allow localhost only if explicitly allowed via global? For browser fallback, we allow all public plus localhost for testing if needed
    // But block metadata
    if (/metadata\.google\.internal|169\.254\.169\.254/i.test(u.hostname)) throw err('ssrf', 'Cloud metadata blocked');
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
      // Remove tracking params for dedup but keep for checking? We'll strip tracking for key
      var tracking = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id','gclid','gclsrc','dclid','fbclid','msclkid','mc_cid','mc_eid','igshid','si','_ga','_gl','spm','yclid','wickedid','rb_clickid','srsltid'];
      tracking.forEach(function (k) { u.searchParams.delete(k); });
      // Decode &amp;
      var urlStr = u.toString().replace(/&amp;/g, '&');
      // Re-parse to clean
      var u2 = new URL(urlStr);
      u2.hash = '';
      return { url: u2.toString(), hash: hash, original: raw, fragment: hash ? hash.slice(1) : '' };
    } catch (e) { return null; }
  }

  function hostKey(h) { return String(h || '').toLowerCase().replace(/^www\./, ''); }
  function internal(url, root) {
    try {
      var a = new URL(url).hostname.toLowerCase(), b = new URL(root).hostname.toLowerCase();
      return hostKey(a) === hostKey(b) || a === b || a.endsWith('.' + hostKey(b));
    } catch (e) { return false; }
  }
  function key(url) {
    try {
      var u = new URL(url);
      u.hash = '';
      u.hostname = hostKey(u.hostname);
      var path = u.pathname;
      if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
      u.pathname = path;
      return u.toString().replace(/\/$/, '');
    } catch { return String(url).toLowerCase().replace(/#.*$/, '').replace(/\/$/, ''); }
  }
  function timeout(ms, signal) {
    var c = new AbortController(), t = setTimeout(function () { c.abort(); }, ms || 12000);
    if (signal) signal.addEventListener('abort', function () { c.abort(); }, { once: true });
    return { signal: c.signal, done: function () { clearTimeout(t); } };
  }

  function direct(url, opt) {
    var t = timeout(12000, opt.signal);
    return fetch(url, { redirect: 'follow', signal: t.signal, headers: { accept: opt.accept || 'text/html,application/xhtml+xml,*/*;q=0.8' } }).then(function (r) {
      return r.text().then(function (tx) {
        t.done();
        return { status: r.status, text: tx, finalUrl: r.url || url, headers: { 'content-type': r.headers.get('content-type') || '' }, via: 'direct', ok: r.ok, redirected: r.redirected };
      });
    }).catch(function (e) { t.done(); throw e; });
  }

  function allorigins(url, opt) {
    var t = timeout(14000, opt.signal);
    return fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(url), { signal: t.signal }).then(function (r) { return r.json(); }).then(function (j) {
      t.done();
      return { status: (j.status && j.status.http_code) || 200, text: j.contents || '', finalUrl: (j.status && j.status.url) || url, headers: { 'content-type': (j.status && j.status.content_type) || '' }, via: 'allorigins', ok: true };
    }).catch(function (e) { t.done(); throw e; });
  }

  function corsproxy(url, opt) {
    var t = timeout(14000, opt.signal);
    return fetch('https://corsproxy.io/?url=' + encodeURIComponent(url), { signal: t.signal }).then(function (r) {
      return r.text().then(function (tx) {
        t.done();
        return { status: r.status, text: tx, finalUrl: url, headers: { 'content-type': r.headers.get('content-type') || '' }, via: 'corsproxy', ok: r.ok };
      });
    }).catch(function (e) { t.done(); throw e; });
  }

  function codetabs(url, opt) {
    var t = timeout(14000, opt.signal);
    return fetch('https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(url), { signal: t.signal }).then(function (r) {
      return r.text().then(function (tx) {
        t.done();
        return { status: r.status, text: tx, finalUrl: url, headers: {}, via: 'codetabs', ok: r.ok };
      });
    }).catch(function (e) { t.done(); throw e; });
  }

  var transports = [direct, allorigins, corsproxy, codetabs];

  function challenge(text) {
    return /just a moment|attention required|cf-browser-verification|challenge-platform|cdn-cgi\/challenge|checking your browser|enable javascript and cookies/i.test(String(text || '').slice(0, 8000));
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
        if (r.text && r.text.length > (opt.cap || 1200000)) r.text = r.text.slice(0, opt.cap || 1200000);
        if (challenge(r.text)) { last = { challenge: true }; return attempt(); }
        if (opt.retry !== false && (r.status === 429 || r.status >= 500)) { last = r; return attempt(); }
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
    // <a href> - covers nav, header, footer, breadcrumbs, content, sidebar, related, pagination
    doc.querySelectorAll('a[href]').forEach(function (a) {
      var raw = a.getAttribute('href');
      if (!raw) return;
      var lower = raw.toLowerCase().trim();
      if (lower.startsWith('javascript:') || lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('data:') || lower.startsWith('blob:')) return;
      if (lower.startsWith('#')) return; // same-page anchor
      var n = norm(raw, base);
      if (!n) return;
      links.push({ raw: raw, url: n.url, hash: n.hash, fragment: n.fragment, anchor: (a.textContent || '').trim().slice(0, 120), type: 'a' });
    });
    // <area>
    doc.querySelectorAll('area[href]').forEach(function (a) {
      var raw = a.getAttribute('href');
      var n = norm(raw, base);
      if (n) links.push({ raw: raw, url: n.url, hash: n.hash, fragment: n.fragment, anchor: '', type: 'area' });
    });
    // <link rel=next/prev>
    doc.querySelectorAll('link[rel][href]').forEach(function (l) {
      var rel = (l.getAttribute('rel') || '').toLowerCase();
      if (!/next|prev|alternate/.test(rel) || /canonical/.test(rel)) return;
      var raw = l.getAttribute('href');
      var n = norm(raw, base);
      if (n) links.push({ raw: raw, url: n.url, hash: n.hash, fragment: n.fragment, anchor: rel, type: 'link' });
    });
    // buttons with data-href
    doc.querySelectorAll('button[data-href],button[data-url],button[data-link]').forEach(function (b) {
      var raw = b.getAttribute('data-href') || b.getAttribute('data-url') || b.getAttribute('data-link');
      var n = norm(raw, base);
      if (n) links.push({ raw: raw, url: n.url, hash: n.hash, fragment: n.fragment, anchor: '', type: 'button' });
    });
    // images
    doc.querySelectorAll('img[src],img[data-src]').forEach(function (img) {
      var raw = img.getAttribute('src') || img.getAttribute('data-src');
      var n = norm(raw, base);
      if (n) links.push({ raw: raw, url: n.url, hash: '', fragment: '', anchor: '', type: 'image' });
    });
    // Mark files
    links.forEach(function (l) {
      if (/\.(pdf|doc|docx|xls|xlsx|csv|zip|txt|ppt|pptx)(\?|#|$)/i.test(l.url)) l.type = 'file';
    });
    return links;
  }

  function extractAnchors(html) {
    var ids = new Set();
    var re = /\bid\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi, m;
    while ((m = re.exec(html))) { var id = (m[1] || m[2] || m[3] || '').trim(); if (id) ids.add(id); }
    var re2 = /<a\b[^>]*\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
    while ((m = re2.exec(html))) { var name = (m[1] || m[2] || m[3] || '').trim(); if (name) ids.add(name); }
    return ids;
  }

  function classifyStatus(status, body, error) {
    body = String(body || '').toLowerCase();
    if (status === 200 || status === 204) return { classification: 'Healthy', category: 'healthy', reason: 'OK (' + status + ')' };
    if ([301,302,303,307,308].indexOf(status) >= 0) return { classification: 'Redirect', category: 'redirect', reason: 'Redirect (' + status + ')' };
    if (status === 404) return { classification: 'Confirmed Broken', category: 'broken', reason: '404 Not Found' };
    if (status === 410) return { classification: 'Confirmed Broken', category: 'broken', reason: '410 Gone' };
    if (status === 401) return { classification: 'Authentication Required', category: 'restricted', reason: '401 Authentication Required' };
    if (status === 403) {
      if (body.includes('cloudflare') || body.includes('captcha') || body.includes('bot') || body.includes('challenge')) return { classification: 'Bot Protection / Unable to Verify', category: 'bot_protection', reason: 'Bot protection detected' };
      return { classification: 'Access Forbidden', category: 'restricted', reason: '403 Forbidden - Unable to verify' };
    }
    if (status === 429) return { classification: 'Rate Limited', category: 'rate_limited', reason: '429 Rate Limited' };
    if (status >= 500) return { classification: 'Confirmed Broken', category: 'server_error', reason: 'Persistent server error (' + status + ')' };
    if (!status) {
      if (error && /nxdomain|enotfound/i.test(error)) return { classification: 'Confirmed Broken', category: 'dns_error', reason: 'DNS resolution failed: NXDOMAIN' };
      return { classification: 'Unable to Verify', category: 'unknown', reason: error || 'Unable to verify' };
    }
    return { classification: 'Unknown', category: 'unknown', reason: 'HTTP ' + status };
  }

  function scoreFromStats(stats) {
    var score = 100;
    if (stats.confirmedBrokenInternal) score -= Math.min(40, stats.confirmedBrokenInternal * 5 + Math.round(stats.confirmedBrokenInternal / Math.max(1, stats.totalInternal) * 30));
    if (stats.confirmedBrokenExternal) score -= Math.min(15, stats.confirmedBrokenExternal * 2);
    if (stats.dnsErrors) score -= Math.min(20, stats.dnsErrors * 4);
    if (stats.serverErrors) score -= Math.min(20, stats.serverErrors * 3);
    if (stats.redirectLoops) score -= Math.min(25, stats.redirectLoops * 8);
    if (stats.brokenAnchors) score -= Math.min(10, stats.brokenAnchors * 2);
    return Math.max(0, Math.round(score));
  }

  B.run = async function (body, onProgress) {
    fetches = 0;
    var started = Date.now();
    var root = input(body.url);
    var maxPages = Math.min(Number(body.maxPages) || 500, 1000);
    var maxDepth = body.maxDepth === 'unlimited' ? 10 : Math.min(Number(body.maxDepth) || 5, 10);
    var scanScope = body.scanScope || 'internal+external';
    var checkExternal = body.checkExternal !== false;
    var checkImages = !!body.checkImages;
    var checkDocs = !!body.checkDocuments;
    var checkAnchors = !!body.checkAnchors;

    onProgress({ stage: 'url_validated', message: 'URL validated (browser): ' + root.toString() });
    onProgress({ stage: 'connect', message: 'Connecting via browser...' });

    var home;
    try { home = await get(root.toString(), { signal: body.signal, cap: 1500000 }); }
    catch (e) { throw err(e.code || 'unreachable', e.message); }

    var finalUrl = home.finalUrl || root.toString();
    var origin = new URL(finalUrl).origin;
    onProgress({ stage: 'connected', message: 'Website connected: ' + finalUrl, finalUrl: finalUrl, status: home.status });

    var robots = { exists: false, sitemaps: [], allowed: function () { return true; } };
    try {
      var rr = await get(new URL('/robots.txt', origin).toString(), { signal: body.signal, cap: 300000, retry: false });
      if (rr.status === 200) {
        robots.exists = true;
        var sm = [];
        var re = /^\s*sitemap:\s*(\S+)/gim, m;
        while ((m = re.exec(rr.text))) sm.push(m[1]);
        robots.sitemaps = sm;
        // Parse Allow/Disallow for simple check
        var rules = [];
        rr.text.split(/\r?\n/).forEach(function (line) {
          var mm = line.match(/^\s*(allow|disallow)\s*:\s*(\S*)/i);
          if (mm) rules.push({ type: mm[1].toLowerCase(), path: mm[2] });
        });
        robots.allowed = function (url) {
          try {
            var p = new URL(url).pathname + new URL(url).search;
            var best = null;
            rules.forEach(function (r) {
              if (!r.path) return;
              var esc = r.path.split('*').map(function (x) { return x.replace(/[.+?^${}()|[\]\\]/g, '\\$&'); }).join('.*');
              var re = new RegExp('^' + esc);
              if (re.test(p) && (!best || r.path.length > best.path.length)) best = r;
            });
            return !best || best.type === 'allow';
          } catch { return true; }
        };
      }
    } catch {}
    onProgress({ stage: 'robots_analyzed', message: robots.exists ? 'robots.txt analyzed' : 'No robots.txt found', robots: { exists: robots.exists, sitemaps: robots.sitemaps.length } });

    // Sitemap discovery
    var sitemapCandidates = ['/sitemap.xml','/sitemap_index.xml','/sitemap-index.xml','/wp-sitemap.xml','/sitemap.xml.gz'].map(function (p) { return new URL(p, origin).toString(); }).concat(robots.sitemaps || []);
    var sitemapUrls = [];
    var sitemapFound = [];
    for (var si = 0; si < Math.min(sitemapCandidates.length, 12); si++) {
      try {
        var smRes = await get(sitemapCandidates[si], { signal: body.signal, cap: 2000000, accept: 'application/xml', retry: false });
        if (smRes.status === 200 && /<(urlset|sitemapindex)\b/i.test(smRes.text)) {
          sitemapFound.push(sitemapCandidates[si]);
          var locRe = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi, lm;
          var isIndex = /<sitemapindex\b/i.test(smRes.text);
          var locs = [];
          while ((lm = locRe.exec(smRes.text))) {
            var rawLoc = lm[1].replace(/&amp;/g, '&').trim();
            var n = norm(rawLoc, origin);
            if (n && n.url) locs.push(n.url);
          }
          if (isIndex) {
            // Enqueue child sitemaps
            for (var ci = 0; ci < Math.min(locs.length, 10); ci++) {
              if (sitemapCandidates.indexOf(locs[ci]) === -1) sitemapCandidates.push(locs[ci]);
            }
          } else {
            sitemapUrls.push.apply(sitemapUrls, locs);
          }
        }
      } catch {}
    }
    sitemapUrls = Array.from(new Set(sitemapUrls)).slice(0, 5000);
    onProgress({ stage: 'sitemap_discovered', message: sitemapFound.length ? ('Sitemap discovered (' + sitemapUrls.length + ' URLs from ' + sitemapFound.length + ' sitemaps)') : 'Sitemap discovery completed', sitemaps: sitemapFound.length, sitemapUrls: sitemapUrls.length });

    // Deep crawl
    var queue = [{ url: finalUrl, depth: 0 }];
    var seen = {};
    seen[key(finalUrl)] = 0;
    var pages = [];
    var allLinks = [];
    var discovered = 1;

    // Add sitemap URLs as discovery sources
    sitemapUrls.slice(0, maxPages).forEach(function (u) {
      if (!internal(u, finalUrl)) return;
      var k = key(u);
      if (!seen.hasOwnProperty(k)) {
        seen[k] = 1;
        queue.push({ url: u, depth: 1 });
        discovered++;
      }
    });

    while (queue.length && pages.length < maxPages) {
      if (body.signal && body.signal.aborted) throw err('cancelled', 'Cancelled');
      var item = queue.shift();
      if (!item) break;
      if (item.depth > maxDepth) continue;
      if (!robots.allowed(item.url)) {
        pages.push({ url: item.url, status: 0, blockedByRobots: true, depth: item.depth, html: '', links: [] });
        continue;
      }
      try {
        var res = await get(item.url, { signal: body.signal, cap: 1500000 });
        var links = extractLinks(res.text, res.finalUrl || item.url);
        var isHtml = /html|xml/i.test(res.headers['content-type'] || '') || /<!doctype|<html/i.test(res.text.slice(0, 2000));
        var page = { url: res.finalUrl || item.url, status: res.status, depth: item.depth, html: res.text, links: links, jsHeavy: false };
        // JS heavy detection
        var textOnly = res.text.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').trim();
        page.jsHeavy = textOnly.length < 300 && /<script/i.test(res.text);

        pages.push(page);
        allLinks.push.apply(allLinks, links.map(function (l) { return { source: page.url, depth: item.depth, url: l.url, raw: l.raw, anchor: l.anchor, type: l.type, hash: l.hash, fragment: l.fragment }; }));

        onProgress({ stage: 'crawl', message: pages.length + ' pages scanned, ' + discovered + ' discovered, ' + allLinks.length + ' links found', discovered: discovered, crawled: pages.length, links: allLinks.length, pages: pages.length });

        if (item.depth < maxDepth) {
          links.forEach(function (l) {
            if (l.type === 'image' && !checkImages) return;
            if (l.type === 'file' && !checkDocs) return;
            if (!internal(l.url, finalUrl)) return;
            if (/\.(css|js|mjs|json|xml|woff2?|ttf|eot|less|scss)(\?|#|$)/i.test(l.url)) return;
            var k = key(l.url);
            if (!seen.hasOwnProperty(k)) {
              seen[k] = item.depth + 1;
              queue.push({ url: l.url, depth: item.depth + 1 });
              discovered++;
            }
          });
        }
      } catch (e) {
        pages.push({ url: item.url, status: 0, depth: item.depth, error: e.message, html: '', links: [] });
      }
    }

    onProgress({ stage: 'crawl_done', message: pages.length + ' pages scanned, ' + discovered + ' discovered', discovered: discovered, crawled: pages.length, links: allLinks.length });

    // Normalize & dedup
    var filtered = allLinks;
    if (scanScope === 'internal' || !checkExternal) filtered = allLinks.filter(function (l) { return internal(l.url, finalUrl); });
    if (!checkImages) filtered = filtered.filter(function (l) { return l.type !== 'image'; });
    if (!checkDocuments) filtered = filtered.filter(function (l) { return l.type !== 'file'; });

    var map = {}, dupRefs = 0;
    filtered.forEach(function (l) {
      var k = key(l.url);
      if (map[k]) {
        map[k].occurrences++;
        dupRefs++;
        if (map[k].sources.indexOf(l.source) === -1) map[k].sources.push(l.source);
        map[k].rawOccurrences.push(l);
        if (l.anchor && map[k].anchorTexts.indexOf(l.anchor) === -1) map[k].anchorTexts.push(l.anchor);
      } else {
        map[k] = { key: k, url: l.url, occurrences: 1, sources: [l.source], anchorTexts: l.anchor ? [l.anchor] : [], types: [l.type], rawOccurrences: [l], firstSeen: l.source, originalWithFragment: l.raw, fragment: l.fragment };
      }
    });
    var unique = Object.values(map);
    onProgress({ stage: 'deduplicated', message: unique.length + ' unique destinations, ' + dupRefs + ' duplicate references removed', duplicateRefs: dupRefs, unique: unique.length });

    // Check destinations
    var issues = [];
    var checked = 0;
    var cache = {};

    for (var i = 0; i < unique.length; i++) {
      if (body.signal && body.signal.aborted) throw err('cancelled', 'Cancelled');
      var u = unique[i];
      var resCheck;
      var ck = key(u.url);
      if (cache[ck]) {
        resCheck = cache[ck];
      } else {
        try {
          resCheck = await get(u.url, { signal: body.signal, cap: 600000, retry: false });
        } catch (e) {
          resCheck = { status: 0, text: '', error: e.message, finalUrl: u.url, headers: {} };
        }
        cache[ck] = resCheck;
      }
      checked++;
      if (checked % 3 === 0 || checked === unique.length) {
        onProgress({ stage: 'checking', message: 'Checking links... ' + checked + '/' + unique.length, checked: checked, total: unique.length });
      }

      var cls = classifyStatus(resCheck.status, resCheck.text, resCheck.error);
      var isInt = internal(u.url, finalUrl);
      var linkType = u.types[0] || 'a';

      var anchorIssue = null;
      if (checkAnchors && u.rawOccurrences.some(function (ro) { return ro.fragment; })) {
        var anchors = extractAnchors(resCheck.text || '');
        u.rawOccurrences.forEach(function (ro) {
          var frag = ro.fragment;
          if (frag && !anchors.has(frag)) {
            try { frag = decodeURIComponent(frag); } catch {}
            if (!anchors.has(frag)) {
              anchorIssue = { reason: 'Anchor target not found: #' + ro.fragment, fragment: ro.fragment };
              cls = { classification: 'Broken Anchor', category: 'broken_anchor', reason: 'Anchor target not found: #' + ro.fragment };
            }
          }
        });
      }

      issues.push({
        source: u.firstSeen,
        sources: u.sources,
        destination: u.url,
        url: u.url,
        originalWithFragment: u.originalWithFragment,
        anchorText: u.anchorTexts[0] || '',
        anchorTexts: u.anchorTexts,
        occurrences: u.occurrences,
        rawOccurrences: u.rawOccurrences,
        linkType: linkType,
        isInternal: isInt,
        depth: 0,
        result: { status: resCheck.status, finalUrl: resCheck.finalUrl || u.url, redirects: [], error: resCheck.error, botProtection: null, evidence: [{ status: resCheck.status, error: resCheck.error }] },
        classification: cls,
        redirectAnalysis: { count: resCheck.redirected ? 1 : 0, isLoop: false, issues: [] },
        anchorIssue: anchorIssue,
        finalUrl: resCheck.finalUrl || u.url,
        status: resCheck.status,
        severity: cls.category === 'broken' || cls.category === 'dns_error' || cls.category === 'server_error' || cls.category === 'broken_anchor' ? (isInt ? 'high' : 'medium') : 'low'
      });
    }

    onProgress({ stage: 'checking_done', message: checked + ' destinations checked', checked: checked });

    var confirmedBroken = issues.filter(function (x) { return x.classification.classification === 'Confirmed Broken'; });
    var stats = {
      pagesDiscovered: discovered,
      pagesScanned: pages.length,
      linksDiscovered: allLinks.length,
      uniqueLinks: unique.length,
      totalInternal: allLinks.filter(function (l) { return internal(l.url, finalUrl); }).length,
      totalExternal: allLinks.filter(function (l) { return !internal(l.url, finalUrl); }).length,
      checkedLinks: checked,
      confirmedBroken: confirmedBroken.length,
      confirmedBrokenInternal: confirmedBroken.filter(function (x) { return x.isInternal; }).length,
      confirmedBrokenExternal: confirmedBroken.filter(function (x) { return !x.isInternal; }).length,
      redirects: issues.filter(function (x) { return x.classification.category === 'redirect'; }).length,
      blocked: issues.filter(function (x) { var c = x.classification.category; return c === 'restricted' || c === 'bot_protection' || c === 'rate_limited'; }).length,
      timeouts: 0,
      dnsErrors: issues.filter(function (x) { return x.classification.category === 'dns_error'; }).length,
      sslErrors: 0,
      anchorErrors: issues.filter(function (x) { return x.classification.category === 'broken_anchor'; }).length,
      serverErrors: issues.filter(function (x) { return x.classification.category === 'server_error'; }).length,
      redirectLoops: 0,
      longRedirectChains: 0,
      brokenAnchors: issues.filter(function (x) { return x.classification.category === 'broken_anchor'; }).length,
      duplicateRefs: dupRefs,
      durationMs: Date.now() - started
    };

    var report = {
      inputUrl: root.toString(),
      finalUrl: finalUrl,
      settings: { maxPages: maxPages, maxDepth: maxDepth === 10 ? 'Unlimited' : maxDepth, checkExternal: checkExternal, checkImages: checkImages, checkDocuments: checkDocs, checkAnchors: checkAnchors, scanScope: scanScope, respectRobots: true },
      stats: stats,
      issues: issues,
      byCategory: {},
      byClassification: {},
      severity: { critical: 0, high: confirmedBroken.filter(function (x) { return x.isInternal; }).length, medium: confirmedBroken.filter(function (x) { return !x.isInternal; }).length, low: issues.length - confirmedBroken.length },
      score: { score: scoreFromStats(stats), grade: scoreFromStats(stats) >= 90 ? 'Excellent' : scoreFromStats(stats) >= 70 ? 'Good' : scoreFromStats(stats) >= 50 ? 'Needs Improvement' : 'Poor', breakdown: [], explanation: 'Score from browser fallback crawl. Internal broken links penalized most. This is an internal diagnostic score, not a Google score.' },
      sitemapIssues: [],
      canonicalIssues: [],
      pagesDetail: pages.map(function (p) { return { url: p.url, status: p.status, depth: p.depth, jsHeavy: !!p.jsHeavy, linkCount: p.links ? p.links.length : 0 }; }),
      limitedCrawlability: pages.some(function (p) { return p.jsHeavy; }),
      browserFallback: true,
      generatedAt: new Date().toISOString()
    };

    onProgress({ stage: 'done', message: 'Scan Complete (browser fallback)', report: { stats: stats, score: report.score.score } });
    return report;
  };
})(window);
