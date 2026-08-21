'use strict';

/**
 * Sitemap Discovery Module
 * Automatically discovers:
 * - /sitemap.xml
 * - /sitemap_index.xml
 * - /sitemap-index.xml
 * - sitemap URLs inside robots.txt
 * Parses sitemap indexes recursively within safe limits.
 */

const { safeFetch } = require('./safeFetcher');
const { normalizeUrl } = require('./urlNormalizer');

const CANDIDATES = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml', '/sitemap.xml.gz', '/wp-sitemap.xml'];

function extractLocs(xml, base) {
  const out = [];
  const re = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const raw = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    const n = normalizeUrl(raw, base);
    if (n && n.url) out.push(n.url);
  }
  return out;
}

function isSitemapIndex(xml) {
  return /<sitemapindex\b/i.test(xml);
}

function isUrlset(xml) {
  return /<urlset\b/i.test(xml);
}

async function readSitemap(url, opts = {}) {
  try {
    const r = await safeFetch(url, { ...opts, accept: 'application/xml,text/xml,*/*;q=0.8', maxBytes: 3 * 1024 * 1024, method: 'GET' });
    const ct = String(r.headers['content-type'] || '').toLowerCase();
    const body = r.body || '';
    const looksXml = ct.includes('xml') || /<(urlset|sitemapindex)\b/i.test(body) || body.trim().startsWith('<?xml');
    if (r.status === 200 && looksXml) {
      const urls = extractLocs(body, r.finalUrl);
      return {
        url: r.finalUrl,
        originalUrl: url,
        status: r.status,
        xml: body,
        valid: true,
        urls,
        isIndex: isSitemapIndex(body),
        isUrlset: isUrlset(body),
        count: urls.length,
        headers: r.headers
      };
    }
    return { url, status: r.status, valid: false, urls: [], isIndex: false, count: 0, headers: r.headers };
  } catch (e) {
    return { url, status: 0, valid: false, urls: [], isIndex: false, count: 0, error: e.message, code: e.code };
  }
}

async function discoverSitemaps(origin, robots, opts = {}) {
  const maxSitemaps = opts.maxSitemaps || 10;
  const maxUrlsPerSitemap = opts.maxUrlsPerSitemap || 5000;
  const maxTotalUrls = opts.maxTotalUrls || 10000;

  const candidates = [];
  for (const p of CANDIDATES) {
    try { candidates.push(new URL(p, origin).toString()); } catch {}
  }
  if (robots && robots.sitemaps) {
    for (const s of robots.sitemaps) {
      const n = normalizeUrl(s, origin);
      if (n && n.url) candidates.push(n.url);
    }
  }

  const seen = new Set();
  const queue = [...candidates];
  const found = [];
  let totalUrls = 0;

  while (queue.length && found.length < maxSitemaps && totalUrls < maxTotalUrls) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);

    opts.onProgress && opts.onProgress({ stage: 'sitemap_discovery', message: `Checking sitemap: ${url}` });

    const sm = await readSitemap(url, opts);
    if (!sm.valid) continue;

    if (sm.isIndex) {
      // Enqueue child sitemaps
      for (const childUrl of sm.urls.slice(0, maxSitemaps * 2)) {
        if (!seen.has(childUrl) && found.length + queue.length < maxSitemaps * 2) {
          queue.push(childUrl);
        }
      }
      found.push({ ...sm, urls: [] }); // index itself doesn't contain page URLs
    } else {
      const limitedUrls = sm.urls.slice(0, maxUrlsPerSitemap);
      totalUrls += limitedUrls.length;
      found.push({ ...sm, urls: limitedUrls });
    }
  }

  // Flatten all page URLs from non-index sitemaps
  const allPageUrls = [];
  for (const f of found) {
    if (!f.isIndex) allPageUrls.push(...f.urls);
  }

  return {
    sitemaps: found,
    pageUrls: [...new Set(allPageUrls)].slice(0, maxTotalUrls),
    candidatesChecked: seen.size
  };
}

async function analyzeSitemapUrls(sitemapUrl, opts = {}) {
  const sm = await readSitemap(sitemapUrl, opts);
  if (!sm.valid) return { valid: false, error: 'Invalid sitemap', url: sitemapUrl };
  // Further analysis can be done elsewhere
  return sm;
}

module.exports = { discoverSitemaps, readSitemap, extractLocs, analyzeSitemapUrls };
