'use strict';

/*
 * Core Web Vitals & INP Auditor — CLS analyzer.
 *
 * Implements the current CLS session-window model: shifts are grouped into
 * session windows; a window ends when the gap between shifts exceeds 1 s
 * AND the window has been open for more than 5 s. The final CLS value is
 * the maximum window score — shifts are NOT summed indefinitely.
 *
 * Shifts that occur within 500 ms of user input (hadRecentInput) are
 * excluded from the value, per the CLS spec, and reported separately.
 */

const TH = require('./thresholds');

function analyzeCls(vitals) {
  const raw = (vitals && vitals.cls) || {};
  const out = {
    status: raw.status === 'measured' ? 'measured' : 'unavailable',
    value: raw.status === 'measured' && typeof raw.value === 'number' ? raw.value : null,
    reason: raw.reason || null,
    classification: null,
    windows: [],
    largestWindow: null,
    excludedShifts: [],
    shifts: [],
    model: 'session-windows (gap > 1 s closes a window open > 5 s)',
    note: null
  };

  if (out.status !== 'measured') return out;
  if (!Array.isArray(raw.entries)) {
    out.status = 'unavailable';
    out.reason = 'No raw layout-shift entries were captured.';
    out.value = null;
    return out;
  }

  const entries = raw.entries;
  const clean = entries
    .filter(e => e && typeof e.startTime === 'number' && typeof e.value === 'number')
    .sort((a, b) => a.startTime - b.startTime);

  (Array.isArray(raw.excluded) ? raw.excluded : []).forEach(e => {
    out.excludedShifts.push({
      value: typeof e.value === 'number' ? e.value : null,
      startTime: typeof e.startTime === 'number' ? e.startTime : null,
      reason: e.reason || 'Excluded (recent user input)'
    });
  });

  // Session windows per the current model.
  let cur = null;
  const windows = [];
  clean.forEach(e => {
    if (!cur) {
      cur = { startTime: e.startTime, endTime: e.startTime, shifts: [], value: 0 };
      windows.push(cur);
    }
    const gap = e.startTime - cur.endTime;
    const openFor = cur.endTime - cur.startTime;
    if (gap > TH.cls.gapMs && openFor > TH.cls.windowMs) {
      cur = { startTime: e.startTime, endTime: e.startTime, shifts: [], value: 0 };
      windows.push(cur);
    }
    cur.shifts.push(e);
    cur.value += e.value;
    cur.endTime = Math.max(cur.endTime, e.startTime + (e.duration || 0));
  });

  out.windows = windows.map(w => ({
    startTime: w.startTime,
    endTime: w.endTime,
    value: Math.round(w.value * 10000) / 10000,
    shiftCount: w.shifts.length
  }));

  // The official value is derived from the session windows (largest window),
  // never from a naive sum of all shifts.
  let largest = null;
  windows.forEach(w => { if (!largest || w.value > largest.value) largest = w; });
  out.value = largest ? Math.round(largest.value * 10000) / 10000 : 0;
  out.classification = TH.classify(out.value, TH.cwv.cls);
  out.largestWindow = largest ? {
    startTime: largest.startTime,
    endTime: largest.endTime,
    value: Math.round(largest.value * 10000) / 10000,
    shifts: largest.shifts.map(s => ({
      value: Math.round(s.value * 10000) / 10000,
      startTime: s.startTime,
      hadRecentInput: !!s.hadRecentInput,
      sources: (Array.isArray(s.sources) ? s.sources : []).slice(0, 4).map(src => ({
        selector: src.selector || null,
        tag: src.tag || null,
        prevRect: src.prevRect || null,
        curRect: src.curRect || null
      }))
    }))
  } : null;

  out.shifts = out.largestWindow ? out.largestWindow.shifts : [];
  if (windows.length > 1) {
    out.note = windows.length + ' session windows detected; final CLS = largest window (' + (largest ? Math.round(largest.value * 10000) / 10000 : 0) + '). Shifts in separate windows are not summed.';
  }
  return out;
}

module.exports = { analyzeCls };
