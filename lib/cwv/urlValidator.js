'use strict';

/*
 * Core Web Vitals & INP Auditor — URL validation.
 *
 * The submitted URL is treated as untrusted. Validation is split in two:
 *   - normalizeInputUrl()  syntax + scheme normalisation (reuses the shared
 *     wptheme normaliser so behaviour matches the other tools on this site)
 *   - assertPublicUrl()    SSRF guard: private/loopback/reserved IPs, cloud
 *     metadata hosts, internal hostnames, credentials, non-http(s) schemes.
 *
 * The server re-validates every request AND every redirect hop with the
 * same rules (DNS is resolved and pinned per hop — see safeFetcher.js), so
 * client-side checks here are only a first line of defence.
 */

const U = require('../wptheme/util');
const SSRF = require('../wptheme/ssrf');

function normalizeInputUrl(raw) {
  return U.normalizeInputUrl(raw);
}

function assertPublicUrl(raw) {
  return SSRF.assertPublicUrl(raw);
}

function validate(raw) {
  const u = normalizeInputUrl(raw);   // throws { code } on invalid input
  assertPublicUrl(u.href);            // throws { code: 'ssrf' } on unsafe targets
  u.hash = '';
  return u;
}

// Small mirror used by the browser UI to fail fast before calling the API.
// The server-side validate() above remains authoritative.
function clientMirror(raw) {
  let s = String(raw == null ? '' : raw).trim().replace(/\s+/g, '');
  if (!s) return { ok: false, code: 'invalid_url', message: 'Please enter a website URL.' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (e) { return { ok: false, code: 'invalid_url', message: 'Please enter a valid website URL (e.g. https://example.com).' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, code: 'invalid_url', message: 'Only http:// and https:// URLs are supported.' };
  if (u.username || u.password) return { ok: false, code: 'invalid_url', message: 'URLs with credentials are not allowed.' };
  const host = String(u.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return { ok: false, code: 'invalid_url', message: 'Please enter a valid website URL.' };
  if (/^(localhost|localhost\.localdomain|ip6-localhost|ip6-loopback)$/.test(host) ||
      /\.(local|internal|lan|home|localhost)$/i.test(host) ||
      /(metadata\.google|instance-data|kubernetes\.default)/.test(host)) {
    return { ok: false, code: 'ssrf', message: 'Private, local or internal addresses cannot be audited.' };
  }
  if (/^(127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|198\.1[89]\.)/.test(host)) {
    return { ok: false, code: 'ssrf', message: 'Private or loopback IP addresses cannot be audited.' };
  }
  return { ok: true, url: u.href };
}

module.exports = { normalizeInputUrl, assertPublicUrl, validate, clientMirror };
