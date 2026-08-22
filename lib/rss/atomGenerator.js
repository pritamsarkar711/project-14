'use strict';

/*
 * RSS Feed Generator: Atom 1.0 generation (RFC 4287).
 * A genuine Atom document (never relabelled RSS):
 *   <feed> with title, id, updated, link(rel=alternate), subtitle
 *   <entry> with id (URI), title, link, updated, published?, summary,
 *   author?, category?
 */

const { escapeXml, escapeAttr } = require('./xmlEscaper');

function iso(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * @param {object} channel { title, link, description }
 * @param {Array}  items   same shape as rssGenerator items
 */
function generateAtom(channel, items, opts = {}) {
  const now = iso(new Date());
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<feed xmlns="http://www.w3.org/2005/Atom">');
  out.push('  <title>' + escapeXml(channel.title) + '</title>');
  out.push('  <link rel="alternate" href="' + escapeAttr(channel.link) + '"/>');
  out.push('  <id>' + escapeXml(channel.link) + '</id>');
  out.push('  <updated>' + now + '</updated>');
  if (channel.description) out.push('  <subtitle type="text">' + escapeXml(channel.description) + '</subtitle>');

  for (const it of items) {
    const updated = it.pubDate ? iso(it.pubDate) : now;
    const o = ['  <entry>'];
    o.push('    <title>' + escapeXml(it.title) + '</title>');
    o.push('    <link rel="alternate" href="' + escapeAttr(it.link) + '"/>');
    o.push('    <id>' + escapeXml(it.guid || it.link) + '</id>');
    o.push('    <updated>' + updated + '</updated>');
    if (opts.includePubDate !== false && it.pubDate) o.push('    <published>' + iso(it.pubDate) + '</published>');
    if (it.description) o.push('    <summary type="html">' + escapeXml(it.description) + '</summary>');
    if (opts.includeCategories && it.categories && it.categories.length) {
      for (const c of it.categories.slice(0, 5)) o.push('    <category term="' + escapeAttr(c) + '"/>');
    }
    if (opts.includeAuthors && it.author) o.push('    <author><name>' + escapeXml(it.author) + '</name></author>');
    if (it.enclosure && it.enclosure.url && it.enclosure.type && it.enclosure.length != null) {
      o.push('    <link rel="enclosure" href="' + escapeAttr(it.enclosure.url) + '" type="' + escapeAttr(it.enclosure.type) + '" length="' + escapeAttr(String(it.enclosure.length)) + '"/>');
    }
    o.push('  </entry>');
    out.push(o.join('\n'));
  }

  out.push('</feed>');
  return out.join('\n');
}

module.exports = { generateAtom };
