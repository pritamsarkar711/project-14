'use strict';

/*
 * RSS Feed Generator, duplicate detection.
 * Deterministic. Deduplicates by:
 *   1. normalised URL (tracking params, fragments, trailing slashes, www)
 *   2. canonical URL (preferred)
 *   3. identical normalised title + URL family (same host+path without slug
 *      query variants), catches the same article reachable via multiple
 *      category URLs
 * The earliest, most complete occurrence wins.
 */

const { canonicalKey, hasTrackingParams } = require('../llmstxt/urlNormalizer');

function normTitle(t) {
  return String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Deduplicate items in place.
 * Items are expected to have: url, canonical, title, reason?.
 * Marked duplicates get: duplicateOf, dupReason.
 * @returns {{removed: number, byUrl: number, byTitle: number}}
 */
function dedupeItems(items) {
  const seenUrl = new Map();   // canonicalKey → item
  const seenTitle = new Map(); // normTitle|pathStem → item
  let byUrl = 0, byTitle = 0;

  const stem = (u) => {
    try {
      const x = new URL(u);
      return x.host.replace(/^www\./, '') + (x.pathname.replace(/\/+$/, '') || '/').toLowerCase();
    } catch { return String(u).toLowerCase(); }
  };

  for (const it of items) {
    if (it._removed) continue;
    const k = canonicalKey(it.canonical || it.url);
    if (seenUrl.has(k)) {
      const winner = seenUrl.get(k);
      it.duplicateOf = winner.url;
      it.dupReason = hasTrackingParams(it.url) || hasTrackingParams(it.requestedUrl || it.url)
        ? 'Duplicate: tracking parameters'
        : (winner.canonical && winner.canonical !== it.url && canonicalKey(winner.canonical) === canonicalKey(it.canonical))
          ? 'Duplicate: same canonical URL'
          : 'Duplicate: same URL';
      it._removed = true;
      byUrl++;
      continue;
    }
    const t = normTitle(it.title);
    if (t) {
      const tk = t + '|' + stem(it.canonical || it.url).replace(/\/[^/]+$/, '/');
      const tw = seenTitle.get(tk);
      if (tw && !tw._removed) {
        // Same title, different URL in the same section → treat as duplicate
        // of the same article (e.g. /blog/x vs /category/news/x).
        it.duplicateOf = tw.url;
        it.dupReason = 'Duplicate: identical title';
        it._removed = true;
        byTitle++;
        continue;
      }
    }
    seenUrl.set(k, it);
    if (t) seenTitle.set(t + '|' + stem(it.canonical || it.url).replace(/\/[^/]+$/, '/'), it);
  }

  return { removed: byUrl + byTitle, byUrl, byTitle };
}

module.exports = { dedupeItems, normTitle };
