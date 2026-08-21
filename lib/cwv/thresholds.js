'use strict';

/*
 * Core Web Vitals & INP Auditor — metric thresholds.
 *
 * LCP / INP / CLS use the current official Core Web Vitals three-tier
 * thresholds (Good / Needs improvement / Poor) as published by Google
 * (web.dev). FCP, TTFB, TBT and Speed Index are NOT Core Web Vitals —
 * they use the advisory targets documented on web.dev/Lighthouse and are
 * labelled "advisory" everywhere they appear in the UI.
 *
 * version: the date this table was last reviewed against the official
 * documentation. The UI surfaces this version so it is never presented as
 * an unverifiable hard-coded fact.
 */

module.exports = {
  version: '2026-08',
  sources: [
    'https://web.dev/articles/vitals',
    'https://web.dev/articles/lcp',
    'https://web.dev/articles/inp',
    'https://web.dev/articles/cls'
  ],
  // Official Core Web Vitals thresholds.
  cwv: {
    lcp: { good: 2500, poor: 4000, unit: 'ms', label: 'LCP' },
    inp: { good: 200, poor: 500, unit: 'ms', label: 'INP' },
    cls: { good: 0.1, poor: 0.25, unit: '', label: 'CLS' }
  },
  // Advisory targets (not official Core Web Vitals thresholds).
  advisory: {
    fcp: { good: 1800, poor: 3000, unit: 'ms', label: 'FCP' },
    ttfb: { good: 800, poor: 1800, unit: 'ms', label: 'TTFB' },
    tbt: { good: 200, poor: 600, unit: 'ms', label: 'TBT' },
    si: { good: 3400, poor: 5800, unit: 'ms', label: 'Speed Index' }
  },
  // Long Task threshold (web.dev): tasks > 50 ms are long tasks.
  longTaskMs: 50,
  // CLS session-window rules (current model):
  // a session window ends when the gap between shifts is > 1 s AND the
  // window has been open for > 5 s. Shifts within 500 ms of user input
  // (hadRecentInput) are excluded from CLS.
  cls: {
    gapMs: 1000,
    windowMs: 5000,
    inputExclusionMs: 500
  }
};

/*
 * Classify a measured value against a three-tier threshold set.
 * Returns { status, label } where status is one of
 * 'good' | 'needs-improvement' | 'poor'.
 */
function classify(value, set) {
  if (value == null || typeof value !== 'number' || !isFinite(value)) return { status: 'unavailable', label: 'Not Available' };
  if (value <= set.good) return { status: 'good', label: 'Good' };
  if (value <= set.poor) return { status: 'needs-improvement', label: 'Needs Improvement' };
  return { status: 'poor', label: 'Poor' };
}

module.exports.classify = classify;
