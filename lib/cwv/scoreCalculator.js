'use strict';

/*
 * Core Web Vitals & INP Auditor — transparent performance score.
 *
 * "Tool Performance Score" — this tool's own 0–100, computed only from
 * measured values with published weights. It is NOT Google's score, NOT
 * PageSpeed Insights and NOT a Lighthouse score; the UI states that.
 *
 * Deterministic: the same measurement bundle always produces the same
 * score (verified by the self-test).
 */

function lin(v, good, poor) {
  if (v == null || !isFinite(v)) return null;
  if (v <= good) return 100;
  if (v >= poor) return 0;
  return Math.round((1 - (v - good) / (poor - good)) * 100);
}
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function calculateScore(ctx) {
  const parts = [];

  function metric(id, label, weight, v, good, poor, advisory) {
    const s = lin(v, good, poor);
    parts.push({
      id, label, weight, score: s, advisory: !!advisory,
      status: s == null ? 'excluded' : (s >= 90 ? 'good' : s >= 50 ? 'fair' : 'poor'),
      note: s == null ? 'Not measured — excluded from the score.' : null,
      detail: s == null ? null : ('value ' + v + ' scored against ' + good + ' → ' + poor)
    });
  }

  const lcp = ctx.lcp, inp = ctx.inp, cls = ctx.cls;
  metric('lcp', 'LCP', 20, lcp && lcp.status === 'measured' ? lcp.value : null, 2500, 4000, false);
  metric('inp', 'INP (lab)', 20, inp && inp.status === 'measured' ? inp.value : null, 200, 500, false);
  metric('cls', 'CLS', 15, cls && cls.status === 'measured' ? cls.value : null, 0.1, 0.25, false);
  metric('ttfb', 'TTFB', 8, ctx.ttfb && ctx.ttfb.status === 'measured' ? ctx.ttfb.value : null, 800, 1800, true);
  metric('fcp', 'FCP', 8, ctx.fcp && ctx.fcp.status === 'measured' ? ctx.fcp.value : null, 1800, 3000, true);
  metric('tbt', 'TBT', 9, ctx.longTasks && typeof ctx.longTasks.tbt === 'number' ? ctx.longTasks.tbt : null, 200, 600, true);

  // Resource efficiency: request count + transfer bytes (measured only).
  {
    const wf = ctx.waterfall;
    let s = null, note = null;
    if (wf && wf.requestCount > 0 && wf.bytesMeasurable) {
      const reqScore = clamp(100 - (wf.requestCount - 20) * 1.1, 0, 100);
      const bytesKb = wf.totalBytes / 1024;
      const byteScore = clamp(100 - (bytesKb - 400) / 40, 0, 100);
      s = Math.round((reqScore + byteScore) / 2);
      note = wf.requestCount + ' requests, ' + Math.round(bytesKb) + ' KB transfer.';
    } else {
      note = 'Transfer sizes not fully measurable — excluded.';
    }
    parts.push({ id: 'resources', label: 'Resource efficiency', weight: 8, score: s, advisory: false, status: s == null ? 'excluded' : (s >= 90 ? 'good' : s >= 50 ? 'fair' : 'poor'), note, detail: null });
  }
  // Network efficiency: caching + compression (measured only).
  {
    let s = null, note = null;
    const cache = ctx.cache;
    if (cache && cache.status === 'measured') {
      const cacheable = cache.static.total ? cache.static.cacheable / cache.static.total : 1;
      const cacheScore = Math.round(cacheable * 60);
      const comp = ctx.resources && ctx.resources.compression;
      const compScore = comp && comp.textResources ? Math.round((comp.compressedText / comp.textResources) * 40) : 0;
      s = clamp(cacheScore + compScore, 0, 100);
      note = 'Cache coverage ' + Math.round(cacheable * 100) + '%, compression coverage ' + (comp && comp.textResources ? Math.round(comp.compressedText / comp.textResources * 100) : 'n/a') + '%.';
    } else {
      note = 'Response headers not observable — excluded.';
    }
    parts.push({ id: 'network', label: 'Network efficiency', weight: 6, score: s, advisory: false, status: s == null ? 'excluded' : (s >= 90 ? 'good' : s >= 50 ? 'fair' : 'poor'), note, detail: null });
  }
  // Rendering efficiency: long tasks + DOM size heuristic (documented).
  {
    let s = null, note = null;
    const lt = ctx.longTasks;
    if (lt) {
      const ltScore = clamp(100 - (lt.total - 2) * 8, 0, 100);
      let domPenalty = 0;
      if (ctx.dom && ctx.dom.status === 'measured') {
        if (ctx.dom.nodeCount > 5000) domPenalty = 25;
        else if (ctx.dom.nodeCount > 2000) domPenalty = 10;
      }
      s = clamp(Math.round(ltScore) - domPenalty, 0, 100);
      note = lt.total + ' long task(s)' + (domPenalty ? '; DOM-size heuristic penalty −' + domPenalty : '') + '.';
    }
    parts.push({ id: 'rendering', label: 'Rendering efficiency', weight: 6, score: s, advisory: false, status: s == null ? 'excluded' : (s >= 90 ? 'good' : s >= 50 ? 'fair' : 'poor'), note, detail: null });
  }

  const available = parts.filter(p => p.score != null);
  const totalWeight = available.reduce((s, p) => s + p.weight, 0);
  const overall = totalWeight ? available.reduce((s, p) => s + p.score * p.weight, 0) / totalWeight : null;

  return {
    label: 'Tool Performance Score',
    value: overall == null ? null : Math.round(overall),
    grade: overall == null ? null : (overall >= 90 ? 'Good' : overall >= 50 ? 'Needs Improvement' : 'Poor'),
    breakdown: parts,
    disclaimer: 'This is the tool\u2019s own transparent score computed from the measurements below. It is not Google\u2019s score, not PageSpeed Insights and not a Lighthouse score. Unmeasured components are excluded and shown in the breakdown.'
  };
}

module.exports = { calculateScore };
