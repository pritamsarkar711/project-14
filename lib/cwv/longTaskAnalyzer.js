'use strict';

/*
 * Core Web Vitals & INP Auditor, long task analyzer.
 *
 * Detects main-thread tasks > 50 ms (the web.dev long-task threshold),
 * attributes them to scripts where the browser exposed attribution, and
 * groups repeated tasks. Groups overlapping slow interactions are flagged
 * with their potential INP impact, as potential, never as proven cause.
 */

const TH = require('./thresholds');

function sourceOf(t) {
  if (t.url) return t.url;
  const a = Array.isArray(t.attribution) ? t.attribution[0] : null;
  if (a && a.name) return a.name;
  return null;
}

function analyzeLongTasks(longTasks, interactions) {
  const out = { status: 'measured', thresholdMs: TH.longTaskMs, total: 0, totalDuration: 0, tbt: null, groups: [], worst: [], note: null };
  if (longTasks == null) {
    out.status = 'unavailable';
    out.tbt = null;
    out.note = 'Main-thread tasks cannot be observed in this transport mode.';
    return out;
  }
  const tasks = (Array.isArray(longTasks) ? longTasks : [])
    .filter(t => t && typeof t.duration === 'number' && t.duration > TH.longTaskMs)
    .sort((a, b) => a.startTime - b.startTime);
  out.total = tasks.length;
  out.totalDuration = Math.round(tasks.reduce((s, t) => s + t.duration, 0));

  // TBT: each long task contributes (duration − 50 ms) after first paint.
  out.tbt = Math.round(tasks.reduce((s, t) => s + Math.max(0, t.duration - TH.longTaskMs), 0));

  // Group repeated tasks by source.
  const groups = new Map();
  tasks.forEach(t => {
    const src = sourceOf(t) || 'unattributed';
    const g = groups.get(src) || { source: src, count: 0, total: 0, max: 0, first: t.startTime, last: t.startTime };
    g.count++;
    g.total += t.duration;
    g.max = Math.max(g.max, t.duration);
    g.first = Math.min(g.first, t.startTime);
    g.last = Math.max(g.last, t.startTime);
    groups.set(src, g);
  });
  out.groups = Array.from(groups.values())
    .map(g => ({
      source: g.source,
      occurrences: g.count,
      totalDuration: Math.round(g.total),
      maxDuration: Math.round(g.max),
      firstStart: Math.round(g.first),
      lastStart: Math.round(g.last)
    }))
    .sort((a, b) => b.totalDuration - a.totalDuration);

  out.worst = tasks.slice().sort((a, b) => b.duration - a.duration).slice(0, 8).map(t => ({
    duration: Math.round(t.duration),
    startTime: Math.round(t.startTime),
    source: sourceOf(t) || 'unattributed',
    attribution: Array.isArray(t.attribution) ? t.attribution.slice(0, 3).map(a => ({
      name: a.name || null, containerType: a.containerType || null, containerSrc: a.containerSrc || null
    })) : []
  }));

  // Potential INP impact: long tasks overlapping tested interactions.
  const ix = Array.isArray(interactions) ? interactions : [];
  const impacted = new Set();
  ix.forEach(i => {
    if (typeof i.startTime !== 'number' || typeof i.latency !== 'number') return;
    tasks.forEach((t, idx) => {
      if (t.startTime + t.duration >= i.startTime && t.startTime <= i.startTime + i.latency) impacted.add(idx);
    });
  });
  out.potentialInpImpact = tasks.filter((t, idx) => impacted.has(idx)).map(t => ({
    duration: Math.round(t.duration), startTime: Math.round(t.startTime), source: sourceOf(t) || 'unattributed'
  })).slice(0, 10);

  if (!tasks.length) out.note = 'No long tasks (> ' + TH.longTaskMs + ' ms) were observed during the measurement window.';
  return out;
}

module.exports = { analyzeLongTasks };
