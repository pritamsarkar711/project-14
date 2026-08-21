'use strict';

/*
 * RSS Feed Generator — minimal XML reader.
 * Dependency-free, regex/scan based. Purpose-built for reading feeds
 * (rss/atom/sitemap) from untrusted servers: tolerant of minor malformation,
 * never throws on bad input, never executes anything.
 *
 * NOT a general-purpose DOM implementation.
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => safeCode(parseInt(n, 10)))
    .replace(/&([a-z][a-z0-9]{1,10});/gi, (m, name) => ENTITIES[name.toLowerCase()] != null ? ENTITIES[name.toLowerCase()] : m);
}

function safeCode(n) {
  if (!Number.isFinite(n) || n < 32 || n === 127) return '';
  try { return String.fromCodePoint(n); } catch { return ''; }
}

/*
 * Find every element whose tag name matches, returning:
 *   { tag, attrs: {name: value}, text (inner text, entities decoded),
 *     inner (raw inner XML), index }
 * CDATA sections inside an element are unwrapped for `text`.
 * Does not descend: for each match, only the element's own inner content
 * is captured (up to the matching close tag, accounting for nesting of the
 * same tag).
 */
function findElements(xml, tagName) {
  const out = [];
  const re = new RegExp('<' + tagName + '\\b([^>]*)>([\\s\\S]*?)<\\/' + tagName + '>|<' + tagName + '\\b([^>]*?)\\/>', 'gi');
  let m;
  while ((m = re.exec(String(xml || '')))) {
    const attrs = m[1] != null ? parseAttrs(m[1]) : parseAttrs(m[3] || '');
    if (m[1] != null) {
      const inner = m[2];
      out.push({ tag: tagName, attrs, inner, text: innerText(inner), index: m.index });
    } else {
      out.push({ tag: tagName, attrs, inner: '', text: '', index: m.index });
    }
  }
  return out;
}

/* Child elements of a parent's inner XML (one level down). */
function childElements(innerXml, tagName) {
  return findElements(innerXml, tagName);
}

function textOf(el) {
  return el ? decodeEntities(el.text) : '';
}

function attrOf(el, name) {
  if (!el) return '';
  for (const k of Object.keys(el.attrs)) if (k.toLowerCase() === name.toLowerCase()) return decodeEntities(el.attrs[k]);
  return '';
}

function parseAttrs(raw) {
  const out = {};
  const re = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(String(raw || '')))) {
    out[m[1]] = m[2] != null ? m[2] : m[3] != null ? m[3] : m[4];
  }
  return out;
}

/* Text content: CDATA kept verbatim (feeds store HTML there), other tags
 * stripped, entities decoded outside CDATA. */
function innerText(inner) {
  let s = String(inner == null ? '' : inner);
  const cdatas = [];
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c) => { cdatas.push(c); return '\u0000CD' + (cdatas.length - 1) + '\u0000'; });
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/\u0000CD(\d+)\u0000/g, (_, i) => cdatas[Number(i)]);
  return s.replace(/\s+/g, ' ').trim();
}

/* Extract the raw inner content of the first (or nth) matching element. */
function findInner(xml, tagName, nth) {
  const els = findElements(xml, tagName);
  if (!els.length) return null;
  const el = els[Math.min(nth || 0, els.length - 1)];
  return { inner: el.inner, text: el.text, attrs: el.attrs };
}

/* Namespaces declared on the root element (name → uri). */
function namespaces(xml) {
  const m = String(xml || '').match(/<[a-zA-Z][\w:.-]*\b([^>]*)>/);
  const out = {};
  if (m) {
    const ns = parseAttrs(m[1]);
    for (const k of Object.keys(ns)) {
      if (/^xmlns(:[\w-]+)?$/i.test(k)) {
        const prefix = k.split(':')[1] || '';
        out[prefix.toLowerCase()] = ns[k];
      }
    }
  }
  return out;
}

/*
 * Detect whether a document is well-formed enough to be XML:
 * has an opening root tag, balanced angle brackets outside CDATA/comments,
 * and no unescaped '&' that is not part of an entity.
 */
function wellFormed(xml) {
  const s = String(xml || '');
  if (!s.trim()) return { ok: false, error: 'Empty document' };
  // strip comments + CDATA + processing instructions for balance check
  const stripped = s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '');
  if (!/<[a-zA-Z]/.test(stripped)) return { ok: false, error: 'No root element found' };
  // unescaped ampersand (not part of an entity reference)
  const amp = stripped.replace(/&(?:[a-z][a-z0-9]{1,10}|#x[0-9a-f]+|#\d+);/gi, '');
  if (amp.includes('&')) return { ok: false, error: 'Unescaped & character' };
  // bracket balance
  let depth = 0;
  const tagRe = /<\/?([a-zA-Z][\w:.-]*)[^>]*?\/?>/g;
  let m;
  const stack = [];
  const voidish = new Set(['?xml', '!doctype']);
  while ((m = tagRe.exec(stripped))) {
    const tag = m[1].toLowerCase();
    if (voidish.has(tag) || m[0].endsWith('/>')) continue;
    if (m[0][1] === '/') {
      if (!stack.length || stack[stack.length - 1] !== tag) return { ok: false, error: 'Unclosed or mismatched tag <' + tag + '>' };
      stack.pop();
    } else {
      stack.push(tag);
      depth++;
      if (depth > 5000) return { ok: false, error: 'Document too deeply nested' };
    }
  }
  if (stack.length) return { ok: false, error: 'Unclosed tag <' + stack[stack.length - 1] + '>' };
  return { ok: true, error: null };
}

module.exports = { findElements, childElements, textOf, attrOf, parseAttrs, innerText, findInner, namespaces, wellFormed, decodeEntities };
