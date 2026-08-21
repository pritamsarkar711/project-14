'use strict';

/*
 * RSS Feed Generator — XML / RSS validation.
 * Validates generated (or existing) RSS 2.0 documents against a concrete
 * checklist. Every check reports pass/warn/fail with a message.
 *
 * Checks (per spec):
 *  - XML syntax (well-formedness, unescaped &), invalid characters
 *  - RSS version, required channel elements (title, link, description)
 *  - valid lastBuildDate
 *  - per item: title, link, guid; guid uniqueness; link absoluteness
 *  - pubDate RFC 822 validity when supplied
 *  - duplicate item URLs
 *  - namespace correctness (media:/dc: declared when used)
 *  - relative URLs anywhere
 *  - malformed entities
 *
 * `autoFix` deterministically strips characters that are invalid in XML 1.0
 * before validation so a formatting-only problem is reported as fixed, not
 * as a failure.
 */

const { wellFormed, findElements, textOf, attrOf, namespaces } = require('./xmlParser');
const { isValidRfc822 } = require('./dateExtractor');

const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function absHttpUrl(u) {
  try {
    const x = new URL(u);
    return /^https?:$/.test(x.protocol) && !!x.hostname;
  } catch { return false; }
}

function autoFixXml(xml) {
  const before = String(xml || '');
  const fixed = before.replace(INVALID_XML_CHARS, '');
  return { fixed, removed: (before.match(INVALID_XML_CHARS) || []).length };
}

/**
 * Validate an RSS 2.0 document.
 * @returns {{valid: boolean, checks: [{name, status, message}], errors: string[], autoFixes: string[]}}
 */
function validateRss(xml, opts = {}) {
  const checks = [];
  const errors = [];
  const autoFixes = [];
  const add = (name, status, message) => checks.push({ name, status, message });

  let doc = String(xml || '');
  const fix = autoFixXml(doc);
  if (fix.removed) { doc = fix.fixed; autoFixes.push('Removed ' + fix.removed + ' invalid XML character(s)'); }

  const wf = wellFormed(doc);
  if (!wf.ok) {
    add('XML syntax', 'fail', wf.error);
    errors.push(wf.error);
    return { valid: false, checks, errors, autoFixes };
  }
  add('XML syntax', 'pass', 'Well-formed document');

  const badEntity = doc.replace(/&(?:[a-z][a-z0-9]{1,10}|#x[0-9a-f]+|#\d+);/gi, '');
  if (badEntity.includes('&')) {
    add('Escaping', 'fail', 'Unescaped & character found');
    errors.push('Unescaped & character');
  } else {
    add('Escaping', 'pass', 'Ampersands correctly escaped');
  }

  const ns = namespaces(doc);

  // Root rss element.
  const rss = findElements(doc, 'rss')[0];
  if (!rss) {
    add('RSS root', 'fail', 'No <rss> root element');
    errors.push('Missing <rss> root element');
    return { valid: false, checks, errors, autoFixes };
  }
  const version = attrOf(rss, 'version');
  if (version === '2.0') add('RSS version', 'pass', 'RSS 2.0');
  else if (version) { add('RSS version', 'warn', 'Unexpected version "' + version + '"'); }
  else { add('RSS version', 'fail', 'rss element missing version="2.0"'); errors.push('Missing version attribute'); }

  const channel = findElements(rss.inner, 'channel')[0];
  if (!channel) {
    add('Channel', 'fail', 'No <channel> element');
    errors.push('Missing <channel>');
    return { valid: false, checks, errors, autoFixes };
  }
  const chText = (t) => { const el = findElements(channel.inner, t)[0]; return el ? textOf(el) : ''; };
  const chTitle = chText('title'), chLink = chText('link'), chDesc = chText('description');
  if (chTitle) add('Channel title', 'pass', chTitle.length + ' chars');
  else { add('Channel title', 'fail', 'Channel is missing <title>'); errors.push('Channel missing title'); }
  if (chLink && absHttpUrl(chLink)) add('Channel link', 'pass', chLink);
  else if (chLink) { add('Channel link', 'fail', 'Channel link is not an absolute http(s) URL'); errors.push('Channel link not absolute'); }
  else { add('Channel link', 'fail', 'Channel is missing <link>'); errors.push('Channel missing link'); }
  if (chDesc) add('Channel description', 'pass', chDesc.length + ' chars');
  else add('Channel description', 'warn', 'Channel has no <description>');

  const lbd = chText('lastbuilddate');
  if (!lbd) add('lastBuildDate', 'warn', 'No <lastBuildDate> in channel');
  else if (isValidRfc822(lbd)) add('lastBuildDate', 'pass', lbd);
  else { add('lastBuildDate', 'fail', 'Invalid date format: ' + lbd); errors.push('Invalid lastBuildDate'); }

  // Items.
  const items = findElements(channel.inner, 'item');
  if (!items.length) add('Items', 'warn', 'Feed contains no <item> elements');

  const guids = new Set();
  const links = new Set();
  let dupGuids = 0, dupLinks = 0, badDates = 0, missing = 0, relLinks = 0, missingDesc = 0, badImages = 0;

  for (const it of items) {
    const inner = it.inner;
    const t = (tag) => { const el = findElements(inner, tag)[0]; return el ? textOf(el) : ''; };
    const title = t('title'), link = t('link'), guid = t('guid'), pubDate = t('pubdate');
    const desc = t('description');

    if (!title) { missing++; }
    if (!link) { missing++; }
    else if (!absHttpUrl(link)) relLinks++;
    if (!guid) missing++;
    if (guid) { if (guids.has(guid)) dupGuids++; guids.add(guid); }
    if (link) { if (links.has(link)) dupLinks++; links.add(link); }
    if (!desc) missingDesc++;
    if (pubDate && !isValidRfc822(pubDate)) { badDates++; errors.push('Invalid pubDate on "' + (title || link) + '": ' + pubDate); }

    // Media/enclosure URLs must be absolute.
    for (const m of findElements(inner, 'media:content').concat(findElements(inner, 'media:thumbnail'), findElements(inner, 'enclosure'))) {
      const mu = attrOf(m, 'url');
      if (mu && !absHttpUrl(mu)) { badImages++; errors.push('Non-absolute media/enclosure URL: ' + mu); }
    }

    // Namespace usage.
    if (/<media:[a-z]+/i.test(inner) && !ns['media']) { errors.push('media: used without xmlns:media declaration'); }
    if (/<dc:[a-z]+/i.test(inner) && !ns['dc']) { errors.push('dc: used without xmlns:dc declaration'); }
  }

  add('Items', items.length ? 'pass' : 'warn', items.length ? items.length + ' item(s) parsed' : 'No items');
  add('Required item elements', missing ? 'fail' : 'pass', missing ? missing + ' item field(s) missing (title/link/guid)' : 'Every item has title, link and guid');
  if (missing) errors.push(missing + ' missing required item field(s)');

  add('GUID uniqueness', dupGuids ? 'fail' : 'pass', dupGuids ? dupGuids + ' duplicate GUID(s)' : 'All ' + guids.size + ' GUIDs unique');
  if (dupGuids) errors.push(dupGuids + ' duplicate GUIDs');

  add('Item URLs', relLinks ? 'fail' : 'pass', relLinks ? relLinks + ' relative/non-absolute item link(s)' : 'All item links are absolute http(s) URLs');
  if (relLinks) errors.push(relLinks + ' relative item links');

  add('Duplicate URLs', dupLinks ? 'warn' : 'pass', dupLinks ? dupLinks + ' duplicate item URL(s)' : 'No duplicate item URLs');
  if (dupLinks) errors.push(dupLinks + ' duplicate item URLs');

  add('Publication dates', badDates ? 'fail' : 'pass', badDates ? badDates + ' invalid pubDate value(s)' : 'All supplied pubDate values are valid RFC 822');

  add('Image URLs', badImages ? 'fail' : 'pass', badImages ? badImages + ' non-absolute media URL(s)' : 'All media/enclosure URLs are absolute http(s)');

  add('Empty descriptions', missingDesc ? 'warn' : 'pass', missingDesc ? missingDesc + ' item(s) without description' : 'Every item has a description');

  const mediaDeclared = !!ns['media'], dcDeclared = !!ns['dc'];
  add('Namespaces', 'pass', 'Declared: ' + Object.keys(ns).filter(k => k).map(k => k + ':').join(' ') + (Object.keys(ns).some(k => !k) ? ' (atom)' : '') + (mediaDeclared ? ' media:' : '') + (dcDeclared ? ' dc:' : ''));

  const valid = errors.length === 0;
  add('Overall', valid ? 'pass' : 'fail', valid ? 'Valid RSS 2.0 document' : errors.length + ' issue(s) must be fixed');
  return { valid, checks, errors, autoFixes };
}

module.exports = { validateRss, autoFixXml, absHttpUrl };
