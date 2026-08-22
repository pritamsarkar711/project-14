'use strict';

/*
 * LLMs.txt Generator, internal quality score (0–100).
 * The tool's own assessment from measurable factors. Explicitly NOT a Google
 * score, NOT an official OpenAI score, and NOT a ranking/visibility guarantee.
 */

const { clamp, round } = require('../wptheme/util');

function scoreQuality({ included, validation, stats, site }) {
  const pages = included || [];
  const n = pages.length;

  // 1. Valid URLs / broken URLs.
  const broken = pages.filter(p => p.broken).length;
  const brokenPct = n ? broken / n : 0;
  const validUrlScore = Math.max(0, 25 - Math.round(brokenPct * 250));

  // 2. Duplicate percentage.
  const dupes = pages.filter(p => p.duplicateOf).length;
  const dupePct = n ? dupes / n : 0;
  const dupeScore = Math.max(0, 10 - Math.round(dupePct * 100));

  // 3. Metadata completeness (title + description presence).
  const withTitle = pages.filter(p => p.title || p.userTitle).length;
  const withDesc = pages.filter(p => (p.description && p.description.length >= 20) || (p.userDescription && p.userDescription.length >= 10)).length;
  const metaScore = n ? Math.round(((withTitle / n) * 10) + ((withDesc / n) * 10)) : 0;

  // 4. Description quality (average length of non-empty descriptions).
  const descs = pages.map(p => p.userDescription != null ? p.userDescription : p.description).filter(d => d && d.length > 0);
  const avgLen = descs.length ? descs.reduce((a, d) => a + d.length, 0) / descs.length : 0;
  const descQuality = avgLen >= 40 ? 10 : avgLen >= 20 ? 7 : avgLen >= 10 ? 4 : 0;

  // 5. Important-page coverage (homepage + about present in output).
  const cats = new Set(pages.map(p => p.category));
  const hasHome = pages.some(p => p.category === 'Home');
  const hasAbout = cats.has('About') || pages.some(p => /about/i.test(p.title || ''));
  const coverage = (hasHome ? 10 : 0) + (hasAbout ? 5 : 0);

  // 6. Category organisation (distinct sections, not one giant list).
  const sections = (validation && validation.stats && validation.stats.sections) || 0;
  const organization = sections >= 3 ? 10 : sections === 2 ? 7 : sections === 1 ? 4 : 0;

  // 7. Canonical consistency (non-canonical pages excluded from output).
  const nonCanonical = pages.filter(p => p.canonicalized).length;
  const canonicalScore = n ? Math.max(0, 10 - Math.round((nonCanonical / n) * 50)) : 10;

  // 8. Crawl completeness (the crawl produced a usable curated set).
  const discovered = (stats && stats.pagesDiscovered) || n;
  const completeness = discovered >= 20 ? 10 : discovered >= 10 ? 7 : discovered >= 3 ? 4 : 2;

  const total = validUrlScore + dupeScore + metaScore + descQuality + coverage + organization + canonicalScore + completeness;
  return clamp(Math.round(total), 0, 100);
}

module.exports = { scoreQuality };
