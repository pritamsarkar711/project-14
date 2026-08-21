'use strict';

/*
 * Minimal DNS wire-protocol client (no dependencies).
 *
 * Why not node:dns? node:dns does not expose DS (43), DNSKEY (48), RRSIG (46),
 * or the DNSSEC OK (DO) bit, all of which this tool needs for its DNSSEC and
 * raw-record reporting. It also lets us control resolvers, timeouts, EDNS
 * buffer size and caching, and keeps every lookup observable (source + timing).
 *
 * Transport: UDP with TCP fallback on truncation; system resolvers from
 * /etc/resolv.conf when present, otherwise public resolvers. A per-scan cache
 * prevents repeated lookups of the same (name, type).
 */

const dgram = require('dgram');
const net = require('net');
const fs = require('fs');
const os = require('os');
const { makeError } = require('./util');

const TYPES = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, DS: 43, RRSIG: 46, DNSKEY: 48, CAA: 257 };
const TYPE_NAMES = {};
for (const k of Object.keys(TYPES)) TYPE_NAMES[TYPES[k]] = k;

const DEFAULT_RESOLVERS = ['8.8.8.8', '1.1.1.1', '9.9.9.9'];
const UDP_TIMEOUT_MS = 2500;
const TCP_TIMEOUT_MS = 4000;
const EDNS_SIZE = 1232;

function systemResolvers() {
  const out = [];
  try {
    const txt = fs.readFileSync('/etc/resolv.conf', 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*nameserver\s+([^\s#]+)/i);
      if (m && net.isIP(m[1])) out.push(m[1]);
      if (out.length >= 3) break;
    }
  } catch (e) { /* ignore */ }
  return out.length ? out : DEFAULT_RESOLVERS;
}

/* ---------------- encoding ---------------- */

function encodeName(name) {
  const out = [];
  for (const label of String(name).replace(/\.$/, '').split('.')) {
    if (!label) continue;
    const b = Buffer.from(label, 'ascii');
    out.push(Buffer.from([b.length]), b);
  }
  out.push(Buffer.from([0]));
  return Buffer.concat(out);
}

function buildQuery(name, type, opts) {
  opts = opts || {};
  const id = (Math.random() * 0xffff) | 0;
  const flags = 0x0100 | (opts.rd === false ? 0 : 0); // RD always set
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(flags, 2);
  header.writeUInt16BE(1, 4); // QDCOUNT
  header.writeUInt16BE(0, 6);
  header.writeUInt16BE(0, 8);
  const qtype = typeof type === 'number' ? type : TYPES[type.toUpperCase()];
  if (!qtype) throw makeError('dns', 'Unsupported record type: ' + type);
  const question = Buffer.concat([encodeName(name), Buffer.from([(qtype >> 8) & 0xff, qtype & 0xff, 0x00, 0x01])]);
  let additional = Buffer.alloc(0);
  if (opts.dnssec) {
    // EDNS0 OPT RR with DO bit
    const opt = Buffer.alloc(11);
    opt.writeUInt16BE(41, 1);   // TYPE=OPT
    opt.writeUInt16BE(EDNS_SIZE, 3); // CLASS = UDP payload size
    opt.writeUInt32BE(0x8000, 5);    // TTL: DO bit
    opt.writeUInt16BE(0, 9);    // RDLEN=0
    const optRR = Buffer.concat([Buffer.from([0]), opt]);
    const arcount = header.readUInt16BE(10) + 1;
    header.writeUInt16BE(arcount, 10);
    additional = optRR;
  }
  return { id, buffer: Buffer.concat([header, question, additional]) };
}

/* ---------------- decoding ---------------- */

function decodeName(buf, offset) {
  const labels = [];
  let pos = offset;
  let jumped = false;
  let end = offset;
  let hops = 0;
  while (pos < buf.length) {
    if (++hops > 128) throw makeError('dns', 'DNS name pointer loop.');
    const len = buf[pos];
    if (len === 0) { pos++; if (!jumped) end = pos; break; }
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length) break;
      const ptr = ((len & 0x3f) << 8) | buf[pos + 1];
      if (!jumped) end = pos + 2;
      pos = ptr;
      jumped = true;
      continue;
    }
    if ((len & 0xc0) !== 0) break; // unknown label type
    pos++;
    labels.push(buf.slice(pos, pos + len).toString('ascii'));
    pos += len;
  }
  return { name: labels.join('.').toLowerCase(), end };
}

function readRdata(buf, pos, rdlen, type, name) {
  const end = pos + rdlen;
  const v = { raw: buf.slice(pos, end).toString('hex') };
  try {
    switch (type) {
      case TYPES.A:
        v.value = Array.from(buf.slice(pos, pos + 4)).join('.');
        break;
      case TYPES.AAAA: {
        const parts = [];
        for (let i = pos; i < pos + 16; i += 2) parts.push(buf.readUInt16BE(i).toString(16));
        v.value = parts.join(':').replace(/(^|:)0(:0)+(:|$)/, '::').replace(/(^|:)0(:0){0,}/g, '::');
        // normalize display: group collapse + zero-padding removal
        v.value = normalizeIPv6(v.value);
        break;
      }
      case TYPES.NS: case TYPES.CNAME: case TYPES.PTR: {
        const n = decodeName(buf, pos);
        v.value = n.name;
        break;
      }
      case TYPES.MX: {
        const pref = buf.readUInt16BE(pos);
        const n = decodeName(buf, pos + 2);
        v.value = n.name;
        v.priority = pref;
        break;
      }
      case TYPES.SOA: {
        let o = pos;
        const mname = decodeName(buf, o); o = mname.end;
        const rname = decodeName(buf, o); o = rname.end;
        v.value = mname.name + ' ' + rname.name;
        v.serial = buf.readUInt32BE(o);
        v.refresh = buf.readUInt32BE(o + 4);
        v.retry = buf.readUInt32BE(o + 8);
        v.expire = buf.readUInt32BE(o + 12);
        v.minimum = buf.readUInt32BE(o + 16);
        break;
      }
      case TYPES.TXT: {
        const chunks = [];
        let p = pos;
        while (p < end) {
          const l = buf[p];
          if (l > 0) chunks.push(buf.slice(p + 1, p + 1 + l).toString('utf8'));
          p += 1 + l;
        }
        v.value = chunks.join('');
        v.parts = chunks;
        break;
      }
      case TYPES.SRV: {
        v.priority = buf.readUInt16BE(pos);
        v.weight = buf.readUInt16BE(pos + 2);
        v.port = buf.readUInt16BE(pos + 4);
        const n = decodeName(buf, pos + 6);
        v.value = n.name;
        break;
      }
      case TYPES.DS: {
        v.keyTag = buf.readUInt16BE(pos);
        v.algorithm = buf[pos + 2];
        v.digestType = buf[pos + 3];
        v.digest = buf.slice(pos + 4, end).toString('hex').toUpperCase();
        v.value = v.keyTag + ' ' + v.algorithm + ' ' + v.digestType + ' ' + v.digest;
        break;
      }
      case TYPES.DNSKEY: {
        v.flags = buf.readUInt16BE(pos);
        v.protocol = buf[pos + 2];
        v.algorithm = buf[pos + 3];
        v.publicKey = buf.slice(pos + 4, end).toString('base64');
        v.value = v.flags + ' ' + v.protocol + ' ' + v.algorithm + ' ' + v.publicKey;
        break;
      }
      case TYPES.RRSIG: {
        const covered = buf.readUInt16BE(pos);
        v.typeCovered = TYPE_NAMES[covered] || String(covered);
        v.algorithm = buf[pos + 2];
        v.labels = buf[pos + 3];
        v.originalTtl = buf.readUInt32BE(pos + 4);
        v.expiration = buf.readUInt32BE(pos + 8);
        v.inception = buf.readUInt32BE(pos + 12);
        v.keyTag = buf.readUInt16BE(pos + 16);
        const n = decodeName(buf, pos + 18);
        v.signerName = n.name;
        const sigEnd = n.end - pos;
        v.signature = buf.slice(pos + n.end - pos, end).toString('base64').slice(0, 64);
        v.value = 'RRSIG ' + v.typeCovered + ' alg=' + v.algorithm + ' signer=' + v.signerName + ' expires=' + new Date(v.expiration * 1000).toISOString().slice(0, 10);
        void sigEnd;
        break;
      }
      case TYPES.CAA: {
        v.flags = buf[pos];
        const tagLen = buf[pos + 1];
        v.tag = buf.slice(pos + 2, pos + 2 + tagLen).toString('ascii');
        v.value = v.flags + ' ' + v.tag + ' "' + buf.slice(pos + 2 + tagLen, end).toString('utf8') + '"';
        break;
      }
      default:
        v.value = v.raw;
    }
  } catch (e) {
    v.parseError = e.message;
    v.value = v.raw;
  }
  return v;
}

function normalizeIPv6(ip) {
  // expand to 8 groups
  let full = ip.toLowerCase();
  if (full.includes('.')) {
    const idx = full.lastIndexOf(':');
    const v4 = full.slice(idx + 1).split('.');
    if (v4.length === 4) {
      const hex = ((+v4[0] << 8) | +v4[1]).toString(16) + ':' + ((+v4[2] << 8) | +v4[3]).toString(16);
      full = full.slice(0, idx + 1) + hex;
    }
  }
  const [head, tail] = full.split('::');
  const hp = head ? head.split(':') : [];
  const tp = tail ? tail.split(':') : [];
  const missing = 8 - hp.length - tp.length;
  const groups = hp.concat(Array(Math.max(0, missing)).fill('0')).concat(tp);
  const nums = groups.slice(0, 8).map(g => parseInt(g || '0', 16) || 0);
  // find longest zero run
  let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (nums[i] === 0) { if (curStart === -1) curStart = i; curLen++; if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; } }
    else { curStart = -1; curLen = 0; }
  }
  let str;
  if (bestLen >= 2) {
    const l = nums.slice(0, bestStart).map(n => n.toString(16));
    const r = nums.slice(bestStart + bestLen).map(n => n.toString(16));
    str = l.join(':') + '::' + r.join(':');
  } else {
    str = nums.map(n => n.toString(16)).join(':');
  }
  return str.replace(/(^|:)0+(?=\d)/g, '$1');
}

function parseResponse(buf) {
  if (buf.length < 12) throw makeError('dns', 'Truncated DNS response.');
  const id = buf.readUInt16BE(0);
  const flags = buf.readUInt16BE(2);
  const qd = buf.readUInt16BE(4);
  const an = buf.readUInt16BE(6);
  const ns = buf.readUInt16BE(8);
  const ar = buf.readUInt16BE(10);
  let pos = 12;
  const questions = [];
  for (let i = 0; i < qd; i++) {
    const n = decodeName(buf, pos); pos = n.end;
    if (pos + 4 > buf.length) break;
    const qtype = buf.readUInt16BE(pos);
    const qclass = buf.readUInt16BE(pos + 2);
    questions.push({ name: n.name, type: qtype });
    pos += 4;
  }
  const rrs = [];
  for (let i = 0; i < an + ns + ar; i++) {
    if (pos + 10 > buf.length) break;
    const n = decodeName(buf, pos); pos = n.end;
    const type = buf.readUInt16BE(pos);
    const cls = buf.readUInt16BE(pos + 2);
    const ttl = buf.readUInt32BE(pos + 4);
    const rdlen = buf.readUInt16BE(pos + 8);
    pos += 10;
    if (pos + rdlen > buf.length) break;
    const rdata = readRdata(buf, pos, rdlen, type, n.name);
    rrs.push({ name: n.name, type, typeName: TYPE_NAMES[type] || 'TYPE' + type, class: cls, ttl, section: i < an ? 'answer' : (i < an + ns ? 'authority' : 'additional'), ...rdata });
    pos += rdlen;
  }
  return {
    id, flags,
    rcode: flags & 0xf,
    aa: !!(flags & 0x0400),
    tc: !!(flags & 0x0200),
    rd: !!(flags & 0x0100),
    ra: !!(flags & 0x0080),
    questions, answers: rrs.filter(r => r.section === 'answer'),
    authorities: rrs.filter(r => r.section === 'authority'),
    additionals: rrs.filter(r => r.section === 'additional')
  };
}

/* ---------------- transport ---------------- */

function udpExchange(server, query, timeoutMs) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    let done = false;
    const finish = (err, data) => {
      if (done) return;
      done = true;
      try { sock.close(); } catch (e) { /* ignore */ }
      err ? reject(err) : resolve(data);
    };
    const timer = setTimeout(() => finish(makeError('dns_timeout', 'DNS query timed out (' + server + ').')), timeoutMs);
    sock.on('error', e => finish(makeError('dns_error', 'DNS socket error: ' + e.message)));
    sock.on('message', msg => { clearTimeout(timer); finish(null, msg); });
    sock.send(query.buffer, 53, server, err => {
      if (err) { clearTimeout(timer); finish(makeError('dns_error', 'DNS send failed: ' + err.message)); }
    });
  });
}

function tcpExchange(server, query, timeoutMs) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: server, port: 53 });
    let buf = Buffer.alloc(0);
    let done = false;
    const finish = (err, data) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch (e) { /* ignore */ }
      err ? reject(err) : resolve(data);
    };
    const timer = setTimeout(() => finish(makeError('dns_timeout', 'DNS-over-TCP timed out (' + server + ').')), timeoutMs);
    sock.on('error', e => finish(makeError('dns_error', 'DNS-over-TCP error: ' + e.message)));
    sock.on('connect', () => {
      const framed = Buffer.concat([Buffer.from([(query.buffer.length >> 8) & 0xff, query.buffer.length & 0xff]), query.buffer]);
      sock.write(framed);
    });
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      if (buf.length >= 2) {
        const len = buf.readUInt16BE(0);
        if (buf.length >= len + 2) {
          clearTimeout(timer);
          finish(null, buf.slice(2, 2 + len));
        }
      }
    });
    sock.on('close', () => finish(makeError('dns_error', 'DNS-over-TCP connection closed early.')));
  });
}

/* ---------------- client ---------------- */

function createDnsClient(opts) {
  opts = opts || {};
  const resolvers = (opts.resolvers || systemResolvers()).slice();
  const cache = opts.cache || new Map();
  const failed = new Set();
  const udpTimeout = opts.udpTimeoutMs || UDP_TIMEOUT_MS;
  const tcpTimeout = opts.tcpTimeoutMs || TCP_TIMEOUT_MS;
  const exchange = opts.exchange || null; // injectable for tests: ({name,type,opts}) => Promise<raw response buffer>
  const state = { queries: 0 }; // real transport queries only (cache hits excluded)

  async function query(name, type, qopts) {
    qopts = qopts || {};
    const key = name.toLowerCase() + '|' + String(type).toUpperCase() + '|' + (qopts.dnssec ? 'do' : '');
    if (cache.has(key)) return cache.get(key);
    const started = Date.now();

    let raw;
    if (exchange) {
      state.queries += 1;
      raw = await exchange({ name, type, opts: qopts });
    } else {
      const q = buildQuery(name, type, qopts);
      let lastErr = null;
      let triedUdp = false;
      let winningServer = null;
      const ordered = resolvers.filter(s => !failed.has(s));
      for (const server of ordered.length ? ordered : resolvers) {
        try {
          raw = await udpExchange(server, q, udpTimeout);
          triedUdp = true;
          winningServer = server;
          break;
        } catch (e) {
          failed.add(server);
          lastErr = e;
        }
      }
      if (!raw) {
        // TCP fallback across resolvers
        for (const server of resolvers) {
          try {
            raw = await tcpExchange(server, buildQuery(name, type, qopts), tcpTimeout);
            winningServer = server;
            break;
          } catch (e) {
            failed.add(server);
            lastErr = e;
          }
        }
      }
      if (!raw) throw lastErr || makeError('dns_error', 'No DNS resolver answered.');
      state.queries += 1;
      if (winningServer) {
        // adaptive preference: successful resolver first for the rest of the scan
        const idx = resolvers.indexOf(winningServer);
        if (idx > 0) { resolvers.splice(idx, 1); resolvers.unshift(winningServer); }
        failed.delete(winningServer);
      }
      const parsed0 = parseResponse(raw);
      if (parsed0.tc && triedUdp) {
        // truncation → retry over TCP
        raw = await tcpExchange(winningServer || resolvers[0], buildQuery(name, type, qopts), tcpTimeout);
      }
    }

    const parsed = parseResponse(raw);
    const result = {
      name: name.toLowerCase(),
      type: type.toUpperCase(),
      rcode: parsed.rcode, // 0=NOERROR 2=SERVFAIL 3=NXDOMAIN 5=REFUSED
      truncated: parsed.tc,
      answers: parsed.answers,
      authorities: parsed.authorities,
      additionals: parsed.additionals,
      dnssecRequested: !!qopts.dnssec,
      elapsedMs: Date.now() - started,
      resolver: resolvers.join(',')
    };
    cache.set(key, result);
    return result;
  }

  async function queryMulti(names, type, qopts) {
    const out = {};
    await Promise.all((names || []).map(async n => {
      try { out[n] = await query(n, type, qopts); } catch (e) { out[n] = e && e.code ? e : makeError('dns_error', String(e && e.message || e)); }
    }));
    return out;
  }

  return { query, queryMulti, resolvers, cache, state, TYPES, TYPE_NAMES };
}

module.exports = { createDnsClient, buildQuery, parseResponse, decodeName, normalizeIPv6, TYPES, TYPE_NAMES, systemResolvers };
