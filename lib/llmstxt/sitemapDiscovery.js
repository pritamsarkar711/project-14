'use strict';

/*
 * LLMs.txt Generator — sitemap discovery.
 * Checks /sitemap.xml, /sitemap_index.xml, /sitemap-index.xml (plus a few
 * WordPress/compressed candidates) and any Sitemap: lines in robots.txt.
 * Sitemap indexes are followed recursively within safe limits.
 * Deterministic; no AI, no paid SEO APIs.
 */

const { safeFetch } = require('./safeFetcher');
const { normalizeUrl, isInternal } = require('./urlNormalizer');

const CANDIDATES = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml', '/wp-sitemap.xml', '/sitemap.xml.gz', '/sitemap-index.xml.gz'];

function extractLocs(xml, base) {
  const out = [];
  const re = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    const raw = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
    const n = normalizeUrl(raw, base);
    if (n) out.push(n);
  }
  return [...new Set(out)];
}

function looksLikeXml(body) {
  return /<(urlset|sitemapindex)\b/i.test(String(body || '')) || String(body || '').trim().startsWith('<?xml');
}

async function readSitemap(url, opts = {}) {
  try {
    const r = await safeFetch(url, { ...opts, accept: 'application/xml,text/xml,*/*;q=0.8', maxBytes: 3 * 1024 * 1024 });
    const ct = String(r.contentType || '').toLowerCase();
    const xml = looksLikeXml(r.body) || ct.includes('xml');
    if (r.status === 200 && xml) {
      const isIndex = /<sitemapindex\b/i.test(r.body);
      const urls = extractLocs(r.body, r.finalUrl);
      return { url: r.finalUrl, originalUrl: url, status: r.status, valid: true, isIndex, urls, count: urls.length };
    }
    return { url, status: r.status, valid: false, isIndex: false, urls: [], count: 0 };
  } catch (e) {
    return { url, status: 0, valid: false, isIndex: false, urls: [], count: 0, error: e.message, code: e.code };
  }
}

async function discoverSitemaps(origin, robots, opts = {}) {
  const maxSitemaps = opts.maxSitemaps || 12;
  const maxTotalUrls = opts.maxTotalUrls || 20000;

  const candidates = [];
  for (const p of CANDIDATES) { try { candidates.push(new URL(p, origin).toString()); } catch {} }
  if (robots && robots.sitemaps) for (const s of robots.sitemaps) { const n = normalizeUrl(s, origin); if (n) candidates.push(n); }

  const seen = new Set();
  const queue = [...new Set(candidates)];
  const found = []; // { url, isIndex, count, urls }
  let totalUrls = 0;

  while (queue.length && found.length < maxSitemaps && totalUrls < maxTotalUrls) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    opts.onProgress && opts.onProgress({ stage: 'sitemaps', message: 'Sitemap discovery' });
    const sm = await readSitemap(url, opts);
    if (!sm.valid) continue;
    if (sm.isIndex) {
      for (const child of sm.urls.slice(0, maxSitemaps * 2)) {
        if (!seen.has(child)) queue.push(child);
      }
      found.push({ url: sm.url, isIndex: true, count: sm.count, urls: [] });
    } else {
      const limited = sm.urls.slice(0, maxTotalUrls - totalUrls);
      totalUrls += limited.length;
      found.push({ url: sm.url, isIndex: false, count: limited.length, urls: limited });
    }
  }

  const pageUrls = [];
  for (const f of found) if (!f.isIndex) pageUrls.push(...f.urls);
  return {
    sitemaps: found,
    pageUrls: [...new Set(pageUrls)].slice(0, maxTotalUrls),
    checked: seen.size
  };
}

/* Filter sitemap page URLs to the scanned site only. */
function internalSitemapUrls(pageUrls, root, includeSubdomains) {
  return pageUrls.filter(u => isInternal(u, root, includeSubdomains));
}

module.exports = { discoverSitemaps, readSitemap, extractLocs, internalSitemapUrls, CANDIDATES };
