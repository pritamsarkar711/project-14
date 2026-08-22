/* RSS Feed Generator, browser fallback.
 * Used only when the server cannot reach the site (e.g. sandboxed egress).
 * The visitor's browser fetches the pages through public read-only relays,
 * parses metadata with DOMParser (including RSS-specific fields: og:image,
 * article author, JSON-LD headline/date, time[datetime], sanitized article
 * HTML, audio media), then POSTs the collected data to /api/rss-browser
 * which runs the identical server-side analysis. */
(function (global) {
  'use strict';
  var B = global.RssBrowserRunner = {};
  var RETRY = [401, 403, 429, 500, 502, 503, 504];
  var MAX_FETCHES = 90;
  var fetches = 0;
  var PRIVATE = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|\[?:1\]?|fc00:|fd[0-9a-f]{2}:|fe80:|metadata\.google\.internal)/i;
  var ARTICLE_HTML_BUDGET = 900 * 1024;

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
  var transports = [direct, allorigins, alloriginsRaw, codetabs, corsproxy];

  function challenge(text) { return /just a moment|attention required|cf-browser-verification|challenge-platform|cdn-cgi\/challenge|checking your browser|enable javascript and cookies/i.test(String(text || '').slice(0, 5000)); }
  function get(url, opt) {
    opt = opt || {};
    if (fetches++ > MAX_FETCHES) return Promise.reject(err('budget', 'Browser fallback request budget reached.'));
    var CAP = opt.cap || 900000;
    function usable(r) {
      if (!r) return false;
      if (r.text && r.text.length > CAP) r.text = r.text.slice(0, CAP);
      if (challenge(r.text)) return false;
      if (RETRY.indexOf(r.status) >= 0) return false;
      return true;
    }
    /* A direct request is tried first: it is fastest when the site allows it
       and returns the true status and headers. Public relays are then raced
       in parallel so one slow relay can no longer stall the whole crawl. */
    function tryRelays(challenged) {
      if (opt.signal && opt.signal.aborted) return Promise.reject(err('cancelled', 'The crawl was cancelled.'));
      var sub = new AbortController();
      if (opt.signal) opt.signal.addEventListener('abort', function () { sub.abort(); }, { once: true });
      var relays = transports.slice(1);
      var winner = null, remaining = relays.length;
      return new Promise(function (resolve, reject) {
        relays.forEach(function (t) {
          t(url, opt).then(function (r) {
            if (winner || !usable(r)) { if (!winner) throw new Error('not usable'); return; }
            winner = r; sub.abort(); resolve(r);
          }, function () {}).catch(function () { remaining--; if (remaining === 0 && !winner) { sub.abort(); reject(challenged ? err('challenge', 'The site is behind bot protection.') : err('unreachable', 'Could not fetch the resource through the browser fallback relays.')); } });
        });
      });
    }
    return direct(url, opt).then(function (r) {
      if (usable(r)) return r;
      return tryRelays(challenge(r && r.text));
    }, function () { return tryRelays(false); });
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
          var matching = groups.filter(function (g) { return g.agents.indexOf('*') >= 0 || g.agents.some(function (a) { return a === 'huvanti-rss'; }); });
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
    return Array.prototype.map.call(doc.querySelectorAll(tag), function (h) { return collapse(h.textContent); }).filter(function (t) { return t; });
  }
  function jsonLdBlocks(doc) {
    var out = [];
    Array.prototype.forEach.call(doc.querySelectorAll('script[type="application/ld+json"]'), function (s) {
      try { out.push(JSON.parse(s.textContent)); } catch (e) {}
    });
    return out;
  }
  function jsonLdFind(blocks, types, field) {
    function walk(v) {
      if (!v || typeof v !== 'object') return null;
      var t = (Array.isArray(v['@type']) ? v['@type'] : [v['@type']]).map(function (x) { return String(x || '').toLowerCase(); });
      if (t.some(function (x) { return types.indexOf(x) >= 0; }) && v[field] != null) return v[field];
      if (v['@graph'] && Array.isArray(v['@graph'])) for (var i = 0; i < v['@graph'].length; i++) { var r = walk(v['@graph'][i]); if (r != null) return r; }
      return null;
    }
    for (var i = 0; i < blocks.length; i++) { var r = walk(blocks[i]); if (r != null) return r; }
    return null;
  }
  var ARTICLE_TYPES = ['newsarticle', 'blogposting', 'article', 'techarticle', 'review', 'report', 'howto', 'tutorial'];
  function authorName(v) {
    if (v == null) return null;
    if (typeof v === 'string') return collapse(v) || null;
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) { var n = authorName(v[i]); if (n) return n; } return null; }
    if (typeof v === 'object' && typeof v.name === 'string' && v.name.trim()) return collapse(v.name);
    return null;
  }
  function jsonLdImage(v) {
    if (v == null) return null;
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) { var u = jsonLdImage(v[i]); if (u) return u; } return null; }
    if (typeof v === 'object' && typeof v.url === 'string') return v.url;
    return null;
  }
  function breadcrumbs(doc) {
    var nav = doc.querySelector('nav[aria-label*="breadcrumb" i],nav.breadcrumb,ol.breadcrumb,ul.breadcrumb');
    if (!nav) return [];
    return Array.prototype.map.call(nav.querySelectorAll('li'), function (li) { return collapse(li.textContent); }).filter(Boolean);
  }
  function bodyText(doc) {
    var clone = doc.body ? doc.body.cloneNode(true) : null;
    if (clone) {
      ['script', 'style', 'noscript', 'nav', 'aside', 'header', 'footer', 'form'].forEach(function (tag) {
        Array.prototype.forEach.call(clone.querySelectorAll(tag), function (el) { el.remove(); });
      });
      return collapse(clone.textContent);
    }
    return '';
  }
  function articleRegion(doc) {
    return doc.querySelector('article') || doc.querySelector('main') || doc.body;
  }
  function sanitizeArticleHtml(region) {
    var clone = region.cloneNode(true);
    Array.prototype.forEach.call(clone.querySelectorAll('script,style,noscript,form,input,button,select,textarea,label,iframe,object,embed,video,audio,canvas,svg,nav,header,footer,aside'), function (el) { el.remove(); });
    Array.prototype.forEach.call(clone.querySelectorAll('*'), function (el) {
      Array.prototype.forEach.call(el.attributes, function (a) {
        if (/^on/i.test(a.name) || a.name === 'style') el.removeAttribute(a.name);
      });
    });
    Array.prototype.forEach.call(clone.querySelectorAll('a[href],img[src]'), function (el) {
      var u = el.getAttribute('href') || el.getAttribute('src') || '';
      if (/^\s*(javascript|vbscript|data):/i.test(u)) el.removeAttribute(el.tagName === 'IMG' ? 'src' : 'href');
      if (el.tagName === 'A') Array.prototype.forEach.call(el.attributes, function (a) { if (a.name !== 'href') el.removeAttribute(a.name); });
    });
    var html = clone.innerHTML;
    if (html.length > 60000) html = html.slice(0, 60000);
    return html;
  }
  function firstParagraph(region) {
    var ps = Array.prototype.filter.call(region.querySelectorAll('p'), function (p) { return collapse(p.textContent).length >= 40; });
    if (ps.length) return collapse(ps[0].textContent);
    var text = bodyText(document);
    var sentences = text.split(/(?<=[.!?])\s+/).filter(function (s) { return s.length >= 40 && s.length <= 500; });
    return sentences[0] || '';
  }
  function visiblePublishedDate(region) {
    var head = collapse(region ? region.textContent : '').slice(0, 1500);
    var m = head.match(/(?:published|posted|updated|date)\s*(?:on|:)?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?\s+\d{4}|\d{4}-\d{2}-\d{2})/i);
    return m ? m[1] : '';
  }
  function audioUrl(doc, region, base) {
    var el = region ? region.querySelector('audio[src]') : null;
    if (!el) el = region ? region.querySelector('source[src]') : null;
    if (!el) {
      var img = region ? region.querySelector('a[href]') : null;
      if (img && /\.(mp3|m4a|aac|ogg|wav)([?#]|$)/i.test(img.getAttribute('href') || '')) return norm(img.getAttribute('href'), base);
    }
    if (el) { var u = norm(el.getAttribute('src'), base); if (u) return u; }
    return null;
  }

  function parsePage(html, base) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var links = [], linkObjects = [];
    Array.prototype.forEach.call(doc.querySelectorAll('a[href]'), function (a) {
      var u = norm(a.getAttribute('href'), base);
      if (!u) return;
      links.push(u);
      linkObjects.push({ url: u, text: collapse(a.textContent).slice(0, 120), nav: !!a.closest('nav'), footer: !!a.closest('footer') });
    });
    var region = articleRegion(doc);
    var blocks = jsonLdBlocks(doc);
    var ogImage = meta(doc, 'og:image') || meta(doc, 'og:image:url') || meta(doc, 'twitter:image');
    if (!ogImage) ogImage = jsonLdImage(jsonLdFind(blocks, ARTICLE_TYPES, 'image')) || '';
    if (ogImage) ogImage = norm(ogImage, base) || ogImage;
    if (!ogImage) {
      var im = region ? region.querySelector('img') : null;
      if (im) { var su = norm(im.getAttribute('src') || im.getAttribute('data-src') || '', base); if (su) ogImage = su; }
    }
    var author = authorName(jsonLdFind(blocks, ARTICLE_TYPES, 'author')) || meta(doc, 'article:author') || meta(doc, 'author') || '';
    if (!author) {
      var al = region ? region.querySelector('a[rel~="author"]') : null;
      if (al) author = collapse(al.textContent);
    }
    var timeEl = region ? region.querySelector('time[datetime]') : null;
    return {
      links: Array.from(new Set(links)), linkObjects: linkObjects,
      title: doc.title || '', metaDescription: meta(doc, 'description'),
      ogTitle: meta(doc, 'og:title'), ogDescription: meta(doc, 'og:description'),
      ogType: meta(doc, 'og:type'), ogSiteName: meta(doc, 'og:site_name'),
      canonical: (function () { var e = doc.querySelector('link[rel~="canonical"][href]'); return e ? norm(e.getAttribute('href'), base) : null; })(),
      noindex: Array.prototype.some.call(doc.querySelectorAll('meta[name="robots"],meta[name="googlebot"]'), function (m) { return /noindex/i.test(m.getAttribute('content') || ''); }),
      h1: (headings(doc, 'h1') || [''])[0], h2: headings(doc, 'h2').slice(0, 20),
      types: (function () { var t = []; blocks.forEach(function (j) { (function walk(v) { if (!v || typeof v !== 'object') return; if (v['@type']) { (Array.isArray(v['@type']) ? v['@type'] : [v['@type']]).forEach(function (x) { if (typeof x === 'string') t.push(x.toLowerCase()); }); } if (v['@graph']) v['@graph'].forEach(walk); })(j); }); return Array.from(new Set(t)); })(),
      breadcrumbs: (function () { var b = jsonLdFind(blocks, ['breadcrumblist'], 'itemListElement'); if (Array.isArray(b)) return b.map(function (it) { return collapse(it && it.name); }).filter(Boolean); return breadcrumbs(doc); })(),
      text: bodyText(doc),
      wordCount: (bodyText(doc).match(/[\p{L}\p{N}'-]+/gu) || []).length,
      hasArticleTag: !!doc.querySelector('article'),
      headline: jsonLdFind(blocks, ARTICLE_TYPES, 'headline') || '',
      structuredDate: jsonLdFind(blocks, ARTICLE_TYPES, 'datePublished') || '',
      metaPublishedTime: meta(doc, 'article:published_time') || meta(doc, 'og:article:published_time') || '',
      timeDatetime: timeEl ? (timeEl.getAttribute('datetime') || '') : '',
      visibleDate: visiblePublishedDate(region),
      firstParagraph: firstParagraph(region),
      articleAuthor: author,
      ogImage: ogImage,
      articleSection: jsonLdFind(blocks, ARTICLE_TYPES, 'articleSection') || '',
      audioUrl: audioUrl(doc, region, base),
      articleHtml: ''
    };
  }

  function locs(xml, base) {
    var out = [];
    var re = /<url\b[^>]*>([\s\S]*?)<\/url>/gi, m;
    while ((m = re.exec(xml || ''))) {
      var block = m[1];
      var loc = (block.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i) || [])[1];
      var lm = (block.match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i) || [])[1];
      var u = norm(loc && loc.replace(/&amp;/g, '&').trim(), base);
      if (u) out.push({ loc: u, lastmod: lm ? lm.replace(/&amp;/g, '&').trim() : null });
    }
    return out;
  }
  function indexLocs(xml, base) {
    var out = [], re = /<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi, m;
    while ((m = re.exec(xml || ''))) {
      var loc = (m[1].match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i) || [])[1];
      var u = norm(loc && loc.replace(/&amp;/g, '&').trim(), base);
      if (u) out.push(u);
    }
    return out;
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
            if (isIndex) {
              indexLocs(r.text, u).slice(0, 20).forEach(function (child) { if (!seen[child]) candidates.push(child); });
            } else {
              out.push({ url: u, isIndex: false, count: locs(r.text, u).length, urls: locs(r.text, u) });
            }
          }
        }, function () {});
      });
    }, Promise.resolve()).then(function () { return out; });
  }

  function feedCandidates(origin) {
    return ['/feed/', '/feed', '/rss.xml', '/rss', '/feed.xml', '/atom.xml'].map(function (p) { return new URL(p, origin).toString(); });
  }
  function detectFeed(origin, homeHtml, opt) {
    var fromTags = [];
    var re = /<link\b[^>]*>/gi, m;
    while ((m = re.exec(homeHtml || ''))) {
      var tag = m[0];
      if (!/rel\s*=\s*["'][^"']*alternate["']/i.test(tag) || !/rss|atom|xml/i.test(tag)) continue;
      var href = (tag.match(/href\s*=\s*["']([^"']*)["']/i) || [])[1];
      var u = norm(href, new URL(origin).toString() + '/');
      if (u) fromTags.push(u);
    }
    var all = feedCandidates(origin).concat(fromTags);
    var i = 0;
    function next() {
      if (i >= all.length || i >= 6) return { url: null, xml: null };
      var u = all[i++];
      return get(u, { accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*', cap: 1200000, signal: opt.signal })
        .then(function (r) {
          if (r.status === 200 && /<(rss|feed)\b/i.test(r.text.slice(0, 2000))) return { url: u, xml: r.text };
          return next();
        }, function () { return next(); });
    }
    return next();
  }

  function detectPlatform(html) {
    var b = String(html || '').slice(0, 200000), found = [];
    if (/wp-content\/|\/wp-includes\/|<meta[^>]+generator[^>]+WordPress/i.test(b)) found.push('WordPress');
    if (/cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i.test(b)) found.push('Shopify');
    if (/__NEXT_DATA__|_next\/static/i.test(b)) found.push('Next.js');
    if (/drupal|Drupal\.settings/i.test(b)) found.push('Drupal');
    if (/joomla|Joomla!/i.test(b)) found.push('Joomla');
    if (/webflow|data-wf-site/i.test(b)) found.push('Webflow');
    return found;
  }

  /* Sitemap mode: parse the sitemap URL directly, then fetch its URLs. */
  async function runSitemap(body, onProgress) {
    fetches = 0;
    var smUrl = input(body.url);
    var maxPages = Math.min(Number(body.maxPages) || 60, 60);
    onProgress({ stage: 'sitemaps', message: 'Parsing sitemap through your browser…' });
    var smRes = await get(smUrl.toString(), { accept: 'application/xml,text/xml,*/*', cap: 1200000, signal: body.signal });
    if (smRes.status !== 200 || !/<(urlset|sitemapindex)\b/i.test(smRes.text)) {
      throw err('sitemap_invalid', 'The sitemap could not be read as an XML sitemap (HTTP ' + smRes.status + ').');
    }
    var urls = locs(smRes.text, smUrl.toString());
    var origin = smUrl.origin;
    var isIndex = /<sitemapindex\b/i.test(smRes.text);
    if (isIndex || !urls.length) {
      var children = indexLocs(smRes.text, smUrl.toString()).slice(0, 8);
      for (var ci = 0; ci < children.length && urls.length < maxPages; ci++) {
        try {
          var cr = await get(children[ci], { accept: 'application/xml,text/xml,*/*', cap: 1200000, signal: body.signal });
          if (cr.status === 200 && /<urlset\b/i.test(cr.text)) urls = urls.concat(locs(cr.text, children[ci]));
        } catch (e) {}
      }
    }
    var root = new URL('/', origin + '/').toString();
    var homeHtml = '';
    try {
      var home = await get(origin + '/', { accept: 'text/html,*/*', cap: 300000, signal: body.signal });
      if (home.status === 200) homeHtml = home.text;
    } catch (e) {}
    var robotsTxt = '';
    try { var rb = await get(origin + '/robots.txt', { accept: 'text/plain,*/*', cap: 250000, signal: body.signal }); if (rb.status === 200) robotsTxt = rb.text; } catch (e) {}
    var robots = robotsParse(robotsTxt);

    var pages = [];
    var take = urls.slice(0, maxPages);
    onProgress({ stage: 'crawl', message: 'Fetching ' + take.length + ' sitemap URLs…', discovered: take.length, crawled: 0 });
    for (var i = 0; i < take.length && pages.length < maxPages; i++) {
      var u = take[i];
      if (!robots.allowed(u.loc)) { pages.push({ url: u.loc, requestedUrl: u.loc, depth: 1, blocked: true, fromSitemap: true }); continue; }
      var res;
      try { res = await get(u.loc, { accept: 'text/html,application/pdf,*/*', cap: 900000, signal: body.signal }); }
      catch (e) { pages.push({ url: u.loc, requestedUrl: u.loc, depth: 1, status: 0, error: e.message, fromSitemap: true }); continue; }
      var ct = (res.ct || '').toLowerCase();
      var isHtml = ct.indexOf('text/html') >= 0 || ct === '' || ct.indexOf('application/xhtml') >= 0;
      if (isHtml) {
        var parsed = parsePage(res.text, res.finalUrl || u.loc);
        pages.push({
          url: res.finalUrl || u.loc, requestedUrl: u.loc, depth: 1, status: res.status, contentType: ct || 'text/html',
          title: parsed.title, metaDescription: parsed.metaDescription, ogTitle: parsed.ogTitle, ogDescription: parsed.ogDescription,
          ogType: parsed.ogType, ogSiteName: parsed.ogSiteName, canonical: parsed.canonical, noindex: parsed.noindex,
          h1: parsed.h1, h2: parsed.h2, types: parsed.types, breadcrumbs: parsed.breadcrumbs, text: parsed.text,
          wordCount: parsed.wordCount, hasArticleTag: parsed.hasArticleTag, headline: parsed.headline,
          structuredDate: parsed.structuredDate, metaPublishedTime: parsed.metaPublishedTime, timeDatetime: parsed.timeDatetime,
          visibleDate: parsed.visibleDate, firstParagraph: parsed.firstParagraph, articleAuthor: parsed.articleAuthor,
          ogImage: parsed.ogImage, articleSection: parsed.articleSection, audioUrl: parsed.audioUrl,
          articleHtml: '', lastmod: u.lastmod || null, jsHeavy: parsed.text.length < 250, links: parsed.links.slice(0, 200),
          fromSitemap: true
        });
      } else {
        pages.push({ url: u.loc, requestedUrl: u.loc, depth: 1, status: res.status, contentType: ct || 'application/octet-stream', title: '', wordCount: 0, fromSitemap: true });
      }
      onProgress({ stage: 'crawl', message: (i + 1) + '/' + take.length + ' sitemap URLs fetched', discovered: take.length, crawled: pages.length });
    }

    onProgress({ stage: 'metadata', message: 'Sending collected data for analysis…' });
    var resp = await fetch('/api/rss-browser', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: root, options: body, pages: pages, discovered: take.length,
        homeHtml: homeHtml.slice(0, 300000), platform: detectPlatform(homeHtml),
        robots: !!robotsTxt, robotsSitemaps: robots.sitemaps,
        sitemaps: [{ url: smUrl.toString(), isIndex: !!isIndex, count: take.length }]
      })
    });
    if (!resp.ok) { var j = null; try { j = await resp.json(); } catch (e) {} throw j || err('error', 'Analysis failed.'); }
    return resp.json();
  }

  B.run = async function (body, onProgress) {
    fetches = 0;
    if (body.mode === 'sitemap') return runSitemap(body, onProgress);
    var articleBudget = ARTICLE_HTML_BUDGET;
    var root = input(body.url);
    var maxPages = Math.min(Number(body.maxPages) || 60, 60);
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

    var sitemaps = await discover(origin, robots, { signal: body.signal });
    onProgress({ stage: 'sitemaps', message: 'Sitemap discovery completed' });

    var lastmods = {};
    sitemaps.forEach(function (s) { (s.urls || []).forEach(function (u) { if (u.lastmod) lastmods[key(u.loc)] = u.lastmod; }); });

    var queue = [{ url: finalRoot, depth: 0, fromSitemap: false }];
    var seen = {}; seen[key(finalRoot)] = 1;
    var discovered = 1;
    sitemaps.forEach(function (s) { (s.urls || []).forEach(function (u) {
      if (!internal(u.loc, finalRoot, subs)) return;
      var k = key(u.loc); if (!seen[k]) { seen[k] = 1; queue.push({ url: u.loc, depth: 1, fromSitemap: true, lastmod: u.lastmod || null }); discovered++; }
    }); });

    var pages = [];
    var idx = 0;
    function record(p) { pages.push(p); onProgress({ stage: 'crawl', message: pages.length + ' pages analyzed', discovered: discovered, crawled: pages.length }); }

        async function crawlNext() {
      if (idx >= queue.length || pages.length >= maxPages) return Promise.resolve();
      var item = queue[idx++];
      if (!robots.allowed(item.url)) { record({ url: item.url, depth: item.depth, blocked: true, fromSitemap: !!item.fromSitemap }); return crawlNext(); }
      var res;
      try { res = await get(item.url, { accept: 'text/html,application/pdf,*/*', cap: 900000, signal: body.signal }); }
      catch (e) { record({ url: item.url, depth: item.depth, status: 0, error: e.message, fromSitemap: !!item.fromSitemap }); return crawlNext(); }
      var ct = (res.ct || '').toLowerCase();
      var isHtml = ct.indexOf('text/html') >= 0 || ct === '' || ct.indexOf('application/xhtml') >= 0;
      if (isHtml) {
        var parsed = parsePage(res.text, res.finalUrl || item.url);
        // Full article HTML only when the user wants full content and budget allows.
        if (body.contentMode === 'full' && articleBudget > 0) {
          var doc = new DOMParser().parseFromString(res.text, 'text/html');
          var region = articleRegion(doc);
          var h = sanitizeArticleHtml(region);
          if (h.length > articleBudget) h = h.slice(0, Math.max(0, articleBudget));
          articleBudget -= h.length;
          parsed.articleHtml = h;
        }
        record({
          url: res.finalUrl || item.url, requestedUrl: item.url, depth: item.depth, status: res.status,
          contentType: ct || 'text/html', title: parsed.title, metaDescription: parsed.metaDescription,
          ogTitle: parsed.ogTitle, ogDescription: parsed.ogDescription, ogType: parsed.ogType, ogSiteName: parsed.ogSiteName,
          canonical: parsed.canonical, noindex: parsed.noindex, h1: parsed.h1, h2: parsed.h2, types: parsed.types,
          breadcrumbs: parsed.breadcrumbs, text: parsed.text, wordCount: parsed.wordCount,
          hasArticleTag: parsed.hasArticleTag, headline: parsed.headline, structuredDate: parsed.structuredDate,
          metaPublishedTime: parsed.metaPublishedTime, timeDatetime: parsed.timeDatetime, visibleDate: parsed.visibleDate,
          firstParagraph: parsed.firstParagraph, articleAuthor: parsed.articleAuthor, ogImage: parsed.ogImage,
          articleSection: parsed.articleSection, audioUrl: parsed.audioUrl, articleHtml: parsed.articleHtml,
          lastmod: item.lastmod || lastmods[key(item.url)] || null,
          jsHeavy: parsed.text.length < 250, links: parsed.links.slice(0, 400),
          fromSitemap: !!item.fromSitemap
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
        record({ url: item.url, depth: item.depth, status: res.status, contentType: ct || 'application/octet-stream', title: '', wordCount: 0, fromSitemap: !!item.fromSitemap });
      }
    
      return crawlNext();
    }
    /* Small worker pool: several pages are fetched at once, which keeps
       relay latency from adding up page by page. */
    var crawlWorkers = [];
    for (var w = 0; w < 3; w++) crawlWorkers.push(crawlNext());
    await Promise.all(crawlWorkers);

    onProgress({ stage: 'feeds', message: 'Checking for an existing feed…' });
    var feed = await detectFeed(origin, home.text || '', { signal: body.signal }).catch(function () { return { url: null, xml: null }; });

    onProgress({ stage: 'metadata', message: 'Sending collected data for analysis…' });
    var resp = await fetch('/api/rss-browser', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: finalRoot, options: body, pages: pages, discovered: discovered,
        homeHtml: (home.text || '').slice(0, 300000),
        platform: detectPlatform(home.text), robots: !!robotsTxt, robotsSitemaps: robots.sitemaps,
        sitemaps: sitemaps.map(function (s) { return { url: s.url, isIndex: s.isIndex, count: s.count }; }),
        existingFeedUrl: feed.url, existingFeedXml: feed.xml
      })
    });
    if (!resp.ok) { var j = null; try { j = await resp.json(); } catch (e) {} throw j || err('error', 'Analysis failed.'); }
    return resp.json();
  };
})(window);
