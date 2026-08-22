'use strict';

const U = require('./util');

/**
 * Ezoic Readiness Score 0–100.
 * Not an official Ezoic score.
 *
 * Category                         Weight
 * Ezoic Requirement Readiness      30
 * Content & Website Quality        20
 * Technical Accessibility          15
 * User Experience                  15
 * Trust & Transparency             10
 * Policy-Risk Signals              10
 */

const CATEGORIES = [
  { key: 'ezoic', label: 'Ezoic Requirement Readiness', weight: 30 },
  { key: 'content', label: 'Content & Website Quality', weight: 20 },
  { key: 'tech', label: 'Technical Accessibility', weight: 15 },
  { key: 'ux', label: 'User Experience', weight: 15 },
  { key: 'trust', label: 'Trust & Transparency', weight: 10 },
  { key: 'policy', label: 'Policy-Risk Signals', weight: 10 }
];

function catOf(f) {
  if (f.category === 'monetization') return 'ezoic';
  if (f.category === 'ezoic') return 'ezoic';
  if (f.category === 'content') return 'content';
  if (f.category === 'tech') return 'tech';
  if (f.category === 'ux') return 'ux';
  if (f.category === 'trust') return 'trust';
  if (f.category === 'policy') return 'policy';
  return f.category;
}

function statusImpact(status) {
  if (status === 'passed') return 1;
  if (status === 'low') return 0.82;
  if (status === 'medium') return 0.52;
  if (status === 'high') return 0.18;
  if (status === 'critical') return 0;
  if (status === 'info' || status === 'manual') return null; // excluded from earned score
  return 1;
}

function weightOf(f) {
  return f.weight || 3;
}

function coverageMultiplier(f, inventory) {
  if (!f.affected || !inventory) return 1;
  const m = String(f.affected).match(/(\d+)\s*\/\s*(\d+)/);
  if (m) {
    const part = Number(m[1]), whole = Number(m[2]) || 1;
    const share = part / whole;
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
  const w = weightOf;

  let posW = 0, negW = 0;
  const lines = [];
  measurable.forEach(f => {
    const impact = statusImpact(f.status);
    const conf = (f.confidence == null ? 100 : f.confidence) / 100;
    const cov = coverageMultiplier(f, inventory);
    const imp = pageImportance(f);
    const ww = w(f);
    if (f.status === 'passed') {
      posW += ww * conf;
      lines.push({
        id: f.id, name: f.name, status: f.status, weight: ww, delta: 0,
        confidence: f.confidence, evidence: f.evidence, fix: f.fix, why: f.why,
        page: f.page, severity: f.severity, affected: f.affected,
        sourceType: f.sourceType, sourceUrl: f.sourceUrl
      });
    } else {
      const penalty = ww * (1 - impact) * conf * cov * imp;
      negW += penalty;
      lines.push({
        id: f.id, name: f.name, status: f.status, weight: ww, delta: -U.round(penalty, 2),
        confidence: f.confidence, evidence: f.evidence, fix: f.fix, why: f.why,
        page: f.page, severity: f.severity, affected: f.affected,
        sourceType: f.sourceType, sourceUrl: f.sourceUrl
      });
    }
  });

  const denom = posW + negW;
  let pct = denom ? posW / denom : 0.62;
  if (!measurable.length) pct = 0.62;

  let capNote = null;
  if (catKey === 'content' && inventory) {
    if (inventory.contentPages === 0 && inventory.siteType !== 'tools') {
      pct = Math.min(pct, 0.32);
      capNote = 'No article/content pages were found in the crawl.';
    } else if (inventory.contentPages > 0 && inventory.contentPages < 3 && inventory.siteType !== 'tools') {
      pct = Math.min(pct, 0.58);
      capNote = 'Only ' + inventory.contentPages + ' content page(s) were found.';
    } else if (inventory.usefulPct < 30 && inventory.contentPages >= 3) {
      pct = Math.min(pct, 0.42);
      capNote = 'Only ~' + inventory.usefulPct + '% of content is substantial (' + inventory.useful + '/' + inventory.contentPages + ').';
    } else if (inventory.thinPct >= 60) {
      pct = Math.min(pct, 0.48);
      capNote = inventory.thinPct + '% of content pages are thin.';
    } else if (inventory.dupPct >= 40) {
      pct = Math.min(pct, 0.5);
      capNote = inventory.dupPct + '% of compared pages are near-duplicates.';
    }
  }
  if (catKey === 'policy') {
    const high = all.filter(f => f.status === 'high' || f.status === 'critical').length;
    if (high >= 2) { pct = Math.min(pct, 0.25); capNote = 'Multiple high-risk policy signals.'; }
  }

  pct = U.clamp(pct, 0, 1);
  const score = Math.round(pct * def.weight);
  return {
    key: catKey,
    label: def.label,
    weight: def.weight,
    score,
    max: def.weight,
    pct: Math.round(pct * 100),
    lines,
    count: measurable.length,
    capNote,
    manuals: all.filter(f => f.status === 'manual' || f.status === 'info')
  };
}

function verdictOf(total, opts) {
  opts = opts || {};
  if (opts.unable) return { verdict: 'Unable to Verify', verdictClass: 'unverifiable', summary: opts.unable };
  if (total < 40) return { verdict: 'Not Ready', verdictClass: 'notready' };
  if (total < 70) return { verdict: 'Needs Improvement', verdictClass: 'improve' };
  return { verdict: 'Likely Ready', verdictClass: 'ready' };
}

function scoreAll(findings, opts) {
  opts = opts || {};
  const inventory = opts.inventory || null;
  const cats = CATEGORIES.map(c => scoreCategory(c.key, findings, inventory));
  let total = cats.reduce((n, c) => n + c.score, 0);
  const maxTotal = cats.reduce((n, c) => n + c.max, 0);
  const caps = [];

  const criticalPolicy = findings.some(f => catOf(f) === 'policy' && f.status === 'critical');
  const highPolicy = findings.filter(f => catOf(f) === 'policy' && f.status === 'high').length;
  const robotsAll = findings.some(f => f.id === 'TECH_ROBOTS_BLOCK');
  const httpsFail = findings.some(f => f.id === 'EZ-HTTPS' && f.status !== 'passed');
  const homeNoindex = findings.some(f => f.id === 'TECH_NOINDEX' && f.page === '/');

  if (criticalPolicy) { total = Math.min(total, 22); caps.push('Critical policy-risk signal, score capped at 22 pending manual review.'); }
  if (highPolicy >= 3) { total = Math.min(total, 38); caps.push('Multiple high-severity policy-risk signals, score capped at 38.'); }
  if (robotsAll) { total = Math.min(total, 28); caps.push('robots.txt blocks the entire site, score capped at 28.'); }
  if (homeNoindex) { total = Math.min(total, 35); caps.push('Homepage is noindexed, score capped at 35.'); }
  if (httpsFail) { total = Math.min(total, Math.max(total - 10, 20)); caps.push('Site is not served over HTTPS, 10-point penalty.'); }
  if (inventory && inventory.contentPages >= 3 && inventory.siteType !== 'tools') {
    if (inventory.usefulPct < 20) { total = Math.min(total, 42); caps.push('Fewer than 20% of content pages are substantial.'); }
    else if (inventory.thinPct >= 60) { total = Math.min(total, 52); caps.push('Most content pages are thin.'); }
  }

  total = U.clamp(Math.round(total), 0, maxTotal);

  let crawlConf = opts.crawlConfidence;
  if (crawlConf == null) crawlConf = 80;
  const v = verdictOf(total, opts);

  if (v.verdict === 'Likely Ready' && (highPolicy || robotsAll || httpsFail)) {
    v.verdict = 'Needs Improvement';
    v.verdictClass = 'improve';
    caps.push('Major blocker present, not labelled Likely Ready.');
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
