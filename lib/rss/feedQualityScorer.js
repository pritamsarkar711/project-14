'use strict';

/*
 * RSS Feed Generator — quality score.
 * A transparent 0–100 tool-generated score. Every component is computed from
 * real scan/generation data and the full breakdown is returned so the UI can
 * show exactly how the number was built. This is never presented as a
 * Google or official score.
 */

function pct(n, d) { return d > 0 ? n / d : 1; }

/**
 * @param {object} data {
 *   validation: {valid, errors},
 *   items: [{link, title, description, pubDate, canonical, type, hasContent}],
 *   stats: {duplicatesRemoved, brokenExcluded, missingDates, pagesCrawled, contentPages}
 * }
 */
function scoreFeed(data) {
  const items = data.items || [];
  const n = items.length;
  const components = [];

  const add = (name, earned, max, note) => components.push({ name, earned: Math.round(earned * 10) / 10, max, note });

  // 1. XML validity (20)
  const valid = !!(data.validation && data.validation.valid);
  add('XML validity', valid ? 20 : 0, 20, valid ? 'Generated XML passed all structural checks' : 'Validation reported ' + ((data.validation && data.validation.errors.length) || 0) + ' issue(s)');

  // 2. URL validity (15)
  let abs = 0;
  for (const it of items) { try { const x = new URL(it.link); if (/^https?:$/.test(x.protocol)) abs++; } catch {} }
  add('URL validity', 15 * pct(abs, n), 15, abs + '/' + n + ' item links are absolute http(s) URLs');

  // 3. Item completeness (15)
  let complete = 0;
  for (const it of items) {
    let f = 0;
    if (it.title) f += 0.4;
    if (it.link) f += 0.3;
    if (it.description) f += 0.3;
    complete += f;
  }
  add('Item completeness', 15 * pct(complete, n), 15, Math.round(100 * pct(complete, n)) + '% of title/link/description fields present');

  // 4. Publication-date coverage (15) — reliable dates only.
  const withDate = items.filter(i => i.pubDate && i.dateReliable !== false).length;
  const withAnyDate = items.filter(i => i.pubDate).length;
  add('Publication dates', 15 * pct(withDate, n), 15, withDate + '/' + n + ' items have a reliable publication date (' + withAnyDate + ' with any date)');

  // 5. Duplicate rate (10)
  const dups = (data.stats && data.stats.duplicatesRemoved) || 0;
  const dupScore = n + dups > 0 ? 10 * (n / (n + dups)) : 10;
  add('Duplicates removed', dupScore, 10, dups + ' duplicate(s) removed before generation');

  // 6. Broken URL rate (10)
  const broken = (data.stats && data.stats.brokenExcluded) || 0;
  const brokenScore = n + broken > 0 ? 10 * (n / (n + broken)) : 10;
  add('Broken URLs excluded', brokenScore, 10, broken + ' broken URL(s) excluded before generation');

  // 7. Canonical consistency (10)
  const canon = items.filter(i => i.canonical && i.link && i.canonical === i.link).length;
  add('Canonical consistency', 10 * pct(canon, n), 10, canon + '/' + n + ' item links match their canonical URL');

  // 8. Content relevance (5)
  const relevant = items.filter(i => i.feedable !== false && (i.hasContent !== false)).length;
  add('Content relevance', 5 * pct(relevant, n), 5, relevant + '/' + n + ' items are classified content (article/post/guide/news)');

  let total = 0;
  for (const c of components) total += c.earned;
  total = Math.max(0, Math.min(100, Math.round(total)));
  return {
    score: n ? total : 0,
    components,
    label: 'Tool-generated RSS quality score',
    note: 'Computed from this scan: XML validity, URL validity, item completeness, date coverage, duplicate rate, broken-URL rate, canonical consistency and content relevance. Not a Google or official score.'
  };
}

module.exports = { scoreFeed };
