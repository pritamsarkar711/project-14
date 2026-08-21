'use strict';

/**
 * Broken Link Checker - HTTP API
 * POST /api/brokenlink  -> SSE: progress -> result | error
 */

const { crawlSite } = require('./crawler');

const buckets = new Map();
let inflight = 0;
const MAX_INFLIGHT = 4;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 20;
const SCAN_MS = 300 * 1000; // 5 minutes max per scan for deep crawl

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

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(obj));
}

function send(res, event, data) {
  try {
    res.write('event: ' + event + '\n');
    res.write('data: ' + JSON.stringify(data) + '\n\n');
  } catch {}
}

async function handle(req, res, body) {
  const ip = clientIp(req);
  if (!rateOk(ip)) {
    sendJson(res, 429, { code: 'ratelimit', message: 'Too many scans from this network. Please wait a few minutes.' });
    return;
  }
  if (inflight >= MAX_INFLIGHT) {
    sendJson(res, 503, { code: 'busy', message: 'The broken link checker is at capacity. Please try again in a moment.' });
    return;
  }

  const input = String((body && (body.url || body.domain)) || '').trim();
  if (!input || input.length > 2048) {
    sendJson(res, 400, { code: 'invalid_input', message: 'Please enter a website URL (e.g. https://example.com).' });
    return;
  }

  // Parse options
  const opts = {
    maxPages: Math.min(Math.max(Number(body.maxPages) || 100, 1), 10000),
    maxDepth: body.maxDepth === 'unlimited' || body.maxDepth === 'Unlimited' ? 'unlimited' : Math.min(Math.max(Number(body.maxDepth) || 3, 1), 10),
    scanScope: body.scanScope === 'internal' ? 'internal' : 'internal+external',
    checkExternal: body.checkExternal !== false,
    checkImages: !!body.checkImages,
    checkDocuments: !!body.checkDocuments,
    checkAnchors: !!body.checkAnchors,
    respectRobots: body.respectRobots !== false,
    concurrency: 4,
    checkConcurrency: 6
  };

  // If scanScope is internal, disable external checking
  if (opts.scanScope === 'internal') opts.checkExternal = false;

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
    const report = await crawlSite(input, {
      ...opts,
      signal: ac.signal,
      onProgress: state => send(res, 'progress', state)
    });
    send(res, 'result', report);
  } catch (e) {
    const code = e.code || (ac.signal.aborted ? 'cancelled' : 'error');
    send(res, 'error', { code, message: e.message || 'The scan failed.', details: e.details || null });
  } finally {
    inflight--;
    clearTimeout(timer);
    try { res.end(); } catch {}
  }
}

module.exports = { handle };
