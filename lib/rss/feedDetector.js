'use strict';

/*
 * RSS Feed Generator — existing feed detection.
 * Checks the standard locations plus <link rel="alternate"> references in the
 * homepage HTML. Only a URL that actually serves a parseable RSS/Atom
 * document counts as an existing feed (a 200 with HTML is not a feed).
 *
 * Deterministic + SSRF-safe (reuses the shared safe fetcher).
 */

const { safeFetch } = require('../llmstxt/safeFetcher');
const { normalizeUrl } = require('../llmstxt/urlNormalizer');
const { parseFeed } = require('./feedParser');

const CANDIDATE_PATHS = ['/feed/', '/feed', '/rss.xml', '/rss', '/feed.xml', '/atom.xml'];

/* Extract rel="alternate" feed references from raw HTML. */
function feedLinkTags(html, base) {
  const out = [];
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const tag = m[0];
    const rel = (tag.match(/rel\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    const type = (tag.match(/type\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    const href = (tag.match(/href\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    if (!/alternate/i.test(rel)) continue;
    if (!/rss|atom|xml/i.test(type)) continue;
    const u = normalizeUrl(href, base);
    if (u) out.push({ url: u, type, title: (tag.match(/title\s*=\s*["']([^"']*)["']/i) || [])[1] || '' });
  }
  return out;
}

async function probeFeed(url, opts) {
  try {
    const r = await safeFetch(url, { ...opts, accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*;q=0.5', maxBytes: 1.5 * 1024 * 1024 });
    const body = String(r.body || '');
    if (r.status !== 200) return { url, status: r.status, found: false };
    if (!/<(rss|feed)\b/i.test(body.slice(0, 2000))) {
      // Not feed markup — some sites serve HTML at /feed/; never trust it.
      return { url, status: r.status, found: false, reason: 'Response is not an RSS/Atom document' };
    }
    const feed = parseFeed(body);
    if (!feed) return { url, status: r.status, found: false, reason: 'Malformed feed document' };
    return { url, status: r.status, found: true, feed, bytes: r.bytes, contentType: r.contentType };
  } catch (e) {
    return { url, status: 0, found: false, error: e.message, code: e.code };
  }
}

/**
 * @param {string} origin  e.g. https://example.com
 * @param {string} homeHtml homepage HTML (for rel=alternate discovery)
 * @param {string} root     final root URL (base for relative feed hrefs)
 */
async function detectExistingFeed(origin, homeHtml, root, opts = {}) {
  const result = { candidates: [], checked: 0, existing: null, wordpress: false };
  const toCheck = [];
  const seen = new Set();
  const push = (u) => {
    if (!u || seen.has(u)) return;
    seen.add(u);
    toCheck.push(u);
  };
  for (const p of CANDIDATE_PATHS) { try { push(new URL(p, origin).toString()); } catch {} }
  for (const ref of feedLinkTags(homeHtml, root)) push(ref.url);

  // Probe at most 6 candidates, sequentially (they are cheap XML docs).
  for (const url of toCheck.slice(0, 6)) {
    result.checked++;
    const probe = await probeFeed(url, opts);
    result.candidates.push({ url, status: probe.status, found: probe.found, reason: probe.reason || null, error: probe.error || null });
    if (probe.found && !result.existing) {
      result.existing = {
        url: probe.url,
        format: probe.feed.format,
        title: probe.feed.title,
        link: probe.feed.link,
        description: probe.feed.description,
        itemCount: probe.feed.items.length,
        items: probe.feed.items.slice(0, 500),
        rawLength: probe.bytes,
        contentType: probe.contentType
      };
    }
  }

  // WordPress signal: /feed/ RSS + wp-content in the homepage.
  if (result.existing && /wp-content\//i.test(String(homeHtml || ''))) result.wordpress = true;
  return result;
}

module.exports = { detectExistingFeed, feedLinkTags, CANDIDATE_PATHS, probeFeed };
