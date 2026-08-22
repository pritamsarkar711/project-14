'use strict';

/*
 * huvanti Domain Information Checker, shared helpers.
 * Accuracy-first: every helper here exists to carry VALUE + SOURCE + CONFIDENCE,
 * never to invent data.
 */

function makeError(code, message, extra) {
  const e = new Error(message || code);
  e.code = code;
  if (extra) {
    // merge extra props but never let them clobber code/message
    for (const k of Object.keys(extra)) {
      if (k === 'code' || k === 'message' || k === 'name' || k === 'stack') continue;
      try { e[k] = extra[k]; } catch (err) { /* read-only */ }
    }
  }
  return e;
}

function nowIso() {
  return new Date().toISOString();
}

function safeString(v, max) {
  const s = String(v == null ? '' : v);
  return max && s.length > max ? s.slice(0, max) : s;
}

function stripAsciiControl(s) {
  return String(s == null ? '' : s)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/* parse an ISO-ish or common date into {iso, date} or null. Tolerant of
 * RDAP/WHOIS formats, but returns null instead of guessing. */
function parseDateLoose(v) {
  if (v == null) return null;
  const s = stripAsciiControl(v);
  if (!s) return null;
  // epoch seconds/millis
  if (/^\d{9,13}$/.test(s)) {
    const n = Number(s);
    const d = new Date(s.length >= 12 ? n : n * 1000);
    if (!Number.isNaN(d.getTime())) return { iso: d.toISOString(), date: d };
    return null;
  }
  const m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?)?/i);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const hh = m[4] != null ? Number(m[4]) : 0;
  const mi = m[5] != null ? Number(m[5]) : 0;
  const ss = m[6] != null ? Number(m[6]) : 0;
  let date;
  if (m[8]) {
    date = new Date(Date.UTC(y, mo - 1, d, hh, mi, ss));
    const off = m[8] === 'Z' ? 0 : (Number(m[8].slice(0, 3)) * 60 + Number(m[8].slice(-2))) * 60000 * (m[8].startsWith('-') ? -1 : 1);
    date = new Date(date.getTime() - off);
  } else {
    date = new Date(y, mo - 1, d, hh, mi, ss);
  }
  if (Number.isNaN(date.getTime())) return null;
  if (y < 1970 || y > 2200) return null;
  return { iso: date.toISOString(), date };
}

function fmtDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const mm = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  return mm;
}

function dateOnlyIso(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/* confidence math: cap at 0-100, round to int */
function conf(v) {
  const n = Math.round(Number(v) || 0);
  return Math.max(0, Math.min(100, n));
}

/* conflict tracker: same subject reported with different values from
 * different sources is surfaced, never silently merged. */
function ConflictTracker() {
  const seen = new Map();
  return {
    note(subject, value, source) {
      const key = String(subject).toLowerCase();
      if (!seen.has(key)) seen.set(key, { subject, values: [] });
      const entry = seen.get(key);
      const valStr = String(value == null ? '' : value).trim();
      if (valStr && !entry.values.some(x => x.value === valStr && x.source === source)) {
        entry.values.push({ value: valStr, source: source || 'unknown' });
      }
    },
    list() {
      const out = [];
      for (const e of seen.values()) {
        const distinct = [];
        for (const v of e.values) if (!distinct.some(d => d.value === v.value)) distinct.push(v);
        if (distinct.length > 1) out.push({ subject: e.subject, values: distinct });
      }
      return out;
    }
  };
}

function withTimeout(promise, ms, code, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(makeError(code || 'timeout', message || 'Timed out.')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

/* Small bounded concurrency pool for parallel DNS work. */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;
  const runners = [];
  const n = Math.max(1, Math.min(limit, items.length || 1));
  for (let w = 0; w < n; w++) {
    runners.push((async () => {
      while (i < items.length) {
        const idx = i++;
        try { results[idx] = await worker(items[idx], idx); }
        catch (e) { results[idx] = e && e.code ? e : makeError('error', e && e.message ? e.message : String(e)); }
      }
    })());
  }
  await Promise.all(runners);
  return results;
}

module.exports = {
  makeError, nowIso, safeString, stripAsciiControl, isPlainObject,
  parseDateLoose, fmtDate, dateOnlyIso, conf, ConflictTracker,
  withTimeout, sleep, pool
};
