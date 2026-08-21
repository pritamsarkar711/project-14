/* huvanti Ezoic checker — browser crawler (independent of AdSense). */
(function (global) {
  'use strict';
  var E = global.Ezoic = global.Ezoic || {};

  var TRACKING = { utm_source:1, utm_medium:1, utm_campaign:1, utm_term:1, utm_content:1, gclid:1, fbclid:1, msclkid:1, _ga:1, _gl:1 };
  var ASSET = /\.(jpe?g|png|webp|gif|svg|avif|ico|bmp|css|js|mjs|json|pdf|zip|woff2?|ttf|eot|mp4|webm|mp3)(\?|#|$)/i;
  var PRIVATE = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|::1|metadata\.google\.internal)/i;
  var TIMEOUT = 14000;
  var MAX_HTML = 180000;

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function originOf(u) { try { return new URL(u).origin; } catch (e) { return ''; } }
  function pathOf(u) { try { return new URL(u).pathname || '/'; } catch (e) { return u; } }
  function normHost(h) { return String(h || '').toLowerCase().replace(/^www\./, ''); }
  function sameSite(a, b) {
    try { return normHost(new URL(a).hostname) === normHost(new URL(b).hostname); }
    catch (e) { return false; }
  }
  function isPublicUrl(raw) {
    try {
      var u = new URL(raw);
      if (!/^https?:$/.test(u.protocol)) return false;
      if (PRIVATE.test(u.hostname)) return false;
      if (/\.(local|internal|lan)$/i.test(u.hostname)) return false;
      return true;
    } catch (e) { return false; }
  }
  function normalizeUrl(raw, base) {
    try {
      var u = new URL(raw, base);
      if (!/^https?:$/.test(u.protocol)) return null;
      u.hash = '';
      u.searchParams.forEach(function (v, k) { if (TRACKING[k.toLowerCase()]) u.searchParams.delete(k); });
      var s = u.toString();
      if (u.pathname.length > 1 && u.pathname.endsWith('/')) s = s.replace(/\/$/, '');
      return s;
    } catch (e) { return null; }
  }
  function makeError(code, msg) { var e = new Error(msg); e.code = code; return e; }
  function headersToObj(h) {
    var o = {};
    if (!h) return o;
    if (h.forEach) h.forEach(function (v, k) { o[k.toLowerCase()] = v; });
    return o;
  }

  function fetchOnce(rawUrl, signal) {
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, TIMEOUT);
    if (signal) signal.addEventListener('abort', function () { ctrl.abort(); }, { once: true });
    var accept = { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };

    function ok(res, text, via, extra) {
      extra = extra || {};
      clearTimeout(to);
      if (text && text.length > MAX_HTML) text = text.slice(0, MAX_HTML);
      return {
        url: rawUrl,
        finalUrl: extra.finalUrl || res.url || rawUrl,
        status: extra.status != null ? extra.status : (res.status || 200),
        ok: (extra.status != null ? extra.status : res.status) < 400,
        redirected: !!res.redirected,
        headers: extra.headers || headersToObj(res.headers),
        text: text || '',
        via: via,
        ms: extra.ms || null,
        bytes: (text || '').length
      };
    }

    return fetch(rawUrl, { redirect: 'follow', signal: ctrl.signal, headers: accept }).then(function (res) {
      return res.text().then(function (text) { return ok(res, text, 'direct'); });
    }).catch(function (e) {
      if (signal && signal.aborted) { clearTimeout(to); throw makeError('cancelled', 'Audit cancelled.'); }
      return fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(rawUrl), { signal: ctrl.signal }).then(function (res) { return res.json(); }).then(function (j) {
        var h = {};
        if (j.status) {
          if (j.status.content_type) h['content-type'] = j.status.content_type;
          if (j.status.http_code) h[':http'] = String(j.status.http_code);
        }
        return ok({ url: rawUrl, redirected: false, headers: { forEach: function () {} } }, j.contents || '', 'allorigins', {
          finalUrl: (j.status && j.status.url) || rawUrl,
          status: (j.status && j.status.http_code) || 200,
          headers: h
        });
      }).catch(function () {
        if (signal && signal.aborted) { clearTimeout(to); throw makeError('cancelled', 'Audit cancelled.'); }
        return fetch('https://corsproxy.io/?url=' + encodeURIComponent(rawUrl), { signal: ctrl.signal }).then(function (res) {
          return res.text().then(function (text) { return ok(res, text, 'corsproxy'); });
        }).catch(function () {
          if (signal && signal.aborted) { clearTimeout(to); throw makeError('cancelled', 'Audit cancelled.'); }
          return fetch('https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(rawUrl), { signal: ctrl.signal }).then(function (res) {
            return res.text().then(function (text) {
              if (/^[A-Za-z ]+Error/i.test(text.slice(0, 80))) throw new Error(text.slice(0, 80));
              return ok(res, text, 'codetabs');
            });
          }).catch(function (err) {
            clearTimeout(to);
            var m = String((err && err.message) || err || '').toLowerCase();
            if (/ssl|certificate|tls/.test(m)) throw makeError('ssl', 'SSL/TLS connection failed. Check the certificate and HTTPS setup.');
            if (/abort/.test(m)) throw makeError('timeout', 'The request timed out.');
            if (/just a moment|cloudflare/.test(m)) throw makeError('challenge', 'The site appears to be behind a Cloudflare/bot challenge.');
            throw makeError('unreachable', 'Could not reach ' + rawUrl + '. The site may be offline, blocking public readers, or behind a challenge page.');
          });
        });
      });
    });
  }

  E.fetchText = function (url, opt) {
    opt = opt || {};
    var signal = opt.signal, retries = opt.retries == null ? 1 : opt.retries, last;
    function attempt(n) {
      return fetchOnce(url, signal).catch(function (e) {
        last = e;
        if (signal && signal.aborted) throw e;
        if (['unreachable', 'ssl', 'challenge', 'invalid_url', 'cancelled'].indexOf(e.code) >= 0 && n >= retries) throw e;
        if (n < retries) return new Promise(function (r) { setTimeout(r, 280 * (n + 1)); }).then(function () { return attempt(n + 1); });
        throw last;
      });
    }
    return attempt(0);
  };

  E.parseRobots = function (txt) {
    var sitemaps = [], groups = [], cur = null;
    String(txt || '').split(/\r?\n/).forEach(function (line) {
      var m;
      if ((m = line.match(/^Sitemap:\s*(\S+)/i))) { sitemaps.push(m[1].trim()); return; }
      if ((m = line.match(/^User-agent:\s*(.+)/i))) { cur = { agent: m[1].trim().toLowerCase(), disallow: [], allow: [] }; groups.push(cur); return; }
      if (cur && (m = line.match(/^Disallow:\s*(.*)/i))) { cur.disallow.push(m[1].trim()); return; }
      if (cur && (m = line.match(/^Allow:\s*(.*)/i))) { cur.allow.push(m[1].trim()); return; }
    });
    return { txt: String(txt || ''), sitemaps: sitemaps, groups: groups, blocksAll: groups.some(function (g) { return g.agent === '*' && g.disallow.some(function (d) { return d === '/'; }); }) };
  };

  var PRIORITY = [
    [/\/(about|who-we-are|our-story|company|team)(\/|$)/i, 100],
    [/\/(contact|get-in-touch|reach)(\/|$)/i, 99],
    [/privacy/i, 98], [/terms|conditions/i, 97], [/disclaimer/i, 96], [/cookie/i, 95],
    [/\/(blog|article|post|news|guide)\//i, 70], [/\/$/, 80]
  ];
  function priorityOf(url) {
    for (var i = 0; i < PRIORITY.length; i++) if (PRIORITY[i][0].test(url)) return PRIORITY[i][1];
    return 10;
  }

  function Crawler(startUrl, opt) {
    opt = opt || {};
    if (!isPublicUrl(startUrl)) throw makeError('invalid_url', 'Please enter a valid public http(s) website URL.');
    this.start = normalizeUrl(startUrl);
    if (!this.start) throw makeError('invalid_url', 'Please enter a valid website URL.');
    this.origin = originOf(this.start);
    this.limit = clamp(parseInt(opt.limit, 10) || 50, 1, 250);
    this.concurrency = clamp(opt.concurrency || 4, 1, 6);
    this.signal = opt.signal;
    this.onProgress = opt.onProgress || function () {};
    this.visited = new Set();
    this.queue = [];
    this.results = [];
    this.errors = [];
    this.robots = { txt: '', sitemaps: [], groups: [], blocksAll: false };
    this.sitemapUrls = [];
    this.adsTxt = { present: false, text: '', hasEzoic: false, lineCount: 0 };
    this.challenge = false;
  }

  Crawler.prototype.enqueue = function (url, depth) {
    var n = normalizeUrl(url, this.origin);
    if (!n || !sameSite(n, this.origin) || ASSET.test(n) || this.visited.has(n)) return;
    if (this.queue.some(function (q) { return q.url === n; })) return;
    this.queue.push({ url: n, priority: priorityOf(n), depth: depth || 0 });
  };

  Crawler.prototype.crawlOne = function (item) {
    var self = this;
    return E.fetchText(item.url, { signal: self.signal, retries: 1 }).then(function (info) {
      var body = (info.text || '').slice(0, 2500).toLowerCase();
      if (/just a moment|challenge-platform|cf-browser-verification/.test(body)) self.challenge = true;
      var ctype = (info.headers && info.headers['content-type']) || '';
      if (ctype && !/html|xml|text\/plain/i.test(ctype) && !/html/i.test((info.text || '').slice(0, 120))) {
        self.results.push({ url: item.url, status: info.status, finalUrl: info.finalUrl, depth: item.depth, skipped: true, reason: 'non-html', via: info.via, ms: info.ms, headers: info.headers });
        return;
      }
      self.results.push({
        url: item.url, finalUrl: info.finalUrl || item.url, status: info.status, depth: item.depth,
        redirected: info.redirected, via: info.via, ms: info.ms, bytes: info.bytes,
        headers: info.headers, html: info.text, challenge: self.challenge
      });
      var re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi, m;
      while ((m = re.exec(info.text || ''))) self.enqueue(m[1], (item.depth || 0) + 1);
    }).catch(function (e) {
      self.errors.push({ url: item.url, code: e.code || 'error', message: e.message });
      self.results.push({ url: item.url, status: 0, depth: item.depth, error: e.message, errorCode: e.code });
    });
  };

  Crawler.prototype.run = function () {
    var self = this;
    self.onProgress({ stage: 'connect', message: 'Opening website…' });
    function loadRobots() {
      self.onProgress({ stage: 'robots', message: 'Reading robots.txt…' });
      return E.fetchText(self.origin + '/robots.txt', { signal: self.signal, retries: 0 }).then(function (r) {
        self.robots = E.parseRobots(r.text || '');
      }).catch(function () { self.robots = E.parseRobots(''); });
    }
    function loadAds() {
      return E.fetchText(self.origin + '/ads.txt', { signal: self.signal, retries: 0 }).then(function (r) {
        if (r.status < 400 && r.text && !/^\s*<(!doctype|html)/i.test(r.text)) {
          self.adsTxt = { present: true, text: r.text.slice(0, 12000), hasEzoic: /ezoic\.com/i.test(r.text), lineCount: r.text.split(/\r?\n/).filter(function (l) { return l.trim() && l.trim().charAt(0) !== '#'; }).length };
        }
      }).catch(function () {});
    }
    function readSitemap(loc) {
      return E.fetchText(loc, { signal: self.signal, retries: 0 }).then(function (info) {
        var urls = [], nested = [], m, re = /<loc>\s*([^<]+)\s*<\/loc>/gi;
        while ((m = re.exec(info.text || ''))) {
          var u = m[1].trim().replace(/&amp;/g, '&');
          if (/sitemap/i.test(u) && /xml/i.test(u)) nested.push(u);
          else if (sameSite(u, self.origin) && !ASSET.test(u)) urls.push(u);
        }
        self.sitemapUrls = self.sitemapUrls.concat(urls);
        return nested.slice(0, 2).reduce(function (p, n) {
          return p.then(function () { return readSitemap(n); });
        }, Promise.resolve());
      }).catch(function () {});
    }
    function loadSitemaps() {
      self.onProgress({ stage: 'sitemap', message: 'Discovering sitemap URLs…' });
      var cands = (self.robots.sitemaps || []).concat([self.origin + '/sitemap.xml', self.origin + '/sitemap_index.xml', self.origin + '/wp-sitemap.xml']);
      var seen = {};
      cands = cands.filter(function (u) { var n = normalizeUrl(u, self.origin); if (!n || seen[n]) return false; seen[n] = 1; return true; }).slice(0, 6);
      return cands.reduce(function (p, loc) { return p.then(function () { return readSitemap(loc); }); }, Promise.resolve());
    }
    function loop() {
      if (self.visited.size >= self.limit) return Promise.resolve();
      if (self.signal && self.signal.aborted) throw makeError('cancelled', 'Audit cancelled.');
      self.queue.sort(function (a, b) { return b.priority - a.priority || a.depth - b.depth; });
      var batch = [];
      while (batch.length < self.concurrency && self.queue.length && self.visited.size + batch.length < self.limit) {
        var it = self.queue.shift();
        if (self.visited.has(it.url)) continue;
        self.visited.add(it.url);
        batch.push(it);
      }
      if (!batch.length) return Promise.resolve();
      return Promise.all(batch.map(function (it) { return self.crawlOne(it); })).then(function () {
        self.onProgress({ stage: 'crawler', message: 'Crawled ' + self.visited.size + ' / ' + self.limit + ' pages…', crawled: self.visited.size, limit: self.limit });
        return loop();
      });
    }
    return loadRobots().then(loadAds).then(loadSitemaps).then(function () {
      self.enqueue(self.start, 0);
      self.sitemapUrls.forEach(function (u) { self.enqueue(u, 1); });
      return loop();
    }).then(function () {
      return {
        start: self.start, origin: self.origin, limit: self.limit,
        robots: self.robots, sitemapUrls: self.sitemapUrls, adsTxt: self.adsTxt,
        pages: self.results, errors: self.errors, challenge: self.challenge,
        reachedLimit: self.queue.length > 0 || self.visited.size >= self.limit
      };
    });
  };

  E.Crawler = Crawler;
  E.isPublicUrl = isPublicUrl;
  E.normalizeUrl = normalizeUrl;
})(typeof window !== 'undefined' ? window : this);
