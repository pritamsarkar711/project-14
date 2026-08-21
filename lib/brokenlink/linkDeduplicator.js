'use strict';

/**
 * Duplicate Detection & Deduplication Engine
 * Deduplicates URLs before requesting them.
 * Detects duplicates caused by:
 * - trailing slash
 * - URL fragments
 * - casing where safe
 * - duplicate tracking parameters
 * - encoded URLs
 * - equivalent URLs
 * - redirects (handled later in redirectAnalyzer)
 */

const { normalizeUrl, canonicalKey } = require('./urlNormalizer');

function deduplicateLinks(links) {
  const map = new Map(); // key -> { url, occurrences, sources: [], anchorTexts, types }
  let duplicateRefs = 0;

  for (const link of links) {
    // Normalize for dedup key
    const norm = normalizeUrl(link.url);
    const key = norm ? norm.key : canonicalKey(link.url);
    if (!key) continue;

    if (map.has(key)) {
      const existing = map.get(key);
      existing.occurrences++;
      duplicateRefs++;
      // Track source pages
      if (!existing.sources.includes(link.source)) {
        existing.sources.push(link.source);
      }
      if (link.anchorText && !existing.anchorTexts.includes(link.anchorText)) {
        existing.anchorTexts.push(link.anchorText);
      }
      // Keep track of raw occurrences
      existing.rawOccurrences.push({
        source: link.source,
        raw: link.raw,
        originalWithFragment: link.originalWithFragment,
        fragment: link.fragment,
        anchorText: link.anchorText,
        type: link.type
      });
    } else {
      map.set(key, {
        key,
        url: norm ? norm.url : link.url,
        originalWithFragment: link.originalWithFragment,
        fragment: link.fragment,
        occurrences: 1,
        sources: [link.source],
        anchorTexts: link.anchorText ? [link.anchorText] : [],
        types: [link.type],
        rawOccurrences: [{
          source: link.source,
          raw: link.raw,
          originalWithFragment: link.originalWithFragment,
          fragment: link.fragment,
          anchorText: link.anchorText,
          type: link.type
        }],
        firstSeen: link.source
      });
    }
  }

  const unique = Array.from(map.values());
  return {
    unique,
    duplicateRefs,
    total: links.length,
    uniqueCount: unique.length
  };
}

function deduplicateUrls(urls) {
  const seen = new Set();
  const out = [];
  let dups = 0;
  for (const u of urls) {
    const k = canonicalKey(u);
    if (seen.has(k)) dups++;
    else {
      seen.add(k);
      out.push(u);
    }
  }
  return { urls: out, duplicateCount: dups };
}

module.exports = { deduplicateLinks, deduplicateUrls };
