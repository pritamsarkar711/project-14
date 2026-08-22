'use strict';

/*
 * Domain Information Checker, offline fixture toolkit (shared by tests).
 * Builds raw wire-format DNS responses, RDAP JSON, WHOIS text, TLS info and
 * HTTP responses from declarative fixtures so the whole engine can run with
 * zero network access.
 */

const { buildQuery, decodeName } = require('./dnsClient');

/* ---------------- DNS wire-format response builder ---------------- */

function encodeNamePlain(name) {
  const out = [];
  for (const label of String(name).replace(/\.$/, '').split('.')) {
    if (!label) continue;
    out.push(Buffer.from([label.length]), Buffer.from(label, 'ascii'));
  }
  out.push(Buffer.from([0]));
  return Buffer.concat(out);
}

function encodeRdata(type, spec) {
  switch (String(type).toUpperCase()) {
    case 'A': {
      const b = Buffer.alloc(4);
      String(spec.value).split('.').forEach((n, i) => { b[i] = Number(n); });
      return b;
    }
    case 'AAAA': {
      // expand then pack 16 bytes
      const ip = String(spec.value).toLowerCase();
      const [head, tail] = ip.split('::');
      const hp = head ? head.split(':').filter(Boolean) : [];
      const tp = tail ? tail.split(':').filter(Boolean) : [];
      const groups = hp.concat(Array(Math.max(0, 8 - hp.length - tp.length)).fill('0')).concat(tp);
      const b = Buffer.alloc(16);
      for (let i = 0; i < 8; i++) {
        const n = parseInt(groups[i] || '0', 16) || 0;
        b.writeUInt16BE(n, i * 2);
      }
      return b;
    }
    case 'NS': case 'CNAME': case 'PTR':
      return encodeNamePlain(spec.value);
    case 'MX': {
      const n = encodeNamePlain(spec.value);
      const b = Buffer.alloc(2 + n.length);
      b.writeUInt16BE(spec.priority || 0, 0);
      n.copy(b, 2);
      return b;
    }
    case 'TXT': {
      const parts = Array.isArray(spec.value) ? spec.value : [String(spec.value || '')];
      const bufs = parts.map(p => {
        const b = Buffer.from(String(p), 'utf8');
        return Buffer.concat([Buffer.from([b.length]), b]);
      });
      return Buffer.concat(bufs);
    }
    case 'SOA': {
      const m = encodeNamePlain(spec.mname || 'ns1.' + spec._zone);
      const r = encodeNamePlain(spec.rname || 'hostmaster.' + spec._zone);
      const b = Buffer.alloc(20);
      b.writeUInt32BE(spec.serial || 2026010101, 0);
      b.writeUInt32BE(spec.refresh || 7200, 4);
      b.writeUInt32BE(spec.retry || 3600, 8);
      b.writeUInt32BE(spec.expire || 1209600, 12);
      b.writeUInt32BE(spec.minimum || 300, 16);
      return Buffer.concat([m, r, b]);
    }
    case 'CAA': {
      const tag = Buffer.from(String(spec.tag || 'issue'));
      const val = Buffer.from(String(spec.value || ''));
      return Buffer.concat([Buffer.from([spec.flags || 0, tag.length]), tag, val]);
    }
    case 'DS': {
      const b = Buffer.alloc(4);
      b.writeUInt16BE(spec.keyTag || 12345, 0);
      b[2] = spec.algorithm != null ? spec.algorithm : 13;
      b[3] = spec.digestType != null ? spec.digestType : 2;
      return Buffer.concat([b, Buffer.from(String(spec.digest || 'AA').repeat(32).slice(0, 64), 'utf8')]);
    }
    case 'DNSKEY': {
      const b = Buffer.alloc(4);
      b.writeUInt16BE(spec.flags || 257, 0);
      b[2] = 3;
      b[3] = spec.algorithm != null ? spec.algorithm : 13;
      return Buffer.concat([b, Buffer.from(String(spec.publicKey || 'TESTKEY'), 'utf8')]);
    }
    case 'SRV': {
      const n = encodeNamePlain(spec.value);
      const b = Buffer.alloc(6 + n.length);
      b.writeUInt16BE(spec.priority || 0, 0);
      b.writeUInt16BE(spec.weight || 0, 2);
      b.writeUInt16BE(spec.port || 0, 4);
      n.copy(b, 6);
      return b;
    }
    default:
      return Buffer.alloc(0);
  }
}

function encodeDnsResponse(queryObj, rcode, answers) {
  const query = queryObj.buffer || queryObj;
  const id = query.readUInt16BE(0);
  const qnameEnd = decodeName(query, 12).end;
  const question = query.slice(12, qnameEnd + 4);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x8180 | (rcode & 0xf), 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(answers.length, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);
  const rrs = [];
  for (const a of answers) {
    const rdata = encodeRdata(a.type, a);
    const rr = Buffer.alloc(12 + rdata.length); // ptr(2)+type(2)+class(2)+ttl(4)+rdlen(2)+rdata
    rr.writeUInt16BE(0xc00c, 0); // pointer to question name
    const typeNum = ({ A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, DS: 43, DNSKEY: 48, CAA: 257 })[String(a.type).toUpperCase()] || 0;
    rr.writeUInt16BE(typeNum, 2);
    rr.writeUInt16BE(1, 4);
    rr.writeUInt32BE(a.ttl || 300, 6);
    rr.writeUInt16BE(rdata.length, 10);
    rdata.copy(rr, 12);
    rrs.push(rr);
  }
  return Buffer.concat([header, question, ...rrs]);
}

/* ---------------- DNS fixture client ---------------- */

function makeDnsFixture(opts) {
  opts = opts || {};
  const map = new Map(); // 'name|TYPE' -> {rcode, answers: [spec]}
  const zoneRoot = opts.zoneRoot || null; // names under this root get NOERROR-empty; others NXDOMAIN

  const api = {
    // live-mutable Cymru tables (tests enrich them after creation)
    setCymru(mapOrObj) { opts.cymru = mapOrObj; return api; },
    setCymruLookup(fn) { opts.cymruLookup = fn; return api; },
    setAsnNames(mapOrObj) { opts.asnNames = mapOrObj; return api; },
    add(name, type, answers, rcode) {
      const key = String(name).toLowerCase() + '|' + String(type).toUpperCase();
      map.set(key, {
        rcode: rcode || 0,
        answers: (answers || []).map(a => Object.assign({ type: String(type).toUpperCase(), _zone: String(name).split('.').slice(-2).join('.') }, a))
      });
      return api;
    },
    exchange: async ({ name, type, opts: qopts }) => {
      const key = String(name).toLowerCase() + '|' + String(type).toUpperCase();
      const q = buildQuery(name, type, qopts || {});
      if (map.has(key)) {
        const entry = map.get(key);
        return encodeDnsResponse(q, entry.rcode, entry.answers);
      }
      // Cymru handlers (read opts live so tests can enrich after creation)
      const low = String(name).toLowerCase();
      const m4 = low.match(/^([\d.]+)\.origin\.asn\.cymru\.com$/);
      const m6 = low.match(/^([\d.]+)\.origin6\.asn\.cymru\.com$/);
      const ma = low.match(/^as(\d+)\.asn\.cymru\.com$/);
      const cymru = opts.cymru || {};
      const cymruLookup = opts.cymruLookup || null;
      const asnNames = opts.asnNames || {};
      if ((m4 || m6 || ma) && type === 'TXT') {
        if (ma) {
          const val = asnNames[ma[1]];
          if (val) return encodeDnsResponse(q, 0, [{ type: 'TXT', value: val }]);
          return encodeDnsResponse(q, 3, []);
        }
        let val = null;
        if (m4) {
          const rev = m4[1];
          const fwd = rev.split('.').reverse().join('.');
          if (cymruLookup) val = cymruLookup(fwd);
          if (!val) val = cymru[rev] || cymru[fwd] || null;
        } else if (m6) {
          const nib = m6[1].split('.').reverse().join('');
          const groups = nib.match(/.{4}/g) || [];
          const ip = groups.map(g => parseInt(g, 16).toString(16)).join(':');
          if (cymruLookup) val = cymruLookup(ip);
          if (!val) val = cymru[ip] || null;
        }
        if (val) return encodeDnsResponse(q, 0, [{ type: 'TXT', value: val }]);
        return encodeDnsResponse(q, 3, []);
      }
      // default: NOERROR-empty inside the zone root, NXDOMAIN outside
      const underZone = zoneRoot && (low === zoneRoot || low.endsWith('.' + zoneRoot));
      return encodeDnsResponse(q, underZone ? 0 : 3, []);
    }
  };
  return api;
}

/* ---------------- RDAP fixture ---------------- */

function rdapRecord(opt) {
  opt = opt || {};
  return {
    objectClassName: 'domain',
    handle: opt.handle || 'D12345-REG',
    ldhName: opt.domain,
    unicodeName: opt.domain,
    events: [
      { eventAction: 'registration', eventDate: opt.registered || '2020-03-15T10:00:00Z' },
      { eventAction: 'expiration', eventDate: opt.expires || '2027-03-15T10:00:00Z' },
      { eventAction: 'last changed', eventDate: opt.updated || '2025-03-15T10:00:00Z' },
      { eventAction: 'last update of rdap database', eventDate: '2026-08-20T00:00:00Z' }
    ],
    status: opt.status || ['clientTransferProhibited', 'serverTransferProhibited'],
    secureDNS: { delegationSigned: !!opt.dnssecSigned, dsData: opt.dsData || [] },
    nameservers: (opt.nameservers || ['ns1.example.com', 'ns2.example.com']).map(h => ({
      objectClassName: 'nameserver', ldhName: h
    })),
    entities: [
      {
        objectClassName: 'entity',
        handle: 'REG-1',
        roles: ['registrar'],
        vcardArray: ['vcard', [
          ['version', {}, 'text', '4.0'],
          ['fn', {}, 'text', opt.registrar || 'Example Registrar, Inc.'],
          ['adr', {}, 'text', ['', '123 Registrar Way', 'City', 'State', 'US']]
        ]],
        publicIds: [{ type: 'IANA Registrar ID', identifier: opt.ianaId || '1234' }]
      },
      {
        objectClassName: 'entity',
        handle: 'OWNER-1',
        roles: ['registrant'],
        vcardArray: opt.privacy ? ['vcard', [['version', {}, 'text', '4.0']]] :
          ['vcard', [
            ['version', {}, 'text', '4.0'],
            ['fn', {}, 'text', 'John Registrant'],
            ['email', {}, 'text', 'owner@example.com']
          ]]
      }
    ],
    port43: opt.whoisServer || 'whois.example-registry.net',
    links: [{ rel: 'self', href: 'https://rdap.example-registry.net/domain/' + opt.domain }]
  };
}

function makeRdapFixture(routes) {
  // routes: Map or object keyed by domain (lowercase) → {record | status}
  const transport = async (urlObj, pin, fopt) => {
    const path = urlObj.pathname;
    const m = path.match(/domain\/([^/?]+)/);
    const domain = m ? decodeURIComponent(m[1]).toLowerCase() : '';
    const entry = routes[domain];
    const notFound = { status: 404, headers: { 'content-type': 'application/rdap+json' }, text: '{"errorCode":404,"title":"Not Found"}', bytes: 30, ms: 3 };
    if (!entry) return notFound;
    if (entry.status === 404) return notFound;
    if (entry.status === 429) {
      return { status: 429, headers: { 'content-type': 'application/rdap+json', 'retry-after': '60' }, text: '{}', bytes: 2, ms: 3 };
    }
    if (entry.throw) throw entry.throw;
    const record = typeof entry.record === 'function' ? entry.record() : entry.record;
    const text = JSON.stringify(record);
    return { status: 200, headers: { 'content-type': 'application/rdap+json' }, text, bytes: text.length, ms: 3 };
  };
  return transport;
}

/* ---------------- WHOIS fixture ---------------- */

function whoisText(opt) {
  opt = opt || {};
  if (opt.notFound) {
    return 'Domain not found.\n>>> Last update of whois database: 2026-08-20T00:00:00Z <<<';
  }
  const lines = [];
  lines.push('Domain Name: ' + (opt.domain || 'example.co.uk'));
  lines.push('Registrar: ' + (opt.registrar || 'Nominet UK'));
  lines.push('Registrar IANA ID: 1234');
  if (opt.registered) lines.push('Creation Date: ' + opt.registered);
  if (opt.updated) lines.push('Updated Date: ' + opt.updated);
  if (opt.expires) lines.push('Registry Expiry Date: ' + opt.expires);
  for (const s of opt.statuses || ['clientTransferProhibited']) lines.push('Domain Status: ' + s);
  for (const ns of opt.nameservers || ['ns1.example.co.uk', 'ns2.example.co.uk']) lines.push('Name Server: ' + ns);
  lines.push('DNSSEC: unsigned');
  if (opt.privacy) lines.push('Registrant Name: Redacted for privacy');
  return lines.join('\r\n');
}

/* ---------------- TLS fixture ---------------- */

function tlsInfo(opt) {
  opt = opt || {};
  return {
    protocol: opt.protocol || 'TLSv1.3',
    authorized: opt.authorized !== false,
    authorizationError: opt.authorizationError || null,
    cert: opt.noCert ? null : {
      raw: Buffer.from('fixture-cert'),
      issuer: { O: opt.issuer || "Let's Encrypt", CN: opt.issuerCN || 'R3' },
      subject: { CN: opt.subject || opt.host },
      valid_from: opt.validFrom || '2026-05-01T00:00:00Z',
      valid_to: opt.validTo || '2026-11-01T00:00:00Z',
      serialNumber: '00A1B2C3',
      subjectaltname: opt.sans || ('DNS:' + opt.host),
      pubkey: { type: opt.pubkey || 'RSA' }
    },
    cipher: { name: 'TLS_AES_128_GCM_SHA256' },
    ms: 12
  };
}

/* ---------------- HTTP fixture ---------------- */

function httpResponse(opt) {
  opt = opt || {};
  const headers = Object.assign({
    'content-type': opt.contentType || 'text/html; charset=utf-8'
  }, opt.headers || {});
  return {
    status: opt.status || 200,
    statusText: opt.statusText || '',
    httpVersion: opt.httpVersion || '1.1',
    headers,
    body: opt.body != null ? opt.body : '<!doctype html><html><head><title>Test</title></head><body>Hello</body></html>',
    bytes: 100,
    ms: opt.ms || 20
  };
}

module.exports = { makeDnsFixture, makeRdapFixture, rdapRecord, whoisText, tlsInfo, httpResponse, encodeDnsResponse, encodeNamePlain };
