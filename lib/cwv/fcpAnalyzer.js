'use strict';

/*
 * Core Web Vitals & INP Auditor — FCP analyzer.
 * FCP is not an official Core Web Vital; it is compared against the
 * advisory web.dev target (≤ 1.8 s "good", > 3 s "poor") and labelled
 * advisory. Slow-FCP causes are derived from measured evidence only.
 */

const TH = require('./thresholds');

function analyzeFcp(vitals, docPhases, cssFiles, jsFiles, fonts, nav) {
  const raw = (vitals && vitals.fcp) || {};
  const out = {
    status: raw.status === 'measured' ? 'measured' : 'unavailable',
    value: raw.status === 'measured' && typeof raw.value === 'number' ? Math.round(raw.value * 10) / 10 : null,
    reason: raw.reason || null,
    classification: null,
    causes: [],
    advisory: true,
    note: 'FCP target is advisory (web.dev), not an official Core Web Vitals threshold.'
  };
  if (out.status !== 'measured') return out;
  out.classification = TH.classify(out.value, TH.advisory.fcp);

  if (out.value > TH.advisory.fcp.good) {
    const causes = [];
    const ttfb = docPhases && typeof docPhases.ttfbMs === 'number' ? docPhases.ttfbMs : (nav && typeof nav.ttfb === 'number' ? nav.ttfb : null);
    if (ttfb != null && ttfb > TH.advisory.ttfb.good) {
      causes.push({ kind: 'ttfb', label: 'Server latency', evidence: 'TTFB ' + Math.round(ttfb) + ' ms accounts for ' + Math.round(ttfb / out.value * 100) + '% of FCP.' });
    }
    const blockingCss = (Array.isArray(cssFiles) ? cssFiles : []).filter(c => c && c.blocking && c.bytes && c.bytes > 30 * 1024);
    if (blockingCss.length) {
      causes.push({ kind: 'css', label: 'Render-blocking CSS', evidence: blockingCss.length + ' render-blocking stylesheet(s) of ≥ 30 KB (' + blockingCss.slice(0, 3).map(c => c.url || c.name).join(', ') + '). CSS must be downloaded and parsed before first paint.' });
    }
    const blockingJs = (Array.isArray(jsFiles) ? jsFiles : []).filter(j => j && j.blocking && j.bytes && j.bytes > 30 * 1024);
    if (blockingJs.length) {
      causes.push({ kind: 'js', label: 'Parser-blocking JavaScript', evidence: blockingJs.length + ' parser-blocking script(s) of ≥ 30 KB (' + blockingJs.slice(0, 3).map(j => j.url || j.name).join(', ') + '). Synchronous scripts delay parsing and first paint.' });
    }
    const fontSwap = (Array.isArray(fonts) ? fonts : []).filter(f => f && f.display === 'block');
    if (fontSwap.length) {
      causes.push({ kind: 'font', label: 'Fonts with font-display: block', evidence: fontSwap.length + ' @font-face rule(s) use font-display: block, which can hold text rendering (FOIT) while fonts load.' });
    }
    if (!causes.length) {
      causes.push({ kind: 'other', label: 'HTML delivery / rendering', evidence: 'No single measured cause dominates — review the waterfall for slow resources before first paint.' });
    }
    out.causes = causes;
  }
  return out;
}

module.exports = { analyzeFcp };
