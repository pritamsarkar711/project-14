'use strict';

/*
 * LLMs.txt Generator, deterministic relevance scoring (internal only).
 * Combines structural + content signals into a 0–100 relevance score used to
 * prioritise and rank URLs. Not exposed to users as fake precision.
 */

const { clamp } = require('../wptheme/util');

function titleQuality(title) {
  const t = String(title || '').trim();
  if (!t) return 0;
  const len = t.length;
  if (len >= 10 && len <= 70) return 10;
  if (len >= 5 && len <= 140) return 5;
  return 2;
}

function metaCompleteness(p) {
  let n = 0;
  if (p.title) n++;
  if (p.metaDescription) n++;
  if (p.ogTitle || p.ogDescription) n++;
  if (p.canonical) n++;
  if (p.h1) n++;
  return Math.round((n / 5) * 10);
}

function cleanUrlBonus(url) {
  let u;
  try { u = new URL(url); } catch { return 0; }
  if (!u.search) return 5;
  // A few meaningful params are acceptable; many are a smell.
  const count = [...u.searchParams.keys()].length;
  return count <= 1 ? 3 : 0;
}

const CATEGORY_BIAS = {
  'Home': 40,
  'Documentation': 30,
  'Knowledge Base': 26,
  'Guides': 24,
  'Tutorials': 22,
  'Services': 22,
  'Products': 20,
  'Tools': 18,
  'FAQ': 16,
  'About': 16,
  'Contact': 12,
  'Resources': 12,
  'Blog': 12,
  'Other': 4
};

const CATEGORY_PENALTY = {
  'Categories': 20,
  'Authors': 20,
  'Tags': 40,
  'Utility': 45
};

function score(page) {
  let s = 0;

  // Homepage is always the most important.
  if (page.category === 'Home') return 100;

  // Depth: closer to the homepage ranks higher.
  const depth = Number(page.depth || 0);
  s += depth === 0 ? 25 : depth === 1 ? 18 : depth === 2 ? 10 : depth === 3 ? 6 : 3;

  // Link authority: pages referenced from many places matter.
  const inlinks = Number(page.inlinks || 0);
  if (inlinks >= 20) s += 18; else if (inlinks >= 10) s += 14; else if (inlinks >= 5) s += 10; else if (inlinks >= 2) s += 6; else s += 2;

  // Navigation presence.
  if (page.navLinked) s += 20;
  else if (page.footerLinked) s += 8;

  // Sitemap presence (webmasters consider these important).
  if (page.inSitemap) s += 10;

  // Title quality.
  s += titleQuality(page.title);

  // Content depth.
  const wc = Number(page.wordCount || 0);
  if (wc >= 800) s += 14; else if (wc >= 400) s += 11; else if (wc >= 200) s += 8; else if (wc >= 80) s += 5; else s += 1;

  // Heading structure.
  if (page.h1) s += 5;
  if ((page.h2 || []).length >= 2) s += 5;

  // Canonical self-consistency.
  if (page.canonical && !page.canonicalized) s += 4;

  // Clean URL.
  s += cleanUrlBonus(page.url);

  // Breadcrumbs (structured hierarchy signal).
  if ((page.breadcrumbs || []).length >= 2) s += 4;

  // Metadata completeness.
  s += metaCompleteness(page);

  // Category bias.
  s += CATEGORY_BIAS[page.category] || 0;

  // Negative signals.
  s -= CATEGORY_PENALTY[page.category] || 0;

  // Keep the homepage uniquely highest; cap other pages just below it.
  return clamp(Math.round(s), 0, 99);
}

/* Coarse human-facing priority derived from the internal score. */
function priorityBand(s) {
  if (s >= 80) return 'High';
  if (s >= 55) return 'Medium';
  return 'Low';
}

module.exports = { score, priorityBand, CATEGORY_BIAS, CATEGORY_PENALTY };
