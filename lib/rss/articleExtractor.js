'use strict';

/*
 * RSS Feed Generator, article metadata extraction.
 * Deterministic, priority-based extraction from raw HTML:
 *
 *   Title:       JSON-LD headline → Open Graph title → <title> → H1
 *   Description: meta description → Open Graph description → first
 *                meaningful paragraph (cleaned; never fabricated)
 *   Date:        structured data datePublished → article:published_time →
 *                <time datetime> → visible publication line → (sitemap
 *                lastmod handled upstream, always marked fallback)
 *   Author:      JSON-LD author → article:author → rel=author link →
 *                meta name=author (no author = null, never invented)
 *   Image:       og:image → JSON-LD image → first content image
 *   Content:     sanitized article/main HTML (full content)
 *
 * Uses the shared llms.txt page parser for base signals, then reads the
 * raw HTML for the article-specific fields it needs.
 */

const { parsePage, metaTag, collapse, stripTags, titleOf, jsonLdField, breadcrumbsOf } = require('../llmstxt/pageParser');
const { normalizeUrl } = require('../llmstxt/urlNormalizer');
const { sanitizeHtml, cleanDescription } = require('./contentSanitizer');
const { parseDate } = require('./dateExtractor');

const ARTICLE_JSONLD_TYPES = ['newsarticle', 'blogposting', 'article', 'techarticle', 'review', 'report', 'howto', 'tutorial'];

function jsonLdFieldMulti(html, field) {
  const re = /<script\b(?=[^>]*type=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    try {
      const j = JSON.parse(m[1].trim());
      const find = (v) => {
        if (!v || typeof v !== 'object') return null;
        const t = (Array.isArray(v['@type']) ? v['@type'] : [v['@type']]).map(x => String(x || '').toLowerCase());
        if (t.some(x => ARTICLE_JSONLD_TYPES.includes(x)) && v[field] != null) return v[field];
        if (v['@graph'] && Array.isArray(v['@graph'])) for (const g of v['@graph']) { const r = find(g); if (r) return r; }
        return null;
      };
      const r = find(j);
      if (r != null) return r;
    } catch {}
  }
  return null;
}

/* JSON-LD author → display name (handles string, object, array, Person/Organization). */
function jsonLdAuthorName(v) {
  if (v == null) return null;
  if (typeof v === 'string') return collapse(v) || null;
  if (Array.isArray(v)) { for (const x of v) { const n = jsonLdAuthorName(x); if (n) return n; } return null; }
  if (typeof v === 'object') {
    const n = v.name;
    if (typeof n === 'string' && n.trim()) return collapse(n);
  }
  return null;
}

function jsonLdImage(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) { for (const x of v) { const u = jsonLdImage(x); if (u) return u; } return null; }
  if (typeof v === 'object') {
    if (typeof v.url === 'string') return v.url;
    if (typeof v['@id'] === 'string' && /^https?:/.test(v['@id'])) return v['@id'];
  }
  return null;
}

/* The article region: <article> if present, else <main>, else <body>. */
function articleRegion(html) {
  const doc = String(html || '');
  let region = doc;
  const art = doc.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (art) region = art[1];
  else {
    const main = doc.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
    if (main) region = main[1];
  }
  return region;
}

/* First meaningful paragraph inside the article region. */
function firstParagraph(html) {
  const region = articleRegion(html);
  const ps = [...region.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(x => collapse(stripTags(x[1])))
    .filter(t => t.length >= 40);
  if (ps.length) return ps[0];
  const text = stripTags(region);
  const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length >= 40 && s.length <= 500);
  return sentences[0] || '';
}

/* Visible "Published on …" / "Posted …" line near the top of the article. */
function visiblePublishedDate(html) {
  const region = articleRegion(html);
  const head = stripTags(region).slice(0, 1500);
  const m = head.match(/(?:published|posted|updated|date)\s*(?:on|:)?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?\s+\d{4}|\d{4}-\d{2}-\d{2})/i);
  if (m) {
    const d = parseDate(m[1], 'visible');
    if (d) return { raw: m[1], ...d };
  }
  return null;
}

/* <time datetime="..."> candidates in the article region. */
function timeDatetime(html) {
  const region = articleRegion(html);
  const re = /<time\b[^>]*datetime\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(region))) {
    const d = parseDate(m[1], 'time-datetime');
    if (d) return { raw: m[1], ...d };
  }
  return null;
}

/* rel=author link or author link text inside the article region. */
function authorLink(html) {
  const region = articleRegion(html);
  const re = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
  let m;
  while ((m = re.exec(region))) {
    const tag = m[0];
    const rel = (tag.match(/rel\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    if (/author/i.test(rel)) {
      const text = collapse(stripTags(tag));
      if (text && text.length < 80 && !/^(home|menu|skip|login|sign)/i.test(text)) return text;
    }
  }
  // /author/<slug> or /by/<slug> links with human-looking text
  const m2 = region.match(/<a\b[^>]*href\s*=\s*["'][^"']*(?:\/author\/|\/by\/)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
  if (m2) {
    const text = collapse(stripTags(m2[1]));
    if (text && text.length >= 2 && text.length < 80 && /\s/.test(text) && !/^(home|blog|news)/i.test(text)) return text;
  }
  return null;
}

/* First content image in the article region (skip icons/pixels/trackers). */
function contentImage(html, base) {
  const region = articleRegion(html);
  const re = /<img\b[^>]*>/gi;
  let m;
  while ((m = re.exec(region))) {
    const tag = m[0];
    const src = (tag.match(/(?:src|data-src)\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!src) continue;
    const u = normalizeUrl(src, base);
    if (!u) continue;
    if (/(1x1|pixel|spacer|tracking|beacon|sprite|icon|logo|favicon|data:image)/i.test(u)) continue;
    return u;
  }
  return null;
}

/* Audio media URL (podcast mode only; detected, never invented). */
function audioUrl(html, base) {
  const region = articleRegion(html);
  const src = region.match(/<(?:audio|source)\b[^>]*src\s*=\s*["']([^"']+)["']/i);
  if (src) { const u = normalizeUrl(src[1], base); if (u) return u; }
  const json = jsonLdFieldMulti(html, 'url');
  if (json && /\.(mp3|m4a|aac|ogg|wav)([?#]|$)/i.test(String(json))) {
    const u = normalizeUrl(String(json), base);
    if (u) return u;
  }
  return null;
}

/*
 * Extract full article metadata from raw HTML.
 * @returns an object with keys:
 *   baseTitle, ogTitle, metaTitle, h1, headline,
 *   metaDescription, ogDescription, firstParagraph,
 *   dates: { structured, meta, time, visible } (parsed or raw),
 *   author, image, articleHtml (sanitized), wordCount, breadcrumbs,
 *   articleSection, canonical
 */
function extractArticle(html, base, parsed = null) {
  html = String(html || '');
  const p = parsed || parsePage(html, base);

  const headline = jsonLdFieldMulti(html, 'headline') || null;
  const ogTitle = p.ogTitle || '';
  const titleTag = titleOf(html) || p.title || '';
  const h1 = p.h1 || '';

  const metaDescription = p.metaDescription || '';
  const ogDescription = p.ogDescription || '';
  const firstPara = firstParagraph(html);

  // Dates with explicit source labels.
  const structuredRaw = String(jsonLdField(html, 'article', 'datePublished') || jsonLdField(html, 'newsarticle', 'datePublished') || jsonLdField(html, 'blogposting', 'datePublished') || '');
  const metaRaw = collapse(metaTag(html, 'article:published_time') || metaTag(html, 'og:article:published_time'));
  const timeInfo = timeDatetime(html);
  const visibleInfo = visiblePublishedDate(html);

  // Author (never fabricated).
  const authorRaw = jsonLdAuthorName(jsonLdFieldMulti(html, 'author'))
    || collapse(metaTag(html, 'article:author'))
    || authorLink(html)
    || collapse(metaTag(html, 'author'))
    || null;

  // Image.
  let image = collapse(metaTag(html, 'og:image') || metaTag(html, 'og:image:url') || metaTag(html, 'twitter:image'));
  if (!image) {
    const j = jsonLdFieldMulti(html, 'image') || jsonLdField(html, 'newsarticle', 'image') || jsonLdField(html, 'blogposting', 'image');
    image = jsonLdImage(j);
  }
  if (image) image = normalizeUrl(image, base);
  if (!image) image = contentImage(html, base);

  // Article section / category from structured data first.
  const articleSection = collapse(String(jsonLdFieldMulti(html, 'articleSection') || '')) || null;

  // Sanitized full content (region only).
  const regionHtml = articleRegion(html);
  const articleHtml = sanitizeHtml(regionHtml.replace(/<(header|nav|aside|form|button)[\s\S]*?<\/(header|nav|aside|form|button)>/gi, ' '));

  return {
    base: p,
    headline, ogTitle, titleTag, h1,
    metaDescription, ogDescription, firstParagraph: firstPara,
    structuredRaw, metaRaw,
    timeInfo, visibleInfo,
    author: authorRaw,
    image,
    articleSection,
    articleHtml,
    wordCount: p.wordCount || 0,
    breadcrumbs: p.breadcrumbs || [],
    canonical: p.canonical || null,
    noindex: !!p.noindex,
    audioUrl: audioUrl(html, base)
  };
}

/* Apply the title priority: JSON-LD headline → OG → <title> → H1.
 * Strips a trailing " | SiteName" suffix from <title> when it exactly
 * matches the known site name (deterministic, no guessing). */
function pickTitle(x, siteName) {
  let t = (x.headline || x.ogTitle || x.titleTag || x.h1 || '').trim();
  if (t && siteName) {
    const site = String(siteName).trim();
    const re = new RegExp('\\s*[|•>–—-]\\s*' + site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i');
    if (re.test(t)) t = t.replace(re, '').trim();
  }
  return collapse(t);
}

/* Apply the description priority. Never returns invented text. */
function pickDescription(x, opts = {}) {
  const raw = x.metaDescription || x.ogDescription || x.firstParagraph || '';
  return cleanDescription(raw, opts);
}

/*
 * Pick the best publication date by priority.
 * Returns { date, iso, source, reliable } or null.
 * Sitemap lastmod is only applied here when the caller explicitly passes
 * `fallback` (always labelled reliable=false).
 */
function pickDate(x, fallbackRaw) {
  const candidates = [
    ['structured-data', x.structuredRaw],
    ['article-published-time', x.metaRaw],
    ['time-datetime', x.timeInfo && x.timeInfo.iso],
    ['visible-publication', x.visibleInfo && x.visibleInfo.iso]
  ];
  for (const [source, raw] of candidates) {
    if (!raw) continue;
    const d = parseDate(raw, source);
    if (d) return { date: d.date, iso: d.iso, source, reliable: d.reliable };
  }
  if (fallbackRaw) {
    const d = parseDate(fallbackRaw, 'sitemap-lastmod');
    if (d) return { date: d.date, iso: d.iso, source: 'sitemap-lastmod', reliable: d.reliable };
  }
  return null;
}

module.exports = { extractArticle, pickTitle, pickDescription, pickDate, jsonLdAuthorName, jsonLdImage, firstParagraph };
