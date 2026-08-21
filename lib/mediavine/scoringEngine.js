'use strict';

const U = require('./util');

/**
 * Mediavine Website Readiness Score 0–100.
 * An internal tool score — NOT an official Mediavine score.
 *
 * Category                                  Weight
 * Original & Audience-First Content         25
 * Brand Safety & Policy Signals             20
 * Reader Experience                        20
 * Technical Quality                        10
 * Trust & Transparency                     10
 * Advertising Readiness                    10
 * Site Architecture                         5
 */
const CATEGORIES = [
  { key: 'content', label: 'Original & Audience-First Content', weight: 25 },
  { key: 'brand', label: 'Brand Safety & Policy Signals', weight: 20 },
  { key: 'ux', label: 'Reader Experience', weight: 20 },
  { key: 'tech', label: 'Technical Quality', weight: 10 },
  { key: 'trust', label: 'Trust & Transparency', weight: 10 },
  { key: 'advertising', label: 'Advertising Readiness', weight: 10 },
  { key: 'architecture', label: 'Site Architecture', weight: 5 }
];

function catOf(f) {
  if (f.category === 'content') return 'content';
  if (f.category === 'brand') return 'brand';
  if (f.category === 'ux') return 'ux';
  if (f.category === 'tech') return 'tech';
  if (f.category === 'trust') return 'trust';
  if (f.category === 'advertising') return 'advertising';
  if (f.category === 'architecture') return 'architecture';
  if (f.category === 'traffic') return 'brand';   // traffic-quality signals fold into brand-safety/policy
  return null;                                    // 'requirement', 'manual', etc. — excluded from earned score
}

function statusImpact(status) {
  if (status === 'passed') return 1;
  if (status === 'low') return 0.82;
  if (status === 'medium') return 0.52;
  if (status === 'high') return 0.18;
  if (status === 'critical') return 0;
  if (status === 'info' || status === 'manual') return null;
  return 1;
}

function weightOf(f) { return f.weight || 3; }

function coverageMultiplier(f, inventory) {
  if (!f.affected || !inventory) return 1;
  const m = String(f.affected).match(/(\d+)\s*\/\s*(\d+)/);
  if (m) {
    const part = Number(m[1]), whole = Number(m[2]) || 1, share = part / whole;
    if (share >= 0.6) return 1.35;
    if (share >= 0.3) return 1.1;
    if (share <= 0.08) return 0.45;
    return 0.75;
  }
  const pct = String(f.affected).match(/(\d+)\s*%/);
  if (pct) {
    const n = Number(pct[1]);
    if (n >= 60) return 1.35;
    if (n >= 30) return 1.1;
    if (n <= 8) return 0.45;
    return 0.75;
  }
  return 1;
}

function pageImportance(f) {
  const p = String(f.page || '');
  if (p === 'Site' || p === '/') return 1.15;
  if (/privacy|contact|about/i.test(p)) return 1.1;
  return 1;
}

function scoreCategory(catKey, findings, inventory) {
  const def = CATEGORIES.find(c => c.key === catKey);
  const all = findings.filter(f => catOf(f) === catKey);
  const measurable = all.filter(f => statusImpact(f.status) != null);
  let posW = 0, negW = 0;
  const lines = [];
  measurable.forEach(f => {
    const impact = statusImpact(f.status);
    const conf = (f.confidence == null ? 100 : f.confidence) / 100;
    const cov = coverageMultiplier(f, inventory);
    const imp = pageImportance(f);
    const ww = weightOf(f);
    if (f.status === 'passed') {
      posW += ww * conf;
      lines.push({ id: f.id, name: f.name, status: f.status, weight: ww, delta: 0, confidence: f.confidence, evidence: f.evidence, fix: f.fix, why: f.why, page: f.page, severity: f.severity, affected: f.affected, sourceType: f.sourceType, sourceUrl: f.sourceUrl });
    } else {
      const penalty = ww * (1 - impact) * conf * cov * imp;
      negW += penalty;
      lines.push({ id: f.id, name: f.name, status: f.status, weight: ww, delta: -U.round(penalty, 2), confidence: f.confidence, evidence: f.evidence, fix: f.fix, why: f.why, page: f.page, severity: f.severity, affected: f.affected, sourceType: f.sourceType, sourceUrl: f.sourceUrl });
    }
  });
  const denom = posW + negW;
  let pct = denom ? posW / denom : 0.62;
  if (!measurable.length) pct = 0.62;

  let capNote = null;
  if (catKey === 'content' && inventory) {
    if (inventory.contentPages === 0 && inventory.siteType !== 'tools') { pct = Math.min(pct, 0.32); capNote = 'No article/content pages were found in the crawl.'; }
    else if (inventory.contentPages > 0 && inventory.contentPages < 3 && inventory.siteType !== 'tools') { pct = Math.min(pct, 0.58); capNote = 'Only ' + inventory.contentPages + ' content page(s) were found.'; }
    else if (inventory.usefulPct < 30 && inventory.contentPages >= 3) { pct = Math.min(pct, 0.42); capNote = 'Only ~' + inventory.usefulPct + '% of content is substantial (' + inventory.useful + '/' + inventory.contentPages + ').'; }
    else if (inventory.thinPct >= 60) { pct = Math.min(pct, 0.48); capNote = inventory.thinPct + '% of content pages are thin.'; }
    else if (inventory.dupPct >= 40) { pct = Math.min(pct, 0.5); capNote = inventory.dupPct + '% of compared pages are near-duplicates.'; }
  }
  if (catKey === 'brand') {
    const high = all.filter(f => f.status === 'high' || f.status === 'critical').length;
    if (high >= 2) { pct = Math.min(pct, 0.25); capNote = 'Multiple high-risk brand-safety/policy signals.'; }
  }

  pct = U.clamp(pct, 0, 1);
  const score = Math.round(pct * def.weight);
  return {
    key: catKey, label: def.label, weight: def.weight, score, max: def.weight, pct: Math.round(pct * 100),
    lines, count: measurable.length, capNote,
    manuals: all.filter(f => f.status === 'manual' || f.status === 'info')
  };
}

function verdictOf(total, opts) {
  opts = opts || {};
  if (opts.unable) return { verdict: 'Unable to Determine', verdictClass: 'unverifiable', summary: opts.unable };
  if (total < 40) return { verdict: 'Significant Issues', verdictClass: 'notready', summary: 'Major content, brand-safety, UX, or technical issues were detected.' };
  if (total < 70) return { verdict: 'Needs Improvement', verdictClass: 'improve', summary: 'Several quality or UX issues should be fixed before applying.' };
  return { verdict: 'Strong Readiness', verdictClass: 'ready', summary: 'No major website-quality problems were detected. Eligibility still requires manual verification of private data.' };
}

function scoreAll(findings, opts) {
  opts = opts || {};
  const inventory = opts.inventory || null;
  const cats = CATEGORIES.map(c => scoreCategory(c.key, findings, inventory));
  let total = cats.reduce((n, c) => n + c.score, 0);
  const maxTotal = cats.reduce((n, c) => n + c.max, 0);
  const caps = [];

  const criticalBrand = findings.some(f => catOf(f) === 'brand' && f.status === 'critical');
  const highBrand = findings.filter(f => catOf(f) === 'brand' && f.status === 'high').length;
  const robotsAll = findings.some(f => f.id === 'MV-H-TECH' && /robots\.txt contains Disallow: \//i.test(f.evidence || '') && f.status === 'critical');
  const homeNoindex = findings.some(f => f.id === 'MV-H-TECH' && f.page === '/' && f.status === 'critical');
  const httpsFail = findings.some(f => f.id === 'MV-H-TECH' && /Start URL is HTTP/i.test(f.evidence || ''));
  const criticalContent = findings.some(f => catOf(f) === 'content' && f.status === 'critical');

  if (criticalBrand || criticalContent) { total = Math.min(total, 22); caps.push('Critical brand-safety or content signal — score capped at 22 pending manual review.'); }
  if (highBrand >= 3) { total = Math.min(total, 38); caps.push('Multiple high-severity brand-safety signals — score capped at 38.'); }
  if (robotsAll) { total = Math.min(total, 28); caps.push('robots.txt blocks the entire site — score capped at 28.'); }
  if (homeNoindex) { total = Math.min(total, 35); caps.push('Homepage is noindexed — score capped at 35.'); }
  if (httpsFail) { total = Math.min(total, Math.max(total - 10, 20)); caps.push('Site is not served over HTTPS — 10-point penalty.'); }
  if (inventory && inventory.contentPages >= 3 && inventory.siteType !== 'tools') {
    if (inventory.usefulPct < 20) { total = Math.min(total, 42); caps.push('Fewer than 20% of content pages are substantial.'); }
    else if (inventory.thinPct >= 60) { total = Math.min(total, 52); caps.push('Most content pages are thin.'); }
  }

  total = U.clamp(Math.round(total), 0, maxTotal);
  const crawlConf = opts.crawlConfidence == null ? 80 : opts.crawlConfidence;
  const v = verdictOf(total, opts);

  if (v.verdict === 'Strong Readiness' && (highBrand || robotsAll || httpsFail)) {
    v.verdict = 'Needs Improvement';
    v.verdictClass = 'improve';
    caps.push('Major blocker present — not labelled Strong Readiness.');
  }

  return {
    total,
    max: maxTotal,
    categories: cats,
    caps,
    verdict: v.verdict,
    verdictClass: v.verdictClass,
    summary: v.summary,
    confidence: Math.round(crawlConf)
  };
}

module.exports = { CATEGORIES, scoreAll, scoreCategory, catOf, verdictOf };
