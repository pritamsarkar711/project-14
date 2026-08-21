/* LLMs.txt Generator — browser fallback.
 * Used only when the server cannot reach the site (e.g. sandboxed egress).
 * The visitor's browser fetches the pages through public read-only relays,
 * parses metadata with DOMParser, then POSTs the collected data to
 * /api/llmstxt-browser which runs the identical server-side analysis. */
(function (global) {
  'use strict';
  var B = global.LlmstxtBrowserRunner = {};
  var RETRY = [401, 403, 429, 500, 502, 503, 504];
  var MAX_FETCHES = 90;
  var fetches = 0;
  var PRIVATE = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|\[?::1\]?|fc00:|fd[0-9a-f]{2}:|fe80:|metadata\.google\.internal)/i;

  function err(code, msg) { var e = new Error(msg); e.code = code; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }

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
      u.hash = ''; u.hostname = u.hostname.toLowerCase();
      if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
      stripTracking(u);
      return u.toString();
    } catch (e) { return null; }
  }
  var TRACK = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'gclid', 'fbclid', 'msclkid', 'dclid', 'gbraid', 'wbraid', 'mc_cid', 'mc_eid', 'igshid', 'srsltid', 'mkt_tok'];
  function stripTracking(u) { if (!u.search) return; TRACK.forEach(function (k) { u.searchParams.delete(k); }); }

  function hostKey(h) { return String(h || '').toLowerCase().replace(/^www\./, ''); }
  function internal(url, root, subs) {
    try { var a = new URL(url).hostname.toLowerCase(), b = new URL(root).hostname.toLowerCase(); return hostKey(a) === hostKey(b) || (!!subs && a.endsWith('.' + hostKey(b))); }
    catch (e) { return false; }
  }
  function key(url) {
    var u = new URL(url); u.hash = ''; u.hostname = hostKey(u.hostname); stripTracking(u);
    return u.origin.replace(/\/+$/, '') + u.pathname.replace(/\/+$/, '') + u.search;
  }
  function assetExt(url) {
    try { var p = new URL(url).pathname.toLowerCase(); return /\.(css|js|mjs|json|xml|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|eot|otf|mp4|webm|mov|avi|mp3|wav|zip|rar|7z|gz|tar|exe|dmg|apk)([?#]|$)/.test(p) && !/\.pdf([?#]|$)/.test(p); } catch (e) { return false; }
  }
  function isPdfUrl(url) { try { return /\.pdf([?#]|$)/i.test(new URL(url).pathname); } catch (e) { return false; } }

  function timeout(ms, signal) {
    var c = new AbortController(), t = setTimeout(function () { c.abort(); }, ms || 8000);
    if (signal) signal.addEventListener('abort', function () { c.abort(); }, { once: true });
    return { signal: c.signal, done: function () { clearTimeout(t); } };
  }
  function direct(url, opt) {
    var t = timeout(8000, opt.signal);
    return fetch(url, { redirect: 'follow', signal: t.signal, headers: { accept: opt.accept || 'text/html,application/xml,text/xml,*/*;q=0.5' } })
      .then(function (r) { return r.text().then(function (tx) { t.done(); return { status: r.status, text: tx, finalUrl: r.url || url, ct: r.headers.get('content-type') || '' }; }); })
      .catch(function (e) { t.done(); throw e; });
  }
  function allorigins(url, opt) {
    var t = timeout(12000, opt.signal);
    return fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(url), { signal: t.signal })
      .then(function (r) { return r.json(); })
      .then(function (j) { t.done(); return { status: (j.status && j.status.http_code) || 200, text: j.contents || '', finalUrl: (j.status && j.status.url) || url, ct: (j.status && j.status.content_type) || '' }; })
      .catch(function (e) { t.done(); throw e; });
  }
  function alloriginsRaw(url, opt) {
    var t = timeout(12000, opt.signal);
    return fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(url), { signal: t.signal })
      .then(function (r) { return r.text().then(function (tx) { t.done(); return { status: r.status, text: tx, finalUrl: url, ct: r.headers.get('content-type') || '' }; }); })
      .catch(function (e) { t.done(); throw e; });
  }
  function codetabs(url, opt) {
    var t = timeout(12000, opt.signal);
    return fetch('https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(url), { signal: t.signal })
      .then(function (r) { return r.text().then(function (tx) { t.done(); return { status: r.status, text: tx, finalUrl: url, ct: '' }; }); })
      .catch(function (e) { t.done(); throw e; });
  }
  function corsproxy(url, opt) {
    var t = timeout(12000, opt.signal);
    return fetch('https://corsproxy.io/?url=' + encodeURIComponent(url), { signal: t.signal })
      .then(function (r) { return r.text().then(function (tx) { t.done(); return { status: r.status, text: tx, finalUrl: url, ct: '' }; }); })
      .catch(function (e) { t.done(); throw e; });
  }
  function jina(url, opt) {
    var t = timeout(15000, opt.signal);
    return fetch('https://r.jina.ai/' + url, { signal: t.signal, headers: { 'X-Return-Format': 'markdown' } })
      .then(function (r) { return r.text().then(function (tx) { t.done(); return { status: r.status, text: tx, finalUrl: url, ct: 'text/markdown' }; }); })
      .catch(function (e) { t.done(); throw e; });
  }
  var transports = [direct, allorigins, alloriginsRaw, codetabs, corsproxy, jina];

  function challenge(text) { return /just a moment|attention required|cf-browser-verification|challenge-platform|cdn-cgi\/challenge|checking your browser|enable javascript and cookies/i.test(String(text || '').slice(0, 5000)); }
  function get(url, opt) {
    opt = opt || {};
    if (fetches++ > MAX_FETCHES) return Promise.reject(err('budget', 'Browser fallback request budget reached.'));
    var i = 0, last = null;
    function attempt() {
      if (i >= transports.length) { if (last && last.challenge) throw err('challenge', 'The site is behind bot protection.'); throw err('unreachable', 'Could not fetch the resource through browser fallback transports.'); }
      return transports[i++](url, opt).then(function (r) {
        if (r.text && r.text.length > (opt.cap || 900000)) r.text = r.text.slice(0, opt.cap || 900000);
        if (challenge(r.text)) { last = { challenge: true }; return attempt(); }
        if (RETRY.indexOf(r.status) >= 0) { last = r; return attempt(); }
        return r;
      }, function (e) { last = e; if (opt.signal && opt.signal.aborted) throw err('cancelled', 'The crawl was cancelled.'); return attempt(); });
    }
    return attempt();
  }

  function robotsParse(txt) {
    var groups = [], sitemaps = [], cur = null;
    String(txt || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.replace(/#.*/, '').trim(), m = line.match(/^([^:]+):\s*(.*)$/);
      if (!m) return;
      var k = m[1].toLowerCase(), v = m[2].trim();
      if (k === 'sitemap') sitemaps.push(v);
      else if (k === 'user-agent') { if (!cur || cur.rules.length || cur.crawlDelay) { cur = { agents: [v.toLowerCase()], rules: [], crawlDelay: null }; groups.push(cur); } else cur.agents.push(v.toLowerCase()); }
      else if (cur && (k === 'allow' || k === 'disallow')) cur.rules.push({ type: k, path: v });
    });
    function matches(rule, path) {
      if (!rule) return false;
      var p = rule, exact = false;
      if (p.slice(-1) === '$') { exact = true; p = p.slice(0, -1); }
      var re = '^' + p.split('*').map(function (x) { return x.replace(/[.+?^${}()|[\]\\]/g, '\\$&'); }).join('.*');
      var rx = new RegExp(re);
      return exact ? rx.test(path) : rx.test(path);
    }
    return {
      sitemaps: sitemaps,
      allowed: function (url) {
        try {
          var u = new URL(url), path = u.pathname + u.search;
          var matching = groups.filter(function (g) { return g.agents.indexOf('*') >= 0 || g.agents.some(function (a) { return a === 'huvanti-llmstxt'; }); });
          var best = null;
          matching.forEach(function (g) { g.rules.forEach(function (r) { if (matches(r.path, path) && (!best || r.path.length > best.path.length)) best = r; }); });
          return !best || best.type === 'allow';
        } catch (e) { return true; }
      }
    };
  }

  function collapse(s) {
    return String(s == null ? '' : s).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
  }
  function meta(doc, key) {
    var el = doc.querySelector('meta[name="' + key + '"],meta[property="' + key + '"]');
    return el ? collapse(el.getAttribute('content')) : '';
  }
  function headings(doc, tag) {
    return Array.prototype.map.call(doc.querySelectorAll(tag), function (h) { var t = collapse(h.textContent); return t; }).filter(function (t) { return t; });
  }
  function jsonLdTypes(doc) {
    var types = [];
    Array.prototype.forEach.call(doc.querySelectorAll('script[type="application/ld+json"]'), function (s) {
      try { var j = JSON.parse(s.textContent); collect(j); } catch (e) { try { var m = s.textContent.match(/\{[\s\S]*\}/); if (m) collect(JSON.parse(m[0])); } catch (e2) {} }
      function collect(v) {
        if (!v || typeof v !== 'object') return;
        if (v['@type']) { var t = Array.isArray(v['@type']) ? v['@type'] : [v['@type']]; t.forEach(function (x) { if (typeof x === 'string') types.push(x.toLowerCase()); }); }
        if (v['@graph'] && Array.isArray(v['@graph'])) v['@graph'].forEach(collect);
      }
    });
    return types;
  }
  function breadcrumbs(doc) {
    var nav = doc.querySelector('nav[aria-label*="breadcrumb" i],nav.breadcrumb,ol.breadcrumb,ul.breadcrumb');
    if (!nav) return [];
    return Array.prototype.map.call(nav.querySelectorAll('li'), function (li) { return collapse(li.textContent); }).filter(Boolean);
  }
  function bodyText(doc) {
    var root = doc.body;
    var clone = root ? root.cloneNode(true) : null;
    if (clone) {
      ['script', 'style', 'noscript', 'nav', 'aside', 'header', 'footer', 'form'].forEach(function (tag) {
        Array.prototype.forEach.call(clone.querySelectorAll(tag), function (el) { el.remove(); });
      });
      return collapse(clone.textContent);
    }
    return '';
  }
  function paragraphs(doc) {
    var region = doc.querySelector('main') || doc.querySelector('article') || doc.body;
    var out = [];
    if (region) Array.prototype.forEach.call(region.querySelectorAll('p'), function (p) { var t = collapse(p.textContent); if (t.length >= 25) out.push(t); });
    return out;
  }

  function parsePage(html, base) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var links = [], linkObjects = [];
    Array.prototype.forEach.call(doc.querySelectorAll('a[href]'), function (a) {
      var u = norm(a.getAttribute('href'), base);
      if (!u) return;
      links.push(u);
      var nav = !!a.closest('nav');
      var footer = !!a.closest('footer');
      linkObjects.push({ url: u, text: collapse(a.textContent).slice(0, 120), nav: nav, footer: footer });
    });
    Array.prototype.forEach.call(doc.querySelectorAll('link[href]'), function (l) { var u = norm(l.getAttribute('href'), base); if (u) links.push(u); });
    // Markdown link + bare-URL extraction (used when a relay returns clean Markdown).
    var raw = String(html || '');
    var mdRe = /\[([^\]]+)\]\((https?:[^)\s]+|\/[^)\s]+)\)/g;
    var m;
    while ((m = mdRe.exec(raw))) { var mu = norm(m[1], base); if (mu) links.push(mu); }
    raw.replace(/https?:\/\/[^\s)'"<>]+/g, function (u) { var nu = norm(u, base); if (nu) links.push(nu); });
    var canEl = doc.querySelector('link[rel~="canonical"][href]');
    var canonical = canEl ? norm(canEl.getAttribute('href'), base) : null;
    var noindex = Array.prototype.some.call(doc.querySelectorAll('meta[name="robots"],meta[name="googlebot"]'), function (m) { return /noindex/i.test(m.getAttribute('content') || ''); });
    var h1s = headings(doc, 'h1'), h2s = headings(doc, 'h2').slice(0, 20);
    var text = bodyText(doc);
    // Markdown fallback: title/h1 from a leading "# Heading", text from raw body.
    if (!doc.title || doc.title === '') {
      var mdH = (raw.match(/^#\s+([^\n]+)/m) || [])[1];
      if (mdH) doc.title = mdH.trim();
    }
    if (!h1s.length) { var mdH1 = (raw.match(/^#\s+([^\n]+)/m) || [])[1]; if (mdH1) h1s.push(mdH1.trim()); }
    if (!text || text.length < 40) text = collapse(raw.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[#>*_`\-]+/g, ' '));
    var wc = (text.match(/[\p{L}\p{N}'-]+/gu) || []).length;
    return {
      links: Array.from(new Set(links)), linkObjects: linkObjects,
      title: doc.title || '', metaDescription: meta(doc, 'description'),
      ogTitle: meta(doc, 'og:title'), ogDescription: meta(doc, 'og:description'),
      ogType: meta(doc, 'og:type'), ogSiteName: meta(doc, 'og:site_name'),
      canonical: canonical, noindex: noindex, h1: h1s[0] || '', h2: h2s,
      types: jsonLdTypes(doc), breadcrumbs: breadcrumbs(doc), text: text,
      wordCount: wc, paragraphs: paragraphs(doc),
      publishedDate: meta(doc, 'article:published_time') || meta(doc, 'og:article:published_time') || '',
      modifiedDate: meta(doc, 'article:modified_time') || meta(doc, 'og:article:modified_time') || ''
    };
  }

  function locs(xml, base) {
    return Array.from(String(xml || '').matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)).map(function (m) { return norm(m[1].replace(/&amp;/g, '&').trim(), base); }).filter(Boolean);
  }
  function discover(origin, robots, opt) {
    var candidates = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml', '/wp-sitemap.xml'].map(function (p) { return new URL(p, origin).toString(); }).concat(robots.sitemaps || []);
    var out = [];
    var seen = {};
    return candidates.reduce(function (pr, u) {
      return pr.then(function () {
        if (seen[u]) return; seen[u] = 1;
        return get(u, { accept: 'application/xml,text/xml,*/*', cap: 1200000, signal: opt.signal }).then(function (r) {
          if (r.status === 200 && /<(urlset|sitemapindex)\b/i.test(r.text)) {
            var isIndex = /<sitemapindex\b/i.test(r.text);
            var urls = locs(r.text, u);
            if (isIndex) {
              urls.slice(0, 20).forEach(function (child) { if (!seen[child]) candidates.push(child); });
            } else {
              out.push({ url: u, isIndex: false, count: urls.length, urls: urls });
            }
          }
        }, function () {});
      });
    }, Promise.resolve()).then(function () { return out; });
  }

  function detectPlatform(html) {
    var b = String(html || '').slice(0, 200000), found = [];
    if (/wp-content\/|\/wp-includes\/|<meta[^>]+generator[^>]+WordPress/i.test(b)) found.push('WordPress');
    if (/cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i.test(b)) found.push('Shopify');
    if (/__NEXT_DATA__|_next\/static/i.test(b)) found.push('Next.js');
    if (/drupal|Drupal\.settings/i.test(b)) found.push('Drupal');
    if (/joomla|Joomla!/i.test(b)) found.push('Joomla');
    if (/webflow|data-wf-site/i.test(b)) found.push('Webflow');
    if (/laravel_session|XSRF-TOKEN/i.test(b)) found.push('Laravel');
    return found;
  }

  B.run = async function (body, onProgress) {
    fetches = 0;
    var opt = { signal: body.signal };
    var root = input(body.url);
    // The browser fallback is deliberately bounded: relay fetches are far slower
    // than a direct crawl, so we keep the page budget small but useful.
    var maxPages = Math.min(Number(body.maxPages) || 500, 60);
    var depth = body.maxDepth === 'unlimited' ? 4 : Math.min(Number(body.maxDepth) || 3, 4);
    var subs = !!body.includeSubdomains;
    onProgress({ stage: 'connect', message: 'Fetching pages through your browser (limited to ' + maxPages + ' pages)…' });

    var home = await get(root.toString(), { accept: 'text/html,*/*', cap: 900000, signal: body.signal });
    var finalRoot = norm(home.finalUrl, root.toString()) || root.toString();
    var origin = new URL(finalRoot).origin;

    var robotsTxt = '';
    try { var rb = await get(new URL('/robots.txt', origin).toString(), { accept: 'text/plain,*/*', cap: 250000, signal: body.signal }); if (rb.status === 200) robotsTxt = rb.text; } catch (e) {}
    var robots = robotsParse(robotsTxt);
    if (!robots.allowed(finalRoot)) throw err('robots', 'Crawling restricted by robots.txt.');
    onProgress({ stage: 'robots', message: 'Robots.txt analyzed' });

    var sitemaps = await discover(origin, robots, opt);
    onProgress({ stage: 'sitemaps', message: 'Sitemap discovery completed' });

    var sitemapSet = {};
    sitemaps.forEach(function (s) { s.urls.forEach(function (u) { sitemapSet[key(u)] = 1; }); });

    var queue = [{ url: finalRoot, depth: 0 }];
    var seen = {}; seen[key(finalRoot)] = 1;
    var sitemapUrls = [];
    sitemaps.forEach(function (s) { s.urls.forEach(function (u) { sitemapUrls.push(u); }); });
    sitemapUrls.slice(0, maxPages).forEach(function (u) {
      if (!internal(u, finalRoot, subs)) return;
      var k = key(u); if (!seen[k]) { seen[k] = 1; queue.push({ url: u, depth: 1, fromSitemap: true }); }
    });

    var pages = [];
    var inlinks = {};
    var discovered = Object.keys(seen).length;
    var idx = 0;

    function addInlinks(linkObjects) {
      linkObjects.forEach(function (lo) {
        if (!internal(lo.url, finalRoot, subs)) return;
        var k = key(lo.url);
        var e = inlinks[k] || (inlinks[k] = { count: 0, nav: [], footer: false });
        e.count++;
        if (lo.nav && lo.text && e.nav.indexOf(lo.text) < 0) e.nav.push(lo.text);
        if (lo.footer) e.footer = true;
      });
    }

    function record(p) { pages.push(p); onProgress({ stage: 'crawl', message: pages.length + ' pages analyzed', discovered: discovered, crawled: pages.length }); }

    while (idx < queue.length && pages.length < maxPages) {
      var item = queue[idx++];
      if (!robots.allowed(item.url)) { record({ url: item.url, depth: item.depth, blocked: true, fromSitemap: !!item.fromSitemap, inSitemap: !!item.fromSitemap || !!sitemapSet[key(item.url)] }); continue; }
      var res;
      try { res = await get(item.url, { accept: 'text/html,application/pdf,*/*', cap: 900000, signal: body.signal }); }
      catch (e) { record({ url: item.url, depth: item.depth, status: 0, fromSitemap: !!item.fromSitemap, inSitemap: !!item.fromSitemap || !!sitemapSet[key(item.url)] }); continue; }
      var ct = (res.ct || '').toLowerCase();
      var isHtml = ct.indexOf('text/html') >= 0 || ct === '' || ct === 'text/markdown';
      var isPdf = ct.indexOf('application/pdf') >= 0 || isPdfUrl(item.url);
      if (isHtml) {
        var parsed = parsePage(res.text, res.finalUrl || item.url);
        addInlinks(parsed.linkObjects);
        record({
          url: res.finalUrl || item.url, requestedUrl: item.url, depth: item.depth, status: res.status,
          headers: { 'content-type': res.ct || 'text/html' }, contentType: res.ct || 'text/html',
          title: parsed.title, metaDescription: parsed.metaDescription, ogTitle: parsed.ogTitle, ogDescription: parsed.ogDescription,
          ogType: parsed.ogType, ogSiteName: parsed.ogSiteName, canonical: parsed.canonical, noindex: parsed.noindex,
          h1: parsed.h1, h2: parsed.h2, types: parsed.types, breadcrumbs: parsed.breadcrumbs, text: parsed.text,
          wordCount: parsed.wordCount, paragraphs: parsed.paragraphs, publishedDate: parsed.publishedDate, modifiedDate: parsed.modifiedDate,
          jsHeavy: parsed.text.length < 250, isPdf: false, links: parsed.links, linkObjects: [],
          fromSitemap: !!item.fromSitemap, inSitemap: !!item.fromSitemap || !!sitemapSet[key(item.url)]
        });
        if (item.depth < depth) {
          parsed.links.forEach(function (link) {
            if (queue.length >= maxPages) return;
            if (!internal(link, finalRoot, subs)) return;
            if (!robots.allowed(link)) return;
            if (assetExt(link)) return;
            var k = key(link);
            if (!seen[k]) { seen[k] = 1; queue.push({ url: link, depth: item.depth + 1 }); discovered++; }
          });
        }
      } else {
        record({ url: item.url, depth: item.depth, status: res.status, headers: { 'content-type': res.ct }, contentType: res.ct, isPdf: isPdf, title: '', wordCount: 0, types: [], h2: [], paragraphs: [], breadcrumbs: [], links: [], linkObjects: [], fromSitemap: !!item.fromSitemap, inSitemap: !!item.fromSitemap || !!sitemapSet[key(item.url)] });
      }
    }

    // Attach inlink signals.
    pages.forEach(function (p) {
      if (p.blocked) return;
      var e = inlinks[key(p.canonical || p.url)] || inlinks[key(p.url)];
      p.inlinks = e ? e.count : 0;
      p.navLinked = !!(e && e.nav && e.nav.length);
      p.footerLinked = !!(e && e.footer);
      p.navLabels = e ? e.nav : [];
    });

    onProgress({ stage: 'metadata', message: 'Sending collected data for analysis…' });
    var resp = await fetch('/api/llmstxt-browser', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: finalRoot, options: body, pages: pages, discovered: discovered,
        homeParsed: { metaDescription: '', ogDescription: '', paragraphs: [], title: '', body: home.text || '' },
        platform: detectPlatform(home.text), robots: { exists: !!robotsTxt, sitemaps: robots.sitemaps },
        sitemaps: sitemaps.map(function (s) { return { url: s.url, isIndex: s.isIndex, count: s.count }; }),
        existingLlmsTxt: null
      })
    });
    if (!resp.ok) { var j = null; try { j = await resp.json(); } catch (e) {} throw j || err('error', 'Analysis failed.'); }
    return resp.json();
  };
})(window);
