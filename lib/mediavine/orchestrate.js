'use strict';

const U = require('./util');
const R = require('./mediavineRules');
const { Crawler } = require('./crawler');
const { parsePage, buildBoilerplateVocab } = require('./parser');
const { classifyPage, detectImportant, detectSiteType, CONTENT_TYPES } = require('./pageClassifier');
const { analyzeContent } = require('./contentAnalyzer');
const { analyzeDuplicates } = require('./duplicateAnalyzer');
const { analyzeBrandSafety } = require('./brandSafetyAnalyzer');
const { analyzeTrafficSignals } = require('./trafficSignalAnalyzer');
const { analyzeUX } = require('./uxAnalyzer');
const { analyzeAdvertising } = require('./advertisingAnalyzer');
const { analyzeTechnical } = require('./technicalAnalyzer');
const { analyzeTrust } = require('./trustAnalyzer');
const { evaluateOfficial } = require('./requirementEngine');
const { scoreAll } = require('./scoringEngine');
const { buildReport } = require('./reportEngine');

function inventoryFrom(pages, ctx) {
  const parsed = pages.filter(p => p.parse && !p.error);
  const contentPages = parsed.filter(p => CONTENT_TYPES[ctx.pageType.get(p.url)]);
  const thin = [], useful = [], empty = [];
  let usefulness = 0;
  contentPages.forEach(p => {
    const uniq = [...U.uniqueAfter(p.parse.mainText, ctx.boilerplate)];
    if (p.parse.wordCount < 20 || uniq.length < 10) { empty.push(p); usefulness += 0; }
    else if (uniq.length < 50) { thin.push(p); usefulness += 0.2; }
    else if (uniq.length < 90) { thin.push(p); usefulness += 0.55; if (uniq.length >= 70) useful.push(p); }
    else { useful.push(p); usefulness += 1; }
  });
  const total = contentPages.length || 1;
  const dup = ctx.duplicateStats || { dupCount: 0, dupPct: 0, clusters: [] };
  return {
    total: parsed.length,
    contentPages: contentPages.length,
    thin: thin.length,
    empty: empty.length,
    useful: useful.length,
    usefulPct: contentPages.length ? Math.round(usefulness / contentPages.length * 100) : 0,
    thinPct: contentPages.length ? U.pct(thin.length + empty.length, contentPages.length) : 0,
    duplicatePages: dup.dupCount,
    duplicateClusters: (dup.clusters || []).length,
    dupPct: dup.dupPct || 0,
    siteType: ctx.siteType
  };
}

function crawlConfidence(scan, parsed, ctx) {
  let c = 90;
  const notes = [];
  if (scan.challenge) { c -= 25; notes.push('Challenge page detected, extracted HTML may be a wall, not the real site.'); }
  if (scan.robots && scan.robots.blocksAll) { c -= 20; notes.push('robots.txt Disallow: / limited the crawl.'); }
  if (!parsed.length) { c = 15; notes.push('No HTML pages could be parsed.'); }
  else {
    const jsHeavy = parsed.filter(p => p.parse && p.parse.jsHeavy).length;
    if (jsHeavy / parsed.length >= 0.5) { c -= 20; notes.push('Many pages look JavaScript-rendered with little extractable text.'); }
  }
  if (scan.errors && scan.errors.length >= Math.max(3, (scan.pages || []).length * 0.4)) { c -= 15; notes.push('A large share of fetch attempts failed.'); }
  if (parsed.length < 3 && scan.limit >= 10) { c -= 10; notes.push('Fewer than 3 pages were readable.'); }
  ctx.confidenceNotes = notes;
  return U.clamp(c, 12, 96);
}

function analyzeParsed(scan, opt) {
  opt = opt || {};
  const onProgress = opt.onProgress || function () {};
  const pages = scan.pages || [];
  onProgress({ stage: 'parse', message: 'Parsing HTML and extracting page signals…' });
  pages.forEach(p => {
    if (!p.error && !p.skipped && p.html) { try { parsePage(p); } catch (e) { p.error = 'Parse error: ' + e.message; } }
    if (p.html && p.html.length > 4000) p.html = undefined;
  });
  const parsed = pages.filter(p => p.parse && !p.error);
  if (!parsed.length) {
    const err = (scan.errors[0] && scan.errors[0].message) || 'No readable HTML pages were found.';
    const code = (scan.errors[0] && scan.errors[0].code) || (scan.challenge ? 'challenge' : 'empty');
    const e = U.makeError(code, err);
    e.scan = scan;
    throw e;
  }

  onProgress({ stage: 'important', message: 'Detecting important pages and site type…' });
  const boilerplate = buildBoilerplateVocab(parsed);
  const important = detectImportant(parsed);
  const importantKeyByUrl = new Map();
  important.forEach(e => importantKeyByUrl.set(e.url, e.key));
  const pageType = new Map();
  parsed.forEach(p => pageType.set(p.url, classifyPage(p, importantKeyByUrl)));
  const siteType = detectSiteType(parsed);
  const urlStatus = new Map();
  pages.forEach(p => { if (p.url) urlStatus.set(p.url, p.status || 0); });

  const ctx = {
    start: scan.start, origin: scan.origin, robots: scan.robots, sitemapUrls: scan.sitemapUrls || [],
    adsTxt: scan.adsTxt, challenge: !!scan.challenge, boilerplate, important, pageType, urlStatus, siteType,
    pagesCrawled: pages.length, crawlErrors: (scan.errors || []).length, reachedLimit: !!scan.reachedLimit
  };

  onProgress({ stage: 'content', message: 'Analyzing original content and portfolio…' });
  let findings = [];
  findings = findings.concat(analyzeContent(parsed, ctx));
  onProgress({ stage: 'duplicates', message: 'Running duplicate and near-duplicate analysis…' });
  findings = findings.concat(analyzeDuplicates(parsed, ctx));
  ctx.inventory = inventoryFrom(parsed, ctx);
  onProgress({ stage: 'technical', message: 'Running technical and performance audit…' });
  findings = findings.concat(analyzeTechnical(pages, ctx));
  onProgress({ stage: 'ux', message: 'Analyzing reader experience and architecture…' });
  findings = findings.concat(analyzeUX(parsed, ctx));
  ctx.contentPortfolio = ctx.contentPortfolio || {};
  onProgress({ stage: 'trust', message: 'Checking trust & transparency pages…' });
  findings = findings.concat(analyzeTrust(parsed, ctx));
  onProgress({ stage: 'advertising', message: 'Reviewing advertising readiness…' });
  findings = findings.concat(analyzeAdvertising(parsed, ctx));
  onProgress({ stage: 'brand', message: 'Running brand-safety screening…' });
  findings = findings.concat(analyzeBrandSafety(parsed, ctx));
  onProgress({ stage: 'traffic', message: 'Assessing traffic signals…' });
  findings = findings.concat(analyzeTrafficSignals(parsed, ctx));
  onProgress({ stage: 'requirements', message: 'Evaluating official Mediavine requirements…' });
  const req = evaluateOfficial(parsed, ctx);
  findings = findings.concat(req.findings);

  // Google standing (manual)
  findings.push({
    id: 'MV-GOOGLE-STANDING', category: 'requirement', name: 'Google AdSense / Ad Exchange standing',
    status: 'manual', severity: 'info', page: 'Site',
    evidence: 'Manual Verification Required. Google account standing is private and cannot be inferred from the website. Mediavine states a site need not have worked with AdSense, but an AdSense ban is a problem.',
    why: 'Documented Mediavine criterion that a URL-only audit cannot verify.', fix: 'Confirm no bans or active policy violations on any Google ads account at application.',
    confidence: 100, sourceType: 'official', sourceUrl: R.SRC.official.url, sourceTitle: R.SRC.official.title, lastVerified: R.VERIFIED, automated: false, weight: 0
  });

  const conf = crawlConfidence(scan, parsed, ctx);
  onProgress({ stage: 'score', message: 'Calculating Mediavine Website Readiness Score…' });
  const unable = (!parsed.length) ? 'The website could not be sufficiently crawled.'
    : (scan.challenge && parsed.length < 2 ? 'The site appears to be behind a bot challenge and could not be sufficiently crawled.' : null);
  const score = scoreAll(findings, { inventory: ctx.inventory, crawlConfidence: conf, unable });

  ctx.findings = findings;
  ctx.score = score;
  ctx.programs = req.programs;
  ctx.pages = pages;
  ctx.parsedCount = parsed.length;
  const report = buildReport(ctx);
  onProgress({ stage: 'done', message: 'Done.' });
  return report;
}

async function runAudit(rawUrl, opt) {
  opt = opt || {};
  const onProgress = opt.onProgress || function () {};
  onProgress({ stage: 'init', message: 'Validating URL…' });
  const crawler = new Crawler(rawUrl, { limit: opt.limit || 50, concurrency: opt.concurrency || 6, signal: opt.signal, onProgress });
  const scan = await crawler.run();
  if (scan.challenge && !(scan.pages || []).some(p => p.parse || (p.html && p.html.length > 400 && !/just a moment/i.test(p.html)))) {
    const parsedTry = (scan.pages || []).filter(p => p.html && p.html.length > 200);
    if (!parsedTry.length) throw U.makeError('challenge', 'The site appears to be behind a Cloudflare or bot challenge and cannot be read automatically.');
  }
  return analyzeParsed(scan, { onProgress });
}

module.exports = { runAudit, analyzeParsed, inventoryFrom };
