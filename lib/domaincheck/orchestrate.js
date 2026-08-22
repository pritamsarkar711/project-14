'use strict';

/*
 * Domain Information Checker — scan orchestration.
 *
 * Pipeline (every progress event fires only after its step really completes):
 *   validate → TLD → RDAP → WHOIS fallback → DNS records → nameservers →
 *   IP/ASN → SSL/TLS → HTTP → email → DNSSEC → technology → subdomains →
 *   age/timeline → report.
 *
 * Budgets: ≤60 DNS queries, ≤10 HTTP requests, 75 s wall clock, per-scan
 * caches. Direct transports fail honestly in environments without egress
 * (e.g. this preview sandbox) — the report labels those sections
 * "unavailable" instead of inventing data.
 */

const U = require('./util');
const { parseInput } = require('./domainParser');
const { analyzeTld } = require('./tldAnalyzer');
const { createDnsClient } = require('./dnsClient');
const { createRdapClient } = require('./rdapClient');
const { createWhoisClient } = require('./whoisFallback');
const { createAsnAnalyzer } = require('./asnAnalyzer');
const { collectRecords } = require('./dnsAnalyzer');
const { analyzeSsl } = require('./sslAnalyzer');
const { analyzeHttp } = require('./httpAnalyzer');
const { analyzeEmail } = require('./emailAnalyzer');
const { analyzeDnssec } = require('./dnssecAnalyzer');
const { buildReport } = require('./reportEngine');

const WALL_CLOCK_MS = 75000;
const DNS_QUERY_LIMIT = 80;
const NS_LIMIT = 4;
const IP_ANALYSIS_LIMIT = 4;
const MX_LIMIT = 4;
const LOOKUP_CONCURRENCY = 3;

async function mapLimit(items, limit, fn) {
  const values = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      values[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return values;
}

function normalizeRegistrationFromRdap(record) {
  const registrar = record.registrar || null;
  return {
    source: 'rdap',
    handle: record.handle,
    registrar,
    dates: {
      registration: record.events && record.events.registration ? record.events.registration : null,
      expiration: record.events && record.events.expiration ? record.events.expiration : null,
      updated: record.events && record.events.updated ? record.events.updated : null,
      databaseUpdated: record.events && record.events.databaseUpdated ? record.events.databaseUpdated : null
    },
    statuses: record.status || [],
    nameservers: (record.nameservers || []).map(n => n.host).filter(Boolean),
    dnssec: record.secureDNS && record.secureDNS.delegationSigned != null ? (record.secureDNS.delegationSigned ? 'signed' : 'unsigned') : null,
    privacy: record.privacy || null,
    rdapServer: record.rdapServer || null,
    whoisServer: record.whoisServer || null,
    note: null
  };
}

function normalizeRegistrationFromWhois(record) {
  return {
    source: 'whois',
    handle: null,
    registrar: record.registrar || null,
    dates: {
      registration: record.dates && record.dates.registration ? record.dates.registration : null,
      expiration: record.dates && record.dates.expiration ? record.dates.expiration : null,
      updated: record.dates && record.dates.updated ? record.dates.updated : null,
      databaseUpdated: null
    },
    statuses: record.statuses || [],
    nameservers: record.nameservers || [],
    dnssec: record.dnssec && /signed/i.test(record.dnssec) ? 'signed' : (record.dnssec && /unsigned/i.test(record.dnssec) ? 'unsigned' : null),
    privacy: record.privacy || null,
    rdapServer: null,
    whoisServer: record.whoisServer || null,
    note: 'RDAP was unavailable for this TLD; this record comes from the registry WHOIS server.'
  };
}

function htmlLinks(html, rootDomain, cap) {
  const out = [];
  if (!html) return out;
  const re = /href\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  let m;
  while ((m = re.exec(html)) && out.length < cap) {
    const href = (m[1] || m[2] || '').trim();
    if (!/^https?:/i.test(href)) continue;
    try {
      const u = new URL(href);
      const host = u.hostname.toLowerCase().replace(/\.$/, '');
      if (host === rootDomain || host.endsWith('.' + rootDomain)) out.push(host);
    } catch (e) { /* skip */ }
  }
  return Array.from(new Set(out)).slice(0, cap);
}

async function runScan(rawInput, opt) {
  opt = opt || {};
  const started = Date.now();
  const onProgress = opt.onProgress || function () {};
  const signal = opt.signal || null;
  const progress = opt.progress || (() => {
    const done = new Set();
    return {
      update(stage, message, key) {
        if (key) done.add(key);
        onProgress({ stage, message, completed: Array.from(done) });
      }
    };
  })();
  const guard = () => {
    if (signal && signal.aborted) throw U.makeError('cancelled', 'Scan cancelled.');
    if (Date.now() - started > WALL_CLOCK_MS) throw U.makeError('timeout', 'Scan exceeded the time limit.');
  };
  const notes = [];

  /* ---------- 1. validate ---------- */
  progress.update('validate', 'Validating and normalizing the domain…');
  let parsed;
  try {
    parsed = parseInput(rawInput);
  } catch (e) {
    throw U.makeError(e.code || 'invalid_input', e.message);
  }
  guard();
  const domain = parsed.hostname;
  const rootDomain = parsed.registrable;
  progress.update('validate', 'Domain validated: ' + domain + ' (registrable domain: ' + rootDomain + ')', 'domain_validated');

  /* ---------- 2. TLD ---------- */
  const tldInfo = analyzeTld(parsed.tldLastLabel, parsed.tld);
  progress.update('tld', 'TLD identified: .' + parsed.tldLastLabel + (tldInfo.known ? ' (' + tldInfo.type + ')' : ' (not in local database)'), 'tld_detected');

  /* ---------- transport wiring ---------- */
  const scanCache = opt.cache || new Map();
  const dns = createDnsClient({ cache: opt.dnsCache || scanCache, exchange: opt.dnsExchange || null, resolvers: opt.resolvers || null });
  let dnsReservations = 0;
  const dnsQuery = async (name, type, qopts) => {
    // Reserve a bounded slot before awaiting network I/O. Without this guard,
    // parallel optional lookups can overrun the per scan DNS budget together.
    if (dns.state.queries + dnsReservations >= DNS_QUERY_LIMIT) throw U.makeError('dns_budget', 'DNS query budget reached.');
    dnsReservations++;
    try { return await dns.query(name, type, qopts); }
    finally { dnsReservations--; }
  };
  const rdap = createRdapClient({ fetcher: opt.rdapFetcher || null });
  const whois = createWhoisClient({ transport: opt.whoisTransport || null });
  const asn = createAsnAnalyzer({ dns: { query: dnsQuery }, rdap, cache: scanCache });

  // Registration data and DNS records do not depend on each other. Starting
  // them together removes a full round trip from the usual scan path.
  progress.update('dns', 'Retrieving DNS records (A, AAAA, CNAME, MX, NS, TXT, CAA, SOA, DS, DNSKEY)…');
  const dnsDataPromise = collectRecords({ query: dnsQuery, TYPES: dns.TYPES }, domain, {});

  /* ---------- 3. RDAP (→ WHOIS fallback) ---------- */
  progress.update('rdap', 'Querying the registry’s RDAP service for ' + domain + '…');
  let regOutcome = 'unknown';
  let regSource = null;
  let regNote = null;
  let registration = null;
  let rdapUsed = false;
  let whoisUsed = false;

  const rdapResult = await rdap.lookupDomain(domain, tldInfo);
  guard();
  rdapUsed = true;
  if (rdapResult.outcome === 'ok') {
    regOutcome = 'ok';
    regSource = 'rdap';
    registration = normalizeRegistrationFromRdap(rdapResult.record);
    if (rdapResult.record.secureDNS && rdapResult.record.secureDNS.delegationSigned != null) {
      registration.dnssec = rdapResult.record.secureDNS.delegationSigned ? 'signed' : 'unsigned';
    }
    progress.update('rdap', 'RDAP record retrieved from the registry.', 'rdap_completed');
  } else if (rdapResult.outcome === 'available') {
    regOutcome = 'available';
    regSource = 'rdap';
    regNote = rdapResult.note;
    progress.update('rdap', 'RDAP answered 404 — the domain does not appear to be registered.', 'rdap_completed');
  } else {
    progress.update('whois', 'RDAP unavailable (' + (rdapResult.reason || 'unknown') + ') — trying the registry WHOIS server…');
    const whoisResult = await whois.lookup(domain, tldInfo);
    guard();
    whoisUsed = true;
    if (whoisResult.outcome === 'ok') {
      regOutcome = 'ok';
      regSource = 'whois';
      registration = normalizeRegistrationFromWhois(whoisResult.record);
      progress.update('whois', 'WHOIS record retrieved (RDAP was unavailable for this TLD).', 'rdap_completed');
    } else if (whoisResult.outcome === 'available') {
      regOutcome = 'available';
      regSource = 'whois';
      regNote = whoisResult.note;
      progress.update('whois', 'WHOIS reported no match for this domain.', 'rdap_completed');
    } else {
      regNote = rdapResult.note + ' ' + whoisResult.note;
      progress.update('whois', 'Neither RDAP nor WHOIS could retrieve registration data.', 'rdap_completed');
      notes.push('Registration data unavailable: ' + regNote);
    }
  }

  /* ---------- 4. DNS records ---------- */
  const dnsData = await dnsDataPromise;
  guard();
  progress.update('dns', 'DNS records retrieved (' + dns.state.queries + ' queries so far).', 'dns_retrieved');

  const nsHosts = (dnsData.records.NS || []).map(r => r.value).filter(Boolean);
  const apexIps = (dnsData.records.A || []).map(r => r.value).concat((dnsData.records.AAAA || []).map(r => r.value));
  const cnameTargets = (dnsData.cnameChain || []).map(l => l.to).filter(Boolean);

  /* If the input is a subdomain, its own node usually has no NS/SOA —
   * check the registered parent zone so "Registered (DNS active)" still
   * applies when registration data is unavailable. */
  let dnsRootActive = false;
  if (domain !== rootDomain) {
    try {
      const [nsR, soaR] = await Promise.all([
        dnsQuery(rootDomain, 'NS').catch(() => null),
        dnsQuery(rootDomain, 'SOA').catch(() => null)
      ]);
      dnsRootActive = !!(nsR && nsR.rcode === 0 && (nsR.answers || []).some(a => a.type === 2)) ||
        !!(soaR && soaR.rcode === 0 && (soaR.answers || []).some(a => a.type === 6));
    } catch (e) { dnsRootActive = false; }
    guard();
  }

  /* ---------- 5 to 10. Independent network checks ---------- */
  progress.update('nameservers', 'Analyzing ' + nsHosts.length + ' nameserver(s)…');
  const nameserverPromise = mapLimit(nsHosts.slice(0, NS_LIMIT), LOOKUP_CONCURRENCY, async host => {
    try {
      const [a4, a6] = await Promise.all([
        dnsQuery(host, 'A').catch(() => null),
        dnsQuery(host, 'AAAA').catch(() => null)
      ]);
      const ips = [
        ...(a4 && a4.rcode === 0 ? (a4.answers || []).filter(x => x.type === 1).map(x => x.value) : []),
        ...(a6 && a6.rcode === 0 ? (a6.answers || []).filter(x => x.type === 28).map(x => x.value) : [])
      ];
      const ipInfo = await Promise.all(ips.slice(0, 2).map(ip => asn.analyzeIp(ip, { allowRdap: false })));
      guard();
      return { host, ips, ipInfo };
    } catch (e) {
      return { host, ips: [], ipInfo: [] };
    }
  });

  progress.update('ip', 'Resolving IP addresses and network (ASN) information…');
  const ptrs = {};
  const ipCandidates = apexIps.slice(0, IP_ANALYSIS_LIMIT);
  const ipPromise = mapLimit(ipCandidates, LOOKUP_CONCURRENCY, async ip => {
    try {
      // BGP and DNS attribution only. Each address is handled independently,
      // so a slow or unavailable address cannot hold up the remaining report.
      const info = await asn.analyzeIp(ip, { allowRdap: false });
      let ptrName = null;
      if (info.version === 4) {
        ptrName = ip.split('.').reverse().join('.') + '.in-addr.arpa';
      } else {
        try {
          const full = ip.toLowerCase().split('::');
          const head = full[0] ? full[0].split(':').filter(Boolean) : [];
          const tail = full[1] ? full[1].split(':').filter(Boolean) : [];
          const groups = head.concat(Array(Math.max(0, 8 - head.length - tail.length)).fill('0')).concat(tail);
          const addr = groups.map(group => String(group).padStart(4, '0')).join('').slice(0, 32);
          ptrName = addr.split('').reverse().join('.') + '.ip6.arpa';
        } catch (e) { ptrName = null; }
      }
      if (ptrName) {
        try {
          const ptrRes = await dnsQuery(ptrName, 'PTR');
          if (ptrRes.rcode === 0) ptrs[ip] = (ptrRes.answers || []).filter(answer => answer.type === 12).map(answer => answer.value);
        } catch (e) { /* PTR is optional evidence. */ }
      }
      guard();
      return info;
    } catch (e) {
      return { ip, version: ip.includes(':') ? 6 : 4, asn: null, provider: null, providerKind: null, sources: [], conflicts: [], confidence: 0, error: e.message };
    }
  });

  progress.update('ssl', 'Inspecting the SSL/TLS certificate…');
  const sslPromise = analyzeSsl(domain, { transport: opt.tlsTransport || null, signal });
  progress.update('http', 'Checking HTTP/HTTPS reachability and redirects…');
  const httpPromise = analyzeHttp(domain, { signal, includeBody: true, request: opt.httpRequest || null });
  progress.update('email', 'Analyzing mail infrastructure (MX, SPF, DMARC, DKIM)…');
  const emailPromise = analyzeEmail({ query: dnsQuery, TYPES: dns.TYPES }, domain, { maxMxHosts: MX_LIMIT });
  progress.update('dnssec', 'Checking DNSSEC (DS / DNSKEY)…');
  const dnssecPromise = analyzeDnssec({ query: dnsQuery, TYPES: dns.TYPES }, domain);

  const [nsDetail, ipInfos, ssl, http, email, dnssec] = await Promise.all([
    nameserverPromise, ipPromise, sslPromise, httpPromise, emailPromise, dnssecPromise
  ]);
  guard();
  progress.update('nameservers', 'Nameserver analysis completed.', 'ns_analyzed');
  progress.update('ip', 'IP information retrieved for ' + ipInfos.length + ' address(es).', 'ip_retrieved');
  if (ssl && ssl.status === 'unavailable') {
    progress.update('ssl', 'SSL/TLS inspection not possible in this environment (' + (ssl.reason || 'unavailable') + ').', 'ssl_analyzed');
  } else {
    progress.update('ssl', ssl && ssl.status === 'valid' ? 'SSL certificate is valid.' : 'SSL analysis completed.', 'ssl_analyzed');
  }
  if (http && http.status === 'unavailable') {
    progress.update('http', 'Direct HTTP check not possible in this environment (' + (http.reason || 'unavailable') + ').', 'http_analyzed');
  } else {
    progress.update('http', http && http.https && http.https.status ? 'HTTP check completed (status ' + http.https.status + ').' : 'HTTP check completed.', 'http_analyzed');
  }
  progress.update('email', 'Email records analyzed.', 'email_analyzed');
  if (registration && dnssec.status === 'enabled' && registration.dnssec !== 'signed') registration.dnssec = 'signed';
  progress.update('dnssec', 'DNSSEC check completed: ' + (dnssec.status === 'enabled' ? 'enabled' : dnssec.status), 'dnssec_analyzed');

  const httpHeaders = http && http.https && http.https.headers ? http.https.headers : {};
  const httpBody = http && http.https && http.https.body ? http.https.body : '';

  /* ---------- 11. technology (needs HTTP body) ---------- */
  progress.update('technology', 'Detecting website technology from public fingerprints…');
  const pathChecks = {};
  if (http && http.status === 'ok' && http.https && http.https.bodyAvailable && http.https.body) {
    // One bounded probe for WordPress REST discovery (only when body hints at it)
    if (/wp-|wordpress/i.test(String(http.https.body).slice(0, 5000))) {
      try {
        const { requestOnce } = require('./httpAnalyzer');
        const { assertPublicUrl, resolveAndPin } = require('../wptheme/ssrf');
        const u = assertPublicUrl('https://' + domain + '/wp-json/');
        const pin = await resolveAndPin(u);
        const res = await requestOnce(u, pin, { timeout: 6000, signal });
        pathChecks['/wp-json/'] = res.status;
      } catch (e) { /* optional probe */ }
    }
  }
  guard();
  const htmlLinksList = htmlLinks(httpBody, rootDomain, 40);
  const mxHosts = (email && email.mx || []).map(m => m.host);
  const spfHosts = [];
  if (email && email.spf) {
    for (const mech of email.spf.mechanisms || []) {
      if (['include', 'a', 'mx'].includes(mech.mechanism) && mech.value) spfHosts.push(mech.value);
    }
    if (email.spf.redirect) spfHosts.push(email.spf.redirect);
  }
  const dkimSelectors = (email && email.dkim && email.dkim.found || []).map(d => d.selector);
  progress.update('technology', 'Technology detection completed.', 'technology_completed');

  /* ---------- 12. age ---------- */
  progress.update('age', 'Calculating domain age from the official registration date…');
  const ageCalc = require('./domainAgeCalculator').calculate(registration && registration.dates ? registration.dates : null);
  progress.update('age', ageCalc.available ? 'Domain age calculated.' : 'Registration date unavailable — domain age cannot be reliably determined.', 'age_calculated');

  /* ---------- 13. assemble ---------- */
  progress.update('report', 'Building the domain report…');
  guard();
  const report = buildReport({
    parsed,
    tldInfo,
    regOutcome,
    regSource,
    regNote,
    registration,
    dns: dnsData,
    dnsRootActive,
    dnsResolvers: dns.resolvers,
    nsHosts,
    nameservers: nsDetail,
    apexIps,
    ipInfos,
    ptrs,
    cdnTargets: cnameTargets,
    cnameTargets,
    ssl,
    http,
    httpHeaders,
    httpBody,
    cookies: httpHeaders['set-cookie'] || '',
    email,
    dnssec,
    mxHosts,
    spfHosts,
    dkimSelectors,
    htmlLinks: htmlLinksList,
    pathChecks,
    scanMs: Date.now() - started,
    transportServerDirect: !!(http && http.source === 'http' && http.status !== 'unavailable'),
    transportBrowserRelay: !!(http && http.source === 'browser-relay'),
    transportNote: (http && http.status === 'unavailable')
      ? 'This server could not reach the internet directly for HTTPS/HTTP checks (RDAP, WHOIS, TLS, HTTP). DNS-based sections were completed normally.'
      : null,
    cymruUsed: ipInfos.some(i => i.sources.includes('cymru-dns')),
    rdapIpUsed: ipInfos.some(i => i.sources.includes('rdap')),
    notes
  });
  return report;
}

module.exports = { runScan, normalizeRegistrationFromRdap, normalizeRegistrationFromWhois, htmlLinks };
