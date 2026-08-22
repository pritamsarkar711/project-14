'use strict';

/*
 * RSS Feed Generator: RSS 2.0 generation.
 * Builds a standards-compliant RSS 2.0 document from prepared items.
 *
 * Rules:
 *  - every text field is XML-escaped; HTML descriptions use CDATA
 *  - namespaces are added only when used (media: for images,
 *    dc: for creators), never unused namespaces
 *  - item order is exactly the order the caller provides
 *  - pubDate/lastBuildDate are RFC 822 (RFC 1123) strings
 *  - guids default to the item's canonical/permalink URL
 *  - nothing is invented: missing dates/authors/categories/images are
 *    simply omitted from the output
 */

const { escapeXml, escapeAttr, cdata } = require('./xmlEscaper');
const { toRfc822 } = require('./dateExtractor');

const MEDIA_NS = 'http://search.yahoo.com/mrss/';
const DC_NS = 'http://purl.org/dc/elements/1.1/';

function absHttpUrl(u) {
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) && !!x.hostname; } catch { return false; }
}

function imageMime(url) {
  const p = String(url || '').split(/[?#]/)[0].toLowerCase();
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.gif')) return 'image/gif';
  if (p.endsWith('.webp')) return 'image/webp';
  if (p.endsWith('.avif')) return 'image/avif';
  if (p.endsWith('.svg') || p.endsWith('.svgz')) return 'image/svg+xml';
  return null;
}

/**
 * @param {object} channel { title, link, description, language? }
 * @param {Array}  items   [{title, link, guid, description, descriptionHtml,
 *                          pubDate (Date|null), author, categories: [], image,
 *                          enclosure? {url, type, length}, descriptionMode}]
 * @param {object} opts    { includeImages, includeAuthors, includeCategories,
 *                          includePubDate, podcast }
 */
function generateRss(channel, items, opts = {}) {
  const usableImages = items.filter(i => i.image && absHttpUrl(i.image));
  const useMedia = opts.includeImages && usableImages.length > 0;
  const useDc = opts.includeAuthors && items.some(i => i.author);

  const ns = [];
  if (useMedia) ns.push('xmlns:media="' + MEDIA_NS + '"');
  if (useDc) ns.push('xmlns:dc="' + DC_NS + '"');
  const nsAttr = ns.length ? ' ' + ns.join(' ') : '';

  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<rss version="2.0"' + nsAttr + '>');
  out.push('  <channel>');
  out.push('    <title>' + escapeXml(channel.title) + '</title>');
  out.push('    <link>' + escapeXml(channel.link) + '</link>');
  out.push('    <description>' + escapeXml(channel.description) + '</description>');
  out.push('    <lastBuildDate>' + escapeXml(toRfc822(new Date())) + '</lastBuildDate>');

  for (const it of items) {
    const o = ['    <item>'];
    o.push('      <title>' + escapeXml(it.title) + '</title>');
    o.push('      <link>' + escapeXml(it.link) + '</link>');
    o.push('      <guid isPermaLink="true">' + escapeXml(it.guid || it.link) + '</guid>');

    // Description: plain text (escaped), or HTML inside CDATA.
    const descMode = it.descriptionMode || 'description';
    if (descMode === 'full' && it.descriptionHtml) {
      o.push('      <description>' + cdata(it.descriptionHtml) + '</description>');
    } else if (descMode === 'excerpt' && it.excerptHtml) {
      o.push('      <description>' + cdata(it.excerptHtml) + '</description>');
    } else {
      o.push('      <description>' + escapeXml(it.description || it.title) + '</description>');
    }

    if (opts.includePubDate !== false && it.pubDate) {
      const s = toRfc822(it.pubDate);
      if (s) o.push('      <pubDate>' + escapeXml(s) + '</pubDate>');
    }

    if (opts.includeAuthors && it.author && useDc) {
      o.push('      <dc:creator>' + escapeXml(it.author) + '</dc:creator>');
    }

    if (opts.includeCategories && it.categories && it.categories.length) {
      for (const c of it.categories.slice(0, 5)) {
        o.push('      <category>' + escapeXml(c) + '</category>');
      }
    }

    if (opts.podcast && it.enclosure && it.enclosure.url && it.enclosure.type && it.enclosure.length != null) {
      o.push('      <enclosure url="' + escapeAttr(it.enclosure.url) + '" type="' + escapeAttr(it.enclosure.type) + '" length="' + escapeAttr(String(it.enclosure.length)) + '"/>');
    }

    if (opts.includeImages && it.image && useMedia && absHttpUrl(it.image)) {
      const mime = imageMime(it.image);
      const typeAttr = mime ? ' type="' + escapeAttr(mime) + '"' : '';
      o.push('      <media:content url="' + escapeAttr(it.image) + '" medium="image"' + typeAttr + '/>');
      o.push('      <media:thumbnail url="' + escapeAttr(it.image) + '"/>');
    }

    o.push('    </item>');
    out.push(o.join('\n'));
  }

  out.push('  </channel>');
  out.push('</rss>');
  return out.join('\n');
}

module.exports = { generateRss, imageMime };
