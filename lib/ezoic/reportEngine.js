'use strict';

const U = require('./util');
const { catOf } = require('./scoringEngine');

function slimFinding(f) {
  return {
    id: f.id,
    category: f.category,
    name: f.name,
    requirement: f.requirement || '',
    status: f.status,
    severity: f.status === 'passed' ? 'passed' : (f.severity || f.status),
    page: f.page,
    urls: f.urls || [],
    evidence: f.evidence,
    why: f.why || '',
    fix: f.fix || '',
    confidence: f.confidence,
    sourceType: f.sourceType || 'heuristic',
    sourceUrl: f.sourceUrl || '',
    lastVerified: f.lastVerified || '',
    automated: !!f.automated,
    affected: f.affected,
    sharedText: f.sharedText,
    tier: f.tier,
    policyCat: f.policyCat,
    weight: f.weight
  };
}

function pageRow(p, findings, pageType) {
  const path = U.pathOf(p.url);
  const related = findings.filter(f => f.page === path);
  const byCat = { content: 0, tech: 0, ux: 0, policy: 0, trust: 0, ezoic: 0 };
  related.forEach(f => {
    const c = catOf(f);
    if (byCat[c] != null && f.status !== 'passed' && f.status !== 'info' && f.status !== 'manual') byCat[c]++;
  });
  const issues = related.filter(f => f.status !== 'passed' && f.status !== 'info' && f.status !== 'manual').length;
  return {
    url: p.url,
    path,
    type: pageType.get(p.url) || (p.error ? 'error' : 'other'),
    status: p.status || 0,
    error: p.error || '',
    wordCount: p.parse ? p.parse.wordCount : 0,
    uniqueHint: p.parse ? U.uniqueAfter(p.parse.mainText || '', null).size : 0,
    title: p.parse ? p.parse.title : '',
    h1: p.parse ? p.parse.h1.length : 0,
    internalLinks: p.parse ? p.parse.internalLinks : 0,
    content: byCat.content,
    technical: byCat.tech,
    ux: byCat.ux,
    risk: byCat.policy,
    issues
  };
}

function buildReport(ctx) {
  const findings = ctx.findings.map(slimFinding);
  const score = ctx.score;
  const counts = {
    critical: findings.filter(f => f.status === 'critical').length,
    high: findings.filter(f => f.status === 'high').length,
    medium: findings.filter(f => f.status === 'medium').length,
    low: findings.filter(f => f.status === 'low').length,
    passed: findings.filter(f => f.status === 'passed').length,
    manual: findings.filter(f => f.status === 'manual' || f.status === 'info').length,
    issues: findings.filter(f => f.status !== 'passed' && f.status !== 'info' && f.status !== 'manual').length
  };

  const important = (ctx.important || []).map(e => ({
    key: e.key,
    label: e.label,
    path: U.pathOf(e.url),
    url: e.url,
    confidence: e.confidence,
    linkedFromNav: !!e.linkedFromNav,
    words: e.page && e.page.parse ? e.page.parse.wordCount : 0
  }));

  const manuals = findings.filter(f => f.status === 'manual');

  let summary = score.caps && score.caps.length
    ? score.caps.join(' ')
    : 'Based on ' + findings.length + ' checks across ' + ctx.parsedCount + ' parsed page(s). This is not an official Ezoic score.';

  return {
    url: ctx.start,
    generatedAt: new Date().toISOString(),
    siteType: ctx.siteType,
    language: ctx.language || null,
    verdict: {
      label: score.verdict,
      class: score.verdictClass,
      summary
    },
    score: {
      total: score.total,
      max: score.max,
      confidence: score.confidence,
      categories: score.categories,
      caps: score.caps || []
    },
    stats: Object.assign({
      pagesCrawled: ctx.pagesCrawled,
      pagesParsed: ctx.parsedCount,
      crawlErrors: ctx.crawlErrors,
      reachedLimit: !!ctx.reachedLimit
    }, counts),
    inventory: ctx.inventory,
    architecture: ctx.archStats,
    importantPages: important,
    duplicates: (ctx.duplicateStats && ctx.duplicateStats.samples) || [],
    duplicateClusters: (ctx.duplicateStats && ctx.duplicateStats.clusters) || [],
    monetization: ctx.monetizationStats || {},
    crawl: {
      robotsBlocksAll: !!(ctx.robots && ctx.robots.blocksAll),
      sitemapCount: (ctx.sitemapUrls || []).length,
      adsTxt: ctx.adsTxt || { present: false },
      challenge: !!ctx.challenge,
      notes: ctx.confidenceNotes || []
    },
    findings,
    manuals,
    pages: ctx.pages.map(p => pageRow(p, findings, ctx.pageType)),
    disclaimer: 'This is an automated assessment of publicly observable signals. It is not affiliated with Ezoic and does not guarantee approval. The final eligibility decision belongs to Ezoic.'
  };
}

module.exports = { buildReport, slimFinding };
