'use strict';

/**
 * DNS Analysis Module
 * Detects:
 * - NXDOMAIN
 * - SERVFAIL
 * - DNS timeout
 * - missing DNS
 * - hostname resolution failure
 */

const dns = require('dns').promises;

function makeError(code, message, meta) {
  const e = new Error(message);
  e.code = code;
  if (meta) Object.assign(e, meta);
  return e;
}

async function resolveWithTimeout(hostname, timeoutMs = 5000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    // Try A and AAAA
    const [a, aaaa] = await Promise.allSettled([
      dns.resolve4(hostname).catch(() => []),
      dns.resolve6(hostname).catch(() => [])
    ]);
    clearTimeout(t);
    const aVals = a.status === 'fulfilled' ? (Array.isArray(a.value) ? a.value : []) : [];
    const aaaaVals = aaaa.status === 'fulfilled' ? (Array.isArray(aaaa.value) ? aaaa.value : []) : [];
    const all = [...aVals, ...aaaaVals];
    if (all.length === 0) {
      // Try lookup as fallback
      try {
        const lookup = await dns.lookup(hostname, { all: true });
        if (lookup && lookup.length) return { addresses: lookup.map(r => r.address), raw: lookup };
      } catch (e) {
        // map errors
        if (e.code === 'ENOTFOUND') throw makeError('NXDOMAIN', `DNS resolution failed: NXDOMAIN for ${hostname}`, { dnsCode: 'NXDOMAIN' });
        if (e.code === 'ESERVFAIL') throw makeError('SERVFAIL', `DNS resolution failed: SERVFAIL for ${hostname}`, { dnsCode: 'SERVFAIL' });
        if (e.code === 'ETIMEOUT' || e.code === 'ETIMEDOUT') throw makeError('DNS_TIMEOUT', `DNS resolution timeout for ${hostname}`, { dnsCode: 'TIMEOUT' });
        throw makeError('DNS_ERROR', `DNS resolution failed for ${hostname}: ${e.message}`, { dnsCode: e.code });
      }
      throw makeError('NXDOMAIN', `DNS resolution failed: no records for ${hostname}`, { dnsCode: 'NXDOMAIN' });
    }
    return { addresses: all, raw: all };
  } catch (e) {
    clearTimeout(t);
    if (e.code && ['NXDOMAIN','SERVFAIL','DNS_TIMEOUT','DNS_ERROR'].includes(e.code)) throw e;
    if (e.name === 'AbortError') throw makeError('DNS_TIMEOUT', `DNS resolution timeout for ${hostname}`, { dnsCode: 'TIMEOUT' });
    throw e;
  }
}

async function analyzeDns(hostname) {
  try {
    const result = await resolveWithTimeout(hostname);
    return { ok: true, hostname, addresses: result.addresses, error: null, code: null };
  } catch (e) {
    return {
      ok: false,
      hostname,
      addresses: [],
      error: e.message,
      code: e.code || 'DNS_ERROR',
      dnsCode: e.dnsCode || e.code || 'UNKNOWN'
    };
  }
}

function classifyDnsError(error) {
  const msg = String(error.message || error || '').toLowerCase();
  const code = String(error.code || '').toUpperCase();
  if (code === 'NXDOMAIN' || msg.includes('nxdomain') || msg.includes('enotfound') || msg.includes('not found')) {
    return { type: 'NXDOMAIN', label: 'DNS resolution failed: NXDOMAIN' };
  }
  if (code === 'SERVFAIL' || msg.includes('servfail')) {
    return { type: 'SERVFAIL', label: 'DNS resolution failed: SERVFAIL' };
  }
  if (code === 'DNS_TIMEOUT' || msg.includes('timeout')) {
    return { type: 'DNS_TIMEOUT', label: 'DNS resolution timeout' };
  }
  return { type: 'DNS_ERROR', label: error.message || 'DNS resolution failed' };
}

module.exports = { resolveWithTimeout, analyzeDns, classifyDnsError };
