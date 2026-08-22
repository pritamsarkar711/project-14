'use strict';

/*
 * RDAP client: RDAP first, always.
 *
 * Uses the local TLD registry table for the registry's official RDAP base,
 * with https://rdap.org (IANA bootstrap) as the generic fallback for TLDs
 * without a locally-known endpoint. Plain registry HTTPS only; no third-party
 * scraping sites. Every response is parsed defensively, fields that are not
 * present stay absent.
 *
 * Results carry an explicit outcome:
 *   'ok'          → parsed RDAP record
 *   'available'   → registry answered 404 (not found)
 *   'unavailable' → network/egress failure, rate limit, or unparsable body
 */

const { createFetcher } = require('../wptheme/fetcher');
const U = require('./util');

const RDAP_BOOTSTRAP = 'https://rdap.org/domain/';
const MAX_BYTES = 384 * 1024;
const TIMEOUT_MS = 9000;

function parseIsoList(events) {
  const out = {};
  for (const ev of events || []) {
    if (!ev || !ev.eventDate) continue;
    const d = U.parseDateLoose(ev.eventDate);
    if (!d) continue;
    const key = String(ev.eventAction || '').toLowerCase();
    if (key === 'registration') out.registration = d.iso;
    else if (key === 'expiration') out.expiration = d.iso;
    else if (key === 'last changed') out.updated = d.iso;
    else if (key === 'last update of rdap database') out.databaseUpdated = d.iso;
    else if (key === 'reregistration') out.reregistration = d.iso;
  }
  return out;
}

function vcardField(vcard, wanted) {
  const v = vcard && vcard[0] === 'vcard' ? vcard[1] : null;
  if (!v) return null;
  for (const item of v) {
    if (Array.isArray(item) && item.length >= 4 && Array.isArray(item[3])) {
      const name = item[0];
      const val = item[3];
      const match = wanted.some(w => name === w || String(val).includes(w));
      if (match && typeof val === 'string') return U.stripAsciiControl(val);
    }
  }
  return null;
}

function vcardLabel(vcard, label) {
  const v = vcard && vcard[0] === 'vcard' ? vcard[1] : null;
  if (!v) return null;
  for (const item of v) {
    if (!Array.isArray(item)) continue;
    const labels = Array.isArray(item[3]) ? item[3] : [item[3]];
    if (String(item[0] || '').toLowerCase() === String(label).toLowerCase()) {
      const val = labels.filter(x => typeof x === 'string').map(U.stripAsciiControl).filter(Boolean);
      if (val.length) return val[0];
    }
  }
  return null;
}

/* Extract registrar + privacy info. Registrant data is NEVER surfaced. */
function entitiesInfo(entities) {
  let registrar = null;
  let privacy = null;
  for (const ent of entities || []) {
    const roles = (ent.roles || []).map(r => String(r).toLowerCase());
    if (roles.includes('registrar')) {
      const name = vcardLabel(ent.vcardArray, 'fn') || U.stripAsciiControl(ent.fn);
      const org = vcardLabel(ent.vcardArray, 'org');
      const ianaId = (ent.publicIds || []).filter(p => /iana/i.test(String(p.type || ''))).map(p => String(p.identifier))[0] || null;
      const email = vcardLabel(ent.vcardArray, 'email');
      const tel = vcardLabel(ent.vcardArray, 'tel');
      const adr = vcardLabel(ent.vcardArray, 'adr');
      const url = vcardLabel(ent.vcardArray, 'url');
      registrar = {
        name: name || org || null,
        organization: org || null,
        ianaId,
        email, tel, adr, url,
        handle: ent.handle || null,
        source: 'rdap'
      };
    }
    if (roles.includes('registrant')) {
      const v = ent.vcardArray && ent.vcardArray[0] === 'vcard' ? ent.vcardArray : null;
      const hasName = !!(v && vcardLabel(v, 'fn'));
      const hasOrg = !!(v && vcardLabel(v, 'org'));
      const hasContact = !!(v && (vcardLabel(v, 'email') || vcardLabel(v, 'tel')));
      privacy = {
        // only booleans/status, never the actual values
        namePresent: hasName,
        orgPresent: hasOrg,
        contactPresent: hasContact,
        redacted: !hasName && !hasOrg && !hasContact
      };
    }
  }
  return { registrar, privacy };
}

function parseDomainRecord(json) {
  const events = parseIsoList(json.events);
  const ent = entitiesInfo(json.entities);
  const nameservers = (json.nameservers || []).map(ns => ({
    host: U.stripAsciiControl(ns.ldhName || ns.unicodeName || ''),
    ips: {
      v4: (ns.ipAddresses && ns.ipAddresses.v4 || []).map(String),
      v6: (ns.ipAddresses && ns.ipAddresses.v6 || []).map(String)
    },
    statuses: (ns.status || []).map(String)
  })).filter(ns => ns.host);

  let selfLink = null;
  for (const link of json.links || []) {
    if (String(link.rel || '').toLowerCase() === 'self' && link.href) selfLink = String(link.href);
  }

  return {
    handle: json.handle || null,
    ldhName: U.stripAsciiControl(json.ldhName),
    unicodeName: json.unicodeName ? U.stripAsciiControl(json.unicodeName) : null,
    status: (json.status || []).map(String),
    events,
    nameservers,
    registrar: ent.registrar,
    privacy: ent.privacy,
    secureDNS: {
      delegationSigned: json.secureDNS ? !!json.secureDNS.delegationSigned : null,
      dsData: (json.secureDNS && json.secureDNS.dsData || []).map(d => ({
        keyTag: d.keyTag, algorithm: d.algorithm, digestType: d.digestType, digest: String(d.digest || '')
      }))
    },
    rdapServer: selfLink,
    whoisServer: json.port43 || null,
    notices: (json.notices || []).slice(0, 3).map(n => ({
      title: U.stripAsciiControl(n.title),
      description: (n.description || []).map(d => U.stripAsciiControl(d).slice(0, 240)).filter(Boolean).slice(0, 2)
    })).filter(n => n.title || (n.description && n.description.length)),
    raw: {
      objectClassName: json.objectClassName || null,
      domain: json.handle ? null : null
    }
  };
}

function createRdapClient(opt) {
  opt = opt || {};
  const fetcher = opt.fetcher || createFetcher({ maxRequests: 6, maxTotalBytes: MAX_BYTES * 2 });
  const timeout = opt.timeout || TIMEOUT_MS;

  async function getJson(url) {
    const res = await fetcher.fetchFollow(url, {
      maxBytes: MAX_BYTES, timeout,
      headers: { 'Accept': 'application/rdap+json, application/json;q=0.9', 'User-Agent': 'huvanti-domain-checker/1.0 (+https://huvanti.com/domain-information-checker)' }
    });
    return res;
  }

  async function lookupDomain(domain, tldInfo) {
    const urls = [];
    if (tldInfo && tldInfo.rdapEndpoint) urls.push(tldInfo.rdapEndpoint + 'domain/' + domain);
    urls.push(RDAP_BOOTSTRAP + domain);
    const seen = new Set();
    let lastErr = null;
    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      try {
        const res = await getJson(url);
        if (res.status === 404) {
          return { outcome: 'available', domain, source: 'rdap', url, note: 'The registry’s RDAP service answered 404 (no such domain).', timestamp: U.nowIso() };
        }
        if (res.status === 429) {
          return {
            outcome: 'unavailable', domain, source: 'rdap', url,
            reason: 'rate_limit',
            note: 'The registry RDAP service rate-limited this request' + (res.headers && res.headers['retry-after'] ? ' (retry after ' + res.headers['retry-after'] + 's)' : '') + '. Availability could not be verified.',
            timestamp: U.nowIso()
          };
        }
        if (res.status !== 200) {
          lastErr = { code: 'http_' + res.status, message: 'RDAP answered HTTP ' + res.status + '.' };
          continue;
        }
        let json;
        try { json = JSON.parse(res.text); } catch (e) {
          lastErr = { code: 'parse', message: 'RDAP returned a non-JSON response.' };
          continue;
        }
        if (!json || typeof json !== 'object' || (!json.objectClassName && !json.ldhName)) {
          lastErr = { code: 'parse', message: 'RDAP returned an unrecognised record.' };
          continue;
        }
        if (json.errorCode === 404 || (json.objectClassName === 'error' && json.errorCode)) {
          return { outcome: 'available', domain, source: 'rdap', url, note: 'The registry’s RDAP service reported the domain as not found.', timestamp: U.nowIso() };
        }
        const record = parseDomainRecord(json);
        record.timestamp = U.nowIso();
        record.source = 'rdap';
        record.rdapUrl = url;
        return { outcome: 'ok', domain, record, url, timestamp: U.nowIso() };
      } catch (e) {
        lastErr = e;
      }
    }
    const reason = lastErr && lastErr.code ? lastErr.code : 'error';
    const note = ['tls_blocked', 'unreachable', 'timeout', 'dns', 'fetch_failed'].includes(reason)
      ? 'RDAP could not be reached (direct HTTPS to the registry failed in this environment).'
      : 'RDAP lookup failed: ' + (lastErr && lastErr.message ? lastErr.message : 'unknown error');
    return { outcome: 'unavailable', domain, source: 'rdap', reason, note, timestamp: U.nowIso() };
  }

  /* IP/ASN RDAP for production ASN enrichment (IP → network org, ASN). */
  async function lookupIp(ip) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return { outcome: 'unavailable', reason: 'ipv6_not_supported' };
    try {
      const res = await getJson('https://rdap.org/ip/' + ip);
      if (res.status !== 200) return { outcome: 'unavailable', reason: 'http_' + res.status };
      const json = JSON.parse(res.text);
      const asn = (json.asn || null);
      const org = ((json.entities || []).filter(e => (e.roles || []).includes('registrant'))[0] || {});
      const orgName = org.vcardArray ? vcardLabel(org.vcardArray, 'fn') : null;
      return {
        outcome: 'ok', source: 'rdap',
        name: json.name || null, handle: json.handle || null,
        startAddress: json.startAddress, endAddress: json.endAddress,
        country: json.country || null,
        asn: asn ? { asn: asn, name: null, source: 'rdap' } : null,
        orgName: orgName || null
      };
    } catch (e) {
      return { outcome: 'unavailable', reason: e && e.code ? e.code : 'error' };
    }
  }

  async function lookupAutnum(asn) {
    try {
      const res = await getJson('https://rdap.org/autnum/' + asn);
      if (res.status !== 200) return { outcome: 'unavailable', reason: 'http_' + res.status };
      const json = JSON.parse(res.text);
      const holder = ((json.entities || []).filter(e => (e.roles || []).includes('holder'))[0] || {});
      const holderName = holder.vcardArray ? vcardLabel(holder.vcardArray, 'fn') : null;
      return { outcome: 'ok', source: 'rdap', asn: json.handle || asn, name: json.name || holderName || null, holderName, country: json.country || null };
    } catch (e) {
      return { outcome: 'unavailable', reason: e && e.code ? e.code : 'error' };
    }
  }

  return { lookupDomain, lookupIp, lookupAutnum };
}

module.exports = { createRdapClient, parseDomainRecord };
