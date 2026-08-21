'use strict';

/**
 * Report Generator
 * Generates final dashboard data
 */

function generateReport(data) {
  const {
    inputUrl,
    finalUrl,
    pagesDiscovered,
    pagesScanned,
    linksDiscovered,
    uniqueLinks,
    internalLinks,
    externalLinks,
    checkedLinks,
    issues,
    duplicateRefs,
    robots,
    sitemaps,
    durationMs,
    settings
  } = data;

  // Categorize issues
  const byCategory = {};
  const byClassification = {};
  const byStatus = {};
  const byType = { internal: [], external: [], image: [], file: [] };

  let confirmedBroken = 0;
  let confirmedBrokenInternal = 0;
  let confirmedBrokenExternal = 0;
  let redirects = 0;
  let blocked = 0;
  let timeouts = 0;
  let dnsErrors = 0;
  let sslErrors = 0;
  let anchorErrors = 0;
  let serverErrors = 0;
  let redirectLoops = 0;
  let longChains = 0;
  let brokenAnchors = 0;

  for (const issue of issues) {
    const cat = issue.classification?.category || 'unknown';
    const cls = issue.classification?.classification || 'Unknown';
    const status = issue.result?.status || 0;
    const type = issue.linkType || 'a';

    byCategory[cat] = (byCategory[cat] || 0) + 1;
    byClassification[cls] = (byClassification[cls] || 0) + 1;
    byStatus[status] = (byStatus[status] || 0) + 1;

    if (issue.isInternal) byType.internal.push(issue);
    else byType.external.push(issue);
    if (type === 'image') byType.image.push(issue);
    if (type === 'file') byType.file.push(issue);

    if (cls === 'Confirmed Broken') {
      confirmedBroken++;
      if (issue.isInternal) confirmedBrokenInternal++;
      else confirmedBrokenExternal++;
    }
    // Count redirects based on redirect chain, not just classification (final may be 200 but had redirects)
    if ((issue.redirectAnalysis && issue.redirectAnalysis.count > 0) || cat === 'redirect' || cls === 'Redirect') redirects++;
    if (cat === 'blocked' || cat === 'restricted' || cat === 'bot_protection' || cat === 'rate_limited' || cls.includes('Blocked') || cls.includes('Forbidden') || cls.includes('Bot Protection') || cls.includes('Rate Limited') || cls.includes('Authentication Required') || cls.includes('Access Forbidden')) blocked++;
    if (cat === 'timeout' || cat === 'temporary_failure') timeouts++;
    if (cat === 'dns_error') dnsErrors++;
    if (cat === 'ssl_error') sslErrors++;
    if (cat === 'server_error') serverErrors++;
    if ((issue.redirectAnalysis && issue.redirectAnalysis.isLoop) || cat === 'redirect_loop') redirectLoops++;
    if (issue.redirectAnalysis && issue.redirectAnalysis.count > 3) longChains++;
    if (cat === 'broken_anchor' || issue.anchorIssue) {
      anchorErrors++;
      brokenAnchors++;
    }
  }

  const stats = {
    pagesDiscovered,
    pagesScanned,
    linksDiscovered,
    uniqueLinks,
    totalInternal: internalLinks,
    totalExternal: externalLinks,
    checkedLinks,
    confirmedBroken,
    confirmedBrokenInternal,
    confirmedBrokenExternal,
    redirects,
    blocked,
    timeouts,
    dnsErrors,
    sslErrors,
    anchorErrors,
    serverErrors,
    redirectLoops,
    longRedirectChains: longChains,
    brokenAnchors,
    duplicateRefs,
    durationMs
  };

  return {
    inputUrl,
    finalUrl,
    settings,
    robots: robots ? { exists: robots.exists, url: robots.url, crawlDelay: robots.crawlDelay } : null,
    sitemaps: sitemaps ? { count: sitemaps.sitemaps?.length || 0, pageUrls: sitemaps.pageUrls?.length || 0, sitemaps: sitemaps.sitemaps?.map(s => ({ url: s.url, count: s.count, isIndex: s.isIndex })) } : null,
    stats,
    byCategory,
    byClassification,
    byStatus,
    byType: {
      internal: byType.internal.length,
      external: byType.external.length,
      image: byType.image.length,
      file: byType.file.length
    },
    issues, // full list
    generatedAt: new Date().toISOString()
  };
}

module.exports = { generateReport };
