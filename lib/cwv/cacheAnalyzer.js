'use strict';

/*
 * Core Web Vitals & INP Auditor — caching audit.
 * Reads the response headers actually observed (Cache-Control, Expires,
 * ETag, Last-Modified, Age, Vary). Static assets and HTML documents are
 * separated: HTML caching is never pushed aggressively (stale-content
 * risk) and is only flagged when it is dangerously long-lived.
 */

function parseMaxAge(cc) {
  const s = String(cc || '');
  const m = s.match(/(?:^|,)\s*max-age\s*=\s*(\d+)/i);
  if (m) return parseInt(m[1], 10);
  return null;
}

function ttlSeconds(headers) {
  const h = headers || {};
  const cc = String(h['cache-control'] || '');
  if (/no-store/i.test(cc)) return 0;
  const maxAge = parseMaxAge(cc);
  if (maxAge != null) return maxAge;
  if (/no-cache/i.test(cc)) return 0;
  if (h.expires) {
    const t = Date.parse(h.expires);
    if (!isNaN(t)) return Math.max(0, Math.round((t - Date.now()) / 1000));
  }
  return null; // unknown — browser heuristic
}

function isStaticUrl(url) {
  return /\.(css|js|mjs|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|pdf|json|xml|txt)([?#]|$)/i.test(String(url || '')) || /^\/?(assets|static|dist|img|images|fonts|css|js|media|_next|wp-content\/uploads|wp-content\/themes)\//i.test(String(url || ''));
}

function analyzeCache(resourceMeta, docHeaders) {
  const out = {
    status: 'unavailable',
    reason: null,
    static: { total: 0, cacheable: 0, longLived: 0, noCacheHeaders: [], shortTtl: [] },
    html: { status: null, note: null, headers: {} },
    notes: []
  };
  if (!resourceMeta || resourceMeta.mode !== 'server-proxy') {
    out.reason = 'Response headers for subresources were not observable in this transport mode (browser-direct). Only the document headers were visible.';
    if (docHeaders) {
      out.html.headers = docHeaders;
      const cc = String(docHeaders['cache-control'] || '');
      out.html.status = cc ? ('observed: ' + cc) : 'no Cache-Control header observed';
    }
    return out;
  }
  out.status = 'measured';
  const items = Array.isArray(resourceMeta.items) ? resourceMeta.items : [];
  // The HTML document is audited from its own recorded headers — never from
  // a non-static subresource that happens to look dynamic.
  const doc = docHeaders && Object.keys(docHeaders).length ? { url: '(document)', headers: docHeaders } : null;
  const staticItems = items.filter(m => m && isStaticUrl(m.url));

  staticItems.forEach(m => {
    out.static.total++;
    const ttl = ttlSeconds(m.headers);
    if (ttl != null && ttl > 0) {
      out.static.cacheable++;
      if (ttl >= 7 * 24 * 3600) out.static.longLived++;
      else if (ttl < 3600) out.static.shortTtl.push({ url: m.url, ttlSeconds: ttl });
    } else if (ttl === 0 || !m.headers['cache-control']) {
      out.static.noCacheHeaders.push({ url: m.url, header: m.headers['cache-control'] || '(none)' });
    }
  });

  if (doc) {
    const ttl = ttlSeconds(doc.headers);
    out.html.headers = doc.headers;
    if (ttl != null && ttl > 86400) {
      out.html.status = 'long-lived';
      out.html.note = 'The HTML document is served with a long cache lifetime (' + Math.round(ttl / 3600) + ' h). If this is a frequently updated page, visitors may see stale content. HTML caching is a trade-off — this is reported, not automatically condemned.';
    } else {
      out.html.status = 'ok';
      out.html.note = 'HTML is served with short/no caching, which avoids stale-content problems.';
    }
  }
  out.notes.push('Static assets are separated from HTML documents; aggressive caching is only recommended for static assets.');
  return out;
}

module.exports = { analyzeCache, parseMaxAge, isStaticUrl, ttlSeconds };
