'use strict';

/*
 * RSS Feed Generator — HTML content sanitizer.
 * Deterministic regex-based cleaning of extracted article HTML before it is
 * embedded (CDATA) in an RSS feed.
 *
 * Removes: script, style, iframe (unless explicitly allowed), forms, nav,
 * headers/footers, sidebars, cookie banners, ad containers, tracking
 * elements, event-handler attributes, javascript: URLs and unsafe markup.
 * Preserves: headings, paragraphs, lists, links, blockquotes, tables and
 * images (with safe src only).
 *
 * It never executes content and never injects new markup beyond the
 * preserved structure.
 */

const ALLOWED_TAGS = new Set(['h1','h2','h3','h4','h5','h6','p','br','hr','ul','ol','li','a','em','strong','b','i','u','s','sub','sup','blockquote','pre','code','figure','figcaption','table','thead','tbody','tr','td','th','img','span','div','section','article']);

function stripUnsafeUrls(url) {
  const s = String(url || '').trim();
  return /^(javascript|vbscript|data):/i.test(s.replace(/[\s\u0000-\u0020]+/g, '')) ? '' : s;
}

/* Remove whole elements (non-greedy; handles one level of same-tag nesting
 * by iterating until stable). */
function removeElements(html, tags) {
  let s = String(html || '');
  let prev;
  do {
    prev = s;
    for (const tag of tags) {
      s = s.replace(new RegExp('<' + tag + '\\b[^>]*>[\\s\\S]*?<\\/' + tag + '>', 'gi'), '');
    }
  } while (s !== prev);
  return s;
}

/* Identify likely ad / boilerplate containers by class/id and drop them. */
function removeBoilerplate(html) {
  let s = String(html || '');
  const classRe = /(?:class|id)\s*=\s*["']([^"']*)["']/gi;
  const patterns = [
    /\b(cookie|consent|gdpr|privacy)-?(banner|bar|notice|message|overlay)\b/i,
    /\b(sticky)?\s*nav(?:bar|igation)?\b/i,
    /\b(ad[s]?[-_ ]?(container|wrapper|unit|slot|space|banner)|adsbygoogle|ad-slot|ad-container|ad-wrapper|ad-break|advertisement|sponsor-slot)\b/i,
    /\b(tracking|pixel|gtag|analytics-code|fbq)\b/i,
    /\b(comment[s]?[-_ ]?(section|form|list|wrapper)|respond|reply-form)\b/i,
    /\b(share|social)[-_ ]?(bar|buttons|share|icons)\b/i,
    /\bnewsletter|subscribe[-_ ]?(form|box|widget)\b/i,
    /\b(related|recommended|trending|popular)[-_ ]?(posts?|articles?|widget|box)\b/i,
    /\bbreadcrumbs?\b/i,
    /\btoolbar|header-bar|footer[-_ ]?(widget|bar)\b/i
  ];
  let m;
  while ((m = classRe.exec(s))) {
    const val = m[1];
    if (patterns.some(p => p.test(val))) {
      // Remove the enclosing element that carries this class/id.
      const start = s.lastIndexOf('<', m.index);
      if (start > -1) {
        const tag = (s.slice(start, m.index).match(/<([a-z][a-z0-9]*)/i) || [])[1];
        if (tag && /div|section|aside|nav|form|ul|header|footer|span|article/i.test(tag)) {
          const closeIdx = s.search(new RegExp('<\\/' + tag + '\\b', 'i'));
          if (closeIdx > m.index) {
            s = s.slice(0, start) + s.slice(closeIdx);
            classRe.lastIndex = 0;
            break; // restart scan — content shifted
          }
        }
      }
    }
  }
  return s;
}

/**
 * Sanitize article HTML for feed embedding.
 * @param {string} html raw article HTML
 * @param {{allowIframe?: boolean, maxBytes?: number}} opts
 */
function sanitizeHtml(html, opts = {}) {
  let s = String(html == null ? '' : html);
  if (!s) return '';

  s = removeElements(s, ['script', 'style', 'noscript', 'form', 'input', 'button', 'select', 'textarea', 'label', 'iframe', 'object', 'embed', 'applet', 'video', 'audio', 'canvas', 'svg']);
  if (!opts.allowIframe) { /* iframes already removed */ }
  s = removeElements(s, ['nav', 'header', 'footer', 'aside']);
  s = removeBoilerplate(s);

  // Drop event handlers, on* attributes, and other unsafe attributes.
  s = s.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/\s+(style)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/\s+(formaction|autofocus|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // Neutralize javascript:/data: URLs in href/src.
  s = s.replace(/(href|src|action)\s*=\s*(["']?)\s*(?:javascript|vbscript|data):[^"'>\s]*\2/gi, '$1=$2#$2');
  // target="_blank" without rel is fine, but add noopener semantics by dropping target.
  s = s.replace(/\s+target\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // Keep only allowed tags; strip disallowed opening/closing tags.
  s = s.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*\/?>/gi, (m, tag) => {
    const t = tag.toLowerCase();
    if (ALLOWED_TAGS.has(t)) {
      if (/^<\//.test(m)) return '</' + t + '>';
      return m; // attributes already cleaned above
    }
    return '';
  });

  // Ensure images keep only safe attributes.
  s = s.replace(/<img\b[^>]*>/gi, (m) => {
    const src = (m.match(/src\s*=\s*["']([^"']*)["']/i) || [])[1];
    const alt = (m.match(/alt\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    const cleanSrc = stripUnsafeUrls(src);
    if (!cleanSrc) return '';
    const esc = v => String(v).replace(/["'<>&]/g, c => ({ '"': '&quot;', "'": '&#39;', '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    return '<img src="' + esc(cleanSrc) + '" alt="' + esc(alt) + '" loading="lazy">';
  });
  // Links keep only href (safe) — drop everything else.
  s = s.replace(/<a\b[^>]*>/gi, (m) => {
    const href = (m.match(/href\s*=\s*["']([^"']*)["']/i) || [])[1];
    const cleanHref = stripUnsafeUrls(href);
    if (!cleanHref) return '<span>';
    const esc = v => String(v).replace(/["'<>&]/g, c => ({ '"': '&quot;', "'": '&#39;', '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    return '<a href="' + esc(cleanHref) + '">';
  });
  // Close tags that were turned into <span> above: <a ...> → <span> keeps its </a> close; fix pairing.
  s = s.replace(/<span>([\s\S]*?)<\/a>/g, '<span>$1</span>');

  // Collapse excess whitespace.
  s = s.replace(/\s{3,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  const maxBytes = opts.maxBytes || 200 * 1024;
  if (s.length > maxBytes) {
    s = s.slice(0, maxBytes);
    // Don't cut inside a tag.
    const lt = s.lastIndexOf('<');
    if (lt > 0 && !s.slice(lt).includes('>')) s = s.slice(0, lt);
  }
  return s;
}

/**
 * Clean a plain-text description: strip HTML, collapse whitespace, remove
 * common boilerplate fragments (cookie notices, nav text, site branding),
 * and cap length. Never fabricates or rewrites meaning.
 */
function cleanDescription(raw, opts = {}) {
  let s = String(raw == null ? '' : raw)
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const remove = [
    /cookie(s)? (preferences|notice|banner|policy)[^\n.;]{0,80}/gi,
    /by continuing (to|using|to use)[^\n.;]{0,80}/gi,
    /we (use|use cookies)[^\n.;]{0,100}/gi,
    /\b(all rights reserved|©|copyright)[^\n.;]{0,60}/gi
  ];
  for (const p of remove) s = s.replace(p, ' ');
  s = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[\s.,;:!]+/, '').trim();
  const max = opts.maxLength || 300;
  if (s.length > max) {
    s = s.slice(0, max);
    const sp = s.lastIndexOf(' ');
    if (sp > max * 0.6) s = s.slice(0, sp);
    s = s.replace(/[,.:;!?]+$/, '') + '…';
  }
  return s;
}

module.exports = { sanitizeHtml, cleanDescription };
