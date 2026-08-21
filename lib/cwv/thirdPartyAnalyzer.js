'use strict';

/*
 * Core Web Vitals & INP Auditor — third-party audit.
 * Groups observed requests by hostname. Third parties are identified by
 * hostname only (vs the page host) and are NEVER automatically labelled
 * "bad": impact is reported from measured main-thread activity and
 * request placement. Category labels are heuristic and marked as such.
 */

const CATEGORY_HINTS = [
  { re: /(google-analytics|googletagmanager|gtag|gtm\.|analytics|mixpanel|amplitude|segment\.|hotjar|clarity\.ms|matomo|plausible|fathom|ga\.|pixel|facebook\.net\/tr|doubleclick|adsbygoogle|adnxs|adservice|advertising|adform|criteo|taboola|outbrain|mgid)/i, cat: 'Analytics / Ads' },
  { re: /(googletagmanager|tagmanager|gtm)/i, cat: 'Tag manager' },
  { re: /(facebook|twitter|x\.com|linkedin|pinterest|instagram|tiktok|snap|addthis|sharethis|disqus)/i, cat: 'Social / widgets' },
  { re: /(zendesk|intercom|tawk|livechat|chatbot|crisp|drift|freshchat|hubspot|messenger)/i, cat: 'Chat / support' },
  { re: /(jsdelivr|unpkg|cdnjs|googleapis|gstatic|cloudflare|fastly|akamai|cloudfront|netdna|maxcdn|bunnycdn)/i, cat: 'CDN' },
  { re: /(fonts\.googleapis|fonts\.gstatic|fontawesome|typekit|use\.typekit)/i, cat: 'Fonts' },
  { re: /(youtube|youtu\.be|vimeo|spotify|soundcloud|wistia)/i, cat: 'Embedded media' },
  { re: /(paypal|stripe|shopify|squareup|klarna|braintree|recurly)/i, cat: 'Payments' },
  { re: /(maps\.googleapis|mapbox|openstreetmap|googleapis\.com\/maps)/i, cat: 'Maps' }
];

function categoryFor(host) {
  for (const h of CATEGORY_HINTS) if (h.re.test(host)) return h.cat;
  return 'Other';
}

function analyzeThirdParties(resources, longTasks, docHost, jsFiles) {
  const res = Array.isArray(resources) ? resources : [];
  const pageHost = (function () {
    try { return new URL(String(docHost || 'http://invalid.invalid')).hostname.toLowerCase(); } catch (e) { return String(docHost || '').toLowerCase(); }
  })();
  const stripWww = h => String(h || '').toLowerCase().replace(/^www\./, '');

  const groups = new Map();
  res.forEach(r => {
    let host = null;
    try { host = new URL(r.name).hostname.toLowerCase(); } catch (e) {}
    if (!host || stripWww(host) === stripWww(pageHost)) return;
    const g = groups.get(host) || { domain: host, requests: 0, bytes: 0, bytesMeasurable: 0, blocking: 0, resources: [] };
    g.requests++;
    if (r.transferSize || r.encodedBodySize) { g.bytes += (r.transferSize || r.encodedBodySize); g.bytesMeasurable++; }
    g.resources.push({ url: r.name, type: r.initiatorType || 'other', startTime: typeof r.startTime === 'number' ? Math.round(r.startTime) : null });
    groups.set(host, g);
  });

  const out = { count: groups.size, parties: [], note: null };
  for (const g of groups.values()) {
    const longTaskMs = (Array.isArray(longTasks) ? longTasks : [])
      .filter(t => {
        const src = t.url || (t.attribution && t.attribution[0] && t.attribution[0].name) || '';
        return src.toLowerCase().includes(g.domain);
      })
      .reduce((s, t) => s + t.duration, 0);
    out.parties.push({
      domain: g.domain,
      requests: g.requests,
      bytes: g.bytesMeasurable ? g.bytes : null,
      mainThreadMs: Math.round(longTaskMs) || null,
      category: categoryFor(g.domain),
      categoryHeuristic: true,
      earliestStart: g.resources.reduce((m, r) => (r.startTime != null && r.startTime < m ? r.startTime : m), Infinity),
      resources: g.resources.slice(0, 6)
    });
  }
  out.parties.sort((a, b) => (b.mainThreadMs || 0) + (b.bytes || 0) / 1000 - ((a.mainThreadMs || 0) + (a.bytes || 0) / 1000));
  out.note = 'Third parties are identified by hostname. Categories are heuristic labels. A third party is only flagged for impact when measured main-thread activity or blocking requests support it — presence alone is not a problem.';
  return out;
}

module.exports = { analyzeThirdParties, categoryFor };
