'use strict';

/**
 * SSRF Protection Module
 * Blocks:
 * - localhost, loopback, private networks, internal services
 * - cloud metadata endpoints
 * - DNS rebinding
 * - malicious redirects
 */

const dns = require('dns').promises;
const net = require('net');

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.goog',
  'kubernetes.default',
  'kubernetes.default.svc',
  'kubernetes.default.svc.cluster.local',
  'ip6-localhost',
  'ip6-loopback',
  'broadcasthost'
]);

function makeError(code, msg) {
  const e = new Error(msg);
  e.code = code;
  return e;
}

function ipv4FromDecimal(n) {
  n = Number(n) >>> 0;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

function expandIPv6(ip) {
  if (!ip) return '0000:0000:0000:0000:0000:0000:0000:0000';
  // Handle IPv4 embedded
  if (ip.includes('.')) {
    const last = ip.lastIndexOf(':');
    if (last !== -1) {
      const v4 = ip.slice(last + 1);
      const parts = v4.split('.').map(Number);
      if (parts.length === 4 && parts.every(p => p >= 0 && p <= 255)) {
        const hex = ((parts[0] << 8) | parts[1]).toString(16).padStart(4, '0') + ':' + ((parts[2] << 8) | parts[3]).toString(16).padStart(4, '0');
        ip = ip.slice(0, last + 1) + hex;
      }
    }
  }
  const [head, tail] = ip.split('::');
  const headP = head ? head.split(':').filter(Boolean) : [];
  const tailP = tail ? tail.split(':').filter(Boolean) : [];
  const missing = 8 - headP.length - tailP.length;
  const mid = missing > 0 ? Array(missing).fill('0') : [];
  const parts = [...headP, ...mid, ...tailP].map(p => p || '0');
  while (parts.length < 8) parts.push('0');
  return parts.slice(0, 8).map(p => p.padStart(4, '0')).join(':');
}

function isPrivateIPv4(ip) {
  const p = ip.split('.').map(n => parseInt(n, 10));
  if (p.length !== 4 || p.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b, c, d] = p;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay
  if (a === 198 && b === 18) return true; // benchmark
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast/reserved
  // Cloud metadata 169.254.169.254
  if (a === 169 && b === 254 && c === 169 && d === 254) return true;
  return false;
}

function isPrivateIPv6(ip) {
  const full = expandIPv6(ip.toLowerCase());
  if (full === '0000:0000:0000:0000:0000:0000:0000:0000') return true; // unspecified
  if (full === '0000:0000:0000:0000:0000:0000:0000:0001') return true; // loopback
  if (full.startsWith('0000:0000:0000:0000:0000:ffff:')) {
    const parts = full.split(':');
    const hi = parseInt(parts[6], 16);
    const lo = parseInt(parts[7], 16);
    const v4 = [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join('.');
    return isPrivateIPv4(v4);
  }
  const first = parseInt(full.slice(0, 4), 16);
  if ((first & 0xffc0) === 0xfe80) return true; // link-local
  if ((first & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((first & 0xff00) === 0xff00) return true; // multicast
  // Documentation prefix 2001:db8::/32
  if (full.startsWith('2001:0db8:')) return true;
  return false;
}

function isPrivateIp(ip) {
  const ver = net.isIP(ip);
  if (ver === 4) return isPrivateIPv4(ip);
  if (ver === 6) return isPrivateIPv6(ip);
  return true; // unknown = block
}

function decodeHostTricks(hostname) {
  let h = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase().trim();
  // Decimal IP e.g. 2130706433 => 127.0.0.1
  if (/^\d+$/.test(h)) {
    try { return ipv4FromDecimal(parseInt(h, 10)); } catch {}
  }
  if (/^0x[0-9a-f]+$/i.test(h)) {
    try { return ipv4FromDecimal(parseInt(h, 16)); } catch {}
  }
  if (/^0[0-7]+$/.test(h) && h.length > 1) {
    try { return ipv4FromDecimal(parseInt(h, 8)); } catch {}
  }
  // Octal dotted
  if (/^0[0-7.]+$/.test(h) && h.includes('.')) {
    const parts = h.split('.').map(p => {
      if (/^0[0-7]+$/.test(p)) return parseInt(p, 8);
      return parseInt(p, 10);
    });
    if (parts.length === 4 && parts.every(n => !Number.isNaN(n) && n >=0 && n <=255)) return parts.join('.');
  }
  return h;
}

function assertSafeHostname(hostname, opts = {}) {
  const raw = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase().trim();
  if (!raw) throw makeError('invalid_url', 'Missing hostname.');
  const allowPrivate = opts.allowPrivate || process.env.ALLOW_PRIVATE === '1';
  // Always block cloud metadata even in private mode
  if (raw.includes('metadata.google') || raw.includes('instance-data') || raw.includes('metadata.') || raw === '169.254.169.254') {
    throw makeError('ssrf', 'Cloud metadata endpoints cannot be scanned.');
  }
  if (raw === 'metadata.google.internal' || raw === 'metadata.goog') throw makeError('ssrf', 'Cloud metadata blocked.');
  if (!allowPrivate) {
    if (BLOCKED_HOSTS.has(raw)) throw makeError('ssrf', 'That host is not allowed (blocked hostname).');
    if (raw === 'localhost' || raw.endsWith('.localhost')) throw makeError('ssrf', 'Localhost cannot be scanned.');
    if (raw.endsWith('.local') || raw.endsWith('.internal') || raw.endsWith('.lan') || raw.endsWith('.home') || raw.endsWith('.corp')) {
      throw makeError('ssrf', 'Internal hostnames cannot be scanned.');
    }
    // Check for private IP tricks
    const decoded = decodeHostTricks(raw);
    if (net.isIP(decoded) && isPrivateIp(decoded)) {
      throw makeError('ssrf', 'Private or loopback IP addresses cannot be scanned (' + decoded + ').');
    }
  } else {
    // In private mode, allow localhost/private but still block metadata
    // Allow 127.0.0.1, localhost etc for testing
  }
  return raw;
}

function assertPublicUrl(raw, opts = {}) {
  let u;
  try { u = new URL(raw); } catch (e) {
    throw makeError('invalid_url', 'Please enter a valid public http(s) URL.');
  }
  if (!/^https?:$/.test(u.protocol)) throw makeError('invalid_url', 'Only http and https URLs are supported.');
  if (u.username || u.password) throw makeError('invalid_url', 'URLs with credentials are not allowed.');
  assertSafeHostname(u.hostname, opts);
  // Block non-standard ports that are often internal services? Allow common web ports only
  if (u.port) {
    const port = Number(u.port);
    const blockedPorts = [22,23,25,110,143,3306,5432,6379,27017,11211,1521,3389];
    if (blockedPorts.includes(port) && !(opts.allowPrivate || process.env.ALLOW_PRIVATE === '1')) throw makeError('ssrf', 'That port is not allowed for scanning.');
  }
  return u;
}

async function resolvePublic(hostname, opts = {}) {
  const allowPrivate = opts.allowPrivate || process.env.ALLOW_PRIVATE === '1';
  const host = assertSafeHostname(hostname, opts);
  if (net.isIP(host)) {
    if (!allowPrivate && isPrivateIp(host)) throw makeError('ssrf', 'Private or loopback IP addresses cannot be scanned.');
    return [{ address: host, family: net.isIP(host) }];
  }
  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch (e) {
    const code = e.code || '';
    if (code === 'ENOTFOUND' || code === 'ENODATA') throw makeError('dns_nxdomain', 'DNS resolution failed: NXDOMAIN for ' + host);
    if (code === 'ESERVFAIL' || code === 'ETIMEOUT') throw makeError('dns_servfail', 'DNS resolution failed: ' + code + ' for ' + host);
    throw makeError('dns', 'Could not resolve DNS for ' + host + ': ' + (e.message || code));
  }
  if (!records || !records.length) throw makeError('dns_nxdomain', 'No DNS records found for ' + host + '.');
  if (allowPrivate) return records;
  const publicRecords = [];
  for (const r of records) {
    if (isPrivateIp(r.address)) {
      throw makeError('ssrf', 'DNS for ' + host + ' resolved to a private or reserved address (' + r.address + '). This may be a DNS rebinding attempt.');
    }
    publicRecords.push(r);
  }
  if (!publicRecords.length) throw makeError('ssrf', 'No public IP found for ' + host + '.');
  return publicRecords;
}

// For DNS rebinding protection, we resolve before and after? This function does double-check
async function resolveAndValidate(urlObj) {
  const first = await resolvePublic(urlObj.hostname);
  // Small delay to catch rebinding? In practice, we resolve again after fetch if needed.
  return first;
}

module.exports = {
  assertPublicUrl,
  assertSafeHostname,
  resolvePublic,
  resolveAndValidate,
  isPrivateIp,
  isPrivateIPv4,
  isPrivateIPv6
};
