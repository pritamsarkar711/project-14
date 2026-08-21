'use strict';

/**
 * Broken Link Checker - Secure Crawler & Orchestrator - Deeply thorough version
 * Full pipeline: validation → SSRF → robots.txt → sitemap discovery → intelligent crawling → extraction → normalization → dedup → HTTP validation → retry → redirects → DNS/TLS/bot → anchor → canonical → classification → scoring → report
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
const { analyzeCanonical } = require('./canonicalAnalyzer');
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

async function crawlSite(rawUrl, options = {}) {
  const started = Date.now();
  const onProgress = options.onProgress || (() => {});
  const signal = options.signal;

  const maxPages = Math.min(Math.max(Number(options.maxPages) || 500, 1), 10000);
  let maxDepth = options.maxDepth;
  if (maxDepth === 'unlimited' || maxDepth === 'Unlimited' || maxDepth === 0) maxDepth = Infinity;
  else maxDepth = Math.min(Math.max(Number(maxDepth) || 5, 1), 20);

  const checkExternal = options.checkExternal !== false;
  const checkImages = !!options.checkImages;
  const checkDocuments = !!options.checkDocuments;
  const checkAnchors = !!options.checkAnchors;
  const respectRobots = options.respectRobots !== false;
  const scanScope = options.scanScope || 'internal+external';
  const concurrency = Math.min(Number(options.concurrency) || 5, 8);
  const allowPrivate = options.allowPrivate || process.env.ALLOW_PRIVATE === '1';

  onProgress({ stage: 'validate', message: 'Validating URL...', percent: null });
  let inputUrl;
  try {
    inputUrl = validateUrlSyntax(rawUrl, { allowPrivate });
  } catch (e) {
    throw makeError(e.code || 'invalid_url', e.message);
  }

  const inputStr = inputUrl.toString();
  onProgress({ stage: 'url_validated', message: `URL validated: ${inputStr}`, inputUrl: inputStr });

  onProgress({ stage: 'connect', message: 'Connecting to website...', percent: null });
  let homeRes;
  try {
    homeRes = await safeFetch(inputStr, { signal, maxBytes: 2 * 1024 * 1024, timeout: 15000, allowPrivate });
  } catch (e) {
    if (e.code === 'ssrf') throw makeError('ssrf', e.message);
    if (e.code && e.code.toLowerCase().includes('dns')) throw makeError('dns', `DNS resolution failed for ${inputUrl.hostname}: ${e.message}`);
    if (e.code === 'tls_error') throw makeError('tls', `TLS error: ${e.message}`);
    if (e.code === 'timeout') throw makeError('timeout', `Connection timeout for ${inputStr}`);
    throw makeError(e.code || 'fetch_failed', `Could not connect to ${inputStr}: ${e.message}`);
  }

  const rootUrl = homeRes.finalUrl;
  const origin = new URL(rootUrl).origin;
  const rootHost = new URL(rootUrl).hostname.toLowerCase();

  onProgress({ stage: 'connected', message: `Website connected: ${rootUrl}`, finalUrl: rootUrl, status: homeRes.status });

  onProgress({ stage: 'robots', message: 'Fetching robots.txt...' });
  const robots = await fetchRobots(origin, { signal, allowPrivate });
  onProgress({ stage: 'robots_analyzed', message: robots.exists ? 'robots.txt analyzed' : 'No robots.txt found', robots: { exists: robots.exists, sitemaps: robots.sitemaps?.length || 0 } });

  if (respectRobots && !robots.allowed(rootUrl)) {
    throw makeError('robots', 'Crawling blocked by robots.txt for the start URL.');
  }

  onProgress({ stage: 'sitemap', message: 'Discovering sitemaps...' });
  let sitemapResult = { sitemaps: [], pageUrls: [] };
  try {
    sitemapResult = await discoverSitemaps(origin, robots, {
      signal,
      maxSitemaps: 15,
      maxUrlsPerSitemap: 10000,
      maxTotalUrls: 10000,
      onProgress: () => {},
      allowPrivate
    });
  } catch (e) {}
  onProgress({
    stage: 'sitemap_discovered',
    message: sitemapResult.sitemaps.length ? `Sitemap discovered (${sitemapResult.pageUrls.length} URLs from ${sitemapResult.sitemaps.length} sitemaps)` : 'Sitemap discovery completed',
    sitemaps: sitemapResult.sitemaps.length,
    sitemapUrls: sitemapResult.pageUrls.length
  });

  onProgress({ stage: 'crawl_start', message: 'Starting deep crawl...' });

  // Use Map for seen with depth tracking to allow shallower revisits? No, keep simple Set but allow deeper if found shallower
  const seen = new Map(); // key -> depth
  const queue = [];
  const pages = [];
  const allLinks = [];
  let discovered = 0;

  function enqueue(url, depth) {
    const k = canonicalKey(url);
    if (!k) return false;
    const existingDepth = seen.get(k);
    if (existingDepth != null && existingDepth <= depth) return false; // already seen at shallower or equal depth
    if (respectRobots && !robots.allowed(url)) return false;
    // Don't enqueue if we already have enough discovered + scanned
    if (queue.length + pages.length >= maxPages * 2) return false;
    seen.set(k, depth);
    queue.push({ url, depth });
    discovered++;
    return true;
  }

  enqueue(rootUrl, 0);
  // Add sitemap URLs
  for (const u of sitemapResult.pageUrls.slice(0, maxPages)) {
    if (!isInternal(u, rootUrl, false)) continue;
    enqueue(u, 1);
  }

  let crawledCount = 0;
  let queueIndex = 0;

  async function worker() {
    while (true) {
      if (signal && signal.aborted) throw makeError('cancelled', 'The scan was cancelled.');
      let item;
      // Critical section for queueIndex
      if (queueIndex >= queue.length) break;
      if (pages.length >= maxPages) break;
      item = queue[queueIndex++];
      if (!item) break;

      if (item.depth > maxDepth) {
        crawledCount++;
        continue;
      }

      if (respectRobots && !robots.allowed(item.url)) {
        pages.push({ url: item.url, status: 0, blockedByRobots: true, depth: item.depth, reason: 'Blocked by robots.txt', html: '', headers: {} });
        crawledCount++;
        onProgress({ stage: 'crawl', message: `${crawledCount} pages scanned, ${discovered} discovered, ${allLinks.length} links found`, discovered, crawled: crawledCount, pages: pages.length, links: allLinks.length });
        continue;
      }

      let page = { url: item.url, depth: item.depth, status: 0, html: '', headers: {}, links: [], blockedByRobots: false };

      try {
        const res = await safeFetch(item.url, { signal, maxBytes: 2 * 1024 * 1024, timeout: 12000, allowPrivate });
        page.url = res.finalUrl;
        page.status = res.status;
        page.headers = res.headers;
        page.html = res.body || '';
        page.redirects = res.redirects || [];
        page.ok = res.ok;

        const ct = String(res.headers['content-type'] || '').toLowerCase();
        const isHtml = /html|xml|text/.test(ct) || /<!doctype|<html/i.test(page.html.slice(0, 2000));

        if (isHtml && res.status >= 200 && res.status < 400) {
          const canResult = analyzeCanonical(page.url, page.html);
          page.canonical = canResult;
          const noindex = detectNoindex(page.html, page.headers);
          page.noindex = noindex;
          page.jsHeavy = page.html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').trim().length < 300 && /<script/i.test(page.html);

          const links = extractLinksFromHtml(page.html, page.url, { checkImages, checkDocuments, checkExternal });
          page.links = links;
          allLinks.push(...links.map(l => ({ ...l, source: page.url, depth: item.depth })));

          // Deep discovery: enqueue internal links
          if (item.depth < maxDepth && pages.length < maxPages) {
            // Prioritize links that look like posts, pages, categories, pagination
            // Sort links by likelihood? For now, just iterate
            for (const link of links) {
              if (pages.length >= maxPages) break;
              if (queue.length >= maxPages) break;
              // Don't crawl images/files as pages
              if (link.type === 'image') continue;
              if (link.type === 'file' && !checkDocuments) continue;
              // Only internal for crawling
              if (!isInternal(link.url, rootUrl, false)) continue;
              // Skip assets
              if (/\.(css|js|mjs|json|xml|woff2?|ttf|eot|less|scss)(\?|#|$)/i.test(link.url)) continue;
              if (/\.(png|jpe?g|webp|avif|gif|svg|bmp|ico|mp4|webm|mp3|wav|avi|mov)(\?|#|$)/i.test(link.url) && !checkImages) continue;

              // Skip mailto etc already filtered
              enqueue(link.url, item.depth + 1);
            }
          }
        } else {
          page.links = [];
        }
      } catch (e) {
        page.status = 0;
        page.error = e.message;
        page.errorCode = e.code;
        page.reason = e.message;
        page.redirects = e.redirects || [];
      }

      pages.push(page);
      crawledCount++;
      onProgress({
        stage: 'crawl',
        message: `${crawledCount} pages scanned, ${discovered} discovered, ${allLinks.length} links found`,
        discovered,
        crawled: crawledCount,
        pages: pages.length,
        links: allLinks.length
      });
    }
  }

  // Run workers
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  onProgress({ stage: 'crawl_done', message: `${pages.length} pages scanned, ${discovered} discovered`, discovered, crawled: pages.length, links: allLinks.length });

  onProgress({ stage: 'normalize', message: `Normalizing ${allLinks.length} links...` });

  let filteredLinks = allLinks;
  if (scanScope === 'internal' || !checkExternal) {
    filteredLinks = allLinks.filter(l => isInternal(l.url, rootUrl, false));
  }

  // Also filter images/docs if toggles off for checking (but we already didn't extract images if off, but a tags that are images still exist)
  if (!checkImages) {
    filteredLinks = filteredLinks.filter(l => l.type !== 'image');
  }
  if (!checkDocuments) {
    filteredLinks = filteredLinks.filter(l => l.type !== 'file');
  }

  const dedup = deduplicateLinks(filteredLinks);
  onProgress({
    stage: 'deduplicated',
    message: `${dedup.uniqueCount} unique destinations, ${dedup.duplicateRefs} duplicate references removed`,
    duplicateRefs: dedup.duplicateRefs,
    unique: dedup.uniqueCount
  });

  onProgress({ stage: 'checking', message: `Checking ${dedup.uniqueCount} unique destinations...` });

  const issues = [];
  let checked = 0;
  const cache = new Map();
  const checkConcurrency = Math.min(Number(options.checkConcurrency) || 8, 12);
  let checkIdx = 0;
  const uniqueList = dedup.unique;
  let lastProgressEmit = Date.now();

  async function checkWorker() {
    while (true) {
      if (signal && signal.aborted) throw makeError('cancelled', 'The scan was cancelled.');
      if (checkIdx >= uniqueList.length) break;
      const item = uniqueList[checkIdx++];
      if (!item) break;

      const cacheKey = item.key;
      let checkResult;
      if (cache.has(cacheKey)) {
        checkResult = cache.get(cacheKey);
      } else {
        try {
          checkResult = await checkWithRetry(item.url, { signal, timeout: 15000, maxBytes: 600 * 1024, maxRetries: 2, allowPrivate });
          cache.set(cacheKey, checkResult);
        } catch (e) {
          checkResult = { url: item.url, status: 0, error: e.message, errorCode: e.code || 'fetch_failed', attempts: [], attemptCount: 0, redirects: e.redirects || [] };
        }
      }

      checked++;
      if (Date.now() - lastProgressEmit > 250 || checked === uniqueList.length) {
        lastProgressEmit = Date.now();
        onProgress({ stage: 'checking', message: `Checking links... ${checked}/${uniqueList.length}`, checked, total: uniqueList.length });
      }

      const redirectAnalysis = analyzeRedirects(checkResult.redirects || [], checkResult.finalUrl, item.url);
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

      const isInt = isInternal(item.url, rootUrl, false);
      const linkType = item.types[0] || (/\.(png|jpe?g|webp|avif|gif|svg|bmp|ico)$/i.test(item.url) ? 'image' : /\.(pdf|doc|docx|xls|xlsx|csv|zip|txt|ppt|pptx)$/i.test(item.url) ? 'file' : 'a');

      let anchorIssue = null;
      if (checkAnchors && item.rawOccurrences.some(ro => ro.fragment)) {
        for (const occ of item.rawOccurrences) {
          if (!occ.fragment) continue;
          if (checkResult.status >= 200 && checkResult.status < 400) {
            try {
              const anchorRes = await validateAnchorLink(checkResult.finalUrl || item.url, occ.fragment, safeFetch, { signal, timeout: 8000, allowPrivate });
              if (!anchorRes.valid && anchorRes.type === 'broken_anchor') {
                anchorIssue = anchorRes;
                classification.classification = 'Broken Anchor';
                classification.category = 'broken_anchor';
                classification.reason = anchorRes.reason;
                break;
              }
            } catch {}
          }
        }
      }

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

      issues.push(issueObj);
    }
  }

  await Promise.all(Array.from({ length: checkConcurrency }, () => checkWorker()));

  onProgress({ stage: 'checking_done', message: `${checked} destinations checked`, checked });

  onProgress({ stage: 'canonical', message: 'Analyzing canonicals & indexability...' });
  const canonicalIssues = [];
  const noindexPages = [];
  for (const page of pages.slice(0, 150)) {
    if (page.noindex && page.noindex.noindex) {
      noindexPages.push({ url: page.url, type: 'noindex', reason: 'Page has noindex' });
    }
    if (!page.canonical || !page.canonical.hasCanonical) continue;
    const canUrl = page.canonical.canonical;
    if (!canUrl) continue;
    if (page.canonical.issues && page.canonical.issues.length) {
      canonicalIssues.push({ pageUrl: page.url, canonical: canUrl, issues: page.canonical.issues, type: page.canonical.type });
    }
    try {
      const canCheck = await checkWithRetry(canUrl, { signal, timeout: 8000, maxBytes: 200 * 1024, maxRetries: 1, allowPrivate });
      if (canCheck.status === 404) {
        canonicalIssues.push({ pageUrl: page.url, canonical: canUrl, issues: ['Canonical points to 404'], type: 'canonical_404', status: 404 });
      } else if (canCheck.status >= 300 && canCheck.status < 400) {
        canonicalIssues.push({ pageUrl: page.url, canonical: canUrl, issues: [`Canonical points to redirect (${canCheck.status})`], type: 'canonical_redirect', status: canCheck.status });
      }
    } catch {}
  }

  const sitemapIssues = [];
  if (sitemapResult.sitemaps.length) {
    for (const sm of sitemapResult.sitemaps) {
      if (!sm.valid) {
        sitemapIssues.push({ url: sm.url, type: 'inaccessible_sitemap', reason: sm.error || `Status ${sm.status}` });
      } else if (!sm.isIndex) {
        const sample = sm.urls.slice(0, 30);
        for (const u of sample) {
          const found = issues.find(i => i.url === u && i.classification.classification === 'Confirmed Broken');
          if (found) {
            sitemapIssues.push({ url: sm.url, type: 'broken_sitemap_url', sitemapUrl: sm.url, brokenUrl: u, status: found.status, reason: `Sitemap contains broken URL: ${u} (${found.status})` });
          }
        }
        // Check for redirecting sitemap URLs
        for (const u of sample) {
          const found = issues.find(i => i.url === u && i.redirectAnalysis && i.redirectAnalysis.count > 0);
          if (found && found.result.status === 200) {
            sitemapIssues.push({ url: sm.url, type: 'redirecting_sitemap_url', sitemapUrl: sm.url, redirectingUrl: u, finalUrl: found.finalUrl, reason: `Sitemap contains redirecting URL: ${u} → ${found.finalUrl}` });
          }
        }
      }
    }
  }

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
    pages: pages.map(p => ({ url: p.url, status: p.status, depth: p.depth, blockedByRobots: !!p.blockedByRobots, jsHeavy: !!p.jsHeavy }))
  };

  const report = generateReport(reportData);
  report.canonicalIssues = canonicalIssues;
  report.sitemapIssues = sitemapIssues;
  report.noindexPages = noindexPages;
  report.pagesDetail = pages.map(p => ({
    url: p.url,
    status: p.status,
    depth: p.depth,
    blocked: !!p.blockedByRobots,
    noindex: p.noindex ? p.noindex.noindex : false,
    jsHeavy: !!p.jsHeavy,
    canonical: p.canonical ? p.canonical.canonical : null,
    linkCount: p.links ? p.links.length : 0
  }));
  report.limitedCrawlability = pages.some(p => p.jsHeavy);

  const score = calculateScore(report);
  report.score = score;

  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const iss of issues) {
    const cls = iss.classification;
    let sev = 'low';
    if (cls.category === 'broken' || cls.category === 'dns_error' || cls.category === 'server_error' || cls.category === 'ssl_error' || cls.category === 'broken_anchor' || cls.category === 'redirect_loop') {
      if (iss.isInternal) {
        if (cls.category === 'broken' && (iss.status === 404 || iss.status === 410)) sev = iss.occurrences > 5 ? 'critical' : 'high';
        else if (cls.category === 'dns_error' || cls.category === 'server_error' || cls.category === 'redirect_loop') sev = 'critical';
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

  onProgress({ stage: 'done', message: 'Scan Complete', report: { stats: report.stats, score: report.score.score } });

  return report;
}

module.exports = { crawlSite };
