'use strict';

/*
 * huvanti WordPress Theme Detector, shared utilities.
 * Deterministic helpers only: no network, no AI, no third-party APIs.
 */

function makeError(code, message, cause) {
  const e = new Error(message || code);
  e.code = code;
  if (cause) e.cause = cause;
  return e;
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function round(n, d) { d = d == null ? 0 : d; const p = Math.pow(10, d); return Math.round(n * p) / p; }
function uniq(arr) { return Array.from(new Set(arr)); }
function strip(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n == null ? 500 : n); }

const MAX_URL_LEN = 2000;

/*
 * Normalise user input into a safe, absolute http(s) URL object.
 * Accepts: example.com, www.example.com, https://example.com, http://example.com,
 *          https://example.com/some/path (path kept), with or without trailing slash.
 */
function normalizeInputUrl(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) throw makeError('invalid_url', 'Please enter a website URL.');
  s = s.replace(/\s+/g, ''); // strip inner whitespace (common paste artefacts)
  if (s.length > MAX_URL_LEN) throw makeError('invalid_url', 'That URL is too long.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    if (/^(https?|ftp|file|data|javascript):/i.test(s)) {
      throw makeError('invalid_url', 'Only http:// and https:// URLs are supported.');
    }
    s = 'https://' + s; // bare domain / www.domain
  }
  let u;
  try { u = new URL(s); } catch (e) {
    throw makeError('invalid_url', 'Please enter a valid website URL (e.g. https://example.com).');
  }
  if (!/^https?:$/.test(u.protocol)) throw makeError('invalid_url', 'Only http:// and https:// URLs are supported.');
  if (u.username || u.password) throw makeError('invalid_url', 'URLs with credentials are not allowed.');
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) throw makeError('invalid_url', 'Please enter a valid website URL.');
  if (!host.includes('.') && host !== 'localhost') {
    throw makeError('invalid_url', 'Please enter a full domain such as example.com.');
  }
  const net = require('net');
  const isIpLiteral = net.isIP(host) !== 0;
  const labels = host.split('.');
  for (const l of labels) {
    if (isIpLiteral) break; // IP literals are validated by the SSRF guard instead
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(l) && !l.includes(':')) {
      throw makeError('invalid_url', 'That hostname does not look valid.');
    }
  }
  if (!isIpLiteral && /^\d+$/.test(labels[labels.length - 1])) {
    throw makeError('invalid_url', 'That hostname does not look valid.');
  }
  if (u.port && !(parseInt(u.port, 10) > 0 && parseInt(u.port, 10) < 65536)) {
    throw makeError('invalid_url', 'That port is not valid.');
  }
  if (u.hash) u.hash = '';
  return u;
}

function originOf(u) { try { return new URL(u).origin; } catch (e) { return ''; } }
function hostOf(u) { try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; } }
function normHost(h) { return String(h || '').toLowerCase().replace(/^www\./, ''); }
function sameSite(a, b) { return normHost(hostOf(a)) === normHost(hostOf(b)); }

/* Absolute URL for a path on the scanned origin (uses the FINAL origin after redirects). */
function absFromOrigin(origin, path) {
  try { return new URL(String(path || '/'), origin).toString(); } catch (e) { return ''; }
}

/* Relative-path resolution used for asset URLs found in HTML. */
function absUrl(raw, base) {
  try {
    const u = new URL(String(raw || ''), base);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.toString();
  } catch (e) { return null; }
}

/*
 * Parse a WordPress theme header from style.css.
 * WordPress keeps the header inside the first CSS comment block; we scan the
 * first 16 KB the same way core does (single-line "Key: value" pairs).
 */
const THEME_HEADER_KEYS = [
  'Theme Name', 'Theme URI', 'Author', 'Author URI', 'Description', 'Version',
  'License', 'License URI', 'Text Domain', 'Tags', 'Template', 'Template Version',
  'Requires at least', 'Tested up to', 'Requires PHP', 'Update URI'
];

function parseThemeHeader(cssText) {
  const css = String(cssText || '');
  const out = { found: false, fields: {} };
  const head = css.slice(0, 16384);
  const open = head.indexOf('/*');
  if (open < 0) return out;
  // find the closing comment that ends the header block (search from the open tag)
  let close = head.indexOf('*/', open);
  if (close < 0) close = head.length;
  const block = head.slice(open + 2, close);
  const re = /^([A-Za-z][A-Za-z -]{1,30}?)\s*:\s*(.+)$/gm;
  let m;
  while ((m = re.exec(block))) {
    const key = m[1].trim().replace(/\s+/g, ' ');
    if (THEME_HEADER_KEYS.indexOf(key) < 0) continue;
    if (out.fields[key] != null) continue;
    out.fields[key] = strip(m[2], 600);
  }
  // A real WP theme header has at least Theme Name (case-insensitive ownership of the block)
  const f = out.fields;
  if (f['Theme Name'] || f['Template'] || (f['Version'] && f['Author'])) out.found = true;
  return out;
}

/* Sanitise a theme slug coming from a URL path segment. */
function sanitizeSlug(slug) {
  const s = String(slug || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9 _.-]{0,78}$/.test(s)) return null;
  if (s.includes('..')) return null;
  return s.replace(/ /g, '-');
}

/* Extract asset URLs (href/src) from raw HTML without a DOM (quotes optional). */
function extractAssetUrls(html, baseUrl) {
  const urls = [];
  const re = /(?:href|src|srcset|data-src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))|url\(\s*["']?([^)"']+)["']?\s*\)/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const raw = m[1] || m[2] || m[3] || m[4];
    if (!raw) continue;
    // srcset: keep first candidate only
    const one = raw.split(',')[0].trim().split(/\s+/)[0];
    const a = absUrl(one, baseUrl);
    if (a && urls.indexOf(a) < 0) urls.push(a);
    if (urls.length >= 400) break;
  }
  return urls;
}

/* All "/wp-content/themes/<slug>/" style references inside arbitrary text. */
function themeSlugRefs(text) {
  const out = [];
  const re = /\/wp-content\/themes\/([A-Za-z0-9_.-]+)\//g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const slug = sanitizeSlug(m[1]);
    if (slug) out.push({ slug, matched: m[0] });
    if (out.length >= 200) break;
  }
  return out;
}

/* ?ver=… query parameter from a URL string. */
function verParam(u) {
  try {
    const q = new URL(u, 'https://x.invalid/').searchParams;
    for (const k of ['ver', 'v', 'version']) {
      const v = q.get(k);
      if (v) return v.slice(0, 40);
    }
  } catch (e) {}
  return null;
}

function looksLikeVersion(v) {
  return /^[0-9]+(\.[0-9]+){0,3}(-[a-z0-9.]+)?$/i.test(String(v || '').trim());
}

/* Compare dotted versions loosely: -1|0|1 (non-numeric parts compared lexically). */
function cmpVersion(a, b) {
  const pa = String(a || '').split(/[.-]/), pb = String(b || '').split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i], y = pb[i];
    if (x == null && y != null) return -1;
    if (y == null && x != null) return 1;
    const nx = /^\d+$/.test(x) ? parseInt(x, 10) : null;
    const ny = /^\d+$/.test(y) ? parseInt(y, 10) : null;
    if (nx != null && ny != null) { if (nx !== ny) return nx < ny ? -1 : 1; }
    else { const c = String(x).localeCompare(String(y)); if (c) return c < 0 ? -1 : 1; }
  }
  return 0;
}

/* Rough visible-text size of an HTML document (used for "JS-only site" heuristics). */
function textMass(html) {
  const s = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { chars: s.length, words: s ? s.split(' ').length : 0 };
}

module.exports = {
  makeError, clamp, round, uniq, strip,
  normalizeInputUrl, originOf, hostOf, normHost, sameSite, absFromOrigin, absUrl,
  parseThemeHeader, sanitizeSlug, extractAssetUrls, themeSlugRefs, verParam,
  looksLikeVersion, cmpVersion, textMass
};
