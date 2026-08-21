'use strict';

/*
 * DNSSEC detection — DS (parent), DNSKEY (child), RRSIG presence where the
 * resolver honours the DO bit.
 *
 * Honest semantics:
 *   enabled  → DS published at the parent AND DNSKEY present in the zone
 *   partial  → only one of the two observed (or signed data observed)
 *   not-detected → neither observed
 * Full chain validation is only claimed when actually performed; otherwise
 * "signed responses observed" is reported as exactly that. The absence of
 * DNSSEC is never called a vulnerability.
 */

const U = require('./util');

async function analyzeDnssec(dns, domain) {
  const out = {
    status: 'not-detected',
    dsPresent: false,
    dsRecords: [],
    dnskeyPresent: false,
    dnskeys: [],
    rrSigObserved: false,
    delegationSigned: null, // from RDAP (set by orchestrator)
    validation: 'unavailable',
    note: null,
    source: 'dns'
  };

  // DS at parent (public resolvers return it from the parent zone)
  let ds;
  try { ds = await dns.query(domain, 'DS', { dnssec: true }); } catch (e) { ds = e; }
  if (ds && !ds.code && ds.rcode === 0) {
    const records = (ds.answers || []).filter(a => a.type === 43);
    if (records.length) {
      out.dsPresent = true;
      out.dsRecords = records.map(a => ({ keyTag: a.keyTag, algorithm: a.algorithm, digestType: a.digestType, digest: a.digest }));
    }
  }

  // DNSKEY at child
  let dk;
  try { dk = await dns.query(domain, 'DNSKEY', { dnssec: true }); } catch (e) { dk = e; }
  if (dk && !dk.code && dk.rcode === 0) {
    const keys = (dk.answers || []).filter(a => a.type === 48);
    if (keys.length) {
      out.dnskeyPresent = true;
      out.dnskeys = keys.map(a => ({ flags: a.flags, protocol: a.protocol, algorithm: a.algorithm, keyType: (a.flags & 257) === 257 ? 'KSK' : (a.flags & 256) === 256 ? 'ZSK' : 'unknown', publicKey: String(a.publicKey || '').slice(0, 96) + (a.publicKey && String(a.publicKey).length > 96 ? '…' : '') }));
    }
  }

  // RRSIG presence (DO bit honoured by some resolvers; others strip EDNS)
  let sig = null;
  try {
    const r = await dns.query(domain, 'A', { dnssec: true });
    sig = r.answers.filter(a => a.type === 46).length;
  } catch (e) { /* ignore */ }
  if (sig) out.rrSigObserved = true;

  if (out.dsPresent && out.dnskeyPresent) {
    out.status = 'enabled';
    out.validation = out.rrSigObserved ? 'signed-responses-observed' : 'ds-and-dnskey-present';
    out.note = 'DS records are published at the parent zone and DNSKEY records exist in the zone. ' + (out.rrSigObserved ? 'Signed (RRSIG) responses were also observed.' : 'RRSIG responses were not visible to this resolver, so signatures were not inspected here.');
  } else if (out.dsPresent || out.dnskeyPresent || out.rrSigObserved) {
    out.status = 'partial';
    out.note = 'Some DNSSEC components were observed (' + [out.dsPresent ? 'DS' : null, out.dnskeyPresent ? 'DNSKEY' : null, out.rrSigObserved ? 'RRSIG' : null].filter(Boolean).join(', ') + ') but not the full set. This can happen during key rollovers or with partial configuration.'
  } else {
    out.note = 'No DS or DNSKEY records were observed. DNSSEC is optional and its absence is not a vulnerability.';
  }

  return out;
}

module.exports = { analyzeDnssec };
