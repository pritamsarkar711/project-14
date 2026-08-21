'use strict';

const { normalizeUrl } = require('./urlNormalizer');

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function extractAllATags(html) {
  const out = [];
  // Regex literal with backtick inside char class is okay
  const re = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = decodeHtmlEntities((m[1] || m[2] || m[3] || '').trim());
    const inner = (m[4] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (raw) out.push({ raw, anchor: inner });
  }
  const re2 = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`>]+))[^>]*>/gi;
  while ((m = re2.exec(html))) {
    const raw = decodeHtmlEntities((m[1] || m[2] || m[3] || '').trim());
    if (raw && !out.some(o => o.raw === raw)) {
      out.push({ raw, anchor: '' });
    }
  }
  return out;
}

function extractGeneric(html, tag, attr) {
  const out = [];
  // Avoid template literal backtick issue by using string concatenation and no backtick in char class
  const pattern = '<' + tag + '\\b[^>]*?\\b' + attr + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'`>]+))[^>]*>';
  const re = new RegExp(pattern, 'gi');
  let m;
  while ((m = re.exec(html))) {
    const raw = decodeHtmlEntities((m[1] || m[2] || m[3] || '').trim());
    if (raw) out.push(raw);
  }
  return out;
}

function extractLinksFromHtml(html, baseUrl, options = {}) {
  html = String(html || '');
  const base = baseUrl;
  const links = [];

  const checkImages = !!options.checkImages;
  const checkDocuments = !!options.checkDocuments;

  const aTags = extractAllATags(html);
  for (const { raw, anchor } of aTags) {
    if (!raw) continue;
    const lower = raw.toLowerCase().trim();
    if (lower.startsWith('javascript:') || lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('data:') || lower.startsWith('blob:') || lower.startsWith('about:')) continue;
    if (lower.startsWith('#')) continue;
    const normalized = normalizeUrl(raw, base);
    if (!normalized) continue;
    if (!normalized.url) continue;
    links.push({
      raw,
      url: normalized.url,
      originalWithFragment: normalized.originalWithFragment,
      fragment: normalized.fragment,
      anchorText: anchor || '',
      type: 'a',
      source: baseUrl
    });
  }

  const areaHrefs = extractGeneric(html, 'area', 'href');
  for (const raw of areaHrefs) {
    const n = normalizeUrl(raw, base);
    if (!n || !n.url) continue;
    links.push({ raw, url: n.url, originalWithFragment: n.originalWithFragment, fragment: n.fragment, anchorText: '', type: 'area', source: baseUrl });
  }

  const linkTagRe = /<link\b[^>]*>/gi;
  let mLink;
  while ((mLink = linkTagRe.exec(html))) {
    const tag = mLink[0];
    const relMatch = tag.match(/\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const hrefMatch = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!relMatch || !hrefMatch) continue;
    const rel = decodeHtmlEntities((relMatch[1] || relMatch[2] || relMatch[3] || '').toLowerCase());
    const raw = decodeHtmlEntities((hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || '').trim());
    if (!raw) continue;
    if (/next|prev|alternate/.test(rel) && !/canonical/.test(rel)) {
      const n = normalizeUrl(raw, base);
      if (n && n.url) {
        links.push({ raw, url: n.url, originalWithFragment: n.originalWithFragment, fragment: n.fragment, anchorText: rel, type: 'link', source: baseUrl });
      }
    }
  }

  const btnRe = /<button\b[^>]*>/gi;
  let mBtn;
  while ((mBtn = btnRe.exec(html))) {
    const tag = mBtn[0];
    const candidates = [];
    const onclickMatch = tag.match(/\bonclick\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (onclickMatch) {
      const code = onclickMatch[1] || onclickMatch[2] || '';
      const urlRe = /(?:location\.href|window\.location|href)\s*=\s*["']([^"']+)["']/gi;
      let mUrl;
      while ((mUrl = urlRe.exec(code))) candidates.push(mUrl[1]);
      const plainRe = /(https?:\/\/[^\s"'`]+|\/[^\s"'`]+)/gi;
      let mPlain;
      while ((mPlain = plainRe.exec(code))) {
        const u = mPlain[1];
        if (u.length > 1 && u.length < 500) candidates.push(u);
      }
    }
    const dataHrefMatch = tag.match(/\bdata-(?:href|url|link)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (dataHrefMatch) candidates.push(dataHrefMatch[1] || dataHrefMatch[2] || dataHrefMatch[3] || '');

    for (const raw of candidates) {
      if (!raw) continue;
      const lower = raw.toLowerCase();
      if (lower.startsWith('javascript:') || lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('data:')) continue;
      const n = normalizeUrl(raw, base);
      if (n && n.url) {
        links.push({ raw, url: n.url, originalWithFragment: n.originalWithFragment, fragment: n.fragment, anchorText: '', type: 'button', source: baseUrl });
      }
    }
  }

  const formActionRe = /<form\b[^>]*\baction\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  let mForm;
  while ((mForm = formActionRe.exec(html))) {
    const raw = decodeHtmlEntities((mForm[1] || mForm[2] || mForm[3] || '').trim());
    if (!raw) continue;
    const n = normalizeUrl(raw, base);
    if (n && n.url) {
      links.push({ raw, url: n.url, originalWithFragment: n.originalWithFragment, fragment: n.fragment, anchorText: '', type: 'form', source: baseUrl });
    }
  }

  if (checkImages) {
    const imgSrcs = extractGeneric(html, 'img', 'src');
    const imgDataSrc = extractGeneric(html, 'img', 'data-src');
    const imgSrcset = extractGeneric(html, 'img', 'srcset');
    const sourceSrcset = extractGeneric(html, 'source', 'srcset');
    const allSrcs = [...imgSrcs, ...imgDataSrc];
    for (const ss of [...imgSrcset, ...sourceSrcset]) {
      const parts = ss.split(',').map(p => p.trim().split(/\s+/)[0]).filter(Boolean).map(decodeHtmlEntities);
      allSrcs.push(...parts);
    }
    for (const raw of allSrcs) {
      if (!raw) continue;
      const lower = raw.toLowerCase();
      if (lower.startsWith('data:') || lower.startsWith('blob:')) continue;
      const n = normalizeUrl(raw, base);
      if (!n || !n.url) continue;
      links.push({ raw, url: n.url, originalWithFragment: n.originalWithFragment, fragment: '', anchorText: '', type: 'image', source: baseUrl });
    }
  }

  for (const l of links) {
    if (/\.(pdf|doc|docx|xls|xlsx|csv|zip|txt|ppt|pptx)(\?|#|$)/i.test(l.url)) {
      l.type = 'file';
    } else if (/\.(png|jpe?g|webp|avif|gif|svg|bmp|ico)(\?|#|$)/i.test(l.url)) {
      if (l.type !== 'image') l.type = 'image';
    }
  }

  return links;
}

function isDocumentUrl(url) {
  return /\.(pdf|doc|docx|xls|xlsx|csv|zip|txt|ppt|pptx)(\?|#|$)/i.test(url);
}

function isImageUrl(url) {
  return /\.(png|jpe?g|webp|avif|gif|svg|bmp|ico)(\?|#|$)/i.test(url);
}

module.exports = { extractLinksFromHtml, isDocumentUrl, isImageUrl };
