'use strict';

/**
 * URL Validation Engine for Broken Link Checker
 * - Validates URL syntax
 * - Adds protocol when missing
 * - Normalizes hostname
 * - Resolves redirects (deferred to safeFetcher)
 * - Validates DNS (deferred to dnsResolver/safeFetcher)
 * - Confirms public destination
 * - Blocks SSRF targets
 * - Rejects localhost, private IP ranges, loopback, cloud metadata
 * - Prevents DNS rebinding attacks
 */

const { assertPublicUrl, assertSafeHostname } = require('./ssrf');

function makeError(code, message, extra) {
  const e = new Error(message);
  e.code = code;
  if (extra) Object.assign(e, extra);
  return e;
}

function cleanInput(raw) {
  let s = String(raw || '').trim();
  if (!s) throw makeError('invalid_url', 'Please enter a website URL.');
  // Remove whitespace, control chars
  s = s.replace(/\s+/g, '');
  // Add protocol when missing
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    // If looks like protocol-relative //example.com
    if (s.startsWith('//')) s = 'https:' + s;
    else s = 'https://' + s;
  }
  return s;
}

function normalizeHostname(hostname) {
  return String(hostname || '').toLowerCase().replace(/\.$/, '');
}

function validateUrlSyntax(raw, opts = {}) {
  const cleaned = cleanInput(raw);
  let url;
  try {
    url = new URL(cleaned);
  } catch (e) {
    throw makeError('invalid_url', 'Please enter a valid URL (e.g. https://example.com).');
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw makeError('invalid_url', 'Only HTTP and HTTPS URLs are supported.');
  }
  if (url.username || url.password) {
    throw makeError('invalid_url', 'URLs with credentials are not allowed.');
  }
  // Basic hostname sanity
  if (!url.hostname || url.hostname.length < 1 || url.hostname.length > 253) {
    throw makeError('invalid_url', 'Hostname is invalid or too long.');
  }
  // Block obviously invalid hostnames
  if (url.hostname.includes('..') || url.hostname.startsWith('-') || url.hostname.endsWith('-')) {
    throw makeError('invalid_url', 'Hostname contains invalid characters.');
  }
  // SSRF protection via hostname checks
  const allowPrivate = opts && opts.allowPrivate;
  try {
    assertSafeHostname(url.hostname, { allowPrivate });
    assertPublicUrl(url.toString(), { allowPrivate });
  } catch (e) {
    if (e.code === 'ssrf' || e.code === 'invalid_url') throw e;
    throw makeError('ssrf', e.message || 'That URL is not allowed.');
  }

  // Normalize hostname
  url.hostname = normalizeHostname(url.hostname);

  // Remove default ports
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = '';
  }

  // Remove fragment for initial validation (but retain original for reporting later)
  // We keep pathname as-is for now, but collapse duplicate slashes later in urlNormalizer
  // Ensure path is at least /
  if (!url.pathname) url.pathname = '/';

  return url;
}

async function validateUrl(raw, opts = {}) {
  const url = validateUrlSyntax(raw);
  // Additional async checks can be added here (DNS pre-check) but safeFetcher will do deep DNS validation
  // We do a lightweight DNS check if requested
  if (opts.checkDns) {
    const { resolvePublic } = require('./ssrf');
    try {
      await resolvePublic(url.hostname);
    } catch (e) {
      throw makeError(e.code || 'dns', e.message || 'DNS resolution failed.');
    }
  }
  return url;
}

function isAcceptedInput(raw) {
  try {
    validateUrlSyntax(raw);
    return true;
  } catch {
    return false;
  }
}

module.exports = { validateUrl, validateUrlSyntax, isAcceptedInput, makeError };
