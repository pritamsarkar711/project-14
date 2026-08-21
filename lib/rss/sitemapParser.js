'use strict';

/*
 * RSS Feed Generator — sitemap discovery + parsing.
 * Checks /sitemap.xml, /sitemap_index.xml, /sitemap-index.xml (+ WordPress
 * candidates and robots.txt Sitemap: lines). Sitemap indexes are followed
 * recursively within safe limits. Unlike the llms.txt tool, this parser also
 * captures <lastmod> per URL — the only legitimate date fallback — clearly
 * labelled as a fallback (never a publication date).
 */

const { safeFetch } = require('../llmstxt/safeFetcher');
const { normalizeUrl } = require('../llmstxt/urlNormalizer');
const { decodeEntities } = require('./xmlParser');

const CANDIDATES = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml', '/wp-sitemap.xml'];

function decodeLoc(s) {
  return String(s == null ? '' : s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
}

/* Parse a single sitemap document (urlset). Returns { isIndex, urls, indexes }. */
function parseSitemapXml(xml, base) {
  const isIndex = /<sitemapindex\b/i.test(String(xml || ''));
  const out = { isIndex, urls: [], indexes: [] };
  if (isIndex) {
    const re = /<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi;
    let m;
    while ((m = re.exec(String(xml || '')))) {
      const block = m[1];
      const loc = (block.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i) || [])[1];
      if (loc) {
        const u = normalizeUrl(decodeLoc(loc), base);
        if (u) out.indexes.push(u);
      }
    }
  } else {
    const re = /<url\b[^>]*>([\s\S]*?)<\/url>/gi;
    let m;
    while ((m = re.exec(String(xml || '')))) {
      const block = m[1];
      const loc = (block.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i) || [])[1];
      if (!loc) continue;
      const u = normalizeUrl(decodeLoc(loc), base);
      if (!u) continue;
      const lastmodRaw = (block.match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i) || [])[1] || '';
      out.urls.push({ loc: u, lastmod: lastmodRaw ? decodeEntities(decodeLoc(lastmodRaw)).trim() : null });
    }
  }
  return out;
}

async function readSitemap(url, opts = {}) {
  try {
    const r = await safeFetch(url, { ...opts, accept: 'application/xml,text/xml,*/*;q=0.8', maxBytes: 3 * 1024 * 1024 });
    const ct = String(r.contentType || '').toLowerCase();
    const body = String(r.body || '');
    const looksXml = /<(urlset|sitemapindex)\b/i.test(body) || body.trim().startsWith('<?xml');
    if (r.status === 200 && (looksXml || ct.includes('xml'))) {
      const parsed = parseSitemapXml(body, r.finalUrl);
      return { url: r.finalUrl, status: r.status, valid: true, ...parsed };
    }
    return { url, status: r.status, valid: false, isIndex: false, urls: [], indexes: [] };
  } catch (e) {
    return { url, status: 0, valid: false, isIndex: false, urls: [], indexes: [], error: e.message, code: e.code };
  }
}

/**
 * Discover sitemaps for an origin (standard paths + robots.txt lines),
 * following indexes recursively.
 * @returns {{sitemaps: Array, pageUrls: Array<{loc,lastmod}>, checked: number}}
 */
async function discoverSitemaps(origin, robots, opts = {}) {
  const maxSitemaps = opts.maxSitemaps || 12;
  const maxTotalUrls = opts.maxTotalUrls || 20000;

  const candidates = [];
  for (const p of CANDIDATES) { try { candidates.push(new URL(p, origin).toString()); } catch {} }
  if (robots && robots.sitemaps) for (const s of robots.sitemaps) { const n = normalizeUrl(s, origin); if (n) candidates.push(n); }

  const seen = new Set();
  const queue = [...new Set(candidates)];
  const found = [];
  let totalUrls = 0;

  while (queue.length && found.length < maxSitemaps && totalUrls < maxTotalUrls) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const sm = await readSitemap(url, opts);
    if (!sm.valid) continue;
    if (sm.isIndex) {
      for (const child of sm.indexes.slice(0, maxSitemaps * 2)) if (!seen.has(child)) queue.push(child);
      found.push({ url: sm.url, isIndex: true, count: sm.indexes.length, urls: [] });
    } else {
      const limited = sm.urls.slice(0, maxTotalUrls - totalUrls);
      totalUrls += limited.length;
      found.push({ url: sm.url, isIndex: false, count: limited.length, urls: limited });
    }
  }

  const pageUrls = [];
  const lastmodMap = new Map();
  for (const f of found) if (!f.isIndex) for (const u of f.urls) {
    pageUrls.push(u);
    if (u.lastmod && !lastmodMap.has(u.loc)) lastmodMap.set(u.loc, u.lastmod);
  }
  return { sitemaps: found, pageUrls, lastmodMap, checked: seen.size };
}

module.exports = { discoverSitemaps, readSitemap, parseSitemapXml, CANDIDATES };
