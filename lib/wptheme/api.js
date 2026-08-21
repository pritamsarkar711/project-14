'use strict';

/*
 * huvanti WordPress Theme Detector — scan API.
 * POST /api/wptheme-scan     { url }                → SSE: progress → result | error
 * POST /api/wptheme-analyze  { browser-collected bundle } → JSON report
 *
 * The analyze endpoint exists because some hosting networks (including this
 * preview sandbox) block direct outbound connections. In that case the page
 * collects the same resources through the visitor's browser and the identical
 * deterministic engine runs here on the submitted bundle.
 */

const { runScan, analyzeCollected } = require('./orchestrate');

const buckets = new Map();
let inflight = 0;
const MAX_INFLIGHT = 3;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 12;
const SCAN_MS = 60 * 1000;
const MAX_ANALYZE_BYTES = 6 * 1024 * 1024;

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}
function rateOk(ip) {
  const now = Date.now();
  const arr = (buckets.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) { buckets.set(ip, arr); return false; }
  arr.push(now); buckets.set(ip, arr); return true;
}
function send(res, event, data) {
  try { res.write('event: ' + event + '\n'); res.write('data: ' + JSON.stringify(data) + '\n\n'); } catch (e) {}
}

async function handle(req, res, body) {
  const ip = clientIp(req);
  if (!rateOk(ip)) {
    res.statusCode = 429; res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ code: 'ratelimit', message: 'Too many scans from this network. Please wait a few minutes.' })); return;
  }
  if (inflight >= MAX_INFLIGHT) {
    res.statusCode = 503; res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ code: 'busy', message: 'Another scan is already running on this server. Please wait and try again.' })); return;
  }
  const url = String((body && body.url) || '').trim();
  if (!url) {
    res.statusCode = 400; res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ code: 'invalid_url', message: 'Please enter a website URL (e.g. example.com).' })); return;
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), SCAN_MS);
  req.on('close', () => ac.abort());
  inflight++;
  try {
    const report = await runScan(url, {
      signal: ac.signal,
      onProgress: state => send(res, 'progress', state)
    });
    send(res, 'result', report);
  } catch (e) {
    const code = e.code || (ac.signal.aborted ? 'cancelled' : 'error');
    const message = e.message || 'Scan failed.';
    send(res, 'error', { code, message, scan: e.scan || null });
  } finally {
    inflight--; clearTimeout(timer); res.end();
  }
}

async function handleAnalyze(req, res, body) {
  const ip = clientIp(req);
  if (!rateOk(ip)) {
    res.statusCode = 429; res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ code: 'ratelimit', message: 'Too many scans from this network. Please wait a few minutes.' })); return;
  }
  if (!body || typeof body !== 'object' || !body.bundle) {
    res.statusCode = 400; res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ code: 'empty', message: 'No collected resources were submitted.' })); return;
  }
  const size = JSON.stringify(body).length;
  if (size > MAX_ANALYZE_BYTES) {
    res.statusCode = 413; res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ code: 'too_large', message: 'The collected bundle is too large to analyse.' })); return;
  }
  if (!Array.isArray(body.bundle.candidates) && !body.bundle.homeHtml) {
    res.statusCode = 400; res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ code: 'empty', message: 'The bundle contains no readable homepage HTML.' })); return;
  }
  body.bundle.via = 'browser';
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  try {
    const report = analyzeCollected(body.bundle);
    res.end(JSON.stringify(report));
  } catch (e) {
    res.statusCode = e.code === 'js_only' || e.code === 'empty' || e.code === 'challenge' ? 422 : 500;
    res.end(JSON.stringify({ code: e.code || 'error', message: e.message || 'Analysis failed.' }));
  }
}

module.exports = { handle, handleAnalyze };
