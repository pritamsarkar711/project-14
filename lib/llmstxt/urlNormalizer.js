'use strict';

/*
 * LLMs.txt Generator — URL normalisation and deduplication helpers.
 * Deterministic only: no network, no AI, no third-party APIs.
 *
 * Responsibilities:
 *  - normalise discovered URLs into a stable absolute http(s) form
 *  - decide whether a URL belongs to the scanned site (internal)
 *  - produce a canonical key used for deduplication
 *  - strip obviously-tracking query parameters (conservatively)
 */

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
  'gclid', 'fbclid', 'msclkid', 'dclid', 'twclid', 'wbraid', 'gbraid', 'gclsrc',
  'mc_cid', 'mc_eid', 'igshid', 'srsltid', 'mkt_tok', '_ga', '_gl', 'vero_id',
  'vero_conv', 'oly_anon_id', 'oly_enc_id', 'pk_source', 'pk_medium', 'pk_campaign'
]);

const ASSET_EXT_RE = /\.(css|js|mjs|json|xml|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|eot|otf|mp4|webm|mov|avi|mp3|wav|zip|rar|7z|gz|tar|exe|dmg|apk)([?#]|$)/i;
const BINARY_EXT_RE = /\.(zip|rar|7z|gz|tar|exe|dmg|apk|mp4|webm|mov|avi|mp3|wav)([?#]|$)/i;
const PDF_EXT_RE = /\.pdf([?#]|$)/i;
const FEED_EXT_RE = /\.(rss|atom)([?#]|$)/i;

function stripDefaultPort(u) {
  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
}

/* Normalise an arbitrary URL found in HTML/sitemaps against a base URL. */
function normalizeUrl(raw, base) {
  let u;
  try { u = new URL(String(raw || ''), base); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  stripDefaultPort(u);
  u.pathname = u.pathname.replace(/\/+/g, '/');
  try { u.pathname = decodeURI(u.pathname); } catch {}
  stripTrackingParams(u);
  return u.toString();
}

/* Remove tracking-only parameters; keep meaningful ones (page, id, product, …). */
function stripTrackingParams(u) {
  if (!u.search) return u;
  for (const k of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(k.toLowerCase())) u.searchParams.delete(k);
  }
  return u;
}

/* Normalise the user-submitted URL (absolute form, no fragment). */
function normalizeInput(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  s = s.replace(/\s+/g, '');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  stripDefaultPort(u);
  return u;
}

/* Registrable-ish host: lowercase, no www. */
function registrableHost(h) {
  return String(h || '').toLowerCase().replace(/^www\./, '');
}

/* Is `url` part of the scanned site (root) — optionally including subdomains? */
function isInternal(url, root, includeSubdomains) {
  let a, b;
  try { a = new URL(url); b = new URL(root); } catch { return false; }
  const ah = registrableHost(a.hostname);
  const bh = registrableHost(b.hostname);
  if (ah === bh) return true;
  return !!includeSubdomains && ah.endsWith('.' + bh);
}

/* Host-normalised key: same resource = same key. */
function canonicalKey(url) {
  let u;
  try { u = new URL(url); } catch { return url; }
  u.hash = '';
  stripDefaultPort(u);
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  stripTrackingParams(u);
  const path = u.pathname.replace(/\/+$/, '');
  return u.origin.replace(/\/+$/, '') + path + u.search;
}

function hasTrackingParams(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  return [...u.searchParams.keys()].some(k => TRACKING_PARAMS.has(k.toLowerCase()));
}

function isAssetUrl(url) { return ASSET_EXT_RE.test(String(url || '').split('?')[0].split('#')[0]) && !PDF_EXT_RE.test(String(url || '').split('?')[0].split('#')[0]); }
function isBinaryUrl(url) { return BINARY_EXT_RE.test(String(url || '').split('?')[0].split('#')[0]); }
function isPdfUrl(url) { return PDF_EXT_RE.test(String(url || '').split('?')[0].split('#')[0]); }
function isFeedUrl(url) { return FEED_EXT_RE.test(String(url || '').split('?')[0].split('#')[0]); }

/* Path helpers used by the classifier. */
function pathOf(url) {
  try { return new URL(url).pathname.toLowerCase().replace(/\/+$/, '') || '/'; } catch { return '/'; }
}
function segmentsOf(url) { return pathOf(url).split('/').filter(Boolean); }
function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } }

module.exports = {
  TRACKING_PARAMS, ASSET_EXT_RE,
  normalizeUrl, stripTrackingParams, normalizeInput,
  registrableHost, isInternal, canonicalKey, hasTrackingParams,
  isAssetUrl, isBinaryUrl, isPdfUrl, isFeedUrl,
  pathOf, segmentsOf, hostOf
};
