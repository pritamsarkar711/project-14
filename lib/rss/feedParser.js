'use strict';

/*
 * RSS Feed Generator — existing feed parser.
 * Parses RSS 2.0 and Atom 1.0 documents into a normalised item list:
 * { format, title, link, description, items: [{title, link, guid, description,
 *    pubDate, author, categories, image}] }
 * Used for existing-feed detection, comparison and "Use Existing Feed".
 */

const { findElements, findInner, attrOf, textOf, namespaces } = require('./xmlParser');

const MIME_IMAGE = /^image\//i;

function normImage(v) {
  return String(v || '').trim() || null;
}

function parseRss(xml) {
  const rss = findElements(xml, 'rss')[0];
  if (!rss) return null;
  const version = attrOf(rss, 'version');
  const channel = findInner(rss.inner, 'channel');
  if (!channel) return null;
  const feed = {
    format: version ? 'rss' + version : 'rss',
    title: '', link: '', description: '', lastBuildDate: '', items: [], namespaces: namespaces(xml)
  };
  const ch = (t) => { const el = findElements(channel.inner, t)[0]; return el ? textOf(el) : ''; };
  feed.title = ch('title');
  feed.link = ch('link');
  feed.description = ch('description');
  feed.lastBuildDate = ch('lastbuilddate');

  for (const it of findElements(channel.inner, 'item')) {
    const inner = it.inner;
    const t = (tag) => { const el = findElements(inner, tag)[0]; return el ? textOf(el) : ''; };
    const rawDescEl = findElements(inner, 'description')[0];
    let description = rawDescEl ? textOf(rawDescEl) : '';
    // Description often holds HTML in CDATA — keep it, it is data.
    const item = {
      title: t('title'),
      link: t('link'),
      guid: t('guid'),
      description,
      pubDate: t('pubdate'),
      author: t('dc:creator') || t('author'),
      categories: findElements(inner, 'category').map(c => textOf(c)).filter(Boolean),
      image: null
    };
    // Image: media:content / media:thumbnail / enclosure with image MIME
    const media = findElements(inner, 'media:content').map(e => attrOf(e, 'url')).filter(Boolean);
    if (media.length) item.image = normImage(media[0]);
    else {
      const thumb = findElements(inner, 'media:thumbnail').map(e => attrOf(e, 'url')).filter(Boolean);
      if (thumb.length) item.image = normImage(thumb[0]);
    }
    if (!item.image) {
      const enc = findElements(inner, 'enclosure').map(e => ({ url: attrOf(e, 'url'), type: attrOf(e, 'type') })).filter(e => e.url && MIME_IMAGE.test(e.type));
      if (enc.length) item.image = normImage(enc[0].url);
    }
    if (!item.guid) item.guid = item.link;
    feed.items.push(item);
  }
  return feed;
}

function parseAtom(xml) {
  const feedEl = findElements(xml, 'feed').find(f => {
    const ns = namespaces(xml);
    return true;
  });
  if (!feedEl) return null;
  const ns = namespaces(xml);
  // Only treat as Atom if in the Atom namespace (or a bare <feed> without rss context)
  if (ns[''] && !/atom$/i.test(ns[''])) return null;
  const feed = { format: 'atom', title: '', link: '', description: '', lastBuildDate: '', items: [], namespaces: ns };
  const t = (tag) => { const el = findElements(feedEl.inner, tag)[0]; return el ? textOf(el) : ''; };
  feed.title = t('title');
  feed.description = t('subtitle') || t('title');
  const links = findElements(feedEl.inner, 'link');
  const alt = links.find(l => attrOf(l, 'rel') === '' || attrOf(l, 'rel') === 'alternate');
  feed.link = alt ? attrOf(alt, 'href') : (links[0] ? attrOf(links[0], 'href') : '');
  feed.lastBuildDate = t('updated');

  for (const en of findElements(feedEl.inner, 'entry')) {
    const inner = en.inner;
    const et = (tag) => { const el = findElements(inner, tag)[0]; return el ? textOf(el) : ''; };
    const elinks = findElements(inner, 'link');
    const ealt = elinks.find(l => attrOf(l, 'rel') === '' || attrOf(l, 'rel') === 'alternate');
    const item = {
      title: et('title'),
      link: ealt ? attrOf(ealt, 'href') : '',
      guid: et('id'),
      description: et('summary') || et('content'),
      pubDate: et('published') || et('updated'),
      author: (findElements(inner, 'name').map(n => textOf(n))[0]) || '',
      categories: findElements(inner, 'category').map(c => attrOf(c, 'term') || textOf(c)).filter(Boolean),
      image: null
    };
    const enc = elinks.filter(l => attrOf(l, 'rel') === 'enclosure').map(l => attrOf(l, 'href')).filter(Boolean);
    if (enc.length) item.image = normImage(enc[0]);
    if (!item.guid) item.guid = item.link;
    feed.items.push(item);
  }
  return feed;
}

/* Parse any feed XML. Returns { format: 'rss2'|'rss'|'atom', ... } or null. */
function parseFeed(xml) {
  const s = String(xml || '');
  if (!s.trim()) return null;
  let feed = null;
  if (/<rss\b/i.test(s)) feed = parseRss(s);
  else if (/<feed\b/i.test(s)) feed = parseAtom(s);
  if (!feed) return null;
  if (/^rss/i.test(feed.format)) feed.format = /2\.0/.test(feed.format) ? 'rss2' : 'rss';
  return feed;
}

module.exports = { parseFeed, parseRss, parseAtom };
