'use strict';

/**
 * Anchor Link Validation
 * Supports /page#pricing
 * Checks whether id="pricing" or valid anchor target exists.
 */

function extractAnchorsFromHtml(html) {
  html = String(html || '');
  const ids = new Set();
  // id="..."
  const reId = /\bid\s*=\s*(?:\"([^\"]+)\"|'([^']+)'|([^\s>]+))/gi;
  let m;
  while ((m = reId.exec(html))) {
    const id = (m[1] || m[2] || m[3] || '').trim();
    if (id) ids.add(id);
  }
  // name="..." for <a name>
  const reName = /<a\b[^>]*\bname\s*=\s*(?:\"([^\"]+)\"|'([^']+)'|([^\s>]+))/gi;
  while ((m = reName.exec(html))) {
    const name = (m[1] || m[2] || m[3] || '').trim();
    if (name) ids.add(name);
  }
  return ids;
}

function checkAnchor(html, fragment) {
  if (!fragment) return { exists: true, reason: 'no fragment' };
  const anchors = extractAnchorsFromHtml(html);
  // Direct match
  if (anchors.has(fragment)) return { exists: true, reason: `found id="${fragment}"` };
  // Case-insensitive? HTML ids are case-sensitive, but we check case-insensitive as fallback
  const lower = fragment.toLowerCase();
  for (const id of anchors) {
    if (id.toLowerCase() === lower) return { exists: true, reason: `found id (case-insensitive) "${id}"` };
  }
  // Check for encoded fragment
  try {
    const decoded = decodeURIComponent(fragment);
    if (anchors.has(decoded)) return { exists: true, reason: `found decoded id="${decoded}"` };
  } catch {}
  return { exists: false, reason: `Anchor target not found: #${fragment}`, availableAnchors: Array.from(anchors).slice(0, 50) };
}

async function validateAnchorLink(destinationUrl, fragment, fetchFn, opts = {}) {
  // destinationUrl without fragment
  if (!fragment) return { valid: true, type: 'no_fragment' };
  try {
    // Fetch destination page
    const res = await fetchFn(destinationUrl, { ...opts, maxBytes: 1 * 1024 * 1024 });
    if (res.status < 200 || res.status >= 400) {
      return { valid: false, type: 'page_unavailable', reason: `Destination page returned ${res.status}`, status: res.status };
    }
    const check = checkAnchor(res.body, fragment);
    return {
      valid: check.exists,
      type: check.exists ? 'anchor_ok' : 'broken_anchor',
      reason: check.reason,
      fragment,
      destinationUrl,
      status: res.status
    };
  } catch (e) {
    return { valid: false, type: 'unable_to_verify', reason: `Could not fetch destination for anchor check: ${e.message}`, error: e.message };
  }
}

module.exports = { extractAnchorsFromHtml, checkAnchor, validateAnchorLink };
