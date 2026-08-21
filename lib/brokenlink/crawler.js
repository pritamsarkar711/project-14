'use strict';

/**
 * Broken Link Checker - Secure Crawler & Orchestrator
 * Implements full pipeline:
 * URL validation → SSRF protection → robots.txt → sitemap discovery → intelligent crawling → link extraction → normalization → deduplication → HTTP validation → retry verification → redirects → DNS → TLS → bot protection detection → anchor validation → canonical analysis → classification → evidence → scoring → reporting → export.
 */

const { validateUrlSyntax } = require('./urlValidator');
const { safeFetch } = require('./safeFetcher');
const { fetchRobots } = require('./robotsParser');
const { discoverSitemaps } = require('./sitemapDiscovery');
const { normalizeUrl, isInternal, canonicalKey } = require('./urlNormalizer');
const { extractLinksFromHtml } = require('./linkExtractor');
const { deduplicateLinks } = require('./linkDeduplicator');
const { checkWithRetry } = require('./retryManager');
const { analyzeRedirects } = require('./redirectAnalyzer');
const { validateAnchorLink } = require('./anchorAnalyzer');
const { analyzeCanonical, validateCanonical } = require('./canonicalAnalyzer');
const { detectNoindex } = require('./contentAnalyzer');
const { classify } = require('./brokenLinkClassifier');
const { generateReport } = require('./reportGenerator');
const { calculateScore } = require('./scoreCalculator');

function makeError(code, msg, extra) {
  const e = new Error(msg);
  e.code = code;
  if (extra) Object.assign(e, extra);
  return e;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function crawlSite(rawUrl, options = {}) {
  const started = Date.now();
  const onProgress = options.onProgress || (() => {});
  const signal = options.signal;

  const maxPages = Math.min(Math.max(Number(options.maxPages) || 100, 1), 10000);
  const maxDepth = options.maxDepth === 'unlimited' || options.maxDepth === 0 ? Infinity : Math.min(Number(options.maxDepth) || 3, 20);
  const checkExternal = options.checkExternal !== false;
  const checkImages = !!options.checkImages;
  const checkDocuments = !!options.checkDocuments;
  const checkAnchors = !!options.checkAnchors;
  const respectRobots = options.respectRobots !== false;
  const scanScope = options.scanScope || 'internal+external'; // 'internal' or 'internal+external'
  const concurrency = Math.min(Number(options.concurrency) || 4, 8);

  // 1. URL Validation
  onProgress({ stage: 'validate', message: 'Validating URL...', percent: null });
  const allowPrivate = options.allowPrivate || process.env.ALLOW_PRIVATE === '1';
  let inputUrl;
  try {
    inputUrl = validateUrlSyntax(rawUrl, { allowPrivate });
  } catch (e) {
    throw makeError(e.code || 'invalid_url', e.message);
  }

  const inputStr = inputUrl.toString();
  onProgress({ stage: 'url_validated', message: `URL validated: ${inputStr}`, inputUrl: inputStr });

  // 2. Fetch homepage to get final URL after redirects (validates SSRF, DNS, TLS)
  onProgress({ stage: 'connect', message: 'Connecting to website...', percent: null });
  let homeRes;
  try {
    homeRes = await safeFetch(inputStr, { signal, maxBytes: 1.5 * 1024 * 1024, timeout: 15000, allowPrivate });
  } catch (e) {
    if (e.code === 'ssrf') throw makeError('ssrf', e.message);
    if (e.code && e.code.toLowerCase().includes('dns')) throw makeError('dns', `DNS resolution failed for ${inputUrl.hostname}: ${e.message}`);
    if (e.code === 'tls_error') throw makeError('tls', `TLS error: ${e.message}`);
    if (e.code === 'timeout') throw makeError('timeout', `Connection timeout for ${inputStr}`);
    throw makeError(e.code || 'fetch_failed', `Could not connect to ${inputStr}: ${e.message}`);
  }

  const rootUrl = homeRes.finalUrl;
  const origin = new URL(rootUrl).origin;

  onProgress({ stage: 'connected', message: `Website connected: ${rootUrl}`, finalUrl: rootUrl, status: homeRes.status });

  // 3. robots.txt
  onProgress({ stage: 'robots', message: 'Fetching robots.txt...' });
  const robots = await fetchRobots(origin, { signal, allowPrivate });
  onProgress({ stage: 'robots_analyzed', message: robots.exists ? 'robots.txt analyzed' : 'No robots.txt found', robots: { exists: robots.exists, sitemaps: robots.sitemaps?.length || 0 } });

  if (respectRobots && !robots.allowed(rootUrl)) {
    throw makeError('robots', 'Crawling blocked by robots.txt for the start URL.');
  }

  // 4. Sitemap discovery
  onProgress({ stage: 'sitemap', message: 'Discovering sitemaps...' });
  let sitemapResult = { sitemaps: [], pageUrls: [] };
  try {
    sitemapResult = await discoverSitemaps(origin, robots, { signal, maxSitemaps: 8, maxTotalUrls: 5000, onProgress: () => {}, allowPrivate });
  } catch (e) {
    // Non-fatal
  }
  onProgress({ stage: 'sitemap_discovered', message: sitemapResult.sitemaps.length ? `Sitemap discovered (${sitemapResult.pageUrls.length} URLs)` : 'Sitemap discovery completed', sitemaps: sitemapResult.sitemaps.length });

  // 5. Intelligent crawling
  onProgress({ stage: 'crawl_start', message: 'Starting crawl...' });

  const queue = [{ url: rootUrl, depth: 0 }];
  const seen = new Set([canonicalKey(rootUrl)]);
  let discovered = 1;

  // Add sitemap URLs as discovery sources
  for (const u of sitemapResult.pageUrls.slice(0, maxPages)) {
    if (!isInternal(u, rootUrl, false)) continue;
    const k = canonicalKey(u);
    if (!seen.has(k)) {
      seen.add(k);
      queue.push({ url: u, depth: 1 });
      discovered++;
    }
  }

  const pages = []; // crawled pages with html
  const allLinks = []; // all extracted links with source
  let idx = 0;

  // Track crawl progress
  let crawledCount = 0;

  async function worker() {
    while (idx < queue.length && pages.length < maxPages) {
      if (signal && signal.aborted) throw makeError('cancelled', 'The scan was cancelled.');
      const item = queue[idx++];
      if (!item) break;

      // Respect robots
      if (respectRobots && !robots.allowed(item.url)) {
        pages.push({ url: item.url, status: 0, blockedByRobots: true, depth: item.depth, reason: 'Blocked by robots.txt', html: '', headers: {} });
        crawledCount++;
        onProgress({ stage: 'crawl', message: `${crawledCount} pages scanned, ${discovered} discovered`, discovered, crawled: crawledCount, pages: pages.length });
        continue;
      }

      // Depth check
      if (item.depth > maxDepth) continue;

      let page = { url: item.url, depth: item.depth, status: 0, html: '', headers: {}, links: [], blockedByRobots: false };

      try {
        const res = await safeFetch(item.url, { signal, maxBytes: 1.2 * 1024 * 1024, timeout: 12000, allowPrivate });
        page.url = res.finalUrl;
        page.status = res.status;
        page.headers = res.headers;
        page.html = res.body || '';
        page.redirects = res.redirects || [];
        page.ok = res.ok;

        // Content analysis
        const ct = String(res.headers['content-type'] || '').toLowerCase();
        const isHtml = /html|xml|text/.test(ct) || /<!doctype|<html/i.test(page.html.slice(0, 1000));

        if (isHtml && res.status >= 200 && res.status < 400) {
          // Canonical analysis
          const canResult = analyzeCanonical(page.url, page.html);
          page.canonical = canResult;

          // Noindex detection
          const noindex = detectNoindex(page.html, page.headers);
          page.noindex = noindex;

          // Link extraction
          const links = extractLinksFromHtml(page.html, page.url, { checkImages, checkDocuments, checkExternal });
          page.links = links;
          allLinks.push(...links.map(l => ({ ...l, source: page.url, depth: item.depth })));

          // Enqueue internal links for further crawling
          if (item.depth < maxDepth) {
            for (const link of links) {
              if (queue.length + pages.length >= maxPages) break;
              // Only crawl internal HTML pages, not images/files
              if (link.type === 'image' && !checkImages) continue;
              if (link.type === 'file' && !checkDocuments) continue;
              if (!isInternal(link.url, rootUrl, false)) continue;
              if (/\.(png|jpe?g|webp|avif|gif|svg|bmp|ico|css|js|mjs|woff2?|ttf|eot|mp4|webm|mp3|zip|rar|7z|exe|dmg)(\?|#|$)/i.test(link.url)) {
                if (!checkImages && !checkDocuments) continue;
                // Skip assets for crawling unless image/file checking enabled and we want to crawl them? No, don't crawl assets as pages
                continue;
              }
              const k = canonicalKey(link.url);
              if (!seen.has(k)) {
                if (respectRobots && !robots.allowed(link.url)) continue;
                seen.add(k);
                queue.push({ url: link.url, depth: item.depth + 1 });
                discovered++;
              }
            }
          }
        } else {
          // Non-HTML, still count as page
          page.links = [];
        }

      } catch (e) {
        page.status = 0;
        page.error = e.message;
        page.errorCode = e.code;
        page.reason = e.message;
      }

      pages.push(page);
      crawledCount++;
      onProgress({ stage: 'crawl', message: `${crawledCount} pages scanned, ${discovered} discovered, ${allLinks.length} links found`, discovered, crawled: crawledCount, pages: pages.length, links: allLinks.length });
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  onProgress({ stage: 'crawl_done', message: `${pages.length} pages scanned`, discovered, crawled: pages.length, links: allLinks.length });

  // 6. URL Normalization & Deduplication
  onProgress({ stage: 'normalize', message: `Normalizing ${allLinks.length} links...` });

  // Filter by scope
  let filteredLinks = allLinks;
  if (scanScope === 'internal' || !checkExternal) {
    filteredLinks = allLinks.filter(l => isInternal(l.url, rootUrl, false));
  }

  // Deduplicate
  const dedup = deduplicateLinks(filteredLinks);
  onProgress({ stage: 'deduplicated', message: `${dedup.uniqueCount} unique destinations, ${dedup.duplicateRefs} duplicate references removed`, duplicateRefs: dedup.duplicateRefs, unique: dedup.uniqueCount });

  // 7. HTTP Validation with retry, redirect analysis, classification
  onProgress({ stage: 'checking', message: `Checking ${dedup.uniqueCount} unique destinations...` });

  const issues = [];
  let checked = 0;
  const cache = new Map(); // key -> result

  // Concurrency for checking
  const checkConcurrency = Math.min(Number(options.checkConcurrency) || 6, 10);
  let checkIdx = 0;
  const uniqueList = dedup.unique;

  // For progress tracking
  let lastProgressEmit = Date.now();

  async function checkWorker() {
    while (checkIdx < uniqueList.length) {
      if (signal && signal.aborted) throw makeError('cancelled', 'The scan was cancelled.');
      const item = uniqueList[checkIdx++];
      if (!item) break;

      const cacheKey = item.key;
      let checkResult;
      if (cache.has(cacheKey)) {
        checkResult = cache.get(cacheKey);
      } else {
        try {
          checkResult = await checkWithRetry(item.url, { signal, timeout: 12000, maxBytes: 400 * 1024, maxRetries: 2, allowPrivate });
          cache.set(cacheKey, checkResult);
        } catch (e) {
          checkResult = { url: item.url, status: 0, error: e.message, errorCode: e.code || 'fetch_failed', attempts: [], attemptCount: 0 };
        }
      }

      checked++;
      // Throttle progress emits
      if (Date.now() - lastProgressEmit > 300 || checked === uniqueList.length) {
        lastProgressEmit = Date.now();
        onProgress({ stage: 'checking', message: `Checking links... ${checked}/${uniqueList.length}`, checked, total: uniqueList.length });
      }

      // Redirect analysis
      const redirectAnalysis = analyzeRedirects(checkResult.redirects || [], checkResult.finalUrl, item.url);

      // Classification
      const classification = classify({
        status: checkResult.status,
        error: checkResult.error,
        errorCode: checkResult.errorCode,
        botProtection: checkResult.botProtection,
        dns: checkResult.dns,
        tls: checkResult.tls,
        attempts: checkResult.attempts,
        attemptCount: checkResult.attemptCount,
        redirects: checkResult.redirects,
        blockedByRobots: false
      });

      // Determine internal/external
      const isInt = isInternal(item.url, rootUrl, false);

      // Skip healthy if we only want to report issues? But we need stats
      // We'll create issue object for all, but later filter for dashboard
      const linkType = item.types[0] || (/\.(png|jpe?g|webp|avif|gif|svg)$/i.test(item.url) ? 'image' : /\.(pdf|doc|docx|xls|xlsx|csv|zip|txt)$/i.test(item.url) ? 'file' : 'a');

      // For anchor validation, if original had fragment
      let anchorIssue = null;
      if (checkAnchors && item.rawOccurrences.some(ro => ro.fragment)) {
        // For each occurrence with fragment, validate anchor
        for (const occ of item.rawOccurrences) {
          if (!occ.fragment) continue;
          if (checkResult.status >= 200 && checkResult.status < 400) {
            try {
              const anchorRes = await validateAnchorLink(checkResult.finalUrl || item.url, occ.fragment, safeFetch, { signal, timeout: 8000, allowPrivate });
              if (!anchorRes.valid && anchorRes.type === 'broken_anchor') {
                anchorIssue = anchorRes;
                // Override classification for broken anchor
                classification.classification = 'Broken Anchor';
                classification.category = 'broken_anchor';
                classification.reason = anchorRes.reason;
                break;
              }
            } catch {}
          }
        }
      }

      // Only push if not healthy, or if we want all for stats? We'll push all but mark
      const issueObj = {
        source: item.firstSeen,
        sources: item.sources,
        destination: item.url,
        url: item.url,
        originalWithFragment: item.originalWithFragment,
        anchorText: item.anchorTexts[0] || '',
        anchorTexts: item.anchorTexts,
        occurrences: item.occurrences,
        rawOccurrences: item.rawOccurrences,
        linkType,
        isInternal: isInt,
        depth: Math.min(...item.rawOccurrences.map(ro => {
          const srcPage = pages.find(p => p.url === ro.source);
          return srcPage ? srcPage.depth : 0;
        })),
        result: checkResult,
        classification,
        redirectAnalysis,
        anchorIssue,
        finalUrl: checkResult.finalUrl,
        status: checkResult.status
      };

      // For stats, we count all, but for issues list we keep all classified results
      issues.push(issueObj);
    }
  }

  const checkWorkers = Array.from({ length: checkConcurrency }, () => checkWorker());
  await Promise.all(checkWorkers);

  onProgress({ stage: 'checking_done', message: `${checked} destinations checked`, checked });

  // 8. Canonical analysis validation for canonical issues (separate)
  onProgress({ stage: 'canonical', message: 'Analyzing canonicals...' });
  const canonicalIssues = [];
  for (const page of pages.slice(0, 100)) { // limit to 100 for performance
    if (!page.canonical || !page.canonical.hasCanonical) continue;
    const canUrl = page.canonical.canonical;
    if (!canUrl) continue;
    // Check if canonical points to another domain, etc.
    if (page.canonical.issues.length) {
      canonicalIssues.push({ pageUrl: page.url, canonical: canUrl, issues: page.canonical.issues, type: page.canonical.type });
    }
    // Optionally validate canonical reachability
    try {
      const canCheck = await checkWithRetry(canUrl, { signal, timeout: 8000, maxBytes: 200 * 1024, maxRetries: 1, allowPrivate });
      if (canCheck.status === 404) {
        canonicalIssues.push({ pageUrl: page.url, canonical: canUrl, issues: ['Canonical points to 404'], type: 'canonical_404', status: 404 });
      } else if (canCheck.status >= 300 && canCheck.status < 400) {
        canonicalIssues.push({ pageUrl: page.url, canonical: canUrl, issues: [`Canonical points to redirect (${canCheck.status})`], type: 'canonical_redirect', status: canCheck.status });
      }
    } catch {}
  }

  // 9. Sitemap issues
  const sitemapIssues = [];
  if (sitemapResult.sitemaps.length) {
    for (const sm of sitemapResult.sitemaps) {
      if (!sm.valid) {
        sitemapIssues.push({ url: sm.url, type: 'inaccessible_sitemap', reason: sm.error || `Status ${sm.status}` });
      } else if (sm.isIndex) {
        // ok
      } else {
        // Check some sitemap URLs for broken?
        // We'll sample first 20 URLs for quick check
        const sample = sm.urls.slice(0, 20);
        for (const u of sample) {
          const found = issues.find(i => i.url === u && i.classification.classification === 'Confirmed Broken');
          if (found) {
            sitemapIssues.push({ url: sm.url, type: 'broken_sitemap_url', sitemapUrl: sm.url, brokenUrl: u, status: found.status, reason: `Sitemap contains broken URL: ${u} (${found.status})` });
          }
        }
      }
    }
  }

  // 10. Generate report
  onProgress({ stage: 'report', message: 'Generating report...' });

  const reportData = {
    inputUrl: inputStr,
    finalUrl: rootUrl,
    pagesDiscovered: discovered,
    pagesScanned: pages.length,
    linksDiscovered: allLinks.length,
    uniqueLinks: dedup.uniqueCount,
    internalLinks: allLinks.filter(l => isInternal(l.url, rootUrl, false)).length,
    externalLinks: allLinks.filter(l => !isInternal(l.url, rootUrl, false)).length,
    checkedLinks: checked,
    issues,
    duplicateRefs: dedup.duplicateRefs,
    robots,
    sitemaps: sitemapResult,
    durationMs: Date.now() - started,
    settings: {
      maxPages,
      maxDepth: maxDepth === Infinity ? 'Unlimited' : maxDepth,
      checkExternal,
      checkImages,
      checkDocuments,
      checkAnchors,
      scanScope,
      respectRobots
    },
    canonicalIssues,
    sitemapIssues,
    pages: pages.map(p => ({ url: p.url, status: p.status, depth: p.depth, blockedByRobots: !!p.blockedByRobots }))
  };

  const report = generateReport(reportData);
  report.canonicalIssues = canonicalIssues;
  report.sitemapIssues = sitemapIssues;
  report.pagesDetail = pages.map(p => ({
    url: p.url,
    status: p.status,
    depth: p.depth,
    blocked: !!p.blockedByRobots,
    noindex: p.noindex ? p.noindex.noindex : false,
    canonical: p.canonical ? p.canonical.canonical : null,
    linkCount: p.links ? p.links.length : 0
  }));

  // Score
  const score = calculateScore(report);
  report.score = score;

  // Severity summary
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const iss of issues) {
    const cls = iss.classification;
    let sev = 'low';
    if (cls.category === 'broken' || cls.category === 'dns_error' || cls.category === 'server_error' || cls.category === 'ssl_error' || cls.category === 'broken_anchor') {
      if (iss.isInternal) {
        if (cls.category === 'broken' && (iss.status === 404 || iss.status === 410)) sev = iss.occurrences > 5 ? 'critical' : 'high';
        else if (cls.category === 'dns_error' || cls.category === 'server_error') sev = 'critical';
        else sev = 'high';
      } else {
        sev = 'medium';
      }
    } else if (cls.category === 'redirect') {
      if (iss.redirectAnalysis && iss.redirectAnalysis.isLoop) sev = 'critical';
      else if (iss.redirectAnalysis && iss.redirectAnalysis.count > 3) sev = 'medium';
      else sev = 'low';
    } else if (cls.category === 'timeout' || cls.category === 'temporary_failure') {
      sev = 'medium';
    } else {
      sev = 'low';
    }
    severityCounts[sev] = (severityCounts[sev] || 0) + 1;
    iss.severity = sev;
  }
  report.severity = severityCounts;

  onProgress({ stage: 'done', message: 'Scan complete', report: { stats: report.stats, score: report.score.score } });

  return report;
}

module.exports = { crawlSite };
