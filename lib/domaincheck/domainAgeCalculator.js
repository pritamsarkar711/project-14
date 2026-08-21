'use strict';

/*
 * Domain age & expiration math.
 * Uses the official registration date only (RDAP/WHOIS) — never search-engine
 * first-seen heuristics. If no registration date exists, the result is
 * explicitly "cannot be reliably determined".
 */

const U = require('./util');

function ageParts(from, to) {
  if (!(from instanceof Date) || !(to instanceof Date) || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  if (to.getTime() < from.getTime()) return null;
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  let months = to.getUTCMonth() - from.getUTCMonth();
  let days = to.getUTCDate() - from.getUTCDate();
  if (days < 0) {
    months -= 1;
    const prevMonth = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 0));
    days += prevMonth.getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const totalDays = Math.floor((to.getTime() - from.getTime()) / 86400000);
  return { years, months, days, totalDays };
}

function ageText(parts) {
  if (!parts) return null;
  const bits = [];
  if (parts.years) bits.push(parts.years + (parts.years === 1 ? ' year' : ' years'));
  if (parts.months) bits.push(parts.months + (parts.months === 1 ? ' month' : ' months'));
  if (parts.days || !bits.length) bits.push(parts.days + (parts.days === 1 ? ' day' : ' days'));
  return bits.join(', ');
}

function expiryWarning(expiryIso, now) {
  const nowD = now || new Date();
  if (!expiryIso) return null;
  const d = U.parseDateLoose(expiryIso);
  if (!d) return null;
  const days = Math.ceil((d.date.getTime() - nowD.getTime()) / 86400000);
  let bucket, label, level;
  if (days < 0) { bucket = 'expired'; label = 'Expired'; level = 'fail'; }
  else if (days <= 7) { bucket = 'expiring-7d'; label = 'Expiring within 7 days'; level = 'warn'; }
  else if (days <= 30) { bucket = 'expiring-30d'; label = 'Expiring within 30 days'; level = 'warn'; }
  else if (days <= 90) { bucket = 'expiring-90d'; label = 'Expiring within 90 days'; level = 'info'; }
  else { bucket = 'ok'; label = 'More than 90 days remaining'; level = 'ok'; }
  return {
    bucket, label, level,
    daysUntilExpiry: days,
    expiresDate: expiryIso,
    note: 'Registry data can lag reality — this is an indication, not a guarantee the domain will lapse.'
  };
}

function calculate(registration) {
  const now = new Date();
  const out = {
    available: false,
    registeredDate: null,
    registeredIso: null,
    age: null,
    ageTextValue: null,
    years: null, months: null, days: null, totalDays: null,
    expiresIso: null,
    expiry: null,
    timeline: [],
    note: null
  };
  if (!registration || !registration.registration) {
    out.available = false;
    out.note = 'Domain age cannot be reliably determined — no official registration date is publicly available.';
    return out;
  }
  const reg = U.parseDateLoose(registration.registration);
  if (!reg) {
    out.note = 'Domain age cannot be reliably determined — the registration date could not be parsed.';
    return out;
  }
  out.available = true;
  out.registeredIso = reg.iso;
  out.registeredDate = U.fmtDate(reg.date);
  const parts = ageParts(reg.date, now);
  out.age = parts;
  out.ageTextValue = ageText(parts);
  out.years = parts ? parts.years : null;
  out.months = parts ? parts.months : null;
  out.days = parts ? parts.days : null;
  out.totalDays = parts ? parts.totalDays : null;

  if (registration.expiration) {
    const exp = U.parseDateLoose(registration.expiration);
    if (exp) {
      out.expiresIso = exp.iso;
      out.expiry = expiryWarning(exp.iso, now);
    }
  }
  return out;
}

function buildTimeline(registration, nowIso) {
  const nowD = nowIso ? U.parseDateLoose(nowIso) : null;
  const items = [];
  if (registration && registration.registration) {
    const d = U.parseDateLoose(registration.registration);
    if (d) items.push({ event: 'registered', date: d.iso, label: 'Registered', source: registration.source || 'registration-data' });
  }
  if (registration && registration.updated) {
    const d = U.parseDateLoose(registration.updated);
    if (d) items.push({ event: 'updated', date: d.iso, label: 'Last updated', source: registration.source || 'registration-data' });
  }
  const nowDate = nowD ? nowD.date : new Date();
  items.push({ event: 'now', date: nowDate.toISOString(), label: 'Current date', source: 'system-clock' });
  if (registration && registration.expiration) {
    const d = U.parseDateLoose(registration.expiration);
    if (d) items.push({ event: 'expires', date: d.iso, label: 'Expiration', source: registration.source || 'registration-data' });
  }
  // chronological order
  items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return items;
}

module.exports = { calculate, ageText, ageParts, expiryWarning, buildTimeline };
