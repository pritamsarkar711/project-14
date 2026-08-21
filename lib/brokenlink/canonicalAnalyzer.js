'use strict';

/**
 * Canonical Analysis
 * For successfully crawled HTML pages, inspect <link rel="canonical">
 * Detect:
 * - canonical points to 404
 * - canonical points to redirect
 * - canonical points to inaccessible page
 * - canonical points to another domain
 * - canonical mismatch
 */

function extractCanonical(html, baseUrl) {
  html = String(html || '');
  const re = /<link\b[^>]*rel\s*=\s*(?:\"[^\"]*canonical[^\"]*\"|'[^']*canonical[^']*'|[^\s>]*canonical[^\s>]*)(?:[^>]*href\s*=\s*(?:\"([^\"]+)\"|'([^']+)'|([^\s>]+))|[^>]*)*>/i;
  // More robust: find all link tags and check rel
  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    if (!/rel\s*=\s*(?:\"[^\"]*canonical[^\"]*\"|'[^']*canonical[^']*'|[^\s>]*canonical)/i.test(tag)) continue;
    const hrefMatch = tag.match(/href\s*=\s*(?:\"([^\"]+)\"|'([^']+)'|([^\s>]+))/i);
    if (hrefMatch) {
      const raw = (hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || '').trim();
      if (raw) {
        try {
          const url = new URL(raw, baseUrl).toString();
          return url;
        } catch {
          return raw;
        }
      }
    }
  }
  return null;
}

function analyzeCanonical(pageUrl, html, opts = {}) {
  const canonical = extractCanonical(html, pageUrl);
  if (!canonical) return { hasCanonical: false };

  let result = {
    hasCanonical: true,
    canonical,
    pageUrl,
    issues: [],
    type: 'ok'
  };

  try {
    const page = new URL(pageUrl);
    const can = new URL(canonical);
    if (page.hostname.toLowerCase() !== can.hostname.toLowerCase()) {
      result.issues.push('Canonical points to another domain');
      result.type = 'cross_domain';
    }
    if (page.toString() !== can.toString()) {
      // Mismatch is not necessarily an issue, but note it
      if (page.pathname !== can.pathname || page.search !== can.search) {
        result.issues.push('Canonical mismatch');
        result.type = 'mismatch';
      }
    }
  } catch {
    result.issues.push('Invalid canonical URL');
    result.type = 'invalid';
  }

  return result;
}

async function validateCanonical(canonicalUrl, fetchFn, opts = {}) {
  if (!canonicalUrl) return { valid: false, reason: 'No canonical' };
  try {
    const res = await fetchFn(canonicalUrl, { ...opts, maxBytes: 300 * 1024 });
    if (res.status === 404) return { valid: false, type: 'canonical_404', reason: 'Canonical points to 404', status: 404 };
    if (res.status >= 300 && res.status < 400) return { valid: false, type: 'canonical_redirect', reason: `Canonical points to redirect (${res.status})`, status: res.status, finalUrl: res.finalUrl };
    if (res.status >= 400) return { valid: false, type: 'canonical_error', reason: `Canonical points to inaccessible page (${res.status})`, status: res.status };
    return { valid: true, type: 'canonical_ok', status: res.status, finalUrl: res.finalUrl };
  } catch (e) {
    return { valid: false, type: 'canonical_unreachable', reason: `Canonical unreachable: ${e.message}`, error: e.message };
  }
}

module.exports = { extractCanonical, analyzeCanonical, validateCanonical };
