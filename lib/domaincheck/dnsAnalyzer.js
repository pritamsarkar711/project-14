'use strict';

/*
 * DNS analyzer, all record types in parallel, bounded and cached.
 * Produces both the raw records and the DNS Health panel. Health rules are
 * deliberately non-alarmist: e.g. a missing AAAA record is only noted
 * informationally, never flagged as a problem.
 */

const U = require('./util');

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'CAA', 'SOA', 'SRV', 'DS', 'DNSKEY'];

function recordValue(r) {
  return r.value != null ? r.value : String(r.raw || '');
}

async function collectRecords(dns, domain, ctx) {
  const out = { records: {}, raw: {}, errors: {}, queries: 0, truncated: {} };
  const results = {};
  const dnssecOpt = { dnssec: true }; // ask for RRSIGs where the resolver supports it

  await Promise.all(RECORD_TYPES.map(async type => {
    try {
      const res = await dns.query(domain, type, dnssecOpt);
      results[type] = res;
    } catch (e) {
      results[type] = e && e.code ? e : U.makeError('dns_error', String(e && e.message || e));
    }
  }));

  for (const type of RECORD_TYPES) {
    const res = results[type];
    if (res && res.code) {
      out.errors[type] = { code: res.code, message: res.message };
      out.records[type] = [];
      continue;
    }
    if (!res) { out.records[type] = []; continue; }
    out.queries += 1;
    if (res.truncated) out.truncated[type] = true;
    const answers = res.answers || [];
    if (res.rcode === 3) { // NXDOMAIN, no records of this type
      out.records[type] = [];
    } else if (res.rcode !== 0) {
      out.errors[type] = { code: 'rcode_' + res.rcode, message: 'DNS server answered rcode ' + res.rcode + '.' };
      out.records[type] = [];
    } else {
      out.records[type] = answers.filter(a => a.type === (type === 'MX' ? 15 : dns.TYPES[type]))
        .map(a => ({
          value: recordValue(a), name: a.name, ttl: a.ttl,
          priority: a.priority != null ? a.priority : null,
          serial: a.serial != null ? a.serial : null,
          flags: a.flags != null ? a.flags : null,
          tag: a.tag != null ? a.tag : null,
          digest: a.digest != null ? a.digest : null,
          keyTag: a.keyTag != null ? a.keyTag : null,
          algorithm: a.algorithm != null ? a.algorithm : null,
          digestType: a.digestType != null ? a.digestType : null,
          typeCovered: a.typeCovered != null ? a.typeCovered : null,
          signerName: a.signerName != null ? a.signerName : null,
          expiration: a.expiration != null ? a.expiration : null
        }));
      // RRSIGs observed for this type
      const sigs = answers.filter(a => a.type === 46);
      if (sigs.length) {
        out.records[type + '_rrsig'] = sigs.map(a => ({
          typeCovered: a.typeCovered, algorithm: a.algorithm, keyTag: a.keyTag,
          signerName: a.signerName,
          expires: a.expiration ? new Date(a.expiration * 1000).toISOString().slice(0, 10) : null
        }));
      }
    }
  }

  // Sort MX by priority, NS/TXT in arrival order
  if (out.records.MX) out.records.MX.sort((a, b) => (a.priority || 0) - (b.priority || 0));

  // CNAME chain of the apex
  const cnameChain = [];
  const seen = new Set();
  let cur = domain;
  for (let i = 0; i < 6; i++) {
    if (seen.has(cur)) { cnameChain.push({ from: cur, to: null, loop: true }); break; }
    seen.add(cur);
    let res;
    try { res = await dns.query(cur, 'CNAME'); } catch (e) { break; }
    const c = (res.answers || []).filter(a => a.type === 5)[0];
    if (!c || res.rcode !== 0) break;
    cnameChain.push({ from: cur, to: c.value });
    cur = c.value;
  }
  out.cnameChain = cnameChain;

  // Resolve A/AAAA of CNAME target(s)
  out.cnameResolved = {};
  for (const link of cnameChain) {
    if (!link.to) continue;
    if (!out.cnameResolved[link.to]) {
      const [a4, a6] = await Promise.all([
        dns.query(link.to, 'A').catch(() => null),
        dns.query(link.to, 'AAAA').catch(() => null)
      ]);
      out.cnameResolved[link.to] = {
        a: a4 && a4.rcode === 0 ? (a4.answers || []).filter(x => x.type === 1).map(x => x.value) : [],
        aaaa: a6 && a6.rcode === 0 ? (a6.answers || []).filter(x => x.type === 28).map(x => x.value) : []
      };
    }
  }

  return out;
}

/* ---------------- DNS health ---------------- */

function healthChecks(recs, ctx) {
  const checks = [];
  function add(id, level, title, detail, evidence) {
    checks.push({ id, level, title, detail, evidence: evidence || null });
  }

  const A = recs.A || [];
  const AAAA = recs.AAAA || [];
  const CNAME = recs.CNAME || [];
  const MX = recs.MX || [];
  const NS = recs.NS || [];
  const TXT = (recs.TXT || []).map(r => r.value);
  const CAA = recs.CAA || [];
  const SOA = recs.SOA || [];

  // A record
  if (!A.length) add('a-missing', 'warn', 'No A (IPv4) record', 'The domain does not resolve to an IPv4 address. Websites and services are typically unreachable over IPv4 without one.');
  else add('a-ok', 'pass', 'A record present', A.length + ' IPv4 address(es): ' + A.slice(0, 3).map(r => r.value).join(', ') + (A.length > 3 ? '…' : ''));

  // AAAA, informational only
  if (!AAAA.length) add('aaaa-missing', 'info', 'No AAAA (IPv6) record', 'The domain has no IPv6 address. This is common and is not a problem, most sites are reachable over IPv4 only.');
  else add('aaaa-ok', 'pass', 'AAAA record present', AAAA.length + ' IPv6 address(es).');

  // CNAME at apex
  if (CNAME.length) {
    const target = CNAME[0].value;
    const flat = ctx && ctx.cnameFlat ? true : false;
    add('cname-apex', 'warn', 'CNAME at the domain apex', 'The apex domain is a CNAME pointing to ' + target + '. This is how many CDN/proxy services work and is normally fine, but it can conflict with other apex records (MX, NS, SOA) per DNS standards.' + (flat ? '' : ''));
  }

  // MX
  if (MX.length) {
    const hosts = MX.map(m => m.value).join(', ');
    add('mx-ok', 'pass', 'MX records present', MX.length + ' mail server(s): ' + hosts);
  } else {
    add('mx-missing', 'info', 'No MX records', 'The domain does not publish MX records. It may not receive email (this is normal for many websites).');
  }

  // NS consistency
  if (NS.length) {
    if (NS.length === 1) add('ns-single', 'warn', 'Single nameserver', 'Only one nameserver is published. Two or more are recommended for resilience.');
    else add('ns-ok', 'pass', 'Nameservers published', NS.length + ' nameserver(s).');
  } else {
    add('ns-missing', 'warn', 'No NS records returned', 'No nameserver records were returned for the domain (the zone may be unresolvable or the domain may be inactive).');
  }

  // SOA
  if (!SOA.length) add('soa-missing', 'info', 'No SOA record', 'No Start-of-Authority record was returned.');

  // SPF / DMARC / DKIM (cross-referenced from email analyzer)
  if (ctx) {
    if (ctx.spf) {
      add('spf-ok', 'pass', 'SPF record', 'SPF policy: ' + String(ctx.spf.value || '').slice(0, 80));
    } else {
      add('spf-missing', 'warn', 'No SPF record', 'No SPF (v=spf1) TXT record was found. Without SPF, spoofed mail from this domain is easier to forge. Domains that never send mail do not need SPF.');
    }
    if (ctx.dmarc) {
      add('dmarc-ok', 'pass', 'DMARC record', 'DMARC policy: p=' + (ctx.dmarc.policy || 'none'));
    } else {
      add('dmarc-missing', 'info', 'No DMARC record', 'No DMARC policy was found at _dmarc.' + (ctx.domain || '') + '. DMARC is recommended for domains that send email.');
    }
    if (ctx.dkim && ctx.dkim.found && ctx.dkim.found.length) {
      add('dkim-ok', 'pass', 'DKIM key published', ctx.dkim.found.length + ' publicly visible DKIM selector(s): ' + ctx.dkim.found.map(d => d.selector).join(', ') + '.');
    } else {
      add('dkim-none', 'info', 'No DKIM selector observed', 'No DKIM key was found for the common selectors checked. DKIM may still be configured under a non-standard selector, or the domain may not send email.');
    }
  }

  // CAA
  if (CAA.length) {
    const issuers = CAA.filter(c => String(c.tag || '').toLowerCase() === 'issue').map(c => c.value).slice(0, 3).join(', ');
    add('caa-ok', 'pass', 'CAA records present', 'Certificate Authority Authorization restricts issuance to: ' + (issuers || '(see raw records)'));
  } else {
    add('caa-none', 'info', 'No CAA record', 'No CAA records were published. Certificate authorities are not restricted for this domain (the default behaviour).');
  }

  // DNSSEC (cross-referenced)
  if (ctx && ctx.dnssec) {
    if (ctx.dnssec.status === 'enabled') add('dnssec-ok', 'pass', 'DNSSEC enabled', 'DS records are published at the parent and DNSKEY records are present.');
    else if (ctx.dnssec.status === 'partial') add('dnssec-partial', 'info', 'DNSSEC partially observed', String(ctx.dnssec.note || ''));
    else add('dnssec-none', 'info', 'DNSSEC not detected', 'No DS/DNSKEY records were observed. DNSSEC is optional; its absence is not a vulnerability.');
  }

  return checks;
}

module.exports = { collectRecords, healthChecks, RECORD_TYPES };
