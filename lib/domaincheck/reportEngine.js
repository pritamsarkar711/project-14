'use strict';

/*
 * Report engine — assembles every analyzer output into the final report.
 * Responsibilities:
 *   - domain status derivation (Active / Expired / Available / Unknown)
 *   - domain-age + timeline (from official registration data only)
 *   - status grouping with plain-language explanations
 *   - data-source ledger + conflicts + explicit unverified list
 *   - registration/privacy section (registrant data never surfaced)
 */

const U = require('./util');
const { interpret, groupStatuses } = require('./statusInterpreter');
const { calculate, buildTimeline } = require('./domainAgeCalculator');
const { detectCdn } = require('./cdnDetector');
const { detectHosting } = require('./hostingDetector');
const { detectTechnology } = require('./technologyDetector');
const { collectObservations } = require('./subdomainAnalyzer');
const { healthChecks } = require('./dnsAnalyzer');

function deriveDomainStatus(regOutcome, registration, dns, rootDnsActive) {
  // Availability from registry answers
  if (regOutcome === 'available') {
    return { status: 'Available', key: 'available', note: 'The registry answered that this domain is not registered.', source: 'rdap/whois' };
  }
  const reg = registration || {};
  const expirationIso = (reg.dates && reg.dates.expiration) || reg.expiration || null;
  if (expirationIso && regOutcome === 'ok') {
    const exp = U.parseDateLoose(expirationIso);
    const now = new Date();
    if (exp && exp.date.getTime() < now.getTime()) {
      const statuses = (reg.statuses || []).join(' ').toLowerCase();
      if (/redemption|pendingdelete/.test(statuses)) {
        return { status: 'Expired (redemption)', key: 'expired-redemption', note: 'The domain is past its expiration date and is in redemption/pending-delete.', source: reg.source };
      }
      return { status: 'Expired', key: 'expired', note: 'The domain is past its registry expiration date. It may still be renewable during a grace period.', source: reg.source };
    }
  }
  if (regOutcome === 'ok') {
    if (reg.statuses && /serverhold|clienthold/i.test(reg.statuses.join(' '))) {
      return { status: 'Active (on hold)', key: 'on-hold', note: 'The domain is registered but on registry/registrar hold (DNS is usually suspended).', source: reg.source };
    }
    if ((reg.statuses || []).some(s => /pendingdelete|redemption/i.test(s))) {
      return { status: 'Pending delete', key: 'pending-delete', note: 'The domain is registered but moving toward deletion.', source: reg.source };
    }
    return { status: 'Active', key: 'active', note: 'The domain is registered and not expired.', source: reg.source };
  }
  if (regOutcome === 'unavailable' || regOutcome === 'unknown') {
    const hasNs = !!(dns && dns.records && dns.records.NS && dns.records.NS.length);
    const hasSoa = !!(dns && dns.records && dns.records.SOA && dns.records.SOA.length);
    if (hasNs || hasSoa) {
      return { status: 'Registered (DNS active)', key: 'registered-dns', note: 'Registration data could not be retrieved, but the domain has an active DNS zone, so it is very likely registered.', source: 'dns' };
    }
    if (rootDnsActive) {
      return { status: 'Registered (DNS active)', key: 'registered-dns', note: 'Registration data could not be retrieved for this name, but its registered parent domain has an active DNS zone, so it is very likely registered.', source: 'dns' };
    }
    return { status: 'Unknown', key: 'unknown', note: 'Registration data is unavailable and DNS shows no zone, so registration status cannot be verified.', source: null };
  }
  return { status: 'Unknown', key: 'unknown', note: 'Registration status could not be determined.', source: null };
}

function buildReport(inputs) {
  const ctx = inputs;
  const domain = ctx.parsed.hostname;
  const root = ctx.parsed.registrable;
  const tldInfo = ctx.tldInfo;

  const registration = ctx.registration; // normalized {source, registrar, dates:{...}, statuses, nameservers, dnssec, privacy, ...}
  const regOutcome = ctx.regOutcome; // 'ok' | 'available' | 'unavailable' | 'unknown'
  const status = deriveDomainStatus(regOutcome, registration, ctx.dns, ctx.dnsRootActive);
  const ageCalc = calculate(registration && registration.dates ? registration.dates : null);
  const timeline = buildTimeline(registration && registration.dates ? registration.dates : null, U.nowIso());

  const statusGroups = groupStatuses(registration && registration.statuses ? registration.statuses : []);

  // CDN + hosting
  const cdnResult = detectCdn({
    headers: ctx.httpHeaders || {},
    cnameTargets: ctx.cnameTargets || [],
    ipInfos: ctx.ipInfos || [],
    tlsIssuer: ctx.ssl && ctx.ssl.issuer ? ctx.ssl.issuer : '',
    nameservers: ctx.nsHosts || []
  });
  const hosting = detectHosting({
    ipInfos: ctx.ipInfos || [],
    apexIps: ctx.apexIps || [],
    ptrs: ctx.ptrs || {},
    cdn: cdnResult,
    serverHeader: ctx.httpHeaders && ctx.httpHeaders['server'] ? ctx.httpHeaders['server'] : null
  });

  // Technology
  const technology = detectTechnology({
    headers: ctx.httpHeaders || {},
    html: ctx.httpBody || '',
    cookies: ctx.cookies || '',
    pathChecks: ctx.pathChecks || {}
  });

  // Subdomains
  const subdomains = collectObservations({
    domain,
    rootDomain: root,
    sanDomains: ctx.ssl && ctx.ssl.sanDomains ? ctx.ssl.sanDomains : [],
    nameservers: ctx.nsHosts || [],
    mxHosts: ctx.mxHosts || [],
    cnameTargets: ctx.cnameTargets || [],
    spfHosts: ctx.spfHosts || [],
    htmlLinks: ctx.htmlLinks || [],
    dkimSelectors: ctx.dkimSelectors || []
  });

  // DNS health (with email/dnssec cross-refs)
  const dnsHealth = healthChecks(ctx.dns ? ctx.dns.records : {}, {
    domain,
    spf: ctx.email ? ctx.email.spf : null,
    dmarc: ctx.email ? ctx.email.dmarc : null,
    dkim: ctx.email ? ctx.email.dkim : null,
    dnssec: ctx.dnssec || null
  });

  // Sources ledger
  const sources = [];
  const addSource = (name, what) => sources.push({ name, what });
  if (ctx.regOutcome === 'ok') addSource('RDAP / WHOIS registry data', 'Registration dates, statuses, nameservers, registrar');
  else if (ctx.regOutcome !== 'unknown') addSource('RDAP / WHOIS registry data', 'Availability answer only (record unavailable)');
  addSource('DNS (public resolvers)', 'A, AAAA, CNAME, MX, NS, TXT, CAA, SOA, DS, DNSKEY, PTR records');
  if (ctx.cymruUsed) addSource('BGP/ASN data (public DNS service)', 'AS numbers, announced prefixes, country-level network data');
  if (ctx.rdapIpUsed) addSource('IP RDAP', 'IP network objects (production only)');
  if (ctx.http) {
    if (ctx.http.status === 'ok') addSource('HTTP/HTTPS', 'Status codes, redirects, headers, HTML fingerprints');
    else if (ctx.http.source === 'browser-relay') addSource('HTTP (via visitor’s browser)', 'CORS-exposed headers and HTML');
  }
  if (ctx.ssl && ctx.ssl.status !== 'unavailable') addSource('TLS handshake', 'Certificate, chain, protocol version');
  addSource('Local fingerprint database', 'CDN/hosting IP ranges, DNS-provider patterns, technology fingerprints');

  // Unverified ledger — everything we could NOT establish
  const unverified = [];
  const pushUnverified = (subject, reason) => unverified.push({ subject, reason });
  if (regOutcome !== 'ok') pushUnverified('Registration record', ctx.regNote || 'Registration data unavailable (see registration section).');
  if (!registration || !registration.dates || !registration.dates.registration) pushUnverified('Registration date', 'No official registration date is publicly available.');
  if (!registration || !registration.dates || !registration.dates.expiration) pushUnverified('Expiration date', 'No expiration date is publicly available.');
  if (hosting.originHosting === 'not-determinable') pushUnverified('Origin hosting provider', 'The origin is hidden behind a CDN/reverse proxy or is not attributable.');
  if (!ctx.ssl || ctx.ssl.status === 'unavailable') pushUnverified('SSL certificate', 'TLS inspection was not possible in this environment.');
  if (!ctx.http || ctx.http.status !== 'ok') pushUnverified('HTTP status', 'Direct HTTP check was not possible in this environment.');
  for (const ip of ctx.ipInfos || []) {
    if (!ip.asn) pushUnverified('ASN for ' + ip.ip, 'No ASN data for this IP.');
  }
  if (registration && registration.privacy && registration.privacy.redacted) {
    pushUnverified('Registrant (owner) details', 'Privacy-protected — respected, not bypassed.');
  }

  // Conflicts across all analyzers
  const conflicts = [];
  for (const ip of ctx.ipInfos || []) {
    for (const c of ip.conflicts || []) conflicts.push(c);
  }

  const report = {
    engine: 'huvanti-domain-information-checker',
    engineVersion: 1,
    generatedAt: U.nowIso(),
    scanMs: ctx.scanMs || null,
    transport: {
      serverDirect: ctx.transportServerDirect || false,
      browserRelay: ctx.transportBrowserRelay || false,
      note: ctx.transportNote || null
    },
    domain: {
      ascii: domain,
      unicode: ctx.parsed.unicodeHostname,
      isIdn: ctx.parsed.isIdn,
      registrable: root,
      subdomain: ctx.parsed.subdomain,
      tld: ctx.parsed.tld,
      tldKnown: ctx.parsed.tldKnown,
      structure: Object.assign({}, ctx.parsed.structure, { protocolAssumed: !ctx.parsed.scheme }),
      idn: ctx.parsed.idn
    },
    availability: {
      status: regOutcome === 'available' ? 'available' : regOutcome === 'ok' ? 'registered' : 'unknown',
      display: regOutcome === 'available' ? 'Available' : regOutcome === 'ok' ? 'Registered' : 'Unable to Verify',
      source: regOutcome === 'available' ? (ctx.regSource || 'registry') : null,
      note: ctx.regNote || null
    },
    domainStatus: status,
    tld: tldInfo,
    registration: registration
      ? {
          source: registration.source,
          registrar: registration.registrar || null,
          dates: {
            registered: registration.dates && registration.dates.registration ? registration.dates.registration : null,
            updated: registration.dates && registration.dates.updated ? registration.dates.updated : null,
            expires: registration.dates && registration.dates.expiration ? registration.dates.expiration : null,
            databaseUpdated: registration.dates && registration.dates.databaseUpdated ? registration.dates.databaseUpdated : null
          },
          statuses: registration.statuses || [],
          statusGroups,
          nameservers: registration.nameservers || [],
          dnssec: registration.dnssec != null ? registration.dnssec : null,
          handle: registration.handle || null,
          privacy: registration.privacy || null,
          whoisServer: registration.whoisServer || null,
          rdapServer: registration.rdapServer || null,
          note: registration.note || null,
          raw: registration.raw || null
        }
      : null,
    age: ageCalc,
    timeline,
    dns: {
      records: ctx.dns ? ctx.dns.records : {},
      rrsig: ctx.dns ? (ctx.dns.records.A_rrsig || ctx.dns.records.AAAA_rrsig || null) : null,
      errors: ctx.dns ? ctx.dns.errors : {},
      cnameChain: ctx.dns ? (ctx.dns.cnameChain || []) : [],
      cnameResolved: ctx.dns ? (ctx.dns.cnameResolved || {}) : {},
      health: dnsHealth,
      provider: cdnResult.dnsProvider,
      providerConfident: cdnResult.dnsProviderConfident,
      providerSignals: cdnResult.dnsProviderSignals,
      resolvers: ctx.dnsResolvers || []
    },
    nameservers: ctx.nameservers || [],
    ip: {
      apex: (ctx.ipInfos || []).filter(i => (ctx.apexIps || []).includes(i.ip)),
      all: ctx.ipInfos || [],
      ptrs: ctx.ptrs || {},
      hosting,
      note: (ctx.ipInfos || []).length ? null : 'No A/AAAA records were found, so no IP information is available.'
    },
    cdn: cdnResult,
    ssl: ctx.ssl || null,
    http: ctx.http || null,
    email: ctx.email || null,
    dnssec: ctx.dnssec || null,
    technology: { items: technology, note: 'Technology detection is heuristic and based on publicly observable fingerprints. Detections can be wrong, and sites can hide their stack. Absence of a signal is not proof a technology is not used.' },
    subdomains,
    sources,
    conflicts,
    unverified,
    notes: ctx.notes || []
  };

  return report;
}

module.exports = { buildReport, deriveDomainStatus };
