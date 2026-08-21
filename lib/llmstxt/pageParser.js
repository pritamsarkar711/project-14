'use strict';

/*
 * LLMs.txt Generator — HTML page parser + metadata extractor.
 * Deterministic regex/text extraction only (no DOM, no AI).
 *
 * Extracts: title, meta description, H1, H2s, canonical, noindex signal,
 * Open Graph fields, article/product structured data, publication/modified
 * dates, breadcrumbs, word count, internal links, PDF links, JSON-LD types,
 * and a JS-heaviness heuristic.
 */

const { normalizeUrl, isPdfUrl } = require('./urlNormalizer');

function attrAll(html, tag, attr) {
  const out = [];
  const re = new RegExp(`<${tag}\\b[^>]*?\\s${attr}=["']([^"']+)["'][^>]*>`, 'gi');
  let m;
  while ((m = re.exec(String(html || '')))) out.push(m[1]);
  return out;
}

function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function collapse(s) {
  return decodeEntities(String(s == null ? '' : s))
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(html) {
  return collapse(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));
}

/* Extract a specific meta tag by name/property (first match). */
function metaTag(html, key) {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<meta\\b(?=[^>]*(?:name|property)=["']${k}["'])(?=[^>]*content=["']([^"']*)["'])[^>]*>`, 'i');
  const m = String(html || '').match(re);
  return m ? collapse(m[1]) : '';
}

function titleOf(html) {
  const m = String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return m ? collapse(m[1]) : '';
}

function headingOf(html, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(String(html || '')))) { const t = collapse(stripTags(m[1])); if (t) out.push(t); }
  return out;
}

function canonicalOf(html, base) {
  const can = String(html || '').match(/<link\b(?=[^>]*rel=["'][^"']*canonical[^"']*["'])(?=[^>]*href=["']([^"']+)["'])[^>]*>/i);
  if (can) return normalizeUrl(can[1], base);
  return null;
}

function robotsMetaSignals(html) {
  const signals = [];
  const re = /<meta\b(?=[^>]*(?:name|property)=["']robots["'])(?=[^>]*content=["']([^"']+)["'])[^>]*>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) signals.push(m[1].toLowerCase());
  return signals;
}

function jsonLdTypes(html) {
  const types = new Set();
  const re = /<script\b(?=[^>]*type=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const block = m[1].trim();
    // Try the whole block, then each balanced top-level object.
    const candidates = [block];
    const objRe = /\{[\s\S]*?\}(?=\s*,?\s*(\{|$))/g;
    let mm;
    while ((mm = objRe.exec(block))) candidates.push(mm[0]);
    for (const c of candidates) {
      try {
        const j = JSON.parse(c);
        const collect = (v) => {
          if (!v || typeof v !== 'object') return;
          if (v['@type']) {
            const t = Array.isArray(v['@type']) ? v['@type'] : [v['@type']];
            for (const x of t) if (typeof x === 'string') types.add(x.toLowerCase());
          }
          if (v['@graph'] && Array.isArray(v['@graph'])) for (const g of v['@graph']) collect(g);
        };
        collect(j);
      } catch {}
    }
  }
  return [...types];
}

function jsonLdField(html, type, field) {
  const re = /<script\b(?=[^>]*type=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    try {
      const j = JSON.parse(m[1].trim());
      const find = (v) => {
        if (!v || typeof v !== 'object') return null;
        const t = (Array.isArray(v['@type']) ? v['@type'] : [v['@type']]).map(x => String(x || '').toLowerCase());
        if (t.includes(type) && v[field] != null) return v[field];
        if (v['@graph'] && Array.isArray(v['@graph'])) for (const g of v['@graph']) { const r = find(g); if (r) return r; }
        return null;
      };
      const r = find(j);
      if (r) return typeof r === 'string' ? collapse(r) : r;
    } catch {}
  }
  return null;
}

function breadcrumbsOf(html) {
  // Prefer JSON-LD BreadcrumbList.
  const re = /<script\b(?=[^>]*type=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    try {
      const j = JSON.parse(m[1].trim());
      const find = (v) => {
        if (!v || typeof v !== 'object') return null;
        const t = (Array.isArray(v['@type']) ? v['@type'] : [v['@type']]).map(x => String(x || '').toLowerCase());
        if (t.includes('breadcrumblist') && Array.isArray(v.itemListElement)) {
          return v.itemListElement.map(it => collapse(it.name || (it.item && it.item.name) || '')).filter(Boolean);
        }
        if (v['@graph'] && Array.isArray(v['@graph'])) for (const g of v['@graph']) { const r = find(g); if (r) return r; }
        return null;
      };
      const r = find(j);
      if (r) return r;
    } catch {}
  }
  // HTML breadcrumbs.
  const nav = String(html || '').match(/<nav\b[^>]*(?:aria-label=["'][^"']*breadcrumb[^"']*["']|class=["'][^"']*breadcrumb[^"']*["'])[^>]*>([\s\S]*?)<\/nav>/i)
    || String(html || '').match(/<(?:ol|ul)\b[^>]*class=["'][^"']*breadcrumb[^"']*["'][^>]*>([\s\S]*?)<\/(?:ol|ul)>/i);
  if (nav) {
    const items = [...nav[1].matchAll(/<(?:li|span)\b[^>]*>([\s\S]*?)<\/(?:li|span)>/gi)].map(x => collapse(stripTags(x[1]))).filter(Boolean);
    if (items.length) return items;
  }
  return [];
}

/* Visible body text for word count + description generation. */
function visibleText(html) {
  const doc = String(html || '');
  let region = doc;
  const main = doc.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (main) region = main[1];
  const art = region.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (art) region = art[1];
  // Drop boilerplate regions.
  region = region
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<(form|button)[\s\S]*?<\/(form|button)>/gi, ' ')
    .replace(/<(script|style|noscript)[\s\S]*?<\/(script|style|noscript)>/gi, ' ');
  return stripTags(region);
}

/* Meaningful paragraph candidates (for deterministic descriptions). */
function paragraphCandidates(html) {
  const doc = String(html || '');
  let region = doc;
  const main = doc.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (main) region = main[1];
  const art = region.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (art) region = art[1];
  region = region
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<(script|style|noscript)[\s\S]*?<\/(script|style|noscript)>/gi, ' ');
  const ps = [...region.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(x => collapse(stripTags(x[1]))).filter(t => t.length >= 25);
  if (ps.length) return ps;
  // No <p> tags: use sentence runs from the visible text.
  const text = stripTags(region);
  const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length >= 25 && s.length <= 400);
  return sentences;
}

function wordCountOf(text) {
  const w = String(text || '').trim().match(/[\p{L}\p{N}'-]+/gu);
  return w ? w.length : 0;
}

/* Extract <a> elements with anchor text + nav/footer context. */
function linkObjectsOf(html, base) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const attrs = m[1] || '';
    const href = (attrs.match(/href\s*=\s*["']([^"']+)["']/i) || attrs.match(/href\s*=\s*([^\s>]+)/i) || [])[1];
    if (!href) continue;
    const n = normalizeUrl(href, base);
    if (!n) continue;
    // Determine whether the anchor sits inside <nav> or <footer> by scanning backwards.
    const before = String(html || '').slice(0, Math.max(0, m.index));
    const openNav = (before.match(/<nav\b[^>]*>/gi) || []).length;
    const closeNav = (before.match(/<\/nav>/gi) || []).length;
    const openFooter = (before.match(/<footer\b[^>]*>/gi) || []).length;
    const closeFooter = (before.match(/<\/footer>/gi) || []).length;
    const nav = openNav > closeNav;
    const footer = openFooter > closeFooter;
    const text = collapse(stripTags(m[2])).slice(0, 120);
    out.push({ url: n, text, nav, footer });
  }
  return out;
}

function parsePage(html, base, headers = {}) {
  html = String(html || '');
  const links = [];
  attrAll(html, 'a', 'href').forEach(h => { const n = normalizeUrl(h, base); if (n) links.push(n); });
  attrAll(html, 'link', 'href').forEach(h => { const n = normalizeUrl(h, base); if (n) links.push(n); });

  const linkObjects = linkObjectsOf(html, base);

  const pdfLinks = [];
  attrAll(html, 'a', 'href').forEach(h => { const n = normalizeUrl(h, base); if (n && isPdfUrl(n)) pdfLinks.push(n); });

  const title = titleOf(html);
  const metaDescription = metaTag(html, 'description');
  const ogTitle = metaTag(html, 'og:title');
  const ogDescription = metaTag(html, 'og:description');
  const ogType = metaTag(html, 'og:type');
  const ogSiteName = metaTag(html, 'og:site_name');
  const canonical = canonicalOf(html, base);
  const robotsMeta = robotsMetaSignals(html);
  const noindex = robotsMeta.some(v => /noindex/.test(v));
  const h1 = headingOf(html, 'h1');
  const h2 = headingOf(html, 'h2').slice(0, 20);
  const types = jsonLdTypes(html);
  const breadcrumbs = breadcrumbsOf(html);
  const text = visibleText(html);
  const wordCount = wordCountOf(text);
  const paragraphs = paragraphCandidates(html);

  const publishedDate = collapse(metaTag(html, 'article:published_time') || metaTag(html, 'og:article:published_time') || String(jsonLdField(html, 'article', 'datePublished') || jsonLdField(html, 'newsarticle', 'datePublished') || jsonLdField(html, 'blogposting', 'datePublished') || ''));
  const modifiedDate = collapse(metaTag(html, 'article:modified_time') || metaTag(html, 'og:article:modified_time') || String(jsonLdField(html, 'article', 'dateModified') || jsonLdField(html, 'newsarticle', 'dateModified') || jsonLdField(html, 'blogposting', 'dateModified') || ''));

  const noScript = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const bodyText = stripTags(noScript);
  const jsHeavy = bodyText.length < 250 && /<script\b/i.test(html);

  return {
    links: [...new Set(links)],
    linkObjects,
    pdfLinks: [...new Set(pdfLinks)],
    title,
    metaDescription,
    ogTitle,
    ogDescription,
    ogType,
    ogSiteName,
    canonical,
    noindex,
    robotsMeta,
    h1: h1[0] || '',
    h2,
    types,
    breadcrumbs,
    text,
    wordCount,
    paragraphs,
    publishedDate,
    modifiedDate,
    jsHeavy
  };
}

module.exports = { parsePage, collapse, stripTags, metaTag, titleOf, jsonLdField, jsonLdTypes, breadcrumbsOf, paragraphCandidates, wordCountOf, visibleText, decodeEntities };
