'use strict';

/*
 * WHOIS fallback, used ONLY when RDAP is unavailable for the TLD.
 * Queries the IANA-assigned WHOIS server for the TLD directly over TCP/43.
 * No third-party scraping sites. Defensive parsing: only well-known field
 * patterns are extracted, everything else is ignored.
 *
 * Registrant (owner) data is detected for privacy status only and is never
 * surfaced in any form.
 */

const net = require('net');
const U = require('./util');

const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 7000;

function whoisQuery(server, query, opt) {
  opt = opt || {};
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let done = false;
    const finish = (err, data) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch (e) { /* ignore */ }
      err ? reject(err) : resolve(data);
    };
    const sock = net.connect({ host: server, port: 43 });
    const timer = setTimeout(() => finish(U.makeError('timeout', 'WHOIS query timed out.')), opt.timeout || TIMEOUT_MS);
    sock.on('error', e => {
      clearTimeout(timer);
      const c = String(e.code || '');
      if (/ECONNRESET|EPIPE/.test(c)) finish(U.makeError('egress_blocked', 'WHOIS (TCP/43) connection was reset, direct WHOIS is not possible from this environment.'));
      else finish(U.makeError('whois_error', 'WHOIS connection failed: ' + e.message));
    });
    sock.on('connect', () => sock.write(query + '\r\n'));
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      if (buf.length > MAX_BYTES) finish(U.makeError('too_large', 'WHOIS response exceeded the size limit.'));
    });
    sock.on('end', () => { clearTimeout(timer); finish(null, buf); });
    sock.on('close', () => { clearTimeout(timer); finish(null, buf); });
  });
}

const NOT_FOUND_PATTERNS = [
  /no match for/i, /not found/i, /no entries found/i, /domain not found/i,
  /no data found/i, /not registered/i, /is free\b/i, /no such domain/i,
  /status:\s*free/i, /no matching record/i, /nothing found/i,
  /queried object does not exist/i, /domain does not exist/i
];

function fieldAfter(text, label) {
  const re = new RegExp('^\\s*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:?\\s*(.+)$', 'im');
  const m = text.match(re);
  if (!m) return null;
  return U.stripAsciiControl(m[1].split(/[\r\n]/)[0]);
}

function listAfter(text, label) {
  const re = new RegExp('^\\s*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:?\\s*(.+)$', 'im');
  const m = text.match(re);
  if (!m) return [];
  return U.stripAsciiControl(m[1]).split(/\s*,\s*/).filter(Boolean);
}

function parseWhois(text) {
  const t = String(text || '');
  if (!t.trim()) return null;
  for (const re of NOT_FOUND_PATTERNS) {
    if (re.test(t)) return { found: false, source: 'whois' };
  }

  const registrar = fieldAfter(t, 'Registrar') || fieldAfter(t, 'Sponsoring Registrar');
  const ianaId = fieldAfter(t, 'Registrar IANA ID');
  const created = fieldAfter(t, 'Creation Date') || fieldAfter(t, 'Registered on') || fieldAfter(t, 'Created on') || fieldAfter(t, 'Created');
  const updated = fieldAfter(t, 'Updated Date') || fieldAfter(t, 'Last updated');
  const expires = fieldAfter(t, 'Registry Expiry Date') || fieldAfter(t, 'Expiration Date') || fieldAfter(t, 'Expiry date') || fieldAfter(t, 'Expires on');
  const dnssec = fieldAfter(t, 'DNSSEC');
  const registrarUrl = fieldAfter(t, 'Registrar URL');
  const registrarWhois = fieldAfter(t, 'Registrar WHOIS Server');
  const abuseEmail = fieldAfter(t, 'Registrar Abuse Contact Email');
  const abusePhone = fieldAfter(t, 'Registrar Abuse Contact Phone');

  // Name servers: lines like "Name Server: NS1.X.COM" (may repeat) or a comma list
  const nsLines = [];
  const nsRe = /^\s*Name Server\s*:\s*(.+)$/gim;
  let m;
  while ((m = nsRe.exec(t))) nsLines.push(U.stripAsciiControl(m[1]));
  const nsAlt = listAfter(t, 'nserver');
  const nameservers = Array.from(new Set(nsLines.length ? nsLines : nsAlt)).slice(0, 13);

  const statuses = [];
  const stRe = /^\s*(?:Domain Status|Status|state)\s*:\s*([^\s]+)/gim;
  while ((m = stRe.exec(t))) statuses.push(m[1]);

  // Registrant privacy: detect redaction phrases; NEVER extract the values.
  const privacyPhrases = /redacted for privacy|privacy service|whois privacy|private registration|data protected|gdpr|privacy protection|masked|withheld for privacy|not disclosed/i;
  const registrantSection = (t.split(/registrant/i, 2)[1] || '');
  const privacy = privacyPhrases.test(registrantSection) || privacyPhrases.test(t);

  const dates = {};
  const dC = created ? U.parseDateLoose(created) : null;
  const dU = updated ? U.parseDateLoose(updated) : null;
  const dE = expires ? U.parseDateLoose(expires) : null;
  if (dC) dates.registration = dC.iso;
  if (dU) dates.updated = dU.iso;
  if (dE) dates.expiration = dE.iso;

  return {
    found: true,
    source: 'whois',
    registrar: registrar ? {
      name: registrar, ianaId: ianaId || null,
      url: registrarUrl || null,
      whoisServer: registrarWhois || null,
      abuseEmail: abuseEmail || null,
      abusePhone: abusePhone || null,
      source: 'whois'
    } : null,
    dates,
    statuses,
    nameservers,
    dnssec: dnssec ? U.stripAsciiControl(dnssec).toLowerCase() : null,
    privacy: privacy ? { redacted: true, note: 'Registrant details are privacy-protected in the WHOIS output.' } : { redacted: false },
    note: null
  };
}

function createWhoisClient(opt) {
  opt = opt || {};
  const transport = opt.transport || null; // injectable: async (server, query) => string

  async function lookup(domain, tldInfo) {
    const server = tldInfo && tldInfo.whoisServer;
    if (!server) {
      return { outcome: 'unavailable', reason: 'no_whois_server', note: 'No IANA-assigned WHOIS server for this TLD in the local database.', source: 'whois', timestamp: U.nowIso() };
    }
    try {
      const text = transport ? await transport(server, domain) : await whoisQuery(server, domain, { timeout: opt.timeout });
      const parsed = parseWhois(text.toString('utf8'));
      if (!parsed) {
        return { outcome: 'unavailable', reason: 'unparsable', note: 'The WHOIS server answered, but the response could not be parsed.', source: 'whois', timestamp: U.nowIso() };
      }
      if (!parsed.found) {
        return { outcome: 'available', source: 'whois', note: 'The WHOIS server reported no match for this domain.', timestamp: U.nowIso() };
      }
      parsed.timestamp = U.nowIso();
      parsed.whoisServer = server;
      return { outcome: 'ok', record: parsed, source: 'whois', timestamp: U.nowIso() };
    } catch (e) {
      const reason = e && e.code ? e.code : 'error';
      const note = reason === 'egress_blocked' || reason === 'timeout'
        ? 'WHOIS (TCP/43) is not reachable from this environment.'
        : 'WHOIS lookup failed: ' + (e && e.message ? e.message : 'unknown error');
      return { outcome: 'unavailable', reason, note, source: 'whois', timestamp: U.nowIso() };
    }
  }

  return { lookup };
}

module.exports = { createWhoisClient, parseWhois, whoisQuery };
