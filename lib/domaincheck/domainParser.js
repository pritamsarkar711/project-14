'use strict';

/*
 * Domain parsing & normalisation.
 * Accepts: example.com | https://example.com | http://blog.example.co.uk:8443/path?q=1
 * Handles IDN (Unicode) input via punycode conversion, multi-level public
 * suffixes, trailing dots, uppercase and whitespace. Never invents structure:
 * every field is either derived from the input or null.
 */

const { domainToASCII, domainToUnicode } = require('url');
const { makeError } = require('./util');
const { publicSuffixFor, hasTld } = require('./psl');

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const RESERVED_TLDS = new Set(['localhost', 'local', 'lan', 'internal', 'test', 'invalid', 'example', 'onion', 'arpa']);

function isIpLiteral(host) {
  const h = String(host || '').replace(/^\[|\]$/g, '');
  // quick v4 check (dotted quad) and v6 (contains ':')
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) return 'ip';
  if (h.includes(':')) return 'ip';
  return null;
}

/* Parse a raw user input into a structured domain descriptor. Throws makeError('invalid_input'). */
function parseInput(raw) {
  if (raw == null) throw makeError('invalid_input', 'Please enter a domain name.');
  let s = String(raw).trim();
  if (!s) throw makeError('invalid_input', 'Please enter a domain name.');
  if (s.length > 2048) throw makeError('invalid_input', 'That input is too long to be a domain.');

  // Scheme-less input: "example.com" or "example.com/path"
  let scheme = null;
  let rest = s;
  const schemeMatch = s.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      throw makeError('invalid_input', 'Only http:// and https:// domains are supported (received "' + scheme + '://").');
    }
    rest = s.slice(schemeMatch[0].length);
  }
  // Strip leading "//" if user typed //example.com
  rest = rest.replace(/^\/+/, '');

  // Split authority from path/query/fragment
  const fragIdx = rest.search(/[?#]/);
  const authority = (fragIdx === -1 ? rest : rest.slice(0, fragIdx)).replace(/\/.*$/, '');

  // Handle userinfo@ (reject — never accept credentials)
  if (authority.includes('@')) {
    throw makeError('invalid_input', 'Usernames or passwords in the input are not accepted. Enter a domain only.');
  }

  let hostport = authority || '';
  let port = null;
  if (hostport.startsWith('[')) {
    throw makeError('invalid_input', 'IP addresses are not accepted — enter a domain name (e.g. example.com).');
  }
  const colon = hostport.lastIndexOf(':');
  if (colon !== -1 && /^\d+$/.test(hostport.slice(colon + 1))) {
    const p = Number(hostport.slice(colon + 1));
    if (p < 1 || p > 65535) throw makeError('invalid_input', 'Port number out of range.');
    port = p;
    hostport = hostport.slice(0, colon);
  }

  let host = hostport.trim().toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1); // trailing root dot — cosmetic only
  if (!host) throw makeError('invalid_input', 'Please enter a domain name (e.g. example.com).');
  if (isIpLiteral(host)) {
    throw makeError('invalid_input', 'IP addresses are not accepted — enter a domain name (e.g. example.com).');
  }

  // IDN → ASCII (punycode). Reject spoofed labels.
  let asciiHost;
  try {
    asciiHost = domainToASCII(host);
  } catch (e) {
    throw makeError('invalid_input', 'That domain contains characters that cannot be converted to a valid domain.');
  }
  if (!asciiHost || asciiHost.length > 253 || /[\u0000-\u0020\u007f]/.test(asciiHost)) {
    throw makeError('invalid_input', 'That does not look like a valid domain name.');
  }
  let unicodeHost = null;
  try { unicodeHost = domainToUnicode(asciiHost); } catch (e) { /* keep null */ }

  const labels = asciiHost.split('.');
  const tldLabel = labels[labels.length - 1];
  if (RESERVED_TLDS.has(tldLabel)) {
    throw makeError('invalid_input', '"' + tldLabel + '" is a reserved name, not a public domain.');
  }
  if (labels.length < 2) {
    throw makeError('invalid_input', 'Enter a full domain name such as example.com (top-level names alone cannot be checked).');
  }
  for (const lab of labels) {
    if (!lab) throw makeError('invalid_input', 'That domain name contains an empty label.');
    if (lab.length > 63) throw makeError('invalid_input', 'A label in that domain is longer than 63 characters.');
    if (!LABEL_RE.test(lab)) {
      throw makeError('invalid_input', 'That domain contains invalid characters (allowed: letters, digits, hyphens).');
    }
  }

  // Public-suffix resolution
  const suffixInfo = publicSuffixFor(labels);
  let suffix, registrable, subdomain, suffixKnown;
  if (suffixInfo && suffixInfo.suffix) {
    suffix = suffixInfo.suffix;
    suffixKnown = true;
    const suffixLabels = suffix.split('.').length;
    if (labels.length > suffixLabels) {
      registrable = labels.slice(-(suffixLabels + 1)).join('.');
      const sub = labels.slice(0, labels.length - (suffixLabels + 1));
      subdomain = sub.length ? sub.join('.') : null;
    } else {
      // the host IS a public suffix (e.g. "co.uk") — not a registrable domain
      registrable = null;
      subdomain = null;
    }
  } else {
    suffix = tldLabel;
    suffixKnown = false;
    registrable = labels.length >= 2 ? labels.slice(-2).join('.') : null;
    const sub = labels.slice(0, -2);
    subdomain = sub.length ? sub.join('.') : null;
  }
  if (!registrable) {
    throw makeError('invalid_input', '"' + asciiHost + '" is a reserved suffix (e.g. a TLD or registry level), not a domain you can look up.');
  }

  const isIdn = unicodeHost !== asciiHost;

  return {
    raw: s,
    scheme: scheme, // 'http' | 'https' | null (unknown → default https)
    hostname: asciiHost,
    unicodeHostname: unicodeHost,
    port,
    path: fragIdx !== -1 ? rest.slice(fragIdx) : null,
    isIdn,
    idn: { asciiDomain: asciiHost, unicodeDomain: unicodeHost },
    labels,
    tld: suffix,               // public suffix (e.g. "com", "co.uk")
    tldLastLabel: tldLabel,
    tldKnown: suffixKnown,
    registrable,               // e.g. example.com
    subdomain,
    structure: {
      protocol: scheme || 'https', // assumed protocol, labelled as such downstream
      subdomain,
      rootDomain: registrable,
      tld: suffix,
      port,
      path: fragIdx !== -1 ? rest.slice(fragIdx) : null
    }
  };
}

module.exports = { parseInput, isIpLiteral, hasTld };
