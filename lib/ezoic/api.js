'use strict';

const { runAudit, analyzeParsed } = require('./orchestrate');

const buckets = new Map();
let inflight = 0;
const MAX_INFLIGHT = 2;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 8;
const AUDIT_MS = 4 * 60 * 1000;

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function rateOk(ip) {
  const now = Date.now();
  const arr = (buckets.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) {
    buckets.set(ip, arr);
    return false;
  }
  arr.push(now);
  buckets.set(ip, arr);
  return true;
}

function send(res, event, data) {
  res.write('event: ' + event + '\n');
  res.write('data: ' + JSON.stringify(data) + '\n\n');
}

async function handle(req, res, body) {
  const ip = clientIp(req);
  if (!rateOk(ip)) {
    res.statusCode = 429;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ code: 'ratelimit', message: 'Too many audits from this network. Please wait a few minutes.' }));
    return;
  }
  if (inflight >= MAX_INFLIGHT) {
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ code: 'busy', message: 'Another audit is already running on this server. Please wait and try again.' }));
    return;
  }

  const url = String((body && body.url) || '').trim();
  const limit = Math.max(1, Math.min(250, parseInt(body && body.limit, 10) || 50));
  if (!url) {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ code: 'invalid_url', message: 'Please enter a valid public http(s) website URL.' }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), AUDIT_MS);
  req.on('close', () => ac.abort());

  inflight++;
  try {
    const report = await runAudit(url, {
      limit,
      signal: ac.signal,
      onProgress: state => {
        try { send(res, 'progress', state); } catch (e) { /* client gone */ }
      }
    });
    send(res, 'result', report);
  } catch (e) {
    const code = e.code || (ac.signal.aborted ? 'cancelled' : 'error');
    const message = e.message || 'Audit failed.';
    try { send(res, 'error', { code, message }); } catch (err) { /* ignore */ }
  } finally {
    inflight--;
    clearTimeout(timer);
    res.end();
  }
}

async function handleAnalyze(req, res, body) {
  const ip = clientIp(req);
  if (!rateOk(ip)) {
    res.statusCode = 429;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ code: 'ratelimit', message: 'Too many audits from this network. Please wait a few minutes.' }));
    return;
  }
  const scan = body && body.pages ? body : (body && body.scan) || null;
  if (!scan || !Array.isArray(scan.pages) || !scan.pages.length) {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ code: 'empty', message: 'No crawled pages were submitted.' }));
    return;
  }
  if (scan.pages.length > 250) scan.pages = scan.pages.slice(0, 250);
  scan.pages.forEach(p => {
    if (p && typeof p.html === 'string' && p.html.length > 120000) p.html = p.html.slice(0, 120000);
  });
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  try {
    const report = analyzeParsed(scan);
    res.end(JSON.stringify(report));
  } catch (e) {
    res.statusCode = e.code === 'empty' || e.code === 'challenge' ? 422 : 500;
    res.end(JSON.stringify({ code: e.code || 'error', message: e.message || 'Analysis failed.' }));
  }
}

module.exports = { handle, handleAnalyze };
