'use strict';

/*
 * RSS Feed Generator: HTTP API.
 *   POST /api/rss           → SSE stream: progress events → result | error
 *   POST /api/rss-finalize  → JSON: regenerated feed from an edited page list
 *   POST /api/rss-browser   → JSON: identical analysis on pages collected by
 *                             the visitor's browser (fallback when the server
 *                             cannot reach the site)
 *
 * Rate-limited per IP, bounded inflight, SSRF-guarded upstream, no AI.
 */

const { crawlSite, crawlSitemap, analyzeAndReport, finalize, parseOptions } = require('./crawler');
const { fetchRobots } = require('../llmstxt/robotsParser');
const { discoverSitemaps } = require('./sitemapParser');
const { detectExistingFeed } = require('./feedDetector');
const { hostOf } = require('../llmstxt/urlNormalizer');
const { cleanDescription } = require('./contentSanitizer');
const { parsePage } = require('../llmstxt/pageParser');
const { makeError } = require('../wptheme/util');

const buckets = new Map();
let inflight = 0;
const MAX_INFLIGHT = 2;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 8;
const SCAN_MS = 240 * 1000;

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
  return {
    mode: body.mode === 'sitemap' ? 'sitemap' : 'website',
    maxPages: body.maxPages,
    maxDepth: body.maxDepth,
    maxItems: body.maxItems,
    includeSubdomains: !!body.includeSubdomains,
    contentMode: body.contentMode,
    feedMode: body.feedMode,
    includeImages: body.includeImages,
    includeAuthors: body.includeAuthors,
    includeCategories: body.includeCategories,
    includePubDate: body.includePubDate,
    excludeUndated: body.excludeUndated,
    sortOrder: body.sortOrder,
    channelTitle: body.channelTitle,
    channelDescription: body.channelDescription,
    channelLink: body.channelLink,
    concurrency: 6
  };
}

async function handle(req, res, body) {
  const ip = clientIp(req);
  if (!rateOk(ip)) { sendJson(res, 429, { code: 'ratelimit', message: 'Too many generation jobs. Please wait a few minutes.' }); return; }
  if (inflight >= MAX_INFLIGHT) { sendJson(res, 503, { code: 'busy', message: 'The RSS generator is busy. Please try again shortly.' }); return; }

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
    const opts = { ...parseApiOptions(body), signal: ac.signal, onProgress: s => send(res, 'progress', s) };
    const report = body.mode === 'sitemap' ? await crawlSitemap(input, opts) : await crawlSite(input, opts);
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

/*
 * Browser fallback: the visitor's browser collected the pages (via relays
 * when the server has no egress). Run the identical server-side analysis on
 * the collected data. Pure CPU, no server-side fetches for pages, but the
 * server still checks robots.txt/sitemaps/existing feeds directly when it
 * can (failures degrade gracefully to the browser-provided copies).
 */
async function handleBrowser(req, res, body) {
  const ip = clientIp(req);
  if (!rateOk(ip)) { sendJson(res, 429, { code: 'ratelimit', message: 'Too many requests. Please wait a few minutes.' }); return; }
  const url = String((body && body.url) || '').trim();
  if (!url || !Array.isArray(body.pages)) { sendJson(res, 400, { code: 'invalid_input', message: 'Missing URL or page data.' }); return; }
  try {
    let rootUrl;
    try {
      rootUrl = new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url);
    } catch { return sendJson(res, 400, { code: 'invalid_url', message: 'Invalid website URL.' }); }
    const root = rootUrl.toString();
    const host = hostOf(root);
    const o = parseOptions(body.options || {});
    o.channelTitle = (body.options && body.options.channelTitle) || '';
    o.channelDescription = (body.options && body.options.channelDescription) || '';
    o.channelLink = (body.options && body.options.channelLink) || '';

    const pages = (body.pages || []).slice(0, 1200).map(raw => {
      const p = {
        url: raw.url, requestedUrl: raw.requestedUrl || raw.url, depth: raw.depth || 0,
        status: raw.status || 0, contentType: raw.contentType || 'text/html',
        redirected: !!raw.redirected, redirects: raw.redirects || [],
        challenge: raw.challenge ? { detected: true, provider: 'Detected' } : null,
        blocked: !!raw.blocked, error: raw.error || null,
        fromSitemap: !!raw.fromSitemap, inSitemap: !!raw.inSitemap,
        _lastmod: raw.lastmod || null,
        _audioLength: raw.audioLength != null ? raw.audioLength : null
      };
      if (raw.blocked || raw.status === 0) return p;
      if (raw.challenge && raw.status !== 200) return p;
      if (raw.status >= 400) return p;
      p.base = {
        title: raw.title || '', metaDescription: raw.metaDescription || '',
        ogTitle: raw.ogTitle || '', ogDescription: raw.ogDescription || '',
        ogType: raw.ogType || '', ogSiteName: raw.ogSiteName || '',
        canonical: raw.canonical || null, noindex: !!raw.noindex,
        h1: raw.h1 || '', h2: raw.h2 || [], types: raw.types || [],
        breadcrumbs: raw.breadcrumbs || [], text: raw.text || '',
        wordCount: raw.wordCount || 0, paragraphs: raw.paragraphs || [],
        links: raw.links || [], linkObjects: [], jsHeavy: !!raw.jsHeavy
      };
      p.hasArticleTag = !!raw.hasArticleTag;
      p._article = {
        headline: raw.headline || null,
        ogTitle: raw.ogTitle || '',
        titleTag: raw.title || '',
        h1: raw.h1 || '',
        metaDescription: raw.metaDescription || '',
        ogDescription: raw.ogDescription || '',
        firstParagraph: raw.firstParagraph || '',
        structuredRaw: raw.structuredDate || '',
        metaRaw: raw.metaPublishedTime || '',
        timeInfo: raw.timeDatetime ? { raw: raw.timeDatetime, iso: raw.timeDatetime } : null,
        visibleInfo: raw.visibleDate ? { raw: raw.visibleDate, iso: raw.visibleDate } : null,
        author: raw.articleAuthor || null,
        image: raw.ogImage || raw.image || null,
        articleSection: raw.articleSection || null,
        articleHtml: String(raw.articleHtml || '').slice(0, 60 * 1024),
        wordCount: raw.wordCount || 0,
        breadcrumbs: raw.breadcrumbs || [],
        canonical: raw.canonical || null,
        noindex: !!raw.noindex,
        audioUrl: raw.audioUrl || null
      };
      return p;
    });

    // Site metadata: explicit > homepage metadata > host.
    let siteName = body.siteName || '';
    let siteDescription = body.siteDescription || '';
    let platform = body.platform || [];
    let robots = { exists: !!body.robots, url: new URL('/robots.txt', root).toString(), sitemaps: (body.robotsSitemaps || []), crawlDelay: null };
    let sitemaps = { sitemaps: body.sitemaps || [], lastmodMap: new Map() };
    let existingFeed = null;

    if (body.homeHtml) {
      const homeParsed = parsePage(body.homeHtml, root, {});
      siteName = siteName || (homeParsed.ogSiteName || homeParsed.ogTitle || homeParsed.title || '').trim();
      siteDescription = siteDescription || cleanDescription(homeParsed.metaDescription || homeParsed.ogDescription || (homeParsed.paragraphs || [])[0], { maxLength: 300 });
    }
    if (!siteName) siteName = host;

    // Server-direct enrichment (best effort, fast-fail).
    try {
      const r = await fetchRobots(new URL(root).origin, { timeout: 6000 });
      robots = { exists: r.exists, url: r.url, sitemaps: r.sitemaps, crawlDelay: r.crawlDelay, _allowed: r.allowed };
    } catch {}
    try {
      const sm = await discoverSitemaps(new URL(root).origin, { sitemaps: robots.sitemaps || [] }, { timeout: 8000, maxSitemaps: 8, maxTotalUrls: 10000 });
      if (sm.sitemaps.length) sitemaps = sm;
    } catch {}
    if (body.homeHtml || body.existingFeedXml) {
      try {
        const det = await detectExistingFeed(new URL(root).origin, body.homeHtml || '', root, { timeout: 8000 });
        if (det.existing) existingFeed = det.existing;
        else if (body.existingFeedXml) existingFeed = browserExistingFeed(body.existingFeedUrl, body.existingFeedXml);
      } catch {
        if (body.existingFeedXml) existingFeed = browserExistingFeed(body.existingFeedUrl, body.existingFeedXml);
      }
    }

    // lastmod map: prefer server sitemap, merge browser lastmods.
    const lastmodMap = new Map(sitemaps.lastmodMap || []);
    for (const p of pages) if (p._lastmod && p.url && !lastmodMap.has(p.url)) lastmodMap.set(p.url, p._lastmod);

    const report = analyzeAndReport(pages, {
      mode: 'website', input: root, root, host, siteName, siteDescription,
      platform, robots: { exists: robots.exists, url: robots.url, sitemaps: robots.sitemaps },
      sitemaps: { sitemaps: sitemaps.sitemaps || [] }, lastmodMap, existingFeed,
      discovered: body.discovered || pages.length, started: Date.now(), options: o, progress: () => {}
    });
    report.transport = 'browser';
    sendJson(res, 200, report);
  } catch (e) {
    sendJson(res, 400, { code: e.code || 'error', message: e.message || 'Unable to analyze the collected pages.' });
  }
}

function browserExistingFeed(url, xml) {
  const { parseFeed } = require('./feedParser');
  const feed = parseFeed(xml);
  if (!feed) return null;
  return {
    url, format: feed.format, title: feed.title, link: feed.link,
    description: feed.description, itemCount: feed.items.length,
    items: feed.items.slice(0, 500), wordpress: false, candidates: []
  };
}

async function handleFinalize(req, res, body) {
  const ip = clientIp(req);
  if (!rateOk(ip)) { sendJson(res, 429, { code: 'ratelimit', message: 'Too many requests. Please wait a few minutes.' }); return; }
  try {
    const out = await finalize(body);
    sendJson(res, 200, out);
  } catch (e) {
    sendJson(res, 400, { code: e.code || 'invalid_input', message: e.message || 'Unable to regenerate the feed.' });
  }
}

module.exports = { handle, handleFinalize, handleBrowser };
