'use strict';

const U = require('./util');
const R = require('./mediavineRules');

function analyzeTechnical(pages, ctx) {
  const out = [];
  const start = ctx.start;
  const https = /^https:/.test(start);
  out.push(R.finding(R.get('MV-H-TECH'), 'Site', https ? 'passed' : 'high',
    https ? 'Start URL is HTTPS and the crawl completed a TLS handshake.' : 'Start URL is HTTP, not HTTPS.',
    { confidence: 0.99, severity: https ? 'passed' : 'high' }));

  if (ctx.robots && ctx.robots.blocksAll) {
    out.push(R.finding(R.get('MV-H-TECH'), 'Site', 'critical',
      'robots.txt contains Disallow: / for user-agent *. A global block prevents reviewers and demand partners from reading the site.',
      { confidence: 0.99, severity: 'critical' }));
  } else if (ctx.robots && ctx.robots.txt) {
    out.push(R.finding(R.get('MV-H-TECH'), 'Site', 'passed',
      'robots.txt fetched (' + ctx.robots.txt.length + ' bytes, ' + (ctx.robots.sitemaps || []).length + ' sitemap reference(s)).',
      { confidence: 0.85, severity: 'passed' }));
  } else {
    out.push(R.finding(R.get('MV-H-TECH'), 'Site', 'low',
      'No robots.txt found.',
      { confidence: 0.8, severity: 'low' }));
  }

  out.push(R.finding(R.get('MV-H-TECH'), 'Site', (ctx.sitemapUrls && ctx.sitemapUrls.length) ? 'passed' : 'low',
    (ctx.sitemapUrls && ctx.sitemapUrls.length) ? ctx.sitemapUrls.length + ' URL(s) discovered from sitemap files.' : 'No XML sitemap discovered.',
    { confidence: 0.8, severity: (ctx.sitemapUrls && ctx.sitemapUrls.length) ? 'passed' : 'low' }));

  if (ctx.challenge) {
    out.push(R.finding(R.get('MV-H-TECH'), 'Site', 'high',
      'One or more responses looked like a Cloudflare or bot-challenge page. Extracted content may be incomplete.',
      { confidence: 0.7, severity: 'high' }));
  }

  // Performance aggregation
  const perf = { ttfb: [], htmlKb: [], scripts: 0, externalScripts: 0, blocking: 0, compression: 0, cache: 0, cdn: 0, pages: 0, imageCount: 0, thirdParty: 0, responses: [] };

  let serverErr = 0, notFound = 0, noindex = 0, redirectChains = 0;
  const brokenInternal = [], brokenImages = [], duplicateUrlGroups = {}, redirectInternal = [];

  pages.forEach(p => {
    const path = U.pathOf(p.url);
    if (p.error) {
      out.push(R.finding(R.get('MV-H-TECH'), path, 'high',
        'Could not read ' + path + ': ' + p.error,
        { confidence: 0.7, severity: 'high' }));
      return;
    }
    if (p.status >= 500) { serverErr++; out.push(R.finding(R.get('MV-H-TECH'), path, 'high', 'HTTP ' + p.status + '.', { confidence: 0.95, severity: 'high' })); }
    else if (p.status >= 400) { notFound++; out.push(R.finding(R.get('MV-H-TECH'), path, 'medium', 'HTTP ' + p.status + '.', { confidence: 0.95, severity: 'medium' })); }
    if (p.hops && p.hops.length > 3) redirectChains++;

    if (p.ms != null) { perf.ttfb.push(p.ms); perf.responses.push({ path, ms: p.ms, status: p.status }); }
    if (p.bytes != null) perf.htmlKb.push(p.bytes / 1024);
    const pa = p.parse;
    if (!pa) return;

    perf.pages++;
    if (pa.htmlSize != null) perf.htmlKb.push(pa.htmlSize / 1024);
    perf.scripts += (pa.scripts || []).length;
    perf.externalScripts += (pa.externalScripts || []).length;
    perf.thirdParty += (pa.externalScripts || []).length;
    perf.blocking += (pa.blockingHeadScripts || 0) + (pa.blockingHeadStyles || 0);
    perf.imageCount += pa.imageCount || 0;
    if (pa.compression) perf.compression++;
    if (pa.cacheHeaders) perf.cache++;
    if (pa.cdn) perf.cdn++;

    if (pa.noindex) {
      noindex++;
      out.push(R.finding(R.get('MV-H-TECH'), path, path === '/' ? 'critical' : 'medium',
        'Page sends noindex via meta robots or X-Robots-Tag.', { confidence: 0.95, severity: path === '/' ? 'critical' : 'medium' }));
    }
    if (pa.mixedResources && pa.mixedResources.length) {
      out.push(R.finding(R.get('MV-H-TECH'), path, 'high',
        pa.mixedResources.length + ' resource(s) loaded over HTTP on an HTTPS page. Example: ' + pa.mixedResources[0],
        { confidence: 0.9, severity: 'high' }));
    }
    if (!pa.title) out.push(R.finding(R.get('MV-H-TECH'), path, 'high', 'No <title> tag.', { confidence: 0.92, severity: 'high' }));
    else if (pa.titleLen < 12 || pa.titleLen > 70) out.push(R.finding(R.get('MV-H-TECH'), path, 'low', pa.titleLen + ' characters: "' + pa.title.slice(0, 80) + '".', { confidence: 0.7, severity: 'low' }));
    if (pa.canonical && !U.sameSite(pa.canonical, p.url)) out.push(R.finding(R.get('MV-H-TECH'), path, 'medium', 'Canonical points off-site: ' + pa.canonical, { confidence: 0.75, severity: 'medium' }));
    if (pa.invalidLd && pa.invalidLd.length) out.push(R.finding(R.get('MV-H-TECH'), path, 'low', pa.invalidLd.length + ' JSON-LD block(s) failed to parse.', { confidence: 0.88, severity: 'low' }));
    if (pa.metaRefresh) out.push(R.finding(R.get('MV-H-TECH'), path, 'medium', 'Meta refresh redirect detected.', { confidence: 0.75, severity: 'medium' }));
    if (pa.hreflangs && pa.hreflangs.length) out.push(R.finding(R.get('MV-H-TECH'), path, 'passed', pa.hreflangs.length + ' hreflang alternate(s).', { confidence: 0.7, severity: 'passed' }));

    // broken internal links (discovered URLs that errored)
    (pa.links || []).forEach(l => {
      if (!l.internal || !l.href) return;
      const target = pages.find(x => x.url.replace(/\/$/, '') === l.href.replace(/\/$/, ''));
      if (target && (target.error || (target.status >= 400))) brokenInternal.push(path);
    });
    // redirecting internal links
    (pa.links || []).forEach(l => {
      if (!l.internal || !l.href) return;
      const target = pages.find(x => x.url.replace(/\/$/, '') === l.href.replace(/\/$/, ''));
      if (target && target.redirected && target.status >= 300 && target.status < 400) redirectInternal.push(path);
    });
    // broken images (missing alt / empty src handled in parser; count heavy images)
    // duplicate URLs (same canonical) handled below
  });

  // Duplicate URL detection (same normalized path or canonical)
  const normCount = {};
  pages.forEach(p => { if (p.parse && p.parse.canonical) { const n = U.normalizeUrl(p.parse.canonical, p.url); if (n) normCount[n] = (normCount[n] || 0) + 1; } });
  const dupCanon = Object.keys(normCount).filter(k => normCount[k] > 1);
  if (dupCanon.length) duplicateUrlGroups[dupCanon[0]] = normCount[dupCanon[0]];

  ctx.techStats = { serverErr, notFound, noindex, redirectChains, brokenInternal: brokenInternal.length, duplicateCanonicalGroups: dupCanon.length };
  ctx.perfStats = {
    avgTtfb: perf.ttfb.length ? U.round(perf.ttfb.reduce((a, b) => a + b, 0) / perf.ttfb.length, 0) : null,
    maxTtfb: perf.ttfb.length ? Math.max.apply(null, perf.ttfb) : null,
    avgHtmlKb: perf.htmlKb.length ? U.round(perf.htmlKb.reduce((a, b) => a + b, 0) / perf.htmlKb.length, 1) : null,
    totalRequests: perf.scripts + perf.imageCount,
    externalScripts: perf.externalScripts,
    renderBlocking: perf.blocking,
    compressionPct: perf.pages ? U.pct(perf.compression, perf.pages) : 0,
    cachePct: perf.pages ? U.pct(perf.cache, perf.pages) : 0,
    cdnPct: perf.pages ? U.pct(perf.cdn, perf.pages) : 0,
    imageCount: perf.imageCount,
    sampleResponses: perf.responses.sort((a, b) => b.ms - a.ms).slice(0, 5)
  };

  if (perf.pages) {
    out.push(R.finding(R.get('MV-H-PERFORMANCE'), 'Site', 'info',
      'Observed performance: avg TTFB ' + (perf.avgTtfb != null ? perf.avgTtfb + 'ms' : 'n/a') + ', avg HTML size '
      + (perf.avgHtmlKb != null ? perf.avgHtmlKb + 'KB' : 'n/a') + ', ' + perf.totalRequests + ' total resource references, '
      + perf.externalScripts + ' third-party scripts, ~' + perf.blocking + ' render-blocking head resources, compression on ' + perf.compressionPct + '% of pages, cache headers on ' + perf.cachePct + '%. These are server-side signals, not a Lighthouse/Core Web Vitals score.',
      { confidence: 0.7, severity: 'info' }));
  }

  return out;
}

module.exports = { analyzeTechnical };
