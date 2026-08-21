'use strict';

const dns = require('dns').promises;
const net = require('net');
const { makeError } = require('./util');

const BLOCKED_HOSTS = new Set([
  'localhost', 'localhost.localdomain',
  'metadata.google.internal', 'metadata.goog',
  'kubernetes.default', 'kubernetes.default.svc',
  'kubernetes.default.svc.cluster.local',
  'ip6-localhost', 'ip6-loopback'
]);

function ipv4FromDecimal(n) {
  n = Number(n) >>> 0;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

function expandIPv6(ip) {
  if (ip.includes('.')) {
    const last = ip.lastIndexOf(':');
    const v4 = ip.slice(last + 1);
    const parts = v4.split('.').map(Number);
    if (parts.length === 4 && parts.every(p => p >= 0 && p <= 255)) {
      const hex = ((parts[0] << 8) | parts[1]).toString(16) + ':' + ((parts[2] << 8) | parts[3]).toString(16);
      ip = ip.slice(0, last + 1) + hex;
    }
  }
  const [head, tail] = ip.split('::');
  const headP = head ? head.split(':') : [];
  const tailP = tail ? tail.split(':') : [];
  const missing = 8 - headP.filter(Boolean).length - tailP.filter(Boolean).length;
  const mid = missing > 0 ? Array(missing).fill('0') : [];
  const parts = headP.concat(mid).concat(tailP).map(p => p || '0');
  while (parts.length < 8) parts.push('0');
  return parts.slice(0, 8).map(p => p.padStart(4, '0')).join(':');
}

function isPrivateIPv4(ip) {
  const p = ip.split('.').map(n => parseInt(n, 10));
  if (p.length !== 4 || p.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT / some cloud
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 192 && b === 0 && (p[2] === 0 || p[2] === 2)) return true;
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIPv6(ip) {
  const full = expandIPv6(ip.toLowerCase());
  if (full === '0000:0000:0000:0000:0000:0000:0000:0000') return true;
  if (full === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
  if (full.startsWith('0000:0000:0000:0000:0000:ffff:')) {
    const parts = full.split(':');
    const hi = parseInt(parts[6], 16);
    const lo = parseInt(parts[7], 16);
    const v4 = [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join('.');
    return isPrivateIPv4(v4);
  }
  const first = parseInt(full.slice(0, 4), 16);
  if ((first & 0xffc0) === 0xfe80) return true; // link-local
  if ((first & 0xfe00) === 0xfc00) return true; // unique local
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (first === 0x2001 && parseInt(full.slice(5, 9), 16) === 0x0000) return true; // teredo-ish documentation
  return false;
}

function isPrivateIp(ip) {
  const ver = net.isIP(ip);
  if (ver === 4) return isPrivateIPv4(ip);
  if (ver === 6) return isPrivateIPv6(ip);
  return true;
}

function decodeHostTricks(hostname) {
  const h = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (/^\d+$/.test(h)) return ipv4FromDecimal(h);
  if (/^0x[0-9a-f]+$/i.test(h)) return ipv4FromDecimal(parseInt(h, 16));
  if (/^0[0-7.]+$/.test(h) && h.includes('.')) {
    const parts = h.split('.').map(p => parseInt(p, 8));
    if (parts.length === 4 && parts.every(n => !Number.isNaN(n))) return parts.join('.');
  }
  return h;
}

function assertSafeHostname(hostname) {
  const raw = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!raw) throw makeError('invalid_url', 'Missing hostname.');
  if (BLOCKED_HOSTS.has(raw)) throw makeError('ssrf', 'That host is not allowed.');
  if (raw.endsWith('.localhost') || raw.endsWith('.local') || raw.endsWith('.internal') || raw.endsWith('.lan') || raw.endsWith('.home')) {
    throw makeError('ssrf', 'Internal hostnames cannot be audited.');
  }
  if (raw.includes('metadata.google') || raw.includes('instance-data')) {
    throw makeError('ssrf', 'Cloud metadata endpoints cannot be audited.');
  }
  const decoded = decodeHostTricks(raw);
  if (net.isIP(decoded) && isPrivateIp(decoded)) {
    throw makeError('ssrf', 'Private or loopback IP addresses cannot be audited.');
  }
  return raw;
}

function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch (e) {
    throw makeError('invalid_url', 'Please enter a valid public http(s) website URL.');
  }
  if (!/^https?:$/.test(u.protocol)) throw makeError('invalid_url', 'Only http and https URLs are supported.');
  if (u.username || u.password) throw makeError('invalid_url', 'URLs with credentials are not allowed.');
  assertSafeHostname(u.hostname);
  return u;
}

async function resolvePublic(hostname) {
  const host = assertSafeHostname(hostname);
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw makeError('ssrf', 'Private or loopback IP addresses cannot be audited.');
    return [{ address: host, family: net.isIP(host) }];
  }
  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch (e) {
    throw makeError('dns', 'Could not resolve DNS for ' + host + '.');
  }
  if (!records || !records.length) throw makeError('dns', 'No DNS records found for ' + host + '.');
  const publicRecords = [];
  for (const r of records) {
    if (isPrivateIp(r.address)) {
      throw makeError('ssrf', 'DNS for ' + host + ' resolved to a private or reserved address (' + r.address + ').');
    }
    publicRecords.push(r);
  }
  if (!publicRecords.length) throw makeError('ssrf', 'No public IP found for ' + host + '.');
  return publicRecords;
}

async function resolveAndPin(urlObj) {
  const records = await resolvePublic(urlObj.hostname);
  return {
    hostname: urlObj.hostname,
    address: records[0].address,
    family: records[0].family,
    records
  };
}

module.exports = {
  assertPublicUrl,
  assertSafeHostname,
  resolvePublic,
  resolveAndPin,
  isPrivateIp,
  isPrivateIPv4,
  isPrivateIPv6
};
