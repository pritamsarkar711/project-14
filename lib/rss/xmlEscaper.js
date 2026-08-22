'use strict';

/*
 * RSS Feed Generator: XML escaping.
 * Deterministic. Guarantees that arbitrary text (titles, descriptions,
 * Unicode, quotes, ampersands) never produces malformed XML.
 */

/* Escape text for use inside an XML element's character data. */
function escapeXml(s) {
  return String(s == null ? '' : s)
    // Remove characters that are illegal in XML 1.0 (control chars except
    // tab/newline/CR). BOM and zero-width joiners are legal and preserved.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* Escape text for use inside a double-quoted XML attribute value. */
function escapeAttr(s) {
  return escapeXml(s).replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/*
 * Wrap HTML (or any text containing markup) in a CDATA section.
 * Content must not contain the CDATA terminator "]]>".
 */
function cdata(html) {
  let s = String(html == null ? '' : html).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  // Defensive: split the (extremely rare) "]]>" sequence so the section
  // can never be terminated early.
  s = s.replace(/\]\]>/g, ']]&gt;');
  return '<![CDATA[' + s + ']]>';
}

module.exports = { escapeXml, escapeAttr, cdata };
