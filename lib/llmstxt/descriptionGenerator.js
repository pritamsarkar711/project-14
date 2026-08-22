'use strict';

/*
 * LLMs.txt Generator, deterministic description generation (no LLM).
 *
 * Page description priority:
 *   1. meta description
 *   2. Open Graph description
 *   3. introductory paragraph
 *   4. first meaningful content paragraph
 *   5. cleaned page title
 *
 * Website (blockquote) description priority:
 *   1. homepage meta description
 *   2. homepage Open Graph description
 *   3. homepage introductory text
 *   4. site title
 *
 * Nothing is ever invented; descriptions only come from the page itself.
 */

const BOILERPLATE_RE = [
  /\b(accept|manage|reject all|allow all|cookie(s)? (settings|policy|consent)|we use cookies|cookie notice)\b/gi,
  /\b(skip to (main )?content|menu|close|search|subscribe to our newsletter|sign up for our newsletter)\b/gi,
  /\b(all rights reserved|copyright|©)\b/gi,
  /\b(this website uses cookies|by continuing to (use|browse) this site)\b/gi,
  /\b(privacy policy|terms of (service|use)|cookie policy)\b/gi
];

function stripBoilerplate(text) {
  let t = String(text || '');
  for (const re of BOILERPLATE_RE) t = t.replace(re, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

function clean(text) {
  return stripBoilerplate(String(text || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')).trim();
}

/* Trim to a sensible length on a sentence boundary. */
function truncate(text, max) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const last = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('; '));
  const out = last > max * 0.5 ? cut.slice(0, last + 1) : cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20));
  return (out.trim().endsWith('.') || out.trim().endsWith('!') || out.trim().endsWith('?')) ? out.trim() : out.trim() + '…';
}

/* A description is "usable" if it has enough real content and isn't boilerplate. */
function usable(desc, minLen) {
  const d = clean(desc);
  if (d.length < (minLen || 15)) return '';
  if (/^(cookie|this site uses|menu|skip to|loading|javascript|enable javascript)/i.test(d)) return '';
  return d;
}

function pageDescription(page) {
  const p = page || {};
  const sources = [
    usable(p.metaDescription),
    usable(p.ogDescription),
    firstMeaningfulParagraph(p),
    cleanedTitle(p)
  ];
  for (const s of sources) {
    if (s) return truncate(s, 200);
  }
  return '';
}

function firstMeaningfulParagraph(page) {
  const ps = (page.paragraphs || []).filter(t => {
    const c = clean(t);
    if (c.length < 40) return false;
    if (BOILERPLATE_RE.some(re => { re.lastIndex = 0; return re.test(c); })) return false;
    return true;
  });
  return ps.length ? ps[0] : '';
}

function cleanedTitle(page) {
  const t = clean(page.title || page.h1 || '');
  if (!t) return '';
  // Titles like "Home | Acme Inc" → keep the meaningful part only when it reads well.
  const parts = t.split(/\s+[|–—]\s+/).map(x => x.trim()).filter(Boolean);
  if (parts.length > 1 && parts[0].length >= 3) return parts[0];
  return t;
}

function websiteDescription(homePage, siteTitle) {
  const h = homePage || {};
  const candidates = [
    usable(h.metaDescription, 20),
    usable(h.ogDescription, 20),
    firstMeaningfulParagraph(h),
    clean(siteTitle || '')
  ];
  for (const c of candidates) if (c) return truncate(c, 220);
  return '';
}

module.exports = { pageDescription, websiteDescription, cleanedTitle, clean, truncate, usable, firstMeaningfulParagraph };
