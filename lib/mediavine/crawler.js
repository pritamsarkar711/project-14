'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const U = require('./util');
const { assertPublicUrl, resolveAndPin, assertSafeHostname } = require('./ssrf');

const MAX_BYTES = 2.5 * 1024 * 1024;
const TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 5;
const UA = 'huvanti-mediavine-checker/1.0 (+https://huvanti.com/mediavine-eligibility-checker)';

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 8, maxFreeSockets: 4 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 8, maxFreeSockets: 4 });

function headersToObj(h) {
  const o = {};
  if (!h) return o;
  for (const k of Object.keys(h)) o[k.toLowerCase()] = Array.isArray(h[k]) ? h[k].join(', ') : String(h[k]);
  return o;
}

function looksLikeChallenge(status, headers, text) {
  const h = headers || {};
  const body = String(text || '').slice(0, 4000).toLowerCase();
  const cf = !!(h['cf-ray'] || h['cf-mitigated'] || /cloudflare/i.test(h['server'] || ''));
  if (cf && (status === 403 || status === 503 || status === 429)) return true;
  if (/just a moment|attention required|cf-browser-verification|challenge-platform|cdn-cgi\/challenge|_cf_chl/i.test(body)) return true;
  if (/checking your browser before accessing|enable javascript and cookies to continue/i.test(body) && cf) return true;
  return false;
}

function requestPinned(urlObj, pin, opt) {
  opt = opt || {};
  const timeout = opt.timeout || TIMEOUT_MS;
  const method = opt.method || 'GET';
  const isHttps = urlObj.protocol === 'https:';
  const port = urlObj.port ? Number(urlObj.port) : (isHttps ? 443 : 80);
  const path = urlObj.pathname + urlObj.search;
  const lib = isHttps ? https : http;
  const agent = isHttps ? httpsAgent : httpAgent;
  const headers = Object.assign({
    'Host': urlObj.hostname, 'User-Agent': UA,
    'Accept': opt.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.1',
    'Accept-Language': 'en-US,en;q=0.8', 'Accept-Encoding': 'identity', 'Connection': 'keep-alive'
  }, opt.headers || {});

  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const family = pin.family || (String(pin.address).includes(':') ? 6 : 4);
    const reqOpts = { protocol: urlObj.protocol, hostname: urlObj.hostname, port, path, method, agent, timeout, headers, servername: isHttps ? urlObj.hostname : undefined };
    if (!opt.useDefaultLookup) reqOpts.lookup = (hostname, options, cb) => { if (options && options.all) cb(null, [{ address: pin.address, family }]); else cb(null, pin.address, family); };
    const req = lib.request(reqOpts, res => {
      const chunks = [];
      let size = 0;
      const abort = () => { res.destroy(); reject(U.makeError('too_large', 'Response is too large to analyse.')); };
      res.on('data', c => { size += c.length; if (size > MAX_BYTES) { abort(); return; } if (method !== 'HEAD') chunks.push(c); });
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let text = '';
        try { text = buf.toString('utf8'); } catch (e) { text = buf.toString('latin1'); }
        resolve({ status: res.statusCode || 0, headers: headersToObj(res.headers), text, bytes: size, ms: Date.now() - t0 });
      });
      res.on('error', e => reject(U.makeError('fetch_failed', e.message, e)));
    });
    req.on('timeout', () => { req.destroy(); reject(U.makeError('timeout', 'The request timed out.')); });
    req.on('error', e => {
      const m = String(e.message || '').toLowerCase();
      if (/cert|ssl|tls|unable to verify/.test(m)) reject(U.makeError('ssl', 'SSL/TLS connection failed. Check the certificate and HTTPS setup.', e));
      else reject(U.makeError('unreachable', 'Could not reach ' + urlObj.href + '.', e));
    });
    if (opt.signal) {
      const onAbort = () => { req.destroy(); reject(U.makeError('cancelled', 'Audit cancelled.')); };
      if (opt.signal.aborted) return onAbort();
      opt.signal.addEventListener('abort', onAbort, { once: true });
    }
    req.end();
  });
}

async function fetchFollow(rawUrl, opt) {
  opt = opt || {};
  let current;
  try { current = assertPublicUrl(rawUrl); } catch (e) { throw e; }
  const hops = [];
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    assertSafeHostname(current.hostname);
    const pin = await resolveAndPin(current);
    const res = await requestPinned(current, pin, opt);
    hops.push({ url: current.href, ip: pin.address, status: res.status, ms: res.ms });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      let next;
      try { next = new URL(res.headers.location, current.href); } catch (e) { throw U.makeError('redirect', 'Invalid redirect location.'); }
      if (!/^https?:$/.test(next.protocol)) throw U.makeError('redirect', 'Redirect used a non-http protocol.');
      assertPublicUrl(next.href);
      current = next;
      continue;
    }
    const challenge = looksLikeChallenge(res.status, res.headers, res.text);
    return { url: rawUrl, finalUrl: current.href, status: res.status, ok: res.status >= 200 && res.status < 400, redirected: hops.length > 1, hops, headers: res.headers, text: res.text, bytes: res.bytes, ms: res.ms, ip: pin.address, challenge, via: 'direct' };
  }
  throw U.makeError('redirect', 'Too many redirects (more than ' + MAX_REDIRECTS + ').');
}

async function fetchWithRetry(url, opt) {
  opt = opt || {};
  const retries = opt.retries == null ? 1 : opt.retries;
  let last;
  for (let n = 0; n <= retries; n++) {
    try { return await fetchFollow(url, opt); }
    catch (e) {
      last = e;
      if (opt.signal && opt.signal.aborted) throw e;
      if (['ssrf', 'invalid_url', 'cancelled', 'too_large', 'ssl', 'challenge', 'dns'].indexOf(e.code) >= 0) throw e;
      if (n < retries) await new Promise(r => setTimeout(r, 250 * (n + 1)));
    }
  }
  throw last;
}

function parseRobots(txt) {
  const sitemaps = [];
  const groups = [];
  let cur = null;
  String(txt || '').split(/\r?\n/).forEach(line => {
    const t = line.replace(/#.*$/, '').trim();
    if (!t) return;
    let m;
    if ((m = t.match(/^Sitemap:\s*(\S+)/i))) { sitemaps.push(m[1].trim()); return; }
    if ((m = t.match(/^User-agent:\s*(.+)/i))) { cur = { agent: m[1].trim().toLowerCase(), disallow: [], allow: [] }; groups.push(cur); return; }
    if (cur && (m = t.match(/^Disallow:\s*(.*)/i))) { cur.disallow.push(m[1].trim()); return; }
    if (cur && (m = t.match(/^Allow:\s*(.*)/i))) { cur.allow.push(m[1].trim()); return; }
  });
  const star = groups.filter(g => g.agent === '*');
  const blocksAll = star.some(g => g.disallow.some(d => d === '/'));
  return { txt: String(txt || ''), sitemaps, groups, blocksAll };
}

function robotsPathAllowed(path, robots) {
  if (!robots || !robots.groups || !robots.groups.length) return true;
  const groups = robots.groups.filter(g => g.agent === '*');
  if (!groups.length) return true;
  const rules = [];
  groups.forEach(g => { g.allow.forEach(p => rules.push({ allow: true, pattern: p })); g.disallow.forEach(p => rules.push({ allow: false, pattern: p })); });
  let matched = null;
  rules.forEach(r => { if (!r.pattern) return; if (path.startsWith(r.pattern) || r.pattern === '/') { if (!matched || r.pattern.length >= matched.pattern.length) matched = r; } });
  if (!matched) return true;
  return matched.allow;
}

const PRIORITY = [
  [/\/(about|who-we-are|our-story|company|team)(\/|$)/i, 100],
  [/\/(contact|get-in-touch|reach)(\/|$)/i, 99],
  [/privacy/i, 98], [/terms|conditions|tos/i, 97], [/disclaimer/i, 96], [/cookie/i, 95], [/editorial/i, 94],
  [/\/(blog|article|post|news|guide|tutorial|review)\//i, 70],
  [/\/(product|shop|pricing|plan)/i, 55], [/\/(category|collection|topics)/i, 40], [/\/$/, 80]
];
function priorityOf(url) { for (let i = 0; i < PRIORITY.length; i++) if (PRIORITY[i][0].test(url)) return PRIORITY[i][1]; return 10; }

function extractSitemapLocs(xml) {
  const urls = [], nested = [];
  const re = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml))) { const u = m[1].trim().replace(/&amp;/g, '&'); if (/sitemap/i.test(u) && /xml/i.test(u)) nested.push(u); else urls.push(u); }
  return { urls, nested };
}

class Crawler {
  constructor(startUrl, opt) {
    opt = opt || {};
    const u = assertPublicUrl(startUrl);
    this.start = U.normalizeUrl(u.href) || u.href;
    this.origin = U.originOf(this.start);
    this.limit = U.clamp(parseInt(opt.limit, 10) || 50, 1, 250);
    this.concurrency = U.clamp(opt.concurrency || 4, 1, 6);
    this.signal = opt.signal;
    this.onProgress = opt.onProgress || function () {};
    this.visited = new Set();
    this.queue = [];
    this.results = [];
    this.errors = [];
    this.robots = { txt: '', sitemaps: [], groups: [], blocksAll: false };
    this.sitemapUrls = [];
    this.cache = new Map();
    this.adsTxt = null;
    this.challenge = false;
    this.sslOk = /^https:/.test(this.start);
  }

  enqueue(url, depth) {
    const n = U.normalizeUrl(url, this.origin);
    if (!n || !U.sameSite(n, this.origin) || U.isAsset(n)) return;
    if (this.visited.has(n)) return;
    if (this.queue.some(q => q.url === n)) return;
    try { const path = U.pathOf(n); if (this.robots && !robotsPathAllowed(path, this.robots) && n !== this.start) return; } catch (e) {}
    this.queue.push({ url: n, priority: priorityOf(n), depth: depth || 0 });
  }

  async fetchCached(url, opt) {
    if (this.cache.has(url)) return this.cache.get(url);
    const r = await fetchWithRetry(url, Object.assign({ signal: this.signal, retries: 1 }, opt || {}));
    this.cache.set(url, r);
    return r;
  }

  async loadRobots() {
    this.onProgress({ stage: 'robots', message: 'Reading robots.txt…' });
    try { const r = await this.fetchCached(this.origin + '/robots.txt', { retries: 0, accept: 'text/plain,*/*' }); if (r.status < 400 && r.text) this.robots = parseRobots(r.text); }
    catch (e) { this.robots = parseRobots(''); }
  }

  async loadAdsTxt() {
    try {
      const r = await this.fetchCached(this.origin + '/ads.txt', { retries: 0, accept: 'text/plain,*/*' });
      if (r.status < 400 && r.text && !/^\s*<(!doctype|html)/i.test(r.text)) {
        this.adsTxt = { present: true, text: r.text.slice(0, 20000), hasMediavine: /mediavine\.com/i.test(r.text), lineCount: r.text.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#')).length };
      } else this.adsTxt = { present: false, text: '', hasMediavine: false, lineCount: 0 };
    } catch (e) { this.adsTxt = { present: false, text: '', hasMediavine: false, lineCount: 0 }; }
  }

  async loadSitemaps() {
    this.onProgress({ stage: 'sitemap', message: 'Discovering sitemap URLs…' });
    const candidates = this.robots.sitemaps.slice();
    ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml', '/wp-sitemap.xml'].forEach(p => candidates.push(this.origin + p));
    const seen = new Set();
    const unique = candidates.filter(u => { const n = U.normalizeUrl(u, this.origin); if (!n || seen.has(n)) return false; seen.add(n); return true; }).slice(0, 8);
    const collect = [];
    for (const loc of unique) {
      if (this.signal && this.signal.aborted) break;
      try {
        const info = await this.fetchCached(loc, { retries: 0, accept: 'application/xml,text/xml,*/*' });
        if (info.status >= 400 || !info.text || !/<urlset|<sitemapindex/i.test(info.text)) continue;
        const parsed = extractSitemapLocs(info.text);
        collect.push(...parsed.urls);
        for (const nested of parsed.nested.slice(0, 3)) { try { const ninfo = await this.fetchCached(nested, { retries: 0 }); const np = extractSitemapLocs(ninfo.text || ''); collect.push(...np.urls); } catch (e) {} }
      } catch (e) {}
    }
    const uniq = [];
    const seenU = new Set();
    collect.forEach(u => { const n = U.normalizeUrl(u, this.origin); if (!n || seenU.has(n) || !U.sameSite(n, this.origin) || U.isAsset(n)) return; seenU.add(n); uniq.push(n); });
    this.sitemapUrls = uniq;
  }

  async crawlOne(item) {
    try {
      const info = await this.fetchCached(item.url, { retries: 1 });
      if (info.challenge) this.challenge = true;
      const ctype = info.headers['content-type'] || '';
      if (ctype && !U.isHtmlCtype(ctype) && !/html/i.test(info.text.slice(0, 200))) {
        this.results.push({ url: item.url, status: info.status, finalUrl: info.finalUrl, depth: item.depth, skipped: true, reason: 'non-html', via: info.via, ms: info.ms, headers: info.headers, hops: info.hops });
        return;
      }
      this.results.push({ url: item.url, finalUrl: info.finalUrl || item.url, status: info.status, depth: item.depth, redirected: info.redirected, hops: info.hops, via: info.via, ms: info.ms, bytes: info.bytes, headers: info.headers, html: info.text, ip: info.ip, challenge: info.challenge, parse: null });
      const hrefs = [];
      const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
      let m;
      while ((m = re.exec(info.text || ''))) hrefs.push(m[1]);
      hrefs.forEach(h => this.enqueue(h, (item.depth || 0) + 1));
    } catch (e) {
      this.errors.push({ url: item.url, code: e.code || 'error', message: e.message });
      this.results.push({ url: item.url, status: 0, depth: item.depth, error: e.message, errorCode: e.code });
    }
  }

  async run() {
    this.onProgress({ stage: 'init', message: 'Validating URL and resolving DNS…' });
    await resolveAndPin(assertPublicUrl(this.start));
    this.onProgress({ stage: 'connect', message: 'Connecting to website…' });
    await this.loadRobots();
    await this.loadAdsTxt();
    await this.loadSitemaps();

    this.enqueue(this.start, 0);
    this.sitemapUrls.slice(0, this.limit * 2).forEach(u => this.enqueue(u, 1));

    const loop = async () => {
      while (this.visited.size < this.limit) {
        if (this.signal && this.signal.aborted) throw U.makeError('cancelled', 'Audit cancelled.');
        this.queue.sort((a, b) => b.priority - a.priority || a.depth - b.depth);
        const batch = [];
        while (batch.length < this.concurrency && this.queue.length && this.visited.size + batch.length < this.limit) {
          const it = this.queue.shift();
          if (this.visited.has(it.url)) continue;
          this.visited.add(it.url);
          batch.push(it);
        }
        if (!batch.length) break;
        await Promise.all(batch.map(it => this.crawlOne(it)));
        this.onProgress({ stage: 'crawler', message: 'Crawled ' + this.visited.size + ' / ' + this.limit + ' pages…', crawled: this.visited.size, limit: this.limit });
      }
    };
    await loop();

    return {
      start: this.start, origin: this.origin, limit: this.limit, robots: this.robots,
      sitemapUrls: this.sitemapUrls, adsTxt: this.adsTxt, pages: this.results, errors: this.errors,
      challenge: this.challenge, reachedLimit: this.queue.length > 0 || this.visited.size >= this.limit, sslOk: this.sslOk
    };
  }
}

module.exports = { Crawler, fetchFollow, fetchWithRetry, parseRobots, robotsPathAllowed, looksLikeChallenge, requestPinned };
