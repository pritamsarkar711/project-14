'use strict';

/*
 * LLMs.txt Generator: HTTP API.
 * POST /api/llmstxt           → SSE stream: progress events → result | error
 * POST /api/llmstxt-finalize  → JSON: regenerated file from an edited page list
 */

const { generate, finalize } = require('./index');
const { analyzeAndReport, parseOptions } = require('./crawler');
const { analyzeIndexability } = require('./indexabilityAnalyzer');
const { canonicalDecision } = require('./canonicalAnalyzer');
const { canonicalKey, hostOf } = require('./urlNormalizer');
const { assertPublicUrl } = require('../wptheme/ssrf');

const buckets = new Map();
let inflight = 0;
const MAX_INFLIGHT = 2;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 8;
const SCAN_MS = 180 * 1000;

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
  try { res.write('event: ' + event + '\n'); res.write('data: ' + JSON.stringify(data) + '\n\n'); } catch {}
}

function parseApiOptions(body) {
  const num = (v, d, min, max) => Math.min(Math.max(Number(v) || d, min), max);
  return {
    maxPages: num(body.maxPages, 500, 1, 10000),
    maxDepth: body.maxDepth === 'unlimited' ? 'unlimited' : num(body.maxDepth, 3, 1, 10),
    includeSubdomains: !!body.includeSubdomains,
    includeExternal: !!body.includeExternal,
    includePdfs: body.includePdfs !== false,
    includeBlog: body.includeBlog !== false,
    includeDocs: body.includeDocs !== false,
    includeCategories: !!body.includeCategories,
    includeAuthors: !!body.includeAuthors,
    includeNoindex: !!body.includeNoindex,
    maxBlogUrls: body.maxBlogUrls || 25,
    maxProducts: body.maxProducts || 50,
    websiteDescription: body.websiteDescription || '',
    concurrency: 6
  };
}

async function handle(req, res, body) {
  const ip = clientIp(req);
  if (!rateOk(ip)) { sendJson(res, 429, { code: 'ratelimit', message: 'Too many generation jobs. Please wait a few minutes.' }); return; }
  if (inflight >= MAX_INFLIGHT) { sendJson(res, 503, { code: 'busy', message: 'The LLMs.txt generator is busy. Please try again shortly.' }); return; }

  const input = String((body && (body.url || body.domain)) || '').trim();
  if (!input || input.length > 2048) { sendJson(res, 400, { code: 'invalid_input', message: 'Please enter a website URL (e.g. https://example.com).' }); return; }

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
    const report = await generate(input, { ...parseApiOptions(body), signal: ac.signal, onProgress: s => send(res, 'progress', s) });
    send(res, 'result', report);
  } catch (e) {
    const code = e.code || (ac.signal.aborted ? 'cancelled' : 'error');
    send(res, 'error', { code, message: e.message || 'Unable to complete the generation.' });
  } finally {
    inflight--;
    clearTimeout(timer);
    try { res.end(); } catch {}
  }
}

/* Browser fallback: the visitor's browser collected the pages; run the identical
 * server-side analysis (indexability → canonical → dedup → classify → score →
 * generate → validate) on the collected data. Pure CPU, no server-side fetch. */
async function handleBrowser(req, res, body) {
  const ip = clientIp(req);
  if (!rateOk(ip)) { sendJson(res, 429, { code: 'ratelimit', message: 'Too many requests. Please wait a few minutes.' }); return; }
  const url = String((body && body.url) || '').trim();
  if (!url || !Array.isArray(body && body.pages)) { sendJson(res, 400, { code: 'invalid_input', message: 'Missing URL or page data.' }); return; }
  try {
    let rootUrl;
    try { rootUrl = new URL(url); assertPublicUrl(rootUrl.toString()); } catch (e) { return sendJson(res, 400, { code: 'invalid_url', message: 'Invalid website URL.' }); }
    const root = rootUrl.toString();
    const host = hostOf(root);
    const o = parseOptions(body.options || {});
    const pages = (body.pages || []).slice(0, 2000).map(raw => {
      if (raw.blocked) return { url: raw.url, depth: raw.depth || 0, status: 0, blocked: true, included: false, inFile: false, excludeReason: 'Robots', reason: 'Excluded: robots.txt restriction', fromSitemap: !!raw.fromSitemap, inSitemap: !!raw.inSitemap };
      const p = {
        url: raw.url, requestedUrl: raw.requestedUrl || raw.url, depth: raw.depth || 0,
        status: raw.status, headers: raw.headers || {}, contentType: raw.contentType || '',
        redirected: !!raw.redirected, redirects: raw.redirects || [], challenge: raw.challenge || null,
        title: raw.title || '', metaDescription: raw.metaDescription || '', ogTitle: raw.ogTitle || '',
        ogDescription: raw.ogDescription || '', ogType: raw.ogType || '', ogSiteName: raw.ogSiteName || '',
        canonical: raw.canonical || null, noindex: !!raw.noindex, h1: raw.h1 || '', h2: raw.h2 || [],
        types: raw.types || [], breadcrumbs: raw.breadcrumbs || [], text: raw.text || '', wordCount: raw.wordCount || 0,
        paragraphs: raw.paragraphs || [], publishedDate: raw.publishedDate || null, modifiedDate: raw.modifiedDate || null,
        jsHeavy: !!raw.jsHeavy, isPdf: !!raw.isPdf, links: raw.links || [], linkObjects: raw.linkObjects || [],
        fromSitemap: !!raw.fromSitemap, inSitemap: !!raw.inSitemap,
        inlinks: raw.inlinks || 0, navLinked: !!raw.navLinked, footerLinked: !!raw.footerLinked, navLabels: raw.navLabels || []
      };
      const ix = analyzeIndexability(p, { includeNoindex: o.includeNoindex, includePdfs: o.includePdfs });
      p.indexable = ix.indexable;
      p.statusNote = ix.status;
      const cd = canonicalDecision(p, root, o.includeSubdomains);
      p.canonicalFinal = cd.canonical;
      p.canonicalized = cd.canonicalized;
      if (cd.canonicalized) { p.canonical = cd.canonical; p.reason = 'Excluded: ' + cd.reason; p.excludeReason = 'Non-canonical'; p.included = false; }
      else p.canonical = cd.canonical;
      return p;
    });

    const homeParsed = { metaDescription: body.homeParsed ? body.homeParsed.metaDescription : '', ogDescription: body.homeParsed ? body.homeParsed.ogDescription : '', paragraphs: body.homeParsed ? body.homeParsed.paragraphs : [], title: body.homeParsed ? body.homeParsed.title : '', body: body.homeParsed ? body.homeParsed.body : '' };
    const platform = body.platform || [];
    const report = analyzeAndReport(pages, {
      input: rootUrl, root, host, homeParsed, platform,
      robots: body.robots || { exists: false, sitemaps: [] },
      sitemaps: { sitemaps: body.sitemaps || [] },
      existingLlmsTxt: body.existingLlmsTxt || null,
      discovered: body.discovered || pages.length,
      started: Date.now(), externalCandidates: [], inlinks: null,
      options: o, progress: () => {}
    });
    sendJson(res, 200, report);
  } catch (e) {
    sendJson(res, 400, { code: e.code || 'error', message: e.message || 'Unable to analyze the collected pages.' });
  }
}

async function handleFinalize(req, res, body) {
  const ip = clientIp(req);
  if (!rateOk(ip)) { sendJson(res, 429, { code: 'ratelimit', message: 'Too many requests. Please wait a few minutes.' }); return; }
  const url = String((body && body.url) || '').trim();
  if (!url || !Array.isArray(body && body.pages)) { sendJson(res, 400, { code: 'invalid_input', message: 'Missing URL or page list.' }); return; }
  try {
    const out = await finalize(body);
    sendJson(res, 200, out);
  } catch (e) {
    sendJson(res, 400, { code: e.code || 'invalid_input', message: e.message || 'Unable to regenerate the file.' });
  }
}

module.exports = { handle, handleFinalize, handleBrowser };
