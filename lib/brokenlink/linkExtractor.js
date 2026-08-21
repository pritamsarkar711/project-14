'use strict';

/**
 * Intelligent Page Discovery & Link Extractor
 * Extracts links from:
 * - <a href>
 * - navigation, header, footer, breadcrumbs, content, sidebar, related content, pagination
 * - HTML buttons containing real URLs
 * Supports absolute, relative, protocol-relative URLs
 * Ignores javascript:, mailto:, tel:, data:, unsupported protocols unless enabled
 */

const { normalizeUrl } = require('./urlNormalizer');

function extractAttribute(html, tag, attr) {
  const out = [];
  const re = new RegExp(`<${tag}\\b[^>]*?\\s${attr}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'>]+))[^>]*>`, 'gi');
  let m;
  while ((m = re.exec(html))) {
    const val = (m[1] || m[2] || m[3] || '').trim();
    if (val) out.push(val);
  }
  return out;
}

function extractAnchorText(html, href) {
  // Very simple: find <a ... href="href">text</a> - for reporting
  try {
    const escHref = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`<a\\b[^>]*href\\s*=\\s*(?:\"${escHref}\"|'${escHref}'|${escHref})[^>]*>([\\s\\S]*?)<\\/a>`, 'i');
    const m = html.match(re);
    if (m) {
      return m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
    }
  } catch {}
  return '';
}

function extractLinksFromHtml(html, baseUrl, options = {}) {
  html = String(html || '');
  const base = baseUrl;
  const links = [];

  const checkImages = !!options.checkImages;
  const checkDocuments = !!options.checkDocuments;
  const checkExternal = options.checkExternal !== false;

  // Extract <a href>
  const aHrefs = extractAttribute(html, 'a', 'href');
  for (const raw of aHrefs) {
    const normalized = normalizeUrl(raw, base);
    if (!normalized) continue;
    if (!normalized.url) {
      // unsupported protocol, skip unless explicitly enabled (we don't enable those)
      continue;
    }
    // Filter out non-http already handled by normalizer returning null url
    links.push({
      raw,
      url: normalized.url,
      originalWithFragment: normalized.originalWithFragment,
      fragment: normalized.fragment,
      anchorText: extractAnchorText(html, raw) || '',
      type: 'a',
      source: baseUrl
    });
  }

  // Extract <area href>
  const areaHrefs = extractAttribute(html, 'area', 'href');
  for (const raw of areaHrefs) {
    const normalized = normalizeUrl(raw, base);
    if (!normalized || !normalized.url) continue;
    links.push({ raw, url: normalized.url, originalWithFragment: normalized.originalWithFragment, fragment: normalized.fragment, anchorText: '', type: 'area', source: baseUrl });
  }

  // Extract buttons with real URLs: <button onclick="location.href='...'"> or <button><a> is already covered
  // Look for <button> or <form> with action?
  // Spec says HTML buttons containing real URLs - we interpret as <button> with data-href or onclick containing URL
  // Simple heuristic: extract URLs from onclick attributes that look like URLs
  const buttonOnclick = [];
  const reBtn = /<button\b[^>]*\bonclick\s*=\s*(?:\"([^\"]*)\"|'([^']*)')[^>]*>/gi;
  let mBtn;
  while ((mBtn = reBtn.exec(html))) {
    const code = (mBtn[1] || mBtn[2] || '');
    // Look for http URLs inside
    const urlMatch = code.match(/https?:\/\/[^\s'"]+/i) || code.match(/\/[^\s'"]+/);
    if (urlMatch) {
      const raw = urlMatch[0];
      const normalized = normalizeUrl(raw, base);
      if (normalized && normalized.url) {
        links.push({ raw, url: normalized.url, originalWithFragment: normalized.originalWithFragment, fragment: normalized.fragment, anchorText: '', type: 'button', source: baseUrl });
      }
    }
  }

  // Extract <link href> for navigation? But many are stylesheets. We filter to likely page links?
  // We'll include <link rel="next" href> <link rel="prev"> pagination
  const linkTags = [];
  const reLink = /<link\b[^>]*>/gi;
  let mLink;
  while ((mLink = reLink.exec(html))) {
    const tag = mLink[0];
    const relMatch = tag.match(/\brel\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>]+))/i);
    const hrefMatch = tag.match(/\bhref\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>]+))/i);
    if (!relMatch || !hrefMatch) continue;
    const rel = (relMatch[1] || relMatch[2] || relMatch[3] || '').toLowerCase();
    const raw = (hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || '').trim();
    if (!raw) continue;
    // Only consider navigation-related rels
    if (/next|prev|canonical|alternate/.test(rel)) {
      // canonical is handled separately
      if (rel.includes('canonical')) continue;
      const normalized = normalizeUrl(raw, base);
      if (normalized && normalized.url) {
        links.push({ raw, url: normalized.url, originalWithFragment: normalized.originalWithFragment, fragment: normalized.fragment, anchorText: rel, type: 'link', source: baseUrl });
      }
    }
  }

  if (checkImages) {
    const imgSrcs = extractAttribute(html, 'img', 'src');
    const srcsetVals = extractAttribute(html, 'img', 'srcset');
    const sourceSrcset = extractAttribute(html, 'source', 'srcset');
    const allSrcs = [...imgSrcs];
    for (const ss of [...srcsetVals, ...sourceSrcset]) {
      // srcset can be comma-separated with descriptors
      const parts = ss.split(',').map(p => p.trim().split(/\s+/)[0]).filter(Boolean);
      allSrcs.push(...parts);
    }
    for (const raw of allSrcs) {
      const normalized = normalizeUrl(raw, base);
      if (!normalized || !normalized.url) continue;
      links.push({ raw, url: normalized.url, originalWithFragment: normalized.originalWithFragment, fragment: '', anchorText: '', type: 'image', source: baseUrl });
    }
  }

  if (checkDocuments) {
    // Documents are already captured via <a href> if they end with .pdf etc, but we also scan for direct doc URLs in HTML
    // The a extraction already covers them, but we mark type as file if extension matches
    for (const l of links) {
      if (/\.(pdf|doc|docx|xls|xlsx|csv|zip|txt)(\?|#|$)/i.test(l.url)) {
        l.type = 'file';
      }
    }
  } else {
    // If not checking documents, we could filter them out? Spec says toggle, so we keep but mark
    for (const l of links) {
      if (/\.(pdf|doc|docx|xls|xlsx|csv|zip|txt)(\?|#|$)/i.test(l.url)) {
        l.type = 'file';
      }
    }
  }

  // Filter external if needed? We'll keep all but mark internal/external later
  return links;
}

function isDocumentUrl(url) {
  return /\.(pdf|doc|docx|xls|xlsx|csv|zip|txt)(\?|#|$)/i.test(url);
}

function isImageUrl(url) {
  return /\.(png|jpe?g|webp|avif|gif|svg|bmp|ico)(\?|#|$)/i.test(url);
}

function getLinkType(url, originalType) {
  if (originalType === 'image') return 'image';
  if (originalType === 'file' || isDocumentUrl(url)) return 'file';
  if (isImageUrl(url)) return 'image';
  return 'a';
}

module.exports = { extractLinksFromHtml, isDocumentUrl, isImageUrl, getLinkType };
