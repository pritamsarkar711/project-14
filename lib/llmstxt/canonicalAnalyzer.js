'use strict';

/*
 * LLMs.txt Generator — canonical URL analysis.
 * Prefers the canonical URL when a page declares a different one, and flags
 * non-canonical duplicates for exclusion (unless the user overrides).
 */

const { canonicalKey, isInternal } = require('./urlNormalizer');

function canonicalDecision(page, rootUrl, includeSubdomains) {
  const selfKey = canonicalKey(page.url);
  if (!page.canonical) {
    return { canonical: page.url, canonicalized: false, reason: null };
  }
  const canKey = canonicalKey(page.canonical);
  if (canKey === selfKey) {
    return { canonical: page.canonical, canonicalized: false, reason: null };
  }
  if (!isInternal(page.canonical, rootUrl, includeSubdomains)) {
    return { canonical: page.url, canonicalized: true, reason: 'Canonical points to an external URL' };
  }
  return { canonical: page.canonical, canonicalized: true, reason: 'Canonical points to another URL' };
}

module.exports = { canonicalDecision };
