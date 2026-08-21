'use strict';

/**
 * URL Normalization Engine
 * Handles:
 * - HTTP/HTTPS
 * - www/non-www
 * - trailing slash
 * - duplicate slashes
 * - URL fragments
 * - encoded characters
 * - Unicode URLs
 * - relative paths
 * - absolute URLs
 * - default ports
 * - safe query parameters (tracking params removal)
 */

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
  'gclid', 'gclsrc', 'dclid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid',
  'igshid', 'si', '_ga', '_gl', 'spm', 'yclid', 'wickedid', 'rb_clickid',
  'srsltid', 'mkt_tok'
]);

function stripDefaultPort(u) {
  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) {
    u.port = '';
  }
}

function normalizePathname(pathname) {
  // Collapse duplicate slashes, but preserve leading slash
  let p = pathname.replace(/\/+/g, '/');
  // Decode safe characters
  try {
    // decodeURI will keep encoded reserved chars; we want to normalize
    p = decodeURI(p);
  } catch {}
  // Re-encode spaces etc? Keep as decoded for readability, URL will re-encode when toString()
  // Remove trailing slash unless root or has extension? We'll handle trailing slash normalization separately
  return p;
}

function removeTrackingParams(searchParams) {
  let removed = 0;
  for (const key of [...searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      searchParams.delete(key);
      removed++;
    }
  }
  return removed;
}

function normalizeUrl(raw, base, opts = {}) {
  opts = opts || {};
  if (!raw) return null;
  const original = String(raw).trim();
  if (!original) return null;

  // Ignore unsupported protocols early
  const lower = original.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('data:') || lower.startsWith('blob:') || lower.startsWith('about:')) {
    return { url: null, original, reason: 'unsupported_protocol', protocol: lower.split(':')[0] };
  }

  let url;
  try {
    url = new URL(original, base);
  } catch {
    return null;
  }

  if (!/^https?:$/.test(url.protocol)) {
    return { url: null, original, reason: 'unsupported_protocol', protocol: url.protocol.replace(':', '') };
  }

  // Store original fragment for reporting
  const fragment = url.hash || '';
  const originalWithFragment = url.toString();

  // Normalize hostname
  url.hostname = url.hostname.toLowerCase();

  stripDefaultPort(url);

  // Normalize pathname
  url.pathname = normalizePathname(url.pathname);

  // Remove tracking params if enabled (default true for dedup key, but keep original for reporting)
  const searchParams = new URLSearchParams(url.search);
  const trackingRemoved = removeTrackingParams(searchParams);
  url.search = searchParams.toString() ? '?' + searchParams.toString() : '';

  // For HTTP status checking, remove fragment
  const urlForChecking = new URL(url.toString());
  urlForChecking.hash = '';

  // Canonical key for deduplication: lower hostname, strip www? No, keep www distinction for dedup? Spec says handle www/non-www
  // For dedup key, we will normalize www vs non-www as equivalent? Safer to treat them as same host for internal?
  // We'll create a key that lowercases, removes tracking, removes fragment, normalizes trailing slash

  // Trailing slash handling: remove trailing slash unless root path
  let pathForKey = urlForChecking.pathname;
  if (pathForKey.length > 1 && pathForKey.endsWith('/')) {
    pathForKey = pathForKey.replace(/\/+$/, '');
  }

  const keyUrl = new URL(urlForChecking.toString());
  keyUrl.pathname = pathForKey;
  // keyUrl already has no hash, no tracking

  // For final URL, we may want to keep trailing slash? We'll keep as normalized
  const finalUrl = urlForChecking.toString();
  const key = keyUrl.toString();

  return {
    url: finalUrl,
    original,
    originalWithFragment,
    fragment: fragment ? fragment.slice(1) : '',
    key,
    trackingRemoved,
    hostname: url.hostname,
    protocol: url.protocol,
    pathname: url.pathname,
    search: url.search,
    hash: fragment
  };
}

function canonicalKey(url) {
  const n = normalizeUrl(url);
  return n ? n.key : String(url).toLowerCase().replace(/#.*$/, '').replace(/\/$/, '');
}

function stripFragment(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return String(url).split('#')[0];
  }
}

function isInternal(url, root, includeSubdomains = false) {
  try {
    const a = new URL(url);
    const b = new URL(root);
    const ah = a.hostname.toLowerCase().replace(/^www\./, '');
    const bh = b.hostname.toLowerCase().replace(/^www\./, '');
    if (ah === bh) return true;
    if (includeSubdomains && (ah.endsWith('.' + bh) || bh.endsWith('.' + ah))) return true;
    // Also check exact match with www handling
    if (a.hostname.toLowerCase() === b.hostname.toLowerCase()) return true;
    return false;
  } catch {
    return false;
  }
}

function getRootDomain(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

module.exports = {
  normalizeUrl,
  canonicalKey,
  stripFragment,
  isInternal,
  getRootDomain,
  TRACKING_PARAMS
};
