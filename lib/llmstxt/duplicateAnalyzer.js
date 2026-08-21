'use strict';

/*
 * LLMs.txt Generator — duplicate detection + deduplication.
 * Detects duplicates caused by query parameters, trailing slashes, fragments,
 * duplicate paths, canonical URLs and tracking parameters. The first occurrence
 * wins; later occurrences are excluded with an accurate reason.
 */

const { canonicalKey, hasTrackingParams } = require('./urlNormalizer');

function classifyDuplicate(p, winner) {
  if (hasTrackingParams(p.url) || hasTrackingParams(p.requestedUrl || p.url)) return 'Tracking parameters';
  return 'Duplicate URL';
}

function dedupePages(pages) {
  const seen = new Map();
  for (const p of pages) {
    // Canonicalized pages are already excluded with an accurate non-canonical
    // reason; never let them win a key or overwrite a canonical target's slot.
    if (p.canonicalized) continue;
    const k = canonicalKey(p.canonical || p.url);
    if (seen.has(k)) {
      const winner = seen.get(k);
      p.duplicateOf = winner.url;
      p.included = false;
      p.statusNote = p.statusNote || 'excluded';
      p.excludeReason = 'Duplicate';
      p.reason = 'Excluded: ' + classifyDuplicate(p, winner);
    } else {
      seen.set(k, p);
    }
  }
  return pages;
}

module.exports = { dedupePages, classifyDuplicate };
