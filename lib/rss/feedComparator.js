'use strict';

/*
 * RSS Feed Generator, existing-feed comparison.
 * Compares the parsed existing feed against the generated items:
 *  - item counts
 *  - duplicate items (same normalised link/guid)
 *  - articles present in one but missing from the other
 *  - metadata differences for shared items (title/description/date)
 * Deterministic set comparison on normalised URLs.
 */

const { canonicalKey } = require('../llmstxt/urlNormalizer');

function keyOf(item) {
  const k = canonicalKey(item.guid && item.guid !== item.link ? item.guid : (item.link || ''));
  return k || canonicalKey(item.link || '');
}

function normTitle(t) {
  return String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * @param {Array} existingItems parsed existing feed items
 * @param {Array} generatedItems generated item objects {link, guid, title, description, pubDate}
 */
function compareFeeds(existingItems, generatedItems) {
  const ex = (existingItems || []).filter(i => i.link);
  const gen = (generatedItems || []).filter(i => i.link);

  const exKeys = new Map();
  for (const i of ex) { const k = keyOf(i); if (k && !exKeys.has(k)) exKeys.set(k, i); }
  const genKeys = new Map();
  for (const i of gen) { const k = keyOf(i); if (k && !genKeys.has(k)) genKeys.set(k, i); }

  const duplicates = [];
  const metadataDiffs = [];
  for (const [k, g] of genKeys) {
    const e = exKeys.get(k);
    if (!e) continue;
    duplicates.push({ url: g.link, title: g.title || e.title });
    const diffs = [];
    if (normTitle(e.title) !== normTitle(g.title)) diffs.push('title');
    const ed = normTitle(String(e.description || '').replace(/<[^>]+>/g, ' '));
    const gd = normTitle(String(g.description || '').replace(/<[^>]+>/g, ' '));
    if (ed && gd && ed !== gd) diffs.push('description');
    if ((e.pubDate || '') !== (g.pubDate || '') && e.pubDate && g.pubDate) diffs.push('date');
    if (diffs.length) metadataDiffs.push({ url: g.link, title: g.title || e.title, diffs });
  }

  const missingFromGenerated = [...exKeys.keys()].filter(k => !genKeys.has(k)).map(k => exKeys.get(k)).slice(0, 50);
  const missingFromExisting = [...genKeys.keys()].filter(k => !exKeys.has(k)).map(k => genKeys.get(k)).slice(0, 50);

  return {
    existingCount: ex.length,
    generatedCount: gen.length,
    duplicates: { count: duplicates.length, items: duplicates.slice(0, 50) },
    missingFromGenerated: { count: missingFromGenerated.length, items: missingFromGenerated },
    missingFromExisting: { count: missingFromExisting.length, items: missingFromExisting },
    metadataDifferences: { count: metadataDiffs.length, items: metadataDiffs.slice(0, 50) }
  };
}

module.exports = { compareFeeds, keyOf };
