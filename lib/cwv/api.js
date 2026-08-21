'use strict';

/*
 * Core Web Vitals & INP Auditor — HTTP API.
 *
 * POST /api/cwv-fetch   { url, profile }        → SSE: progress → result | error
 *                                                  (server fetches + rewrites the
 *                                                  page; creates a scan session)
 * GET  /api/cwv-page    ?sid=                   → the rewritten page (iframe)
 * GET  /api/cwv-proxy   ?sid=&u=                → proxied subresource (SSRF-safe,
 *                                                  throttled, recorded)
 * GET  /api/cwv-meta    ?sid=                   → recorded transport evidence
 * POST /api/cwv-analyze { bundle }              → full analysis report
 *
 * The browser-measurement pipeline runs in the visitor's browser; when the
 * server has no direct egress (e.g. this preview sandbox) the page falls
 * back to a relay-based browser-direct load and still POSTs the same
 * measurement bundle to /api/cwv-analyze.
 */

const zlib = require('zlib');
const { validate } = require('./urlValidator');
const { createFetcher } = require('./safeFetcher');
const { createSession, getSession, recordResource, sessionMeta } = require('./session');
const CwvRewriter = require('./rewriter');
const { createThrottle } = require('./throttle');
const { analyzeBundle } = require('./analyze');

const MAX_INFLIGHT = 3;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 15;
const FETCH_MS = 45 * 1000;
const MAX_ANALYZE_BYTES = 8 * 1024 * 1024;
const MAX_HTML_BYTES = 6 * 1024 * 1024;
const MAX_SUBRESOURCE_BYTES = 12 * 1024 * 1024;
const MAX_CSS_BYTES = 1.5 * 1024 * 1024;

const buckets = new Map();
let inflight = 0;

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}
function rateOk(ip) {
  const now = Date.now();
  const arr = (buckets.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) { buckets.set(ip, arr); return false; }
  arr.push(now);
  buckets.set(ip, arr);
  return true;
}
function sendSSE(res, event, data) {
  try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch (e) {}
}
function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(obj));
}
function err(code, message) { const e = new Error(message); e.code = code; return e; }

/* ------------------------------------------------------------------ */
/* POST /api/cwv-fetch — server-side fetch + rewrite (SSE)             */
/* ------------------------------------------------------------------ */
async function handleFetch(req, res, body) {
  const ip = clientIp(req);
  if (!rateOk(ip)) return sendJson(res, 429, { code: 'ratelimit', message: 'Too many audits from this network. Please wait a few minutes.' });
  if (inflight >= MAX_INFLIGHT) return sendJson(res, 503, { code: 'busy', message: 'Another audit is already running on this server. Please wait.' });

  const url = String((body && body.url) || '').trim();
  if (!url) return sendJson(res, 400, { code: 'invalid_url', message: 'Please enter a website URL (e.g. https://example.com).' });

  let urlObj;
  try { urlObj = validate(url); }
  catch (e) { return sendJson(res, e.code === 'ssrf' ? 403 : 400, { code: e.code, message: e.message }); }

  const profile = (body && body.profile && typeof body.profile === 'object') ? body.profile : null;
  const network = profile && profile.network || null;
  const mobileViewport = profile && profile.viewport && profile.viewport.w && profile.viewport.w < 600;

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_MS);
  req.on('close', () => ac.abort());
  inflight++;

  const stage = (s, msg) => sendSSE(res, 'progress', { stage: s, message: msg });
  try {
    stage('validate', 'URL validated — checking DNS and connecting…');
    const fetcher = createFetcher({});
    let home;
    try {
      home = await fetcher.fetchUrl(urlObj.href, { maxBytes: MAX_HTML_BYTES, timeout: 20000, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5' });
    } catch (e) {
      if (ac.signal.aborted) throw err('cancelled', 'The audit was cancelled.');
      throw err('no_egress', 'The server could not reach the site directly (' + (e.code || e.message) + '). The page will fall back to a browser-based measurement.');
    }
    stage('connect', 'Page fetched — rewriting for the measurement sandbox…');

    if (home.status === 404) throw err('not_found', 'The page returned 404 Not Found — check the URL.');
    if (home.status >= 400) throw err('blocked', 'The website returned HTTP ' + home.status + (home.challenge ? ' with a bot challenge' : '') + '.');
    if (home.challenge) throw err('challenge', 'The site is protected by ' + (home.guard || 'a bot challenge') + ' and could not be measured.');

    const ct = String(home.headers['content-type'] || '').toLowerCase();
    if (ct && !/html|xml|text\/plain/i.test(ct) && !/^[\s<]*<!doctype/i.test(home.text)) {
      throw err('not_html', 'The URL returned ' + (ct || 'unknown content') + ' instead of an HTML page.');
    }

    const session = createSession({
      url: urlObj.href,
      finalUrl: home.finalUrl,
      html: '', // set after the rewrite below
      docHeaders: home.headers,
      docPhases: home.phases,
      docProtocol: home.protocol,
      docIp: home.ip,
      docRedirects: home.redirects,
      docStatus: home.status,
      docBytes: home.bytes,
      docTruncated: home.truncated,
      profile: profile ? {
        id: profile.id || 'custom',
        viewport: profile.viewport || null,
        dpr: profile.dpr || null,
        network: network ? { label: network.label || null, latencyMs: network.latencyMs || 0, downKbps: network.downKbps || 0 } : null
      } : null
    });
    session.throttle = network ? { latencyMs: network.latencyMs || 0, downKbps: network.downKbps || 0, label: network.label || null } : null;
    session.pageUrl = '/api/cwv-page?sid=' + session.sid;
    session.proxyPrefix = '/api/cwv-proxy?sid=' + session.sid;

    const rewritten = CwvRewriter.rewriteHtml(home.text, {
      sid: session.sid,
      baseUrl: home.finalUrl,
      injectScript: '/assets/js/cwv/measure.js',
      addViewport: mobileViewport
    });
    session.html = rewritten.html;
    session.rewriteStats = rewritten.stats;

    stage('rewritten', 'Page ready — starting the browser measurement…');
    sendSSE(res, 'result', {
      sid: session.sid,
      pageUrl: session.pageUrl,
      proxyPrefix: session.proxyPrefix,
      finalUrl: home.finalUrl,
      requestedUrl: urlObj.href,
      status: home.status,
      htmlBytes: home.bytes,
      truncated: home.truncated,
      protocol: home.protocol,
      headers: {
        'cache-control': home.headers['cache-control'] || null,
        'content-encoding': home.headers['content-encoding'] || null,
        server: home.headers['server'] || null,
        via: home.headers['via'] || null,
        age: home.headers['age'] || null,
        expires: home.headers['expires'] || null,
        etag: home.headers['etag'] || null,
        'last-modified': home.headers['last-modified'] || null,
        vary: home.headers['vary'] || null,
        'cf-cache-status': home.headers['cf-cache-status'] || null,
        'x-cache': home.headers['x-cache'] || null
      },
      phases: home.phases,
      redirects: home.redirects,
      rewriteStats: rewritten.stats
    });
  } catch (e) {
    sendSSE(res, 'error', { code: e.code || 'error', message: e.message || 'Fetch failed.' });
  } finally {
    inflight--; clearTimeout(timer);
    res.end();
  }
}

/* ------------------------------------------------------------------ */
/* GET /api/cwv-page — serve the rewritten page                        */
/* ------------------------------------------------------------------ */
function handlePage(req, res, query) {
  const session = getSession(query.get('sid') || '');
  if (!session || !session.html) return sendJson(res, 404, { code: 'expired', message: 'This audit session has expired. Please start the audit again.' });
  res.statusCode = 200;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('timing-allow-origin', '*');
  // Sandbox flags are applied by the parent iframe; strip X-Frame-Options by
  // not setting it, and serve no restrictive CSP so the measurement script runs.
  const throttle = session.throttle ? createThrottle(session.throttle) : null;
  const body = Buffer.from(session.html, 'utf8');
  if (throttle && throttle.active) {
    throttle.write(res, body);
    throttle.end(res);
  } else {
    res.end(body);
  }
}

/* ------------------------------------------------------------------ */
/* GET /api/cwv-proxy — proxied subresource                            */
/* ------------------------------------------------------------------ */
function guessType(url) {
  const p = String(url || '').split(/[?#]/)[0].toLowerCase();
  if (/\.css$/.test(p)) return 'text/css; charset=utf-8';
  if (/\.js$|\.mjs$/.test(p)) return 'application/javascript; charset=utf-8';
  if (/\.(png|jpg|jpeg|gif|webp|avif|svg|ico)$/.test(p)) return 'image/' + (p.match(/\.([a-z0-9]+)$/i) || [])[1].replace('jpg', 'jpeg');
  if (/\.(woff2?)$/.test(p)) return 'font/woff2';
  if (/\.(ttf|otf)$/.test(p)) return 'font/' + (p.match(/\.([a-z0-9]+)$/i) || [])[1];
  return 'application/octet-stream';
}

const proxyBuckets = new Map();
function proxyRateOk(ip) {
  const now = Date.now();
  const arr = (proxyBuckets.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (arr.length >= 3000) { proxyBuckets.set(ip, arr); return false; }
  arr.push(now);
  proxyBuckets.set(ip, arr);
  return true;
}

async function handleProxy(req, res, query) {
  const ip = clientIp(req);
  if (!proxyRateOk(ip)) return sendJson(res, 429, { code: 'ratelimit', message: 'Too many proxied requests from this network.' });
  const sid = query.get('sid') || '';
  const rawTarget = query.get('u') || '';
  const session = getSession(sid);
  if (!session) return sendJson(res, 404, { code: 'expired', message: 'Session expired.' });

  let target;
  try {
    const u = new URL(rawTarget);
    if (!/^https?:$/.test(u.protocol)) throw err('ssrf', 'unsupported scheme');
    validate(u.href);
    target = u.href;
  } catch (e) {
    return sendJson(res, 403, { code: 'ssrf', message: 'Blocked target.' });
  }

  const isCss = /\.css([?#]|$)/i.test(target);
  const maxBytes = isCss ? MAX_CSS_BYTES : MAX_SUBRESOURCE_BYTES;

  // Session-level body cache for rewritten CSS (measurement script fetches
  // the same CSS again for analysis — serves from memory, not the target).
  if (isCss && session.cssCache && session.cssCache.has(target)) {
    const hit = session.cssCache.get(target);
    res.statusCode = hit.status || 200;
    res.setHeader('content-type', 'text/css; charset=utf-8');
    res.setHeader('timing-allow-origin', '*');
    res.setHeader('cache-control', 'no-store');
    res.end(hit.body);
    return;
  }
  session.cssCache = session.cssCache || new Map();

  const fetcher = createFetcher({});
  let r;
  try {
    r = await fetcher.fetchUrl(target, {
      maxBytes, timeout: 15000,
      accept: isCss ? 'text/css,*/*;q=0.5' : '*/*'
    });
  } catch (e) {
    recordResource(sid, { url: target, status: 0, error: e.code || 'network', headers: {} });
    return sendJson(res, 502, { code: 'proxy_error', message: 'Subresource fetch failed.' });
  }

  recordResource(sid, {
    url: target, status: r.status, headers: r.headers,
    contentType: r.headers['content-type'] || guessType(target),
    protocol: r.protocol, ttfbMs: r.phases.ttfbMs, totalMs: r.phases.totalMs,
    bytes: r.rawBytes, truncated: r.truncated, error: null
  });

  const throttle = session.throttle ? createThrottle(session.throttle) : null;
  const contentType = r.headers['content-type'] || guessType(target);

  if (isCss && !r.truncated) {
    // Rewrite CSS: url()/@import → proxy URLs, then re-compress.
    let css = r.text;
    css = CwvRewriter.rewriteCssText(css, target, { sid });
    let body = Buffer.from(css, 'utf8');
    let enc = '';
    if (body.length > 1024) { body = zlib.gzipSync(body); enc = 'gzip'; }
    // cache (bounded)
    if (session.cssCache.size < 10 && body.length < 600 * 1024) session.cssCache.set(target, { status: r.status || 200, body });
    res.statusCode = r.status || 200;
    res.setHeader('content-type', 'text/css; charset=utf-8');
    if (enc) res.setHeader('content-encoding', enc);
    res.setHeader('timing-allow-origin', '*');
    res.setHeader('cache-control', 'no-store');
    if (throttle && throttle.active) { throttle.write(res, body); throttle.end(res); }
    else res.end(body);
    return;
  }

  // Passthrough: serve the raw body from the buffered fetch.
  res.statusCode = r.status || 200;
  res.setHeader('content-type', contentType);
  res.setHeader('timing-allow-origin', '*');
  res.setHeader('cache-control', 'no-store');
  const body = r.buffer && r.buffer.length ? r.buffer : Buffer.alloc(0);
  if (throttle && throttle.active) { throttle.write(res, body); throttle.end(res); }
  else res.end(body);
}

/* ------------------------------------------------------------------ */
/* GET /api/cwv-meta — recorded evidence                               */
/* ------------------------------------------------------------------ */
function handleMeta(req, res, query) {
  const sid = query.get('sid') || '';
  const meta = sessionMeta(sid);
  if (!meta) return sendJson(res, 404, { code: 'expired', message: 'Session expired.' });
  sendJson(res, 200, meta);
}

/* ------------------------------------------------------------------ */
/* POST /api/cwv-analyze — full analysis                               */
/* ------------------------------------------------------------------ */
async function handleAnalyze(req, res, body) {
  const ip = clientIp(req);
  if (!rateOk(ip)) return sendJson(res, 429, { code: 'ratelimit', message: 'Too many analyses from this network. Please wait a few minutes.' });
  if (!body || typeof body !== 'object' || !body.bundle) {
    return sendJson(res, 400, { code: 'empty', message: 'No measurement bundle was submitted.' });
  }
  const size = Buffer.byteLength(JSON.stringify(body));
  if (size > MAX_ANALYZE_BYTES) return sendJson(res, 413, { code: 'too_large', message: 'The measurement bundle is too large to analyse.' });
  try {
    const report = analyzeBundle(body.bundle);
    sendJson(res, 200, report);
  } catch (e) {
    if (e.code === 'invalid_bundle') return sendJson(res, 422, { code: e.code, message: e.message });
    return sendJson(res, 500, { code: 'error', message: 'Analysis failed.' });
  }
}

module.exports = { handleFetch, handlePage, handleProxy, handleMeta, handleAnalyze };
