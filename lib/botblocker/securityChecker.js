'use strict';

/*
 * Security checker (pure analysis) — given the results of fetching a site's
 * robots.txt and homepage, produce an evidence-based report. Never claims a
 * crawler is technically blocked: only reports which rules were found asking
 * crawlers to stay away. Transport/headers are reported as evidence.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else {
    const BB = root.BB = root.BB || {};
    BB.securityChecker = factory(name => {
      const key = name.replace(/^\.\//, '');
      if (!BB[key]) throw new Error('botblocker module missing: ' + name);
      return BB[key];
    });
  }
})(typeof self !== 'undefined' ? self : globalThis, function (require) {

  const { parse } = require('./robotsParser');
  const conflicts = require('./ruleConflictDetector');
  const db = require('./botDatabase');
  const { uaContainsToken } = require('./botPatternMatcher');

  const CDN_HINTS = [
    { header: 'cf-ray', contains: null, name: 'Cloudflare', note: 'cf-ray response header — served through the Cloudflare edge.' },
    { header: 'x-vercel-id', contains: null, name: 'Vercel', note: 'x-vercel-id header present.' },
    { header: 'x-nf-request-id', contains: null, name: 'Netlify', note: 'x-nf-request-id header present.' },
    { header: 'x-github-request-id', contains: null, name: 'GitHub Pages', note: 'x-github-request-id header present.' },
    { header: 'x-served-by', contains: 'cache-', name: 'Fastly', note: 'x-served-by cache header present.' },
    { header: 'x-amz-cf-id', contains: null, name: 'Amazon CloudFront', note: 'x-amz-cf-id header present.' },
    { header: 'x-amz-request-id', contains: null, name: 'AWS S3/ALB', note: 'x-amz-request-id header present.' },
    { header: 'x-fw-server', contains: 'fly', name: 'Fly.io', note: 'x-fw-server header present.' }
  ];

  const SECURITY_HEADERS = [
    ['strict-transport-security', 'HSTS'],
    ['content-security-policy', 'CSP'],
    ['x-content-type-options', 'X-Content-Type-Options'],
    ['x-frame-options', 'X-Frame-Options'],
    ['referrer-policy', 'Referrer-Policy'],
    ['permissions-policy', 'Permissions-Policy']
  ];

  function lower(headers) {
    const out = {};
    if (headers) for (const k of Object.keys(headers)) out[String(k).toLowerCase()] = headers[k];
    return out;
  }

  function analyze(input) {
    const robotsFetch = input.robots || null;   // { ok, status, contentType, body, finalUrl, error, redirects }
    const homeFetch = input.home || null;       // { ok, status, headers, finalUrl, error, redirects }
    const sections = [];
    const findings = [];

    // ── robots.txt ────────────────────────────────────────────────
    const robotsSection = { title: 'robots.txt', items: [] };
    let parsed = null;
    if (!robotsFetch || robotsFetch.error) {
      robotsSection.items.push({ status: 'bad', text: 'robots.txt could not be fetched' + (robotsFetch && robotsFetch.error ? ' — ' + robotsFetch.error : '') + '. No conclusion can be drawn about the site\u2019s crawler rules.' });
    } else if (robotsFetch.status === 200) {
      parsed = parse(robotsFetch.body);
      robotsSection.items.push({ status: 'ok', text: 'robots.txt found (HTTP 200, ' + (robotsFetch.body ? robotsFetch.body.length : 0).toLocaleString() + ' bytes' + (robotsFetch.contentType ? ', ' + robotsFetch.contentType : '') + ').' });
      robotsSection.items.push({ status: 'info', text: parsed.stats.groups + ' User-agent group(s), ' + parsed.stats.rules + ' rule(s), ' + parsed.stats.sitemaps + ' sitemap declaration(s).' });

      // AI bot rules detected
      const controlled = [];
      for (const g of parsed.groups) {
        for (const a of g.agentsLower) {
          if (a === '*') continue;
          const bot = db.byToken(a);
          if (bot) controlled.push(bot);
        }
      }
      const aiControlled = controlled.filter(b => db.AI_CATEGORIES.includes(b.category));
      if (aiControlled.length) {
        robotsSection.items.push({
          status: 'info',
          text: 'AI-bot rules detected for: ' + aiControlled.map(b => b.token + ' (' + db.CATEGORY_LABELS[b.category] + ')').join(', ') + '. These rules REQUEST those crawlers not to crawl — they are not technical blocks.'
        });
        findings.push('AI crawler rules found for ' + aiControlled.length + ' known AI crawler token(s). robots.txt is advisory: it does not enforce access control.');
      } else {
        robotsSection.items.push({ status: 'info', text: 'No rules detected for known AI crawler tokens in our database.' });
      }
      const wildBlock = parsed.groups.find(g => g.agentsLower.includes('*') && g.rules.some(r => r.type === 'disallow' && r.path === '/'));
      if (wildBlock) {
        robotsSection.items.push({ status: 'warn', text: 'The wildcard (*) group disallows the entire site — every compliant crawler, including search engines, is asked not to crawl.' });
        findings.push('Wildcard Disallow: / found — potentially unintended blocking of search engines.');
      }
      const cf = conflicts.analyze(parsed);
      for (const issue of cf.issues) {
        if (issue.level === 'error') robotsSection.items.push({ status: 'bad', text: 'Conflict: ' + issue.title + ' — ' + issue.detail });
        else if (issue.level === 'warning') robotsSection.items.push({ status: 'warn', text: 'Warning: ' + issue.title + ' — ' + issue.detail });
      }
      if (parsed.sitemaps.length) robotsSection.items.push({ status: 'info', text: 'Sitemaps declared: ' + parsed.sitemaps.join(', ') });
    } else if (robotsFetch.status === 404) {
      robotsSection.items.push({ status: 'warn', text: 'robots.txt returns 404. Per RFC 9309 this means crawlers may crawl anything (absence of rules = no restrictions).' });
    } else {
      robotsSection.items.push({ status: 'bad', text: 'robots.txt returned HTTP ' + robotsFetch.status + ' — not readable, no rules can be confirmed.' });
    }
    sections.push(robotsSection);

    // ── Transport ─────────────────────────────────────────────────
    const transport = { title: 'HTTPS & response', items: [] };
    const finalUrl = (homeFetch && homeFetch.finalUrl) || (robotsFetch && robotsFetch.finalUrl) || input.url || '';
    const isHttps = /^https:\/\//i.test(String(finalUrl));
    if (homeFetch && !homeFetch.error) {
      transport.items.push({ status: isHttps ? 'ok' : 'warn', text: (isHttps ? 'HTTPS confirmed' : 'Not using HTTPS') + ' (final URL ' + finalUrl + ').' });
      transport.items.push({ status: homeFetch.status === 200 ? 'ok' : 'warn', text: 'Homepage responded with HTTP ' + homeFetch.status + '.' + ((homeFetch.redirects || 0) > 0 ? ' ' + homeFetch.redirects + ' redirect(s) followed.' : '') });
    } else {
      transport.items.push({ status: 'bad', text: 'Homepage could not be fetched' + (homeFetch && homeFetch.error ? ' — ' + homeFetch.error : '') + '.' });
    }
    sections.push(transport);

    // ── CDN / server ──────────────────────────────────────────────
    const cdn = { title: 'CDN / server detection', items: [] };
    if (homeFetch && !homeFetch.error && homeFetch.headers) {
      const h = lower(homeFetch.headers);
      const server = h['server'];
      cdn.items.push({ status: 'info', text: server ? 'Server header: ' + server : 'No Server header disclosed.' });
      let detected = null;
      for (const hint of CDN_HINTS) {
        const v = h[hint.header];
        if (v !== undefined && (hint.contains === null || String(v).toLowerCase().includes(hint.contains))) { detected = hint; break; }
      }
      if (detected) cdn.items.push({ status: 'ok', text: 'CDN detected: ' + detected.name + ' (' + detected.note + ') — CDN/WAF-level AI-bot rules may be available to you there.' });
      else cdn.items.push({ status: 'info', text: 'No CDN evidence in response headers (this does not prove there is none).' });
    } else {
      cdn.items.push({ status: 'info', text: 'No headers available — CDN detection skipped.' });
    }
    sections.push(cdn);

    // ── Security headers (informational) ─────────────────────────
    const sec = { title: 'Security headers (informational)', items: [] };
    if (homeFetch && !homeFetch.error && homeFetch.headers) {
      const h = lower(homeFetch.headers);
      for (const [header, label] of SECURITY_HEADERS) {
        sec.items.push({ status: h[header] !== undefined ? 'ok' : 'info', text: (h[header] !== undefined ? label + ' present' : label + ' not present — informational only; not related to AI crawler blocking.') });
      }
    } else {
      sec.items.push({ status: 'info', text: 'No headers available.' });
    }
    sections.push(sec);

    return {
      url: input.url || '',
      sections, parsed, findings,
      disclaimer: 'Evidence-based report: the checker only states what it observed. It never claims a crawler is technically blocked unless a technical control was observed — and robots.txt is not one.'
    };
  }

  return { analyze };
});
