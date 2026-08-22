'use strict';

const U = require('./util');
const { catOf } = require('./scoringEngine');
const R = require('./raptiveRules');
const { applicationEligibility } = require('./requirementEngine');

function slimFinding(f) {
  return {
    id: f.id, category: f.category, name: f.name, requirement: f.requirement || '',
    program: f.program || 'all', status: f.status,
    severity: f.status === 'passed' ? 'passed' : (f.severity || f.status),
    page: f.page, urls: f.urls || [], evidence: f.evidence,
    why: f.why || '', fix: f.fix || '', confidence: f.confidence,
    sourceType: f.sourceType || 'heuristic', sourceUrl: f.sourceUrl || '', sourceTitle: f.sourceTitle || '',
    lastVerified: f.lastVerified || '', effectiveDate: f.effectiveDate || '',
    automated: !!f.automated, affected: f.affected, sharedText: f.sharedText,
    tier: f.tier, brandCat: f.brandCat, confidenceLevel: f.confidenceLevel, trafficHalf: f.trafficHalf,
    reqStatus: f.reqStatus || null, weight: f.weight
  };
}

function pageRow(p, findings, pageType) {
  const path = U.pathOf(p.url);
  const related = findings.filter(f => f.page === path);
  const byCat = { content: 0, brand: 0, ux: 0, tech: 0, originality: 0 };
  related.forEach(f => {
    const c = catOf(f);
    if (f.status === 'passed' || f.status === 'info' || f.status === 'manual') return;
    if (c === 'content') byCat.content++;
    else if (c === 'brand') byCat.brand++;
    else if (c === 'ux') byCat.ux++;
    else if (c === 'tech') byCat.tech++;
  });
  const issues = related.filter(f => f.status !== 'passed' && f.status !== 'info' && f.status !== 'manual').length;
  return {
    url: p.url, path, type: pageType.get(p.url) || (p.error ? 'error' : 'other'),
    status: p.status || 0, error: p.error || '',
    wordCount: p.parse ? p.parse.wordCount : 0,
    uniqueHint: p.parse ? U.uniqueAfter(p.parse.mainText || '', null).size : 0,
    title: p.parse ? p.parse.title : '', h1: p.parse ? p.parse.h1.length : 0,
    content: byCat.content, originality: byCat.content, ux: byCat.ux,
    technical: byCat.tech, brandSafety: byCat.brand, issues
  };
}

function reqStatusOf(f) {
  if (f.reqStatus) return f.reqStatus;
  if (f.status === 'manual' || f.status === 'info') return 'Manual Verification';
  if (f.status === 'passed') return 'Verified';
  if (f.status === 'high' || f.status === 'critical') return 'Needs Review';
  if (f.status === 'medium' || f.status === 'low') return 'Needs Review';
  return 'Unable to Verify';
}

function officialRequirementRows(findings, ctx) {
  const ids = [
    'RAP-OFFICIAL-PAGEVIEWS', 'RAP-OFFICIAL-COUNTRIES-MID', 'RAP-OFFICIAL-COUNTRIES-HIGH',
    'RAP-OFFICIAL-GA', 'RAP-OFFICIAL-DOMAIN-AGE', 'RAP-OFFICIAL-LONGFORM',
    'RAP-OFFICIAL-ORIGINAL', 'RAP-OFFICIAL-HUMAN', 'RAP-OFFICIAL-AD-BUILD', 'RAP-OFFICIAL-TRAFFIC-QUALITY'
  ];
  const rows = [];
  ids.forEach(id => {
    const f = findings.filter(x => x.id === id);
    if (!f.length) return;
    const primary = f[0];
    rows.push({
      id,
      name: primary.name,
      requirement: (R.get(id) && R.get(id).requirement) || '',
      status: reqStatusOf(primary),
      statusClass: primary.status === 'passed' ? 'passed' : (primary.status === 'high' || primary.status === 'critical' ? 'problem' : 'manual'),
      evidence: primary.evidence,
      sourceUrl: primary.sourceUrl,
      lastVerified: primary.lastVerified,
      automated: primary.automated,
      tier: (R.get(id) && R.get(id).tier) || 'all'
    });
  });
  return rows;
}

function manualVerificationPanel(ctx) {
  const ga = ctx.analytics || {};
  return [
    {
      metric: 'Monthly pageviews',
      status: 'Manual Verification Required',
      whyCannotVerify: 'Unable to verify from the public website. Pageviews are private Google Analytics data. SEO traffic estimates are not used.',
      evidenceToProvide: 'GA4 pageviews for the last 30 days. Current Raptive minimum: 25,000. Optionally enter your verified number above.'
    },
    {
      metric: 'Google Analytics',
      status: ga.detected ? 'Tracking code detected, configuration not verified' : 'Tracking code not detected',
      whyCannotVerify: ga.detected
        ? 'Implementation detected, but actual tracking accuracy cannot be verified without Analytics access.'
        : 'No GA4/gtag/GTM snippet was found. Configuration still cannot be verified from a URL.',
      evidenceToProvide: 'GA4 property access (read-only) at application. Confirm hits are recording.'
    },
    {
      metric: 'Traffic countries',
      status: 'Manual Verification Required',
      whyCannotVerify: 'Cannot determine a reliable percentage from URL-only crawling.',
      evidenceToProvide: 'GA4 geo report. 50%+ US/UK/CA/AU/NZ at 25,000–99,999 pageviews; 40%+ at 100,000+.'
    },
    {
      metric: 'Traffic sources',
      status: 'Manual Verification Required',
      whyCannotVerify: 'Source distribution is private analytics data.',
      evidenceToProvide: 'GA4 acquisition report (organic, direct, social, paid, referral).'
    },
    {
      metric: 'Traffic quality / human traffic',
      status: 'Manual Verification Required',
      whyCannotVerify: 'Only publicly observable signals can be analyzed. Human vs bot share is private.',
      evidenceToProvide: 'GA4 (and any bot-filtering) showing authentic human traffic.'
    },
    {
      metric: 'Google Analytics accuracy',
      status: 'Partially verifiable',
      whyCannotVerify: 'Snippet presence is public; filters, views, and data quality are not.',
      evidenceToProvide: 'Confirm the GA4 property matches the site and is receiving data.'
    },
    {
      metric: 'Domain traffic history',
      status: 'Unable to Verify',
      whyCannotVerify: 'Historical Analytics is private. Domain registration date is a separate RDAP check.',
      evidenceToProvide: 'GA4 date-range report covering recent months.'
    }
  ];
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

  const eligibility = applicationEligibility(score, ctx);
  const user = ctx.userInputs || {};
  const brandFindings = ctx.brandSafetyFindings || [];
  const trafficFindings = findings.filter(f => f.category === 'traffic');

  let summary = score.caps && score.caps.length ? score.caps.join(' ')
    : 'Based on ' + findings.length + ' checks across ' + ctx.parsedCount + ' parsed page(s). This is an internal Raptive Readiness Score, not an official Raptive score.';

  return {
    url: ctx.start,
    generatedAt: new Date().toISOString(),
    siteType: ctx.siteType,
    language: ctx.language || null,
    verdict: { label: score.verdict, class: score.verdictClass, summary },
    score: {
      total: score.total, max: score.max, confidence: score.confidence,
      categories: score.categories, caps: score.caps || [],
      label: 'Raptive Readiness Score'
    },
    websiteQualityScore: score.total,
    applicationEligibility: {
      status: eligibility.status,
      class: eligibility.class,
      reason: eligibility.reason,
      tier: eligibility.tier
    },
    declaredTraffic: {
      pageviews: user.pageviews,
      combinedKeyCountryPct: user.combined,
      countries: { us: user.us, uk: user.uk, ca: user.ca, au: user.au, nz: user.nz },
      label: user.provided ? 'User-provided value' : 'Not provided',
      independentlyVerified: false
    },
    officialRequirements: officialRequirementRows(findings, ctx),
    stats: Object.assign({ pagesCrawled: ctx.pagesCrawled, pagesParsed: ctx.parsedCount, crawlErrors: ctx.crawlErrors, reachedLimit: !!ctx.reachedLimit }, counts),
    inventory: ctx.inventory,
    contentPortfolio: ctx.contentPortfolio || {},
    longForm: ctx.longForm || {},
    originality: ctx.originality || {},
    humanInvolvement: ctx.humanInvolvement || {},
    analytics: ctx.analytics || {},
    domainAge: ctx.domainAge || { verified: false },
    architecture: ctx.archStats,
    importantPages: (ctx.important || []).map(e => ({ key: e.key, label: e.label, path: U.pathOf(e.url), url: e.url, confidence: e.confidence, linkedFromNav: !!e.linkedFromNav, words: e.page && e.page.parse ? e.page.parse.wordCount : 0 })),
    duplicates: (ctx.duplicateStats && ctx.duplicateStats.samples) || [],
    duplicateClusters: (ctx.duplicateStats && ctx.duplicateStats.clusters) || [],
    advertising: ctx.advertisingStats || {},
    brandSafety: { findings: brandFindings, stats: ctx.brandSafetyStats || { total: 0, high: 0, medium: 0, pages: 0 } },
    traffic: {
      observable: trafficFindings.filter(f => f.status !== 'manual' && f.trafficHalf !== 'Cannot Be Verified'),
      cannotVerify: trafficFindings.filter(f => f.status === 'manual' || f.trafficHalf === 'Cannot Be Verified')
    },
    performance: ctx.perfStats || {},
    crawl: {
      robotsBlocksAll: !!(ctx.robots && ctx.robots.blocksAll),
      sitemapCount: (ctx.sitemapUrls || []).length,
      adsTxt: ctx.adsTxt || { present: false },
      challenge: !!ctx.challenge,
      notes: ctx.confidenceNotes || []
    },
    findings,
    manuals: findings.filter(f => f.status === 'manual'),
    manualVerification: manualVerificationPanel(ctx),
    pages: ctx.pages.map(p => pageRow(p, findings, ctx.pageType)),
    disclaimer: 'This is an automated assessment of publicly observable signals. It is NOT an official Raptive score and does not guarantee acceptance. Raptive makes the final eligibility decision. Monthly pageviews, traffic-country percentages, traffic sources, and Analytics accuracy are private data that this URL-only audit cannot verify. Detecting a Google Analytics snippet is not proof that Analytics is correctly configured. SEO traffic estimates are never treated as pageviews.'
  };
}

module.exports = { buildReport, slimFinding };
