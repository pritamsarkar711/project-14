'use strict';

const U = require('./util');
const R = require('./ezoicRules');

function analyzeTechnical(pages, ctx) {
  const out = [];
  const start = ctx.start;
  const https = /^https:/.test(start);
  out.push(R.finding(R.get('EZ-HTTPS'), 'Site', https ? 'passed' : 'high',
    https ? 'Start URL is HTTPS and the crawl completed a TLS handshake.' : 'Start URL is HTTP, not HTTPS.',
    { confidence: 0.99, severity: https ? 'passed' : 'high' }));

  if (ctx.robots && ctx.robots.blocksAll) {
    out.push({
      id: 'TECH_ROBOTS_BLOCK',
      category: 'tech',
      name: 'robots.txt blocks all crawlers',
      status: 'critical',
      severity: 'critical',
      page: 'Site',
      evidence: 'robots.txt contains Disallow: / for user-agent *. Additional pages were not crawled.',
      why: 'Heuristic / technical. A global block prevents reviewers and demand partners from reading the site.',
      fix: 'Remove the site-wide disallow before applying to Ezoic.',
      confidence: 99,
      sourceType: 'heuristic',
      automated: true,
      weight: 8
    });
  }

  out.push({
    id: 'TECH_ROBOTS',
    category: 'tech',
    name: 'robots.txt',
    status: ctx.robots && ctx.robots.txt ? 'passed' : 'low',
    severity: ctx.robots && ctx.robots.txt ? 'passed' : 'low',
    page: 'Site',
    evidence: ctx.robots && ctx.robots.txt ? 'robots.txt fetched (' + ctx.robots.txt.length + ' bytes, ' + (ctx.robots.sitemaps || []).length + ' sitemap reference(s)).' : 'No robots.txt found.',
    why: 'Heuristic. robots.txt is expected on production sites.',
    fix: 'Add a robots.txt that allows crawling of public content and references the XML sitemap.',
    confidence: 85,
    sourceType: 'heuristic',
    automated: true,
    weight: 1
  });

  out.push({
    id: 'TECH_SITEMAP',
    category: 'tech',
    name: 'XML sitemap',
    status: (ctx.sitemapUrls && ctx.sitemapUrls.length) ? 'passed' : 'low',
    severity: (ctx.sitemapUrls && ctx.sitemapUrls.length) ? 'passed' : 'low',
    page: 'Site',
    evidence: ctx.sitemapUrls && ctx.sitemapUrls.length ? ctx.sitemapUrls.length + ' URL(s) discovered from sitemap files.' : 'No XML sitemap discovered from robots.txt or common sitemap paths.',
    why: 'Heuristic. Sitemaps help discovery; they are not an official Ezoic eligibility rule.',
    fix: 'Publish an XML sitemap and list it in robots.txt.',
    confidence: 80,
    sourceType: 'heuristic',
    automated: true,
    weight: 1
  });

  if (ctx.challenge) {
    out.push({
      id: 'TECH_CHALLENGE',
      category: 'tech',
      name: 'Bot / Cloudflare challenge',
      status: 'high',
      severity: 'high',
      page: 'Site',
      evidence: 'One or more responses looked like a Cloudflare or bot-challenge page (cf-ray / challenge body). Extracted content may be incomplete.',
      why: 'Heuristic. If public readers cannot see the site, reviewers cannot either.',
      fix: 'Allow legitimate crawlers through the challenge, or exclude the checker IP from the firewall.',
      confidence: 70,
      sourceType: 'heuristic',
      automated: true,
      weight: 6
    });
  }

  let jsHeavy = 0;
  let noindex = 0;
  let serverErr = 0;
  let notFound = 0;
  let mixed = 0;
  const mixedUrls = [];

  pages.forEach(p => {
    const path = U.pathOf(p.url);
    if (p.error) {
      out.push({
        id: 'TECH_UNREACHABLE',
        category: 'tech',
        name: 'Unreachable page',
        status: 'high',
        severity: 'high',
        page: path,
        evidence: 'Could not read ' + path + ': ' + p.error,
        why: 'Heuristic. Broken URLs reduce crawl confidence.',
        fix: 'Fix the server or remove the link.',
        confidence: 70,
        sourceType: 'heuristic',
        automated: true,
        weight: 3
      });
      return;
    }
    if (p.status >= 500) { serverErr++; out.push({ id: 'TECH_STATUS', category: 'tech', name: 'Server error', status: 'high', severity: 'high', page: path, evidence: 'HTTP ' + p.status + '.', why: 'Heuristic.', fix: 'Fix the 5xx error.', confidence: 95, sourceType: 'heuristic', automated: true, weight: 4 }); }
    else if (p.status >= 400) { notFound++; out.push({ id: 'TECH_STATUS', category: 'tech', name: 'HTTP client error', status: 'medium', severity: 'medium', page: path, evidence: 'HTTP ' + p.status + '.', why: 'Heuristic.', fix: 'Restore or redirect the URL.', confidence: 95, sourceType: 'heuristic', automated: true, weight: 3 }); }
    else if (p.hops && p.hops.length > 3) {
      out.push(R.finding(R.get('EZ-REDIRECTS-POPUPS'), path, 'medium',
        'Redirect chain of ' + p.hops.length + ' hops: ' + p.hops.map(h => h.status).join(' → ') + '.',
        { confidence: 0.8 }));
    }

    const pa = p.parse;
    if (!pa) return;
    if (pa.jsHeavy) jsHeavy++;
    if (pa.noindex) {
      noindex++;
      out.push({
        id: 'TECH_NOINDEX',
        category: 'tech',
        name: 'noindex',
        status: path === '/' ? 'critical' : 'medium',
        severity: path === '/' ? 'critical' : 'medium',
        page: path,
        evidence: 'Page sends noindex via meta robots or X-Robots-Tag (' + (pa.robotsMeta || pa.xRobots || 'noindex') + ').',
        why: 'Heuristic. noindex pages are hidden from Google, which Ezoic depends on.',
        fix: 'Remove noindex from pages that should be public.',
        confidence: 95,
        sourceType: 'heuristic',
        automated: true,
        weight: path === '/' ? 7 : 3
      });
    }
    if (pa.mixedResources && pa.mixedResources.length) {
      mixed++;
      mixedUrls.push(path);
      out.push({
        id: 'TECH_MIXED',
        category: 'tech',
        name: 'Mixed content',
        status: 'high',
        severity: 'high',
        page: path,
        evidence: pa.mixedResources.length + ' resource(s) loaded over HTTP on an HTTPS page. Example: ' + pa.mixedResources[0],
        why: 'Heuristic. Browsers block mixed content and ads can fail to render.',
        fix: 'Serve every asset over HTTPS.',
        confidence: 90,
        sourceType: 'heuristic',
        automated: true,
        weight: 3
      });
    }
    if (!pa.title) {
      out.push({ id: 'TECH_TITLE', category: 'tech', name: 'Missing title', status: 'high', severity: 'high', page: path, evidence: 'No <title> tag.', why: 'Heuristic.', fix: 'Add a unique title.', confidence: 92, sourceType: 'heuristic', automated: true, weight: 2 });
    } else if (pa.titleLen < 12 || pa.titleLen > 70) {
      out.push({ id: 'TECH_TITLE', category: 'tech', name: 'Title length', status: 'low', severity: 'low', page: path, evidence: pa.titleLen + ' characters: “' + pa.title.slice(0, 80) + '”.', why: 'Heuristic.', fix: 'Aim for about 30–60 characters.', confidence: 70, sourceType: 'heuristic', automated: true, weight: 1 });
    }
    if (pa.h1.length !== 1) {
      out.push({ id: 'TECH_H1', category: 'tech', name: 'H1', status: pa.h1.length === 0 ? 'medium' : 'low', severity: pa.h1.length === 0 ? 'medium' : 'low', page: path, evidence: pa.h1.length + ' H1 tag(s).', why: 'Heuristic.', fix: 'Use exactly one descriptive H1.', confidence: 80, sourceType: 'heuristic', automated: true, weight: 1 });
    }
    if (pa.canonical && !U.sameSite(pa.canonical, p.url)) {
      out.push({ id: 'TECH_CANONICAL', category: 'tech', name: 'Canonical points off-site', status: 'medium', severity: 'medium', page: path, evidence: 'Canonical is ' + pa.canonical, why: 'Heuristic. Off-site canonicals can hide the page from indexing.', fix: 'Use a self-referencing canonical unless this is intentional syndication.', confidence: 75, sourceType: 'heuristic', automated: true, weight: 3 });
    }
    if (pa.invalidLd && pa.invalidLd.length) {
      out.push({ id: 'TECH_SCHEMA', category: 'tech', name: 'Invalid structured data', status: 'low', severity: 'low', page: path, evidence: pa.invalidLd.length + ' JSON-LD block(s) failed to parse.', why: 'Heuristic.', fix: 'Fix JSON-LD syntax.', confidence: 88, sourceType: 'heuristic', automated: true, weight: 1 });
    }
    if (pa.metaRefresh) {
      out.push(R.finding(R.get('EZ-REDIRECTS-POPUPS'), path, 'medium',
        'Meta refresh redirect detected.',
        { confidence: 0.75 }));
    }
  });

  if (jsHeavy >= Math.max(1, Math.ceil(pages.filter(p => p.parse).length * 0.5))) {
    out.push({
      id: 'TECH_JS_HEAVY',
      category: 'tech',
      name: 'JavaScript-heavy rendering',
      status: 'medium',
      severity: 'medium',
      page: 'Site',
      evidence: jsHeavy + ' page(s) contained almost no extractable text despite large HTML and many scripts. Analysis confidence is reduced; this checker does not run a headless browser on every page.',
      why: 'Heuristic. Client-rendered apps can look empty to crawlers that do not execute JavaScript.',
      fix: 'Provide server-rendered or prerendered HTML for public content.',
      confidence: 68,
      sourceType: 'heuristic',
      automated: true,
      weight: 5
    });
  }

  ctx.techStats = { serverErr, notFound, noindex, mixed, jsHeavy };
  return out;
}

module.exports = { analyzeTechnical };
