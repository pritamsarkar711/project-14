'use strict';

/*
 * Domain Information Checker: HTTP API.
 *   POST /api/domaincheck            { domain } → SSE: progress → result | error
 *   POST /api/domaincheck-analyze    { domain, bundle } → merged HTTP section
 *
 * Anti-abuse: per-IP rate limits, global concurrency cap, wall-clock budget,
 * payload caps, cancellation when the client disconnects. Nothing is stored:
 * reports exist only for the duration of the request.
 */

const { runScan } = require('./orchestrate');
const { analyzeBrowserBundle } = require('./httpAnalyzer');
const { detectTechnology } = require('./technologyDetector');
const { collectObservations } = require('./subdomainAnalyzer');

const buckets = new Map();
let inflight = 0;
const MAX_INFLIGHT = 4;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 20;
const SCAN_MS = 75 * 1000;
const MAX_ANALYZE_BYTES = 512 * 1024;

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

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(obj));
}

function send(res, event, data) {
  try { res.write('event: ' + event + '\n'); res.write('data: ' + JSON.stringify(data) + '\n\n'); } catch (e) { /* client gone */ }
}

async function handle(req, res, body) {
  const ip = clientIp(req);
  if (!rateOk(ip)) {
    sendJson(res, 429, { code: 'ratelimit', message: 'Too many checks from this network. Please wait a few minutes.' });
    return;
  }
  if (inflight >= MAX_INFLIGHT) {
    sendJson(res, 503, { code: 'busy', message: 'The checker is at capacity. Please try again in a moment.' });
    return;
  }
  const input = String((body && (body.domain || body.url)) || '').trim();
  if (!input || input.length > 2048) {
    sendJson(res, 400, { code: 'invalid_input', message: 'Please enter a domain name (e.g. example.com or https://example.com).' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), SCAN_MS);
  req.on('close', () => ac.abort());
  inflight++;
  try {
    const report = await runScan(input, {
      signal: ac.signal,
      onProgress: state => send(res, 'progress', state)
    });
    send(res, 'result', report);
  } catch (e) {
    const code = e.code || (ac.signal.aborted ? 'cancelled' : 'error');
    send(res, 'error', { code, message: e.message || 'The check failed.' });
  } finally {
    inflight--;
    clearTimeout(timer);
    try { res.end(); } catch (e) { /* ignore */ }
  }
}

async function handleAnalyze(req, res, body) {
  const ip = clientIp(req);
  if (!rateOk(ip)) {
    sendJson(res, 429, { code: 'ratelimit', message: 'Too many requests from this network. Please wait a few minutes.' });
    return;
  }
  if (!body || typeof body !== 'object' || !body.domain || !body.bundle) {
    sendJson(res, 400, { code: 'bad_request', message: 'A domain and browser bundle are required.' });
    return;
  }
  const size = JSON.stringify(body).length;
  if (size > MAX_ANALYZE_BYTES) {
    sendJson(res, 413, { code: 'too_large', message: 'The submitted bundle is too large.' });
    return;
  }
  const domain = String(body.domain).slice(0, 253);
  const bundle = body.bundle;
  // the HTTP section (plus technology/subdomains derived from it) is
  // enriched from the browser bundle
  const http = analyzeBrowserBundle(bundle, domain);
  const headers = http && http.https && http.https.headers ? http.https.headers : {};
  const html = http && http.https && http.https.body ? http.https.body : '';
  const technology = detectTechnology({
    headers,
    html,
    cookies: headers['set-cookie'] || '',
    pathChecks: {}
  });
  const rootDomain = String(bundle.rootDomain || domain);
  const links = [];
  if (html) {
    const re = /href\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
    let m;
    while ((m = re.exec(html)) && links.length < 40) {
      const href = (m[1] || m[2] || '').trim();
      if (!/^https?:/i.test(href)) continue;
      try {
        const u = new URL(href);
        const host = u.hostname.toLowerCase().replace(/\.$/, '');
        if (host === rootDomain || host.endsWith('.' + rootDomain)) links.push(host);
      } catch (e) { /* skip */ }
    }
  }
  const subdomains = collectObservations({
    domain,
    rootDomain,
    sanDomains: [],
    nameservers: [],
    mxHosts: [],
    cnameTargets: [],
    spfHosts: [],
    htmlLinks: Array.from(new Set(links)),
    dkimSelectors: []
  });
  sendJson(res, 200, { ok: true, http, technology, subdomains });
}

module.exports = { handle, handleAnalyze };
