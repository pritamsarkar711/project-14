'use strict';

/**
 * Broken Link Health Score Calculator
 * Creates transparent 0–100 diagnostic score.
 * Factors:
 * - confirmed broken internal links
 * - persistent 5xx failures
 * - DNS failures
 * - broken anchors
 * - redirect loops
 * - excessive redirect chains
 * Does not heavily penalize:
 * - normal 301 redirects
 * - 403,429,bot protection,temporary failures
 */

function calculateScore(report) {
  const stats = report.stats || {};
  const issues = report.issues || [];

  let score = 100;
  const breakdown = [];

  const confirmedBrokenInternal = stats.confirmedBrokenInternal || 0;
  const confirmedBrokenExternal = stats.confirmedBrokenExternal || 0;
  const totalInternal = stats.totalInternal || 1;
  const totalExternal = stats.totalExternal || 1;
  const dnsErrors = stats.dnsErrors || 0;
  const sslErrors = stats.sslErrors || 0;
  const redirectLoops = stats.redirectLoops || 0;
  const longChains = stats.longRedirectChains || 0;
  const brokenAnchors = stats.brokenAnchors || 0;
  const serverErrors = stats.serverErrors || 0;

  // Internal broken links: heavy penalty
  if (confirmedBrokenInternal > 0) {
    const pct = confirmedBrokenInternal / Math.max(1, totalInternal);
    // Up to 40 points penalty for internal broken
    let penalty = Math.min(40, Math.round(pct * 100 * 0.8 + confirmedBrokenInternal * 2));
    // Cap
    if (confirmedBrokenInternal >= 20) penalty = Math.min(50, penalty + 10);
    score -= penalty;
    breakdown.push({ factor: 'Confirmed broken internal links', count: confirmedBrokenInternal, penalty, detail: `${confirmedBrokenInternal} of ${totalInternal} internal links are confirmed broken (${Math.round(pct*100)}%)` });
  }

  // External broken: lighter penalty
  if (confirmedBrokenExternal > 0) {
    const pct = confirmedBrokenExternal / Math.max(1, totalExternal);
    let penalty = Math.min(15, Math.round(pct * 50 + confirmedBrokenExternal * 0.5));
    score -= penalty;
    breakdown.push({ factor: 'Confirmed broken external links', count: confirmedBrokenExternal, penalty, detail: `${confirmedBrokenExternal} external links broken` });
  }

  // DNS failures: high penalty
  if (dnsErrors > 0) {
    const penalty = Math.min(20, dnsErrors * 4);
    score -= penalty;
    breakdown.push({ factor: 'DNS failures', count: dnsErrors, penalty, detail: `${dnsErrors} links failed DNS resolution` });
  }

  // SSL errors
  if (sslErrors > 0) {
    const penalty = Math.min(15, sslErrors * 3);
    score -= penalty;
    breakdown.push({ factor: 'SSL/TLS errors', count: sslErrors, penalty, detail: `${sslErrors} SSL/TLS issues` });
  }

  // Server errors (persistent 5xx)
  if (serverErrors > 0) {
    const penalty = Math.min(20, serverErrors * 3);
    score -= penalty;
    breakdown.push({ factor: 'Persistent server errors (5xx)', count: serverErrors, penalty, detail: `${serverErrors} persistent 5xx failures` });
  }

  // Redirect loops: critical
  if (redirectLoops > 0) {
    const penalty = Math.min(25, redirectLoops * 8);
    score -= penalty;
    breakdown.push({ factor: 'Redirect loops', count: redirectLoops, penalty, detail: `${redirectLoops} redirect loops detected` });
  }

  // Long chains
  if (longChains > 0) {
    const penalty = Math.min(10, longChains * 2);
    score -= penalty;
    breakdown.push({ factor: 'Long redirect chains', count: longChains, penalty, detail: `${longChains} chains longer than 3 hops` });
  }

  // Broken anchors
  if (brokenAnchors > 0) {
    const penalty = Math.min(10, brokenAnchors * 1.5);
    score -= penalty;
    breakdown.push({ factor: 'Broken anchors', count: brokenAnchors, penalty, detail: `${brokenAnchors} anchor targets not found` });
  }

  // Ensure 0-100
  score = Math.max(0, Math.min(100, Math.round(score)));

  let grade = 'Excellent';
  if (score < 90) grade = 'Good';
  if (score < 75) grade = 'Needs Improvement';
  if (score < 50) grade = 'Poor';
  if (score < 25) grade = 'Critical';

  return {
    score,
    grade,
    breakdown,
    explanation: `Score starts at 100 and deducts for confirmed issues. Internal broken links penalized most (up to 40-50 points), DNS/server errors and redirect loops next, external broken and anchors least. Normal 301 redirects, 403/429, bot protection, and temporary failures are not heavily penalized. This is an internal diagnostic score, not a Google score.`
  };
}

module.exports = { calculateScore };
