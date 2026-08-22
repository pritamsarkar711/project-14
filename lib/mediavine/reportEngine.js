'use strict';

const U = require('./util');
const { catOf } = require('./scoringEngine');
const R = require('./mediavineRules');

function slimFinding(f) {
  return {
    id: f.id, category: f.category, name: f.name, requirement: f.requirement || '',
    program: f.program || 'both', status: f.status,
    severity: f.status === 'passed' ? 'passed' : (f.severity || f.status),
    page: f.page, urls: f.urls || [], evidence: f.evidence,
    why: f.why || '', fix: f.fix || '', confidence: f.confidence,
    sourceType: f.sourceType || 'heuristic', sourceUrl: f.sourceUrl || '', sourceTitle: f.sourceTitle || '',
    lastVerified: f.lastVerified || '', effectiveDate: f.effectiveDate || '',
    automated: !!f.automated, affected: f.affected, sharedText: f.sharedText,
    tier: f.tier, brandCat: f.brandCat, confidenceLevel: f.confidenceLevel, trafficHalf: f.trafficHalf,
    weight: f.weight
  };
}

function pageRow(p, findings, pageType) {
  const path = U.pathOf(p.url);
  const related = findings.filter(f => f.page === path);
  const byCat = { content: 0, brand: 0, ux: 0, tech: 0, trust: 0, advertising: 0, architecture: 0 };
  related.forEach(f => {
    const c = catOf(f);
    if (byCat[c] != null && f.status !== 'passed' && f.status !== 'info' && f.status !== 'manual') byCat[c]++;
  });
  const issues = related.filter(f => f.status !== 'passed' && f.status !== 'info' && f.status !== 'manual').length;
  return {
    url: p.url, path, type: pageType.get(p.url) || (p.error ? 'error' : 'other'),
    status: p.status || 0, error: p.error || '',
    wordCount: p.parse ? p.parse.wordCount : 0,
    uniqueHint: p.parse ? U.uniqueAfter(p.parse.mainText || '', null).size : 0,
    title: p.parse ? p.parse.title : '', h1: p.parse ? p.parse.h1.length : 0,
    internalLinks: p.parse ? p.parse.internalLinks : 0,
    content: byCat.content, brandSafety: byCat.brand, ux: byCat.ux,
    technical: byCat.tech, trust: byCat.trust, advertising: byCat.advertising, architecture: byCat.architecture,
    issues
  };
}

function applicationRequirements(ctx, findings, programs) {
  const list = [];
  // Official
  const official = programs.official;
  list.push({
    program: 'Mediavine Official',
    item: 'Annual ad revenue (≥ $5,000)',
    status: 'Manual Verification Required',
    statusClass: 'manual',
    affects: 'Official',
    evidence: 'Revenue is private account data. A URL crawl cannot read it. Current threshold: $5,000+ annual ad revenue (effective ' + R.EFFECTIVE + ').',
    verifyWith: 'GA4 / ad-network revenue report for the trailing 12 months.'
  });
  list.push({
    program: 'Mediavine Official',
    item: 'Google AdSense / Ad Exchange standing',
    status: 'Manual Verification Required',
    statusClass: 'manual',
    affects: 'Official',
    evidence: 'Account standing is private. A site need not have worked with AdSense, but an AdSense ban is a problem.',
    verifyWith: 'Confirm no active policy violations or bans on any Google ads account.'
  });
  // Journey
  list.push({
    program: 'Journey by Mediavine',
    item: 'Monthly sessions (≥ 1,000)',
    status: 'Manual Verification Required',
    statusClass: 'manual',
    affects: 'Journey',
    evidence: 'Session counts are private Google Analytics data. Current entry: 1,000+ sessions/month.',
    verifyWith: 'GA4 sessions report for the last 30 days; install the Grow plugin (30-day evaluation).'
  });
  // Quality items that ARE verifiable
  const contentFinding = findings.find(f => f.id === 'MV-OFFICIAL-ORIGINAL-CONTENT');
  list.push({
    program: 'Both',
    item: 'Original, audience-first content',
    status: contentFinding && contentFinding.status === 'passed' ? 'Verified (public signals)' : (contentFinding && (contentFinding.status === 'high' || contentFinding.status === 'critical') ? 'Potential Problem' : 'Partially Verified'),
    statusClass: contentFinding && contentFinding.status === 'passed' ? 'passed' : (contentFinding && (contentFinding.status === 'high' || contentFinding.status === 'critical') ? 'problem' : 'manual'),
    affects: 'Official & Journey',
    evidence: contentFinding ? contentFinding.evidence : 'Not assessed.',
    verifyWith: 'Public content audit (this tool).'
  });
  const brandFinding = findings.find(f => f.id === 'MV-Q-BRAND-SAFETY');
  list.push({
    program: 'Both',
    item: 'Brand-safe, policy-compliant content',
    status: brandFinding && brandFinding.status === 'passed' ? 'Verified (public signals)' : (brandFinding && (brandFinding.status === 'high' || brandFinding.status === 'critical') ? 'Potential Problem' : 'Review Recommended'),
    statusClass: brandFinding && brandFinding.status === 'passed' ? 'passed' : (brandFinding && (brandFinding.status === 'high' || brandFinding.status === 'critical') ? 'problem' : 'manual'),
    affects: 'Official & Journey',
    evidence: brandFinding ? brandFinding.evidence : 'Not assessed.',
    verifyWith: 'Public brand-safety screen (this tool) plus manual review.'
  });
  return list;
}

function manualVerificationPanel(programs) {
  const rows = [
    ['Annual ad revenue', 'Official', 'Cannot be read from a public URL, private ad-network/GA4 data.', 'GA4 or ad-network revenue report for the trailing 12 months (≥ $5,000 for Official).'],
    ['Monthly sessions', 'Journey', 'Cannot be read from a public URL, private GA4 data.', 'GA4 sessions report (≥ 1,000 for Journey); Grow plugin 30-day evaluation.'],
    ['Traffic sources', 'Official & Journey', 'Source distribution is private analytics data.', 'GA4 acquisition report showing organic/direct/social/paid mix.'],
    ['Traffic countries', 'Official & Journey', 'Country distribution is private analytics data.', 'GA4 geo report (premium-country share).'],
    ['Audience demographics', 'Official & Journey', 'Demographics are private analytics data.', 'GA4 demographics report.'],
    ['Google AdSense / Ad Exchange standing', 'Official & Journey', 'Account status is private and cannot be inferred from the site.', 'Confirm no bans/policy violations on any Google ads account.'],
    ['Traffic authenticity', 'Official & Journey', 'Human-vs-bot share is private; only obvious public signals are observable.', 'Confirm no purchased/incentivized/bot traffic.'],
    ['Ownership information', 'Official & Journey', 'Who runs the site is not reliably knowable from a public crawl.', 'Verify ownership/identity at application.']
  ];
  return rows.map(r => ({
    metric: r[0], affects: r[1], whyCannotVerify: r[2], evidenceToProvide: r[3], status: 'Manual Verification Required'
  }));
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

  const manuals = findings.filter(f => f.status === 'manual');
  const programs = ctx.programs || {};
  const appReq = applicationRequirements(ctx, findings, programs);
  const manualPanel = manualVerificationPanel(programs);

  const brandFindings = ctx.brandSafetyFindings || [];
  const trafficFindings = findings.filter(f => f.category === 'traffic');

  let summary = score.caps && score.caps.length ? score.caps.join(' ')
    : 'Based on ' + findings.length + ' checks across ' + ctx.parsedCount + ' parsed page(s). This is an internal Mediavine Readiness Score, not an official Mediavine score.';

  return {
    url: ctx.start,
    generatedAt: new Date().toISOString(),
    siteType: ctx.siteType,
    language: ctx.language || null,
    verdict: { label: score.verdict, class: score.verdictClass, summary },
    score: { total: score.total, max: score.max, confidence: score.confidence, categories: score.categories, caps: score.caps || [] },
    programEligibility: {
      // Official: revenue not verifiable → cannot confirm
      official: {
        name: 'Mediavine Official',
        websiteQualityReady: score.total,
        revenueRequirement: 'Unable to Verify',
        applicationEligibility: 'Cannot Be Confirmed',
        reason: 'Official requires $5,000+ annual ad revenue, which is private data and cannot be verified from a public URL audit.',
        revenueThresholdUsd: 5000,
        revenueShare: '75%'
      },
      journey: {
        name: 'Journey by Mediavine',
        websiteQualityReady: score.total,
        sessionRequirement: 'Unable to Verify',
        applicationEligibility: 'Cannot Be Confirmed',
        reason: 'Journey requires 1,000+ monthly sessions, which is private Google Analytics data and cannot be verified from a public URL audit.',
        sessionThreshold: 1000,
        revenueShare: '70%'
      }
    },
    applicationRequirements: appReq,
    stats: Object.assign({ pagesCrawled: ctx.pagesCrawled, pagesParsed: ctx.parsedCount, crawlErrors: ctx.crawlErrors, reachedLimit: !!ctx.reachedLimit }, counts),
    inventory: ctx.inventory,
    contentPortfolio: ctx.contentPortfolio || {},
    architecture: ctx.archStats,
    importantPages: (ctx.important || []).map(e => ({ key: e.key, label: e.label, path: U.pathOf(e.url), url: e.url, confidence: e.confidence, linkedFromNav: !!e.linkedFromNav, words: e.page && e.page.parse ? e.page.parse.wordCount : 0 })),
    duplicates: (ctx.duplicateStats && ctx.duplicateStats.samples) || [],
    duplicateClusters: (ctx.duplicateStats && ctx.duplicateStats.clusters) || [],
    advertising: ctx.advertisingStats || {},
    brandSafety: { findings: brandFindings, stats: ctx.brandSafetyStats || { total: 0, high: 0, medium: 0, pages: 0 } },
    traffic: {
      observable: trafficFindings.filter(f => f.status !== 'manual' && f.trafficHalf !== 'Cannot Be Verified'),
      cannotVerify: trafficFindings.filter(f => f.status === 'manual' || f.trafficHalf === 'Cannot Be Verified'),
      googleStanding: 'Manual Verification Required'
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
    manuals,
    manualVerification: manualPanel,
    pages: ctx.pages.map(p => pageRow(p, findings, ctx.pageType)),
    disclaimer: 'This is an automated assessment of publicly observable signals. It is NOT an official Mediavine score and does not guarantee acceptance. Mediavine makes the final eligibility decision. Revenue, sessions, traffic sources/countries, demographics, and Google account standing are private data that this URL-only audit cannot verify.'
  };
}

module.exports = { buildReport, slimFinding };
