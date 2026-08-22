'use strict';

/*
 * AI Crawler & LLM Bot Blocker: HTTP API (server-side only, plain CommonJS;
 * never loaded in the browser).
 * POST /api/botblocker-inspect { url } → fetches robots.txt + homepage
 * (SSRF-guarded, time- and size-bounded, rate-limited) and returns an
 * evidence-based securityChecker report. Configuration generation itself runs
 * entirely in the visitor's browser, nothing is sent to the server for it.
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { assertPublicUrl } = require('../wptheme/ssrf');
const { analyze } = require('./securityChecker');

  const TOOL_UA = 'huvanti-botblocker/1.0 (+https://huvanti.com/ai-crawler-blocker)';
  const TIMEOUT_MS = 8000;
const MAX_BYTES_ROBOTS = 256 * 1024;
const MAX_BYTES_HOME = 128 * 1024;
const MAX_REDIRECTS = 3;

const buckets = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 8;
const robotsCache = new Map(); // host → { at, data } (60 s)
let inflight = 0;
const MAX_INFLIGHT = 2;

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}
function rateOk(ip) {
  const now = Date.now();
  const arr = (buckets.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) { buckets.set(ip, arr); return false; }
  arr.push(now); buckets.set(ip, arr); return true;
}
function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(obj));
}

function fetchBounded(rawUrl, { maxBytes, method, timeout }) {
  return new Promise(resolve => {
    let target;
    try {
      target = new URL(rawUrl);
    } catch (e) {
      return resolve({ ok: false, error: 'invalid URL' });
    }
    const mod = target.protocol === 'https:' ? https : http;
    const req = mod.get(target, {
      headers: { 'user-agent': TOOL_UA, accept: '*/*' },
      timeout: timeout || TIMEOUT_MS,
      rejectUnauthorized: true,
      setHost: true
    }, res => {
      const chunks = [];
      let size = 0;
      let truncated = false;
      res.on('data', d => {
        size += d.length;
        if (size <= maxBytes) chunks.push(d);
        else { truncated = true; req.destroy(); finish(); }
      });
      res.on('end', () => finish());
      res.on('error', () => finish());
      let done = false;
      function finish() {
        if (done) return; done = true;
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 400,
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
          truncated,
          finalUrl: target.toString()
        });
      }
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', e => resolve({ ok: false, error: e.code || e.message || 'network error' }));
  });
}

/* Follow a bounded number of redirects, re-validating every hop (SSRF). */
async function fetchFollow(rawUrl, opts) {
  let url = rawUrl;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    let u;
    try { u = new URL(url); } catch (e) { return { ok: false, error: 'invalid URL' }; }
    try { assertPublicUrl(u.toString()); } catch (e) { return { ok: false, error: 'blocked target (private/internal address refused)' }; }
    const res = await fetchBounded(u.toString(), opts);
    if (res.ok && [301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
      try { url = new URL(res.headers.location, u).toString(); } catch (e) { return res; }
      continue;
    }
    res.redirects = i;
    return res;
  }
  return { ok: false, error: 'too many redirects' };
}

async function handle(req, res, body) {
  const ip = clientIp(req);
  if (!rateOk(ip)) return sendJson(res, 429, { code: 'ratelimit', message: 'Too many checks. Please wait a few minutes.' });
  if (inflight >= MAX_INFLIGHT) return sendJson(res, 503, { code: 'busy', message: 'Checker busy, try again shortly.' });

  const input = String((body && body.url) || '').trim();
  if (!input || input.length > 2048) return sendJson(res, 400, { code: 'invalid_input', message: 'Enter a website URL, e.g. https://example.com' });

  let origin;
  try {
    origin = new URL(/^https?:\/\//i.test(input) ? input : 'https://' + input);
    if (!origin.hostname.includes('.')) throw new Error('no dot');
    assertPublicUrl(origin.toString());
  } catch (e) {
    return sendJson(res, 400, { code: 'invalid_url', message: 'That URL cannot be checked (invalid or private address).' });
  }
  const root = origin.protocol + '//' + origin.host;

  inflight++;
  try {
    const robotsUrl = root + '/robots.txt';
    const host = origin.host;
    const cached = robotsCache.get(host);
    let robotsFetch;
    if (cached && Date.now() - cached.at < 60000) robotsFetch = cached.data;
    else {
      robotsFetch = await fetchFollow(robotsUrl, { maxBytes: MAX_BYTES_ROBOTS });
      if (robotsFetch && robotsFetch.status !== undefined) robotsCache.set(host, { at: Date.now(), data: robotsFetch });
      if (robotsCache.size > 500) robotsCache.delete(robotsCache.keys().next().value);
    }
    const homeFetch = await fetchFollow(root + '/', { maxBytes: MAX_BYTES_HOME });

    const report = analyze({
      url: root,
      robots: robotsFetch.error ? robotsFetch : {
        ok: robotsFetch.ok, status: robotsFetch.status, error: null,
        contentType: robotsFetch.headers ? robotsFetch.headers['content-type'] : '',
        body: robotsFetch.body || '', finalUrl: robotsFetch.finalUrl, redirects: robotsFetch.redirects || 0
      },
      home: homeFetch.error ? homeFetch : {
        ok: homeFetch.ok, status: homeFetch.status, error: null,
        headers: homeFetch.headers || {}, finalUrl: homeFetch.finalUrl, redirects: homeFetch.redirects || 0
      }
    });
    report.robotsBody = robotsFetch.error ? null : String(robotsFetch.body || '').slice(0, 20000);
    report.robotsFetchError = robotsFetch.error || null;
    report.homeFetchError = homeFetch.error || null;
    sendJson(res, 200, { ok: true, url: root, report });
  } catch (e) {
    sendJson(res, 500, { code: 'error', message: 'Check failed: ' + (e.message || 'unexpected error') });
  } finally {
    inflight--;
  }
}

module.exports = { handle };
