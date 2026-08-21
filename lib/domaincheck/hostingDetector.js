'use strict';

/*
 * Hosting / network provider detection.
 *
 * Combines: A/AAAA apex IPs → ASN/org/provider (asnAnalyzer), reverse DNS,
 * HTTP Server header, TLS issuer (production) and CDN detection.
 *
 * Critical accuracy rule: when a CDN/reverse proxy fronts the domain, the
 * edge IP belongs to the PROXY, not the origin host. In that case:
 *   CDN/Proxy:    <provider>
 *   Origin Host:  Not publicly determinable
 * …unless independent signals identify an origin (e.g. an apex IP outside the
 * CDN network). Cloudflare is never claimed as the origin host just because
 * it proxies traffic.
 */

const U = require('./util');

const SHARED_HOSTING_ASNS = new Set(['46606', '26496', '398101', '19871', '2635', '55293', '13213', '47583', '22612', '8560', '27647']);
const CLOUD_ASNS = new Set(['16509', '14618', '39111', '15169', '396982', '36384', '8075', '8068', '8069', '8070', '8071', '8072', '8073', '8074', '132203', '37963', '45102', '36351']);

function detectHosting(ctx) {
  const conflicts = U.ConflictTracker();
  const ipInfos = (ctx.ipInfos || []).filter(i => i && i.ip);
  const cdn = ctx.cdn || { status: 'not-detected' };
  const apexIps = ctx.apexIps || [];
  const ptrs = ctx.ptrs || {}; // ip -> [ptrs]
  const notes = [];

  const result = {
    provider: null,
    asn: null,
    organization: null,
    ip: null,
    ipv6: null,
    kind: null, // cloud | host | isp | cdn
    confidence: 0,
    source: null,
    signals: [],
    cdn: null,
    originHosting: null,
    notes: []
  };

  // Providers represented by the apex IPs (only non-CDN IPs count as origin candidates)
  const originCandidates = [];
  for (const info of ipInfos) {
    const isCdnIp = info.providerKind === 'cdn';
    const isApex = apexIps.some(ip => ip === info.ip);
    conflicts.note('ASN for ' + info.ip, info.asn || 'unknown', info.sources.join('+') || 'unknown');
    if (isApex && !isCdnIp && info.provider) originCandidates.push(info);
    if (isCdnIp && isApex && info.provider) {
      result.signals.push('Apex IP ' + info.ip + ' is inside the ' + info.provider + ' edge network (AS' + info.asn + ')');
    }
  }

  // CDN relationship (from cdnDetector)
  if (cdn.status === 'detected' && cdn.provider) {
    result.cdn = { provider: cdn.provider, confidence: cdn.confidence, evidence: cdn.evidence || [] };
    result.signals.push('CDN/proxy detected: ' + cdn.provider);
  }

  if (!originCandidates.length) {
    if (cdn.status === 'detected') {
      result.originHosting = 'not-determinable';
      result.notes.push('The domain is served through a CDN/reverse proxy (' + (cdn.provider || 'unknown') + '), so the origin host is not publicly determinable from edge data.');
    } else if (!apexIps.length) {
      result.originHosting = 'no-ip';
      result.notes.push('The domain has no A/AAAA records, so no hosting provider can be identified.');
    } else {
      result.originHosting = 'not-determinable';
      result.notes.push('The apex IPs could not be attributed to a known network, so the hosting provider is not publicly determinable.');
    }
    return result;
  }

  // Agree/disagree across candidates
  const byProvider = new Map();
  for (const c of originCandidates) {
    const key = c.provider;
    if (!byProvider.has(key)) byProvider.set(key, []);
    byProvider.get(key).push(c);
  }
  const entries = Array.from(byProvider.entries()).sort((a, b) => b[1].length - a[1].length);
  const [topProvider, topIps] = entries[0];
  const allAgree = entries.length === 1;
  if (!allAgree) {
    result.notes.push('Apex IPs resolve to multiple networks (' + entries.map(e => e[0]).join(', ') + '). This can be normal (multi-provider or multi-CDN setups); each IP is shown individually.');
  }

  const first = topIps[0];
  result.provider = topProvider;
  result.kind = first.providerKind || null;
  result.asn = first.asn || null;
  result.organization = first.asnOrg || topProvider;
  result.ip = topIps.find(c => c.version === 4) ? topIps.find(c => c.version === 4).ip : topIps[0].ip;
  const v6 = topIps.find(c => c.version === 6);
  result.ipv6 = v6 ? v6.ip : null;
  result.originHosting = 'identified';

  // Reverse DNS signal
  const ptrList = [];
  for (const c of topIps) {
    const ptr = (ptrs[c.ip] || [])[0];
    if (ptr) {
      ptrList.push(ptr);
      conflicts.note('reverse DNS for ' + c.ip, ptr, 'ptr');
    }
  }
  if (ptrList.length) {
    result.signals.push('Reverse DNS: ' + ptrList.slice(0, 3).join(', '));
  }

  // Server header signal (production)
  if (ctx.serverHeader) {
    result.signals.push('HTTP Server header: ' + ctx.serverHeader);
  }

  // Kind inference
  if (!result.kind) {
    if (result.asn && CLOUD_ASNS.has(String(result.asn))) result.kind = 'cloud';
    else if (result.asn && SHARED_HOSTING_ASNS.has(String(result.asn))) result.kind = 'host';
    else if (first.providerKind) result.kind = first.providerKind;
  }
  if (result.kind === 'host') {
    const sharedHints = [];
    if (result.asn && SHARED_HOSTING_ASNS.has(String(result.asn))) sharedHints.push('AS' + result.asn + ' is a known shared-hosting network');
    for (const p of ptrList) {
      if (/shared|host|server|srv|web|www|ip-\d+-\d+-\d+-\d+/i.test(p)) sharedHints.push('reverse DNS pattern: ' + p);
    }
    if (sharedHints.length) {
      result.notes.push('Signals consistent with shared hosting: ' + sharedHints.join('; ') + '. Shared vs. VPS cannot be conclusively distinguished from public data.');
    } else {
      result.notes.push('The hosting network is identifiable, but whether the site runs on shared hosting or a VPS is not publicly determinable.');
    }
  }

  // Confidence
  let conf = 60;
  if (allAgree) conf += 12;
  if (first.sources.includes('cymru-dns')) conf += 10;
  if (first.sources.includes('local-cidr')) conf += 8;
  if (first.sources.includes('rdap')) conf += 6;
  if (ptrList.length) conf += 6;
  if (first.conflicts.length) conf -= 15;
  result.confidence = U.conf(conf);
  result.conflicts = first.conflicts;

  // Source description
  const srcs = [];
  if (first.sources.includes('cymru-dns')) srcs.push('IP → ASN (BGP data)');
  if (first.sources.includes('local-cidr')) srcs.push('IP → local network database');
  if (first.sources.includes('rdap')) srcs.push('IP → RDAP');
  if (ptrList.length) srcs.push('Reverse DNS');
  if (ctx.serverHeader) srcs.push('HTTP Server header');
  result.source = srcs.join(' + ') || 'IP attribution';

  return result;
}

module.exports = { detectHosting, SHARED_HOSTING_ASNS, CLOUD_ASNS };
