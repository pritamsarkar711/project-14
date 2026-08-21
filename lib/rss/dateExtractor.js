'use strict';

/*
 * RSS Feed Generator — publication date extraction.
 * Deterministic parsing only. Never invents a date: returns null when the
 * input cannot be interpreted reliably.
 *
 * `source` tells the caller where the date came from; `reliable` is false
 * for sitemap lastmod fallbacks and vague human formats, so the UI can
 * label them honestly.
 */

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
};

/* RFC 822 / HTTP date: "Fri, 21 Aug 2026 12:00:00 GMT" */
function parseRfc822(s) {
  const m = String(s).trim().match(
    /^([A-Za-z]{3,9})?\s*,?\s+(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(UTC|GMT|Z|UT|EST|EDT|CST|CDT|PST|PDT|[\+\-]\d{2}:?\d{2})?$/i
  );
  if (!m) return null;
  const mon = MONTHS[String(m[3]).toLowerCase()];
  if (mon == null) return null;
  let year = parseInt(m[4], 10);
  if (year < 100) year += year < 70 ? 2000 : 1900;
  const day = parseInt(m[2], 10);
  const hh = parseInt(m[5] || '0', 10), mm = parseInt(m[6] || '0', 10), ss = parseInt(m[7] || '0', 10);
  if (day < 1 || day > 31 || hh > 23 || mm > 59 || ss > 60) return null;
  // We treat the time as UTC when no offset is supplied (feeds normally are).
  return new Date(Date.UTC(year, mon, day, hh, mm, ss));
}

/* ISO 8601: 2026-08-21, 2026-08-21T12:00:00Z, 2026-08-21T12:00:00+02:00 */
function parseIso(s) {
  const m = String(s).trim().match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[\+\-]\d{2}:?\d{2})?)?$/i
  );
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const hh = m[4] ? +m[4] : 0, mi = m[5] ? +m[5] : 0, ss = m[6] ? +m[6] : 0;
  const tz = m[7];
  let t;
  if (tz && tz !== 'Z') {
    const sign = tz[0] === '-' ? -1 : 1;
    const off = sign * (parseInt(tz.slice(1, 3), 10) * 60 + parseInt(tz.slice(-2), 10));
    t = Date.UTC(y, mo - 1, d, hh, mi, ss) - off * 60000;
  } else {
    t = Date.UTC(y, mo - 1, d, hh, mi, ss);
  }
  const dt = new Date(t);
  // Reject impossible calendar dates (e.g. Feb 31) — JS would roll them over.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1990 || y > 2100) return null;
  return dt;
}

/* Human formats: "August 21, 2026", "21 August 2026", "Aug 21 2026", "21 Aug 2026" */
function parseHuman(s) {
  const t = String(s).trim().replace(/\s+/g, ' ');
  let m = t.match(/^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
  if (m) {
    const mon = MONTHS[String(m[1]).toLowerCase().replace(/\.$/, '')];
    if (mon == null) return null;
    const dt = new Date(Date.UTC(+m[3], mon, +m[2]));
    if (dt.getUTCDate() !== +m[2]) return null;
    return dt;
  }
  m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?,?\s+(\d{4})$/i);
  if (m) {
    const mon = MONTHS[String(m[2]).toLowerCase().replace(/\.$/, '')];
    if (mon == null) return null;
    const dt = new Date(Date.UTC(+m[3], mon, +m[1]));
    if (dt.getUTCDate() !== +m[1]) return null;
    return dt;
  }
  return null;
}

/**
 * Parse a date string from any source.
 * @returns {{date: Date, iso: string, reliable: boolean} | null}
 */
function parseDate(raw, source) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s || s.length > 80) return null;
  let d = null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) d = parseIso(s);
  if (!d) d = parseRfc822(s);
  if (!d) d = parseIso(s);
  if (!d) d = parseHuman(s);
  if (!d || Number.isNaN(d.getTime())) return null;
  const reliable = source !== 'sitemap-lastmod' && source !== 'visible' ? true
    : source === 'sitemap-lastmod' ? false : true;
  return { date: d, iso: d.toISOString(), reliable };
}

/* Format a Date as RFC 822 (RFC 1123) for RSS pubDate/lastBuildDate. */
function toRfc822(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = n => String(n).padStart(2, '0');
  return days[d.getUTCDay()] + ', ' + p(d.getUTCDate()) + ' ' + mon[d.getUTCMonth()] + ' ' +
    d.getUTCFullYear() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + ' GMT';
}

/* Validate a string as RFC 822 (RFC 1123) — the required RSS pubDate format.
 * Plain ISO dates are NOT valid pubDate values, so they are rejected here. */
function isValidRfc822(s) {
  const str = String(s || '').trim();
  if (!/^[A-Za-z]{3,9}\s*,?\s+\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}/.test(str)) return false;
  return !!parseRfc822(str);
}

module.exports = { parseDate, toRfc822, isValidRfc822, parseRfc822, parseIso, parseHuman };
