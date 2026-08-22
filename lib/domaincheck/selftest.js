'use strict';

/*
 * huvanti Domain Information Checker, offline self-test.
 * Run: node lib/domaincheck/selftest.js
 *
 * The full production pipeline (parse → TLD → RDAP/WHOIS → DNS → ASN →
 * hosting/CDN → SSL → HTTP → email → DNSSEC → age → report) runs against
 * injected fixture transports, so no network access is needed. DNS is stubbed
 * to a public IP so the SSRF/pinning path still executes.
 *
 * Covers the required scenario matrix (active/new/old/expired domains,
 * ccTLDs, privacy-protected registrants, Cloudflare/AWS/shared/VPS hosting,
 * IPv6, DNSSEC, SPF/DMARC, IDN, redirects, broken domains, multi-NS, and
 * unavailable RDAP) plus unit tests for every analyzer module.
 */

const assert = require('assert');
const dns = require('dns');

// SSRF path must still execute: stub system resolution to a public IP.
dns.promises.lookup = async (host, o) => {
  const rec = { address: '93.184.216.34', family: 4 };
  return o && o.all ? [rec] : rec;
};

const U = require('./util');
const { runScan } = require('./orchestrate');
const { parseInput } = require('./domainParser');
const { createFetcher } = require('../wptheme/fetcher');
const F = require('./fixtures');
const { makeDnsFixture, makeRdapFixture, rdapRecord, whoisText, tlsInfo, httpResponse } = F;
const { analyzeTld } = require('./tldAnalyzer');
const { interpret } = require('./statusInterpreter');
const { calculate, expiryWarning } = require('./domainAgeCalculator');
const { parseSpf, parseDmarc } = require('./emailAnalyzer');
const { detectCdn } = require('./cdnDetector');
const { detectHosting } = require('./hostingDetector');
const { detectTechnology } = require('./technologyDetector');
const { collectObservations } = require('./subdomainAnalyzer');
const { analyzeRedirectChain } = require('./redirectAnalyzer');
const { analyzeBrowserBundle } = require('./httpAnalyzer');
const { analyzeSsl } = require('./sslAnalyzer');
const { createWhoisClient, parseWhois } = require('./whoisFallback');
const { createRdapClient } = require('./rdapClient');

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

/* ---------------- helpers ---------------- */

function makeError(code, msg) { const e = new Error(msg); e.code = code; return e; }

function expectedAge(iso, now) {
  const f = new Date(iso); const t = now || new Date();
  let y = t.getUTCFullYear() - f.getUTCFullYear();
  let m = t.getUTCMonth() - f.getUTCMonth();
  let d = t.getUTCDate() - f.getUTCDate();
  if (d < 0) { m -= 1; d += new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0)).getUTCDate(); }
  if (m < 0) { y -= 1; m += 12; }
  return { y, m, d };
}

function scanFor(cfg) {
  return runScan(cfg.domain, {
    dnsExchange: cfg.dns ? cfg.dns.exchange : undefined,
    rdapFetcher: createFetcher({ transport: makeRdapFixture(cfg.rdap || {}), maxRequests: 6, maxTotalBytes: 1 << 20 }),
    whoisTransport: cfg.whois || null,
    tlsTransport: cfg.tls || null,
    httpRequest: cfg.http || null,
    cache: new Map()
  });
}

function dnsBase(zone) {
  return makeDnsFixture({
    zoneRoot: zone,
    cymru: {
      '93.184.216.34': '15133 | 93.184.216.0/24 | US | arin | 2011-06-09'
    },
    asnNames: {
      '15133': '15133 | US | arin | 2011-06-09 | EDGECAST, US',
      '13335': '13335 | US | arin | 2010-07-14 | CLOUDFLARENET - Cloudflare, Inc., US',
      '16509': '16509 | US | arin | 2000-04-12 | AMAZON-02, US',
      '46606': '46606 | US | arin | 2009-01-01 | UNIFIEDLAYER-AS-1, US',
      '14061': '14061 | US | arin | 2012-09-25 | DIGITALOCEAN-ASN, US',
      '15169': '15169 | US | arin | 2000-03-30 | GOOGLE, US'
    }
  });
}

function defaultRdap(domain, opt) {
  const routes = {};
  routes[domain] = { record: () => rdapRecord(Object.assign({ domain }, opt)) };
  return routes;
}

/* ================================================================== */
/* Scenario matrix (prompt testing requirements 1–25)                  */
/* ================================================================== */

test('1, active .com domain: full registration report', async () => {
  const d = dnsBase('example.com');
  d.add('example.com', 'A', [{ value: '93.184.216.34' }]);
  d.add('example.com', 'NS', [{ value: 'ns1.example.com' }, { value: 'ns2.example.com' }]);
  d.add('example.com', 'SOA', [{ mname: 'ns1.example.com', rname: 'hostmaster.example.com', serial: 2026010101 }]);
  d.add('example.com', 'MX', [{ value: 'mx1.example.com', priority: 10 }]);
  d.add('example.com', 'TXT', [{ value: 'v=spf1 include:_spf.example.com -all' }]);
  d.add('example.com', 'CAA', [{ tag: 'issue', value: 'letsencrypt.org' }]);
  d.add('mx1.example.com', 'A', [{ value: '93.184.216.35' }]);
  const report = await scanFor({
    domain: 'example.com', dns: d,
    rdap: defaultRdap('example.com', { registered: '2020-03-15T10:00:00Z' }),
    tls: () => tlsInfo({ host: 'example.com' })
  });
  assert.strictEqual(report.availability.status, 'registered');
  assert.strictEqual(report.availability.display, 'Registered');
  assert.strictEqual(report.domainStatus.status, 'Active');
  assert.strictEqual(report.domain.registrable, 'example.com');
  assert.strictEqual(report.tld.registry, 'Verisign, Inc.');
  assert.strictEqual(report.tld.type, 'gTLD');
  assert.strictEqual(report.registration.source, 'rdap');
  assert.strictEqual(report.registration.registrar.name, 'Example Registrar, Inc.');
  assert.strictEqual(report.registration.registrar.ianaId, '1234');
  assert.ok(report.registration.statuses.includes('clientTransferProhibited'));
  assert.ok(report.registration.statusGroups.normal.some(s => s.code === 'clientTransferProhibited'));
  assert.ok(report.age.available);
  const exp = expectedAge('2020-03-15T10:00:00Z');
  assert.strictEqual(report.age.years, exp.y);
  assert.strictEqual(report.age.months, exp.m);
  assert.strictEqual(report.age.days, exp.d);
  assert.ok(/year/i.test(report.age.ageTextValue));
  assert.ok(report.timeline.map(t => t.event).includes('registered'));
  assert.ok(report.timeline.map(t => t.event).includes('now'));
  assert.ok(report.timeline.map(t => t.event).includes('expires'));
  // timeline chronological
  const events = report.timeline;
  for (let i = 1; i < events.length; i++) assert.ok(new Date(events[i].date) >= new Date(events[i - 1].date));
  assert.strictEqual(report.ssl.status, 'valid');
  assert.ok(report.sources.length >= 4);
  assert.ok(Array.isArray(report.unverified));
});

test('2, .org domain: registry + TLD identification', async () => {
  const d = dnsBase('nice.org');
  d.add('nice.org', 'A', [{ value: '93.184.216.34' }]);
  d.add('nice.org', 'NS', [{ value: 'ns1.nice.org' }]);
  const report = await scanFor({
    domain: 'nice.org', dns: d,
    rdap: defaultRdap('nice.org', {})
  });
  assert.strictEqual(report.tld.registry, 'Public Interest Registry (PIR)');
  assert.strictEqual(report.tld.type, 'gTLD');
  assert.strictEqual(report.domain.tld, 'org');
  assert.strictEqual(report.domainStatus.status, 'Active');
});

test('3, .net domain: registration works', async () => {
  const d = dnsBase('mynet.net');
  d.add('mynet.net', 'A', [{ value: '93.184.216.34' }]);
  const report = await scanFor({
    domain: 'mynet.net', dns: d,
    rdap: defaultRdap('mynet.net', { registered: '2018-01-10T00:00:00Z' })
  });
  assert.strictEqual(report.tld.registry, 'Verisign, Inc.');
  assert.strictEqual(report.availability.status, 'registered');
  assert.ok(report.age.available);
});

test('4, country-code domain (.co.uk): WHOIS fallback + multi-level suffix', async () => {
  const d = dnsBase('example.co.uk');
  d.add('example.co.uk', 'A', [{ value: '93.184.216.34' }]);
  d.add('example.co.uk', 'NS', [{ value: 'ns1.example.co.uk' }]);
  const whois = async (server, domain) => {
    assert.strictEqual(server, 'whois.nic.uk');
    return whoisText({ domain, registered: '2015-06-01', expires: '2027-06-01', registrar: 'Nominet UK' });
  };
  const report = await scanFor({
    domain: 'example.co.uk',
    dns: d,
    rdap: { 'example.co.uk': { throw: makeError('tls_blocked', 'reset') } },
    whois
  });
  assert.strictEqual(report.domain.tld, 'co.uk');
  assert.strictEqual(report.domain.registrable, 'example.co.uk');
  assert.strictEqual(report.tld.type, 'ccTLD');
  assert.strictEqual(report.tld.country, 'United Kingdom');
  assert.strictEqual(report.registration.source, 'whois');
  assert.strictEqual(report.registration.registrar.name, 'Nominet UK');
  assert.ok(report.registration.note.includes('RDAP was unavailable'));
  assert.strictEqual(report.age.registeredIso, '2015-06-01T00:00:00.000Z');
});

test('5, new domain (3 days old): age math', async () => {
  const iso = new Date(Date.now() - 3 * 86400000).toISOString();
  const d = dnsBase('newdomain.com');
  d.add('newdomain.com', 'A', [{ value: '93.184.216.34' }]);
  const report = await scanFor({
    domain: 'newdomain.com', dns: d,
    rdap: defaultRdap('newdomain.com', { registered: iso })
  });
  assert.ok(report.age.available);
  assert.strictEqual(report.age.years, 0);
  assert.strictEqual(report.age.months, 0);
  assert.ok(report.age.days >= 2 && report.age.days <= 4);
  assert.ok(report.age.totalDays >= 2 && report.age.totalDays <= 4);
  assert.strictEqual(report.domainStatus.status, 'Active');
});

test('6, very old domain (1995): 30+ years', async () => {
  const d = dnsBase('old-domain.org');
  d.add('old-domain.org', 'A', [{ value: '93.184.216.34' }]);
  const report = await scanFor({
    domain: 'old-domain.org', dns: d,
    rdap: defaultRdap('old-domain.org', { registered: '1995-01-15T00:00:00Z', expires: '2030-01-15T00:00:00Z' })
  });
  assert.ok(report.age.available);
  assert.ok(report.age.years >= 30);
  const exp = expectedAge('1995-01-15T00:00:00Z');
  assert.strictEqual(report.age.years, exp.y);
  assert.strictEqual(report.age.months, exp.m);
  assert.strictEqual(report.age.days, exp.d);
});

test('7, expired domain: status + expiration warning', async () => {
  const d = dnsBase('expired-domain.net');
  d.add('expired-domain.net', 'A', [{ value: '93.184.216.34' }]);
  const report = await scanFor({
    domain: 'expired-domain.net', dns: d,
    rdap: defaultRdap('expired-domain.net', { registered: '2015-01-01T00:00:00Z', expires: '2026-06-01T00:00:00Z' })
  });
  assert.strictEqual(report.domainStatus.status, 'Expired');
  assert.strictEqual(report.age.expiry.bucket, 'expired');
  assert.ok(report.age.expiry.daysUntilExpiry < 0);
  assert.ok(report.domainStatus.note.includes('grace period'));
});

test('8, privacy-protected domain: registrant never surfaced', async () => {
  const d = dnsBase('private-domain.com');
  d.add('private-domain.com', 'A', [{ value: '93.184.216.34' }]);
  const report = await scanFor({
    domain: 'private-domain.com', dns: d,
    rdap: defaultRdap('private-domain.com', { privacy: true })
  });
  assert.ok(report.registration.privacy);
  assert.ok(report.registration.privacy.redacted);
  assert.ok(!report.registration.privacy.namePresent);
  // the owner name must never appear anywhere in the report
  const { reportText } = require('./reportEngine');
  void reportText;
  const json = JSON.stringify(report);
  assert.ok(!json.includes('John Registrant'), 'registrant name leaked into report');
  assert.ok(!json.includes('owner@example.com'), 'registrant email leaked into report');
});

test('9: Cloudflare-proxied domain: CDN ≠ origin hosting', async () => {
  const d = dnsBase('cf-site.com');
  d.add('cf-site.com', 'A', [{ value: '104.16.0.1' }, { value: '172.64.0.1' }]);
  d.add('cf-site.com', 'AAAA', [{ value: '2606:4700::1111' }]);
  d.add('cf-site.com', 'NS', [{ value: 'era.ns.cloudflare.com' }, { value: 'bob.ns.cloudflare.com' }]);
  d.setCymru({
    '104.16.0.1': '13335 | 104.16.0.0/13 | US | arin | 2014-03-28',
    '172.64.0.1': '13335 | 172.64.0.0/13 | US | arin | 2014-03-28'
  });
  const report = await scanFor({
    domain: 'cf-site.com', dns: d,
    rdap: defaultRdap('cf-site.com', {}),
    http: () => httpResponse({ headers: { server: 'cloudflare', 'cf-ray': 'abc123-xyz' } })
  });
  assert.strictEqual(report.cdn.status, 'detected');
  assert.strictEqual(report.cdn.provider, 'Cloudflare');
  assert.ok(report.cdn.confidence >= 70);
  assert.ok(report.cdn.evidence.some(e => e.signal === 'cf-ray-header'));
  assert.ok(report.cdn.evidence.some(e => e.signal === 'ip-range'));
  assert.strictEqual(report.ip.hosting.originHosting, 'not-determinable');
  assert.strictEqual(report.ip.hosting.provider, null, 'CDN must not be claimed as origin host');
  assert.strictEqual(report.ip.hosting.cdn.provider, 'Cloudflare');
  assert.strictEqual(report.dns.provider, 'Cloudflare DNS');
  assert.ok(report.dns.providerConfident);
  // hosting explanation present
  assert.ok(report.ip.hosting.notes.some(n => /CDN\/reverse proxy/i.test(n)));
});

test('10: AWS-hosted domain: origin identified via BGP ASN', async () => {
  const d = dnsBase('aws-site.com');
  d.add('aws-site.com', 'A', [{ value: '3.5.7.9' }]);
  d.add('aws-site.com', 'NS', [{ value: 'ns1.aws-site.com' }]);
  d.setCymru({ '3.5.7.9': '16509 | 3.5.0.0/16 | US | arin | 2017-11-02' });
  const report = await scanFor({
    domain: 'aws-site.com', dns: d,
    rdap: defaultRdap('aws-site.com', {})
  });
  const ip = report.ip.apex[0];
  assert.strictEqual(ip.asn, '16509');
  assert.strictEqual(ip.provider, 'Amazon.com (AWS)');
  assert.strictEqual(ip.providerKind, 'cloud');
  assert.strictEqual(report.ip.hosting.originHosting, 'identified');
  assert.strictEqual(report.ip.hosting.provider, 'Amazon.com (AWS)');
  assert.strictEqual(report.ip.hosting.kind, 'cloud');
  assert.strictEqual(report.cdn.status, 'not-detected');
});

test('11, shared hosting network: Unified Layer (Newfold)', async () => {
  const d = dnsBase('sharedhost-site.com');
  d.add('sharedhost-site.com', 'A', [{ value: '162.241.0.1' }]);
  d.add('1.0.241.162.in-addr.arpa', 'PTR', [{ value: '162-241-0-1.unifiedlayer.com' }]);
  d.setCymru({ '162.241.0.1': '46606 | 162.241.0.0/18 | US | arin | 2011-05-05' });
  const report = await scanFor({
    domain: 'sharedhost-site.com', dns: d,
    rdap: defaultRdap('sharedhost-site.com', {})
  });
  assert.strictEqual(report.ip.hosting.originHosting, 'identified');
  assert.strictEqual(report.ip.hosting.provider, 'Unified Layer (Newfold: Bluehost/HostGator)');
  assert.strictEqual(report.ip.hosting.kind, 'host');
  assert.ok(report.ip.hosting.notes.some(n => /shared hosting/i.test(n)), 'shared-hosting signals must be described');
});

test('12: VPS network: DigitalOcean', async () => {
  const d = dnsBase('vps-site.com');
  d.add('vps-site.com', 'A', [{ value: '143.198.5.5' }]);
  d.add('5.5.198.143.in-addr.arpa', 'PTR', [{ value: 'droplet-05.sfo3.example' }]);
  d.setCymru({ '143.198.5.5': '14061 | 143.198.0.0/16 | US | arin | 2019-06-06' });
  const report = await scanFor({
    domain: 'vps-site.com', dns: d,
    rdap: defaultRdap('vps-site.com', {})
  });
  assert.strictEqual(report.ip.hosting.provider, 'DigitalOcean');
  assert.strictEqual(report.ip.hosting.kind, 'host');
  assert.strictEqual(report.ip.hosting.organization, 'DIGITALOCEAN-ASN, US');
});

test('13: CDN-only detectable domain: CNAME evidence', async () => {
  const d = dnsBase('cdnonly.site');
  d.add('cdnonly.site', 'CNAME', [{ value: 'cdn.cloudflare.net' }]);
  d.add('cdn.cloudflare.net', 'A', [{ value: '104.16.5.5' }]);
  d.setCymru({ '104.16.5.5': '13335 | 104.16.0.0/13 | US | arin | 2014-03-28' });
  const report = await scanFor({
    domain: 'cdnonly.site', dns: d,
    rdap: defaultRdap('cdnonly.site', {})
  });
  assert.strictEqual(report.cdn.status, 'detected');
  assert.strictEqual(report.cdn.provider, 'Cloudflare');
  assert.ok(report.cdn.evidence.some(e => e.signal === 'cname'));
  assert.strictEqual(report.ip.hosting.originHosting, 'not-determinable');
  assert.ok(report.dns.cnameChain.length >= 1);
});

test('14, domain with IPv6: AAAA + IPv6 ASN', async () => {
  const d = dnsBase('v6-site.org');
  d.add('v6-site.org', 'A', [{ value: '142.250.0.1' }]);
  d.add('v6-site.org', 'AAAA', [{ value: '2001:4860:4860::8888' }]);
  d.setCymruLookup(ip => {
    if (ip === '2001:4860:4860::8888' || ip === '2001:486:486:0:0:0:0:8888' || ip === '2001:4860:4860:0:0:0:0:8888') return '15169 | 2001:4860::/32 | US | arin | 2005-03-14';
    if (ip === '142.250.0.1') return '15169 | 142.250.0.0/16 | US | arin | 2012-05-24';
    return null;
  });
  const report = await scanFor({
    domain: 'v6-site.org', dns: d,
    rdap: defaultRdap('v6-site.org', {})
  });
  assert.strictEqual(report.dns.records.AAAA.length, 1);
  assert.strictEqual(report.dns.records.AAAA[0].value, '2001:4860:4860::8888');
  const v6 = report.ip.all.filter(i => i.version === 6);
  assert.ok(v6.length);
  assert.strictEqual(v6[0].asn, '15169');
  assert.ok(report.dns.health.some(c => c.id === 'aaaa-ok' && c.level === 'pass'));
});

test('15, domain without IPv6: informational only, not a problem', async () => {
  const d = dnsBase('nov6.com');
  d.add('nov6.com', 'A', [{ value: '93.184.216.34' }]);
  const report = await scanFor({
    domain: 'nov6.com', dns: d,
    rdap: defaultRdap('nov6.com', {})
  });
  assert.strictEqual(report.dns.records.AAAA.length, 0);
  const aaaa = report.dns.health.find(c => c.id === 'aaaa-missing');
  assert.ok(aaaa, 'AAAA note should exist');
  assert.strictEqual(aaaa.level, 'info', 'missing AAAA must be info, not a warning');
});

test('16, domain with DNSSEC: DS + DNSKEY → enabled', async () => {
  const d = dnsBase('signed-site.org');
  d.add('signed-site.org', 'A', [{ value: '93.184.216.34' }]);
  d.add('signed-site.org', 'DS', [{ keyTag: 2371, algorithm: 13, digestType: 2, digest: 'A'.repeat(64) }]);
  d.add('signed-site.org', 'DNSKEY', [{ flags: 257, algorithm: 13, publicKey: 'KSKKEY' }, { flags: 256, algorithm: 13, publicKey: 'ZSKKEY' }]);
  const report = await scanFor({
    domain: 'signed-site.org', dns: d,
    rdap: defaultRdap('signed-site.org', { dnssecSigned: true })
  });
  assert.strictEqual(report.dnssec.status, 'enabled');
  assert.strictEqual(report.dnssec.dsRecords.length, 1);
  assert.strictEqual(report.dnssec.dsRecords[0].keyTag, 2371);
  assert.strictEqual(report.dnssec.dnskeys.length, 2);
  assert.strictEqual(report.registration.dnssec, 'signed');
  assert.ok(report.dns.health.some(c => c.id === 'dnssec-ok' && c.level === 'pass'));
});

test('17, domain without DNSSEC: not-detected, never a vulnerability claim', async () => {
  const d = dnsBase('unsigned-site.org');
  d.add('unsigned-site.org', 'A', [{ value: '93.184.216.34' }]);
  const report = await scanFor({
    domain: 'unsigned-site.org', dns: d,
    rdap: defaultRdap('unsigned-site.org', { dnssecSigned: false })
  });
  assert.strictEqual(report.dnssec.status, 'not-detected');
  assert.ok(report.dnssec.note.includes('not a vulnerability'));
  assert.strictEqual(report.registration.dnssec, 'unsigned');
});

test('18, domain with SPF: record parsed, policy shown', async () => {
  const d = dnsBase('spf-site.com');
  d.add('spf-site.com', 'A', [{ value: '93.184.216.34' }]);
  d.add('spf-site.com', 'MX', [{ value: 'mx.spf-site.com', priority: 10 }]);
  d.add('spf-site.com', 'TXT', [{ value: 'v=spf1 include:_spf.google.com -all' }]);
  const report = await scanFor({
    domain: 'spf-site.com', dns: d,
    rdap: defaultRdap('spf-site.com', {})
  });
  assert.strictEqual(report.email.security.spf, 'detected');
  assert.strictEqual(report.email.spf.hardFail, true);
  assert.ok(report.email.spf.mechanisms.some(m => m.mechanism === 'include'));
  assert.ok(report.dns.health.some(c => c.id === 'spf-ok' && c.level === 'pass'));
  // honest framing: SPF alone is not "protected"
  assert.ok(report.email.notes.some(n => /SPF alone/i.test(n)));
});

test('19, domain with DMARC: policy extracted', async () => {
  const d = dnsBase('dmarc-site.com');
  d.add('dmarc-site.com', 'A', [{ value: '93.184.216.34' }]);
  d.add('dmarc-site.com', 'TXT', [{ value: 'v=spf1 -all' }]);
  d.add('_dmarc.dmarc-site.com', 'TXT', [{ value: 'v=DMARC1; p=quarantine; pct=50; rua=mailto:dmarc@dmarc-site.com' }]);
  const report = await scanFor({
    domain: 'dmarc-site.com', dns: d,
    rdap: defaultRdap('dmarc-site.com', {})
  });
  assert.strictEqual(report.email.security.dmarc, 'detected');
  assert.strictEqual(report.email.dmarc.policy, 'quarantine');
  assert.strictEqual(report.email.dmarc.pct, '50');
  assert.ok(report.email.dmarc.rua.includes('dmarc@'));
});

test('20, domain without MX: reported honestly', async () => {
  const d = dnsBase('nomx.com');
  d.add('nomx.com', 'A', [{ value: '93.184.216.34' }]);
  const report = await scanFor({
    domain: 'nomx.com', dns: d,
    rdap: defaultRdap('nomx.com', {})
  });
  assert.strictEqual(report.email.mx.length, 0);
  assert.ok(!report.email.nullMx);
  assert.strictEqual(report.email.security.spf, 'not-detected');
  const mxCheck = report.dns.health.find(c => c.id === 'mx-missing');
  assert.ok(mxCheck);
  assert.strictEqual(mxCheck.level, 'info');
});

test('21, internationalized domain (IDN): punycode + Unicode display', async () => {
  const d = dnsBase('xn--bcher-kva.de');
  d.add('xn--bcher-kva.de', 'A', [{ value: '93.184.216.34' }]);
  d.add('xn--bcher-kva.de', 'NS', [{ value: 'ns1.xn--bcher-kva.de' }]);
  const report = await scanFor({
    domain: 'bücher.de', dns: d,
    rdap: defaultRdap('xn--bcher-kva.de', {})
  });
  assert.strictEqual(report.domain.ascii, 'xn--bcher-kva.de');
  assert.strictEqual(report.domain.unicode, 'bücher.de');
  assert.strictEqual(report.domain.isIdn, true);
  assert.strictEqual(report.domain.tld, 'de');
  assert.strictEqual(report.tld.registry, 'DENIC eG');
  assert.strictEqual(report.availability.status, 'registered');
});

test('22, redirecting domain: chain + www normalization + HTTPS upgrade', async () => {
  const d = dnsBase('redirect.site');
  d.add('redirect.site', 'A', [{ value: '93.184.216.34' }]);
  const httpT = async (u) => {
    if (u.hostname === 'www.redirect.site') return httpResponse({ status: 200, headers: { server: 'nginx' } });
    return httpResponse({ status: 301, headers: { location: 'https://www.redirect.site/' } });
  };
  const report = await scanFor({
    domain: 'redirect.site', dns: d,
    rdap: defaultRdap('redirect.site', {}),
    http: httpT
  });
  assert.strictEqual(report.http.status, 'ok');
  assert.strictEqual(report.http.https.status, 200);
  assert.strictEqual(report.http.https.finalUrl, 'https://www.redirect.site/');
  assert.strictEqual(report.http.redirects.count, 1);
  assert.strictEqual(report.http.redirects.chain[0].status, 301);
  assert.ok(report.http.redirects.analysis.wwwNormalized);
  assert.strictEqual(report.http.httpsRedirect, true);
});

test('23, broken/unregistered domain: honest availability + no fabricated data', async () => {
  const d = makeDnsFixture({ zoneRoot: null }); // everything NXDOMAIN
  const report = await scanFor({
    domain: 'never-registered-xyz.com', dns: d,
    rdap: { 'never-registered-xyz.com': { status: 404 } },
    tls: () => { throw makeError('tls_blocked', 'reset'); },
    http: () => { throw makeError('dns', 'The domain could not be resolved.'); }
  });
  assert.strictEqual(report.availability.status, 'available');
  assert.strictEqual(report.availability.display, 'Available');
  assert.strictEqual(report.domainStatus.status, 'Available');
  assert.strictEqual(report.registration, null);
  assert.strictEqual(report.age.available, false);
  assert.ok(report.age.note.includes('cannot be reliably determined'));
  assert.strictEqual(report.dns.records.A.length, 0);
  assert.strictEqual(report.ssl.status, 'unavailable');
  assert.strictEqual(report.http.status, 'unavailable');
  assert.ok(report.unverified.length >= 4);
});

test('24, multiple nameservers: all analyzed with networks', async () => {
  const d = dnsBase('multi-ns.org');
  d.add('multi-ns.org', 'A', [{ value: '93.184.216.34' }]);
  const hosts = ['ns1.multi-ns.org', 'ns2.multi-ns.org', 'ns3.multi-ns.org', 'ns4.multi-ns.org'];
  d.add('multi-ns.org', 'NS', hosts.map(h => ({ value: h })));
  hosts.forEach((h, i) => d.add(h, 'A', [{ value: '104.16.1.' + (i + 1) }]));
  d.setCymru({
    '104.16.1.1': '13335 | 104.16.0.0/13 | US | arin | 2014-03-28',
    '104.16.1.2': '13335 | 104.16.0.0/13 | US | arin | 2014-03-28',
    '104.16.1.3': '13335 | 104.16.0.0/13 | US | arin | 2014-03-28',
    '104.16.1.4': '13335 | 104.16.0.0/13 | US | arin | 2014-03-28'
  });
  const report = await scanFor({
    domain: 'multi-ns.org', dns: d,
    rdap: defaultRdap('multi-ns.org', {})
  });
  assert.strictEqual(report.nameservers.length, 4);
  assert.ok(report.nameservers.every(n => n.ips.length === 1));
  assert.ok(report.nameservers.every(n => n.ipInfo[0].asn === '13335'));
  assert.ok(report.dns.health.some(c => c.id === 'ns-ok' && c.level === 'pass'));
});

test('25: RDAP unavailable + WHOIS unavailable: Unable to Verify, DNS-based status', async () => {
  const d = dnsBase('opaque-registry.com');
  d.add('opaque-registry.com', 'A', [{ value: '93.184.216.34' }]);
  d.add('opaque-registry.com', 'NS', [{ value: 'ns1.opaque-registry.com' }]);
  const report = await scanFor({
    domain: 'opaque-registry.com', dns: d,
    rdap: { 'opaque-registry.com': { throw: makeError('tls_blocked', 'reset') } },
    whois: () => { throw makeError('egress_blocked', 'reset'); }
  });
  assert.strictEqual(report.availability.status, 'unknown');
  assert.strictEqual(report.availability.display, 'Unable to Verify');
  assert.strictEqual(report.registration, null);
  assert.strictEqual(report.domainStatus.key, 'registered-dns');
  assert.strictEqual(report.domainStatus.source, 'dns');
  assert.strictEqual(report.age.available, false);
  assert.ok(report.timeline.every(t => t.event === 'now'));
  assert.ok(report.notes.some(n => /Registration data unavailable/i.test(n)));
});

test('27, subdomain input inherits the parent zone’s DNS-active status', async () => {
  const d = dnsBase('wikipedia.org');
  d.add('wikipedia.org', 'NS', [{ value: 'ns0.wikimedia.org' }, { value: 'ns1.wikimedia.org' }]);
  d.add('wikipedia.org', 'SOA', [{ mname: 'ns0.wikimedia.org' }]);
  d.add('bn.wikipedia.org', 'A', [{ value: '93.184.216.34' }]);
  const report = await scanFor({
    domain: 'bn.wikipedia.org', dns: d,
    rdap: { 'bn.wikipedia.org': { throw: makeError('tls_blocked', 'reset') } },
    whois: () => { throw makeError('egress_blocked', 'reset'); }
  });
  assert.strictEqual(report.domain.registrable, 'wikipedia.org');
  assert.strictEqual(report.domain.subdomain, 'bn');
  assert.strictEqual(report.domainStatus.key, 'registered-dns');
  assert.ok(report.domainStatus.note.includes('parent domain'));
});

test('26, conflicting data: sources shown side by side, confidence reduced', async () => {
  const d = dnsBase('conflict-site.com');
  d.add('conflict-site.com', 'A', [{ value: '104.16.0.1' }]);
  // local CIDR says Cloudflare; BGP data (fixture) says DigitalOcean → conflict
  d.setCymru({ '104.16.0.1': '14061 | 104.16.0.0/13 | US | arin | 2014-03-28' });
  const report = await scanFor({
    domain: 'conflict-site.com', dns: d,
    rdap: defaultRdap('conflict-site.com', {})
  });
  const ip = report.ip.apex[0];
  assert.ok(ip.conflicts.length >= 1, 'conflict must be surfaced');
  assert.ok(report.conflicts.length >= 1);
  assert.ok(ip.confidence < 92, 'confidence must drop on conflict');
});

/* ================================================================== */
/* Unit tests, every analyzer                                          */
/* ================================================================== */

test('unit, domainParser: shapes, IDN, multi-level suffix, rejections', () => {
  assert.strictEqual(parseInput('example.com').hostname, 'example.com');
  assert.strictEqual(parseInput('https://example.com').scheme, 'https');
  assert.strictEqual(parseInput(' http://WWW.Example.COM/  ').hostname, 'www.example.com');
  assert.strictEqual(parseInput('https://blog.example.co.uk:8443/articles').tld, 'co.uk');
  assert.strictEqual(parseInput('https://blog.example.co.uk:8443/articles').subdomain, 'blog');
  assert.strictEqual(parseInput('https://blog.example.co.uk:8443/articles').port, 8443);
  assert.strictEqual(parseInput('bücher.de').hostname, 'xn--bcher-kva.de');
  assert.strictEqual(parseInput('bücher.de').unicodeHostname, 'bücher.de');
  assert.strictEqual(parseInput('bücher.de').isIdn, true);
  assert.strictEqual(parseInput('example.com.').hostname, 'example.com');
  for (const bad of ['', 'localhost', 'example.local', '127.0.0.1', '192.168.1.1', '10.0.0.1',
    'https://user:pass@example.com', 'ftp://example.com', 'foo', 'example.invalid', 'a..b.com',
    'https://', 'com', '[::1]', '256.1.1.1']) {
    assert.throws(() => parseInput(bad), e => e && e.code === 'invalid_input', 'should reject: ' + bad);
  // reserved names must be rejected with the reserved-name wording
  for (const reserved of ['localhost', 'example.test', 'foo.onion', 'x.arpa']) {
    try { parseInput(reserved); assert.fail('should reject ' + reserved); }
    catch (e) { assert.ok(/reserved/.test(e.message), reserved + ': ' + e.message); }
  }
  }
  // structure object
  const st = parseInput('https://blog.example.com/articles').structure;
  assert.strictEqual(st.subdomain, 'blog');
  assert.strictEqual(st.rootDomain, 'example.com');
  assert.strictEqual(st.tld, 'com');
});

test('unit, tldAnalyzer: known/unknown TLDs', () => {
  assert.strictEqual(analyzeTld('com', 'com').registry, 'Verisign, Inc.');
  assert.strictEqual(analyzeTld('uk', 'co.uk').type, 'ccTLD');
  assert.strictEqual(analyzeTld('bd', 'com.bd').country, 'Bangladesh');
  assert.strictEqual(analyzeTld('xyz', 'xyz').known, true);
  const unknown = analyzeTld('notatld', 'notatld');
  assert.strictEqual(unknown.known, false);
  assert.ok(/guessed/.test(unknown.note));
});

test('unit, domainAgeCalculator: buckets + wording', () => {
  const now = new Date('2026-08-21T12:00:00Z');
  const w = expiryWarning;
  assert.strictEqual(w(new Date(now.getTime() + 100 * 864e5).toISOString(), now).bucket, 'ok');
  assert.strictEqual(w(new Date(now.getTime() + 60 * 864e5).toISOString(), now).bucket, 'expiring-90d');
  assert.strictEqual(w(new Date(now.getTime() + 20 * 864e5).toISOString(), now).bucket, 'expiring-30d');
  assert.strictEqual(w(new Date(now.getTime() + 3 * 864e5).toISOString(), now).bucket, 'expiring-7d');
  assert.strictEqual(w(new Date(now.getTime() - 2 * 864e5).toISOString(), now).bucket, 'expired');
  assert.ok(w(new Date(now.getTime() - 2 * 864e5).toISOString(), now).note.includes('lapse'));
  const calc = calculate(null);
  assert.strictEqual(calc.available, false);
  assert.ok(calc.note.includes('cannot be reliably determined'));
  const calc2 = calculate({ registration: 'not-a-date' });
  assert.strictEqual(calc2.available, false);
});

test('unit, statusInterpreter: grouped, plain language, non-alarming', () => {
  assert.strictEqual(interpret('clientTransferProhibited').group, 'normal');
  assert.ok(interpret('clientTransferProhibited').explanation.includes('not a problem'));
  assert.strictEqual(interpret('pendingDelete').group, 'pending');
  assert.strictEqual(interpret('serverHold').group, 'problem');
  assert.strictEqual(interpret('redemptionPeriod').group, 'problem');
  assert.strictEqual(interpret('serverTransferProhibited').group, 'transfer-restricted');
  assert.strictEqual(interpret('serverUpdateProhibited').group, 'update-restricted');
});

test('unit, email parsers: SPF + DMARC', () => {
  const spf = parseSpf('v=spf1 ip4:1.2.3.4 include:_spf.example.com -all');
  assert.ok(spf);
  assert.strictEqual(spf.hardFail, true);
  assert.strictEqual(spf.mechanisms.length, 2);
  assert.strictEqual(parseSpf('random txt'), null);
  const dmarc = parseDmarc('v=DMARC1; p=reject; sp=quarantine; pct=100');
  assert.strictEqual(dmarc.policy, 'reject');
  assert.strictEqual(dmarc.subdomainPolicy, 'quarantine');
  assert.strictEqual(parseDmarc('v=spf1 -all'), null);
});

test('unit, cdnDetector: DNS-only Cloudflare is NOT a proxy claim', () => {
  const r = detectCdn({
    headers: {}, cnameTargets: [], ipInfos: [],
    tlsIssuer: '', nameservers: ['era.ns.cloudflare.com', 'bob.ns.cloudflare.com']
  });
  assert.strictEqual(r.status, 'not-detected');
  assert.strictEqual(r.provider, null);
  assert.strictEqual(r.dnsProvider, 'Cloudflare DNS');
  assert.ok(r.note && /NOT claimed/i.test(r.note));
});

test('unit, cdnDetector: header evidence detects the proxy', () => {
  const r = detectCdn({
    headers: { 'cf-ray': '1a2b', server: 'cloudflare' },
    cnameTargets: [], ipInfos: [],
    tlsIssuer: '', nameservers: []
  });
  assert.strictEqual(r.status, 'detected');
  assert.strictEqual(r.provider, 'Cloudflare');
  assert.ok(r.evidence.some(e => e.signal === 'cf-ray-header'));
});

test('unit, hostingDetector: origin visible beside CDN', () => {
  const r = detectHosting({
    ipInfos: [
      { ip: '104.16.0.1', provider: 'Cloudflare', providerKind: 'cdn', asn: '13335', sources: ['local-cidr', 'cymru-dns'], conflicts: [], confidence: 92 },
      { ip: '3.5.7.9', provider: 'Amazon.com (AWS)', providerKind: 'cloud', asn: '16509', sources: ['cymru-dns'], conflicts: [], confidence: 88 }
    ],
    apexIps: ['104.16.0.1', '3.5.7.9'],
    ptrs: {},
    cdn: { status: 'detected', provider: 'Cloudflare', confidence: 97, evidence: [] },
    serverHeader: 'cloudflare'
  });
  assert.strictEqual(r.cdn.provider, 'Cloudflare');
  assert.strictEqual(r.originHosting, 'identified');
  assert.strictEqual(r.provider, 'Amazon.com (AWS)');
  assert.strictEqual(r.kind, 'cloud');
});

test('unit, technologyDetector: fingerprints with evidence', () => {
  const html = '<html><head><meta name="generator" content="WordPress 6.5"></head><body>' +
    '<script src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>' +
    '<link rel="stylesheet" href="/wp-content/themes/x/style.css"></body></html>';
  const items = detectTechnology({ headers: {}, html, cookies: '', pathChecks: {} });
  const wp = items.find(i => i.id === 'wordpress');
  assert.ok(wp, 'WordPress should be detected');
  assert.ok(wp.confidence >= 70);
  assert.ok(wp.evidence.length >= 2);
  const ga = items.find(i => i.id === 'ga4');
  assert.ok(ga, 'GA4 should be detected');
});

test('unit, subdomainAnalyzer: passive sources only, labelled', () => {
  const r = collectObservations({
    domain: 'example.com', rootDomain: 'example.com',
    sanDomains: ['www.example.com', 'mail.example.com'],
    nameservers: ['ns1.example.com'],
    mxHosts: ['mx.example.com'],
    cnameTargets: ['cdn.example.com'],
    spfHosts: [],
    htmlLinks: ['help.example.com', 'other-site.org'],
    dkimSelectors: []
  });
  assert.strictEqual(r.count, 6);
  assert.ok(r.list.find(x => x.subdomain === 'www' && x.sources.includes('SSL certificate SAN')));
  assert.ok(r.list.find(x => x.subdomain === 'cdn' && x.sources.includes('CNAME target')));
  assert.ok(r.list.find(x => x.subdomain === 'ns1' && x.sources.includes('NS record')));
  assert.ok(r.note.includes('NOT a complete inventory'));
  // external host must not be listed
  assert.ok(!r.list.find(x => x.subdomain === 'other-site'));
});

test('unit, redirectAnalyzer: loop + downgrade detection', () => {
  const r = analyzeRedirectChain([
    { url: 'http://a.com/', status: 301, location: 'https://a.com/' },
    { url: 'https://a.com/', status: 301, location: 'https://a.com/' },
    { url: 'https://a.com/', status: 301, location: 'https://a.com/' }
  ], 'a.com');
  assert.ok(r.loopDetected);
  assert.ok(r.httpToHttps);
  const downgrade = analyzeRedirectChain([
    { url: 'https://a.com/', status: 302, location: 'http://a.com/' }
  ], 'a.com');
  assert.ok(downgrade.httpsToHttp);
});

test('unit, sslAnalyzer: valid / expired / mismatch (injected transport)', async () => {
  const valid = await analyzeSsl('tls.test', { transport: (h, o) => o && o.weakProbe ? { protocol: null, authorized: false, authorizationError: 'rejected', cert: null, cipher: null, ms: 1, rejected: true } : tlsInfo({ host: h }) });
  assert.strictEqual(valid.status, 'valid');
  assert.ok(valid.daysRemaining > 0);
  assert.strictEqual(valid.issuer, "Let's Encrypt");
  assert.ok(valid.signals.some(s => s.name === 'certificate-valid' && s.status === 'ok'));

  const expired = await analyzeSsl('tls.test', { transport: (h, o) => o && o.weakProbe ? { protocol: null, authorized: false, authorizationError: 'rejected', cert: null, cipher: null, ms: 1, rejected: true } : tlsInfo({ host: h, validTo: '2026-01-01T00:00:00Z' }) });
  assert.strictEqual(expired.status, 'expired');
  assert.strictEqual(expired.expired, true);
  assert.ok(expired.signals.some(s => s.name === 'expired' && s.status === 'fail'));

  const mismatch = await analyzeSsl('other.test', { transport: (h, o) => o && o.weakProbe ? { protocol: null, authorized: false, authorizationError: 'rejected', cert: null, cipher: null, ms: 1, rejected: true } : tlsInfo({ host: 'tls.test', sans: 'DNS:tls.test' }) });
  assert.strictEqual(mismatch.status, 'invalid');
  assert.strictEqual(mismatch.hostnameMatches, false);

  const unavailable = await analyzeSsl('x.test', { transport: () => { throw makeError('tls_blocked', 'reset'); } });
  assert.strictEqual(unavailable.status, 'unavailable');
  assert.ok(unavailable.note.includes('could not be inspected'));
});

test('unit, httpAnalyzer: HSTS parsing + status via injected transport', async () => {
  const { analyzeHttp } = require('./httpAnalyzer');
  const out = await analyzeHttp('httptest.site', {
    request: async (u) => {
      if (u.protocol === 'http:') return httpResponse({ status: 301, headers: { location: 'https://httptest.site/' } });
      return httpResponse({ status: 200, headers: { server: 'nginx', 'strict-transport-security': 'max-age=63072000; includeSubDomains; preload' } });
    }
  });
  assert.strictEqual(out.status, 'ok');
  assert.strictEqual(out.https.status, 200);
  assert.strictEqual(out.hsts.present, true);
  assert.strictEqual(out.hsts.maxAge, 63072000);
  assert.strictEqual(out.hsts.includeSubDomains, true);
  assert.strictEqual(out.hsts.preload, true);
  assert.strictEqual(out.httpsRedirect, true);
});

test('unit, analyzeBrowserBundle: CORS-exposed headers only', () => {
  const out = analyzeBrowserBundle({
    https: {
      status: 200, statusText: 'OK',
      finalUrl: 'https://x.test/',
      headers: { server: 'cloudflare', 'content-type': 'text/html' },
      body: '<div id="__next"></div>'
    },
    http: { status: 301, finalUrl: 'https://x.test/' }
  }, 'x.test');
  assert.strictEqual(out.status, 'ok');
  assert.strictEqual(out.via, 'browser');
  assert.strictEqual(out.https.status, 200);
  assert.strictEqual(out.https.server, 'cloudflare');
  assert.strictEqual(out.httpsRedirect, true);
  const empty = analyzeBrowserBundle(null, 'x.test');
  assert.strictEqual(empty.status, 'unavailable');
});

test('unit, whoisFallback: found / not-found / privacy / egress-blocked', async () => {
  const parsed = parseWhois(whoisText({ registered: '2019-02-01', expires: '2027-02-01', privacy: true }));
  assert.strictEqual(parsed.found, true);
  assert.strictEqual(parsed.dates.registration, '2019-02-01T00:00:00.000Z');
  assert.strictEqual(parsed.privacy.redacted, true);
  assert.ok(parsed.nameservers.length === 2);
  assert.strictEqual(parseWhois('Domain not found.\n>>> last update <<<').found, false);
  const client = createWhoisClient({ transport: async () => { throw makeError('egress_blocked', 'reset'); } });
  const res = await client.lookup('x.co.uk', { whoisServer: 'whois.nic.uk' });
  assert.strictEqual(res.outcome, 'unavailable');
  assert.strictEqual(res.reason, 'egress_blocked');
  const noServer = await client.lookup('x.com', { whoisServer: null });
  assert.strictEqual(noServer.reason, 'no_whois_server');
});

test('unit, rdapClient: ok / 404 available / 429 rate limit', async () => {
  const client = createRdapClient({
    fetcher: createFetcher({
      transport: makeRdapFixture({
        'good.com': { record: () => rdapRecord({ domain: 'good.com' }) },
        'free.com': { status: 404 },
        'limited.com': { status: 429 }
      }),
      maxRequests: 6, maxTotalBytes: 1 << 20
    })
  });
  const ok = await client.lookupDomain('good.com', { rdapEndpoint: 'https://rdap.verisign.com/com/v1/' });
  assert.strictEqual(ok.outcome, 'ok');
  assert.strictEqual(ok.record.registrar.name, 'Example Registrar, Inc.');
  assert.strictEqual(ok.record.events.registration, '2020-03-15T10:00:00.000Z');

  const free = await client.lookupDomain('free.com', { rdapEndpoint: 'https://rdap.verisign.com/com/v1/' });
  assert.strictEqual(free.outcome, 'available');

  const limited = await client.lookupDomain('limited.com', { rdapEndpoint: 'https://rdap.verisign.com/com/v1/' });
  assert.strictEqual(limited.outcome, 'unavailable');
  assert.strictEqual(limited.reason, 'rate_limit');
  assert.ok(limited.note.includes('rate-limited'));
});

test('unit, fixtures encode/decode: real DNS wire format round-trips', async () => {
  const d = dnsBase('roundtrip.com');
  d.add('roundtrip.com', 'MX', [{ value: 'mail.roundtrip.com', priority: 20 }]);
  d.add('roundtrip.com', 'TXT', [{ value: 'v=spf1 -all' }, { value: 'second string' }]);
  const { createDnsClient } = require('./dnsClient');
  const client = createDnsClient({ exchange: d.exchange });
  const mx = await client.query('roundtrip.com', 'MX');
  assert.strictEqual(mx.answers[0].value, 'mail.roundtrip.com');
  assert.strictEqual(mx.answers[0].priority, 20);
  const txt = await client.query('roundtrip.com', 'TXT');
  assert.ok(txt.answers.some(a => a.value === 'v=spf1 -all'));
  assert.ok(txt.answers.some(a => a.value === 'second string'));
});

/* ================================================================== */

(async () => {
  let pass = 0;
  let fail = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      pass++;
      console.log('  ✓ ' + name);
    } catch (e) {
      fail++;
      console.error('  ✗ ' + name);
      console.error('    ' + (e && e.message ? e.message : e));
      if (e && e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
    }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
