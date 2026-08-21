'use strict';

const U = require('./util');
const R = require('./ezoicRules');

function buildGraph(pages) {
  const idx = new Map();
  pages.forEach(p => { if (p.parse) idx.set(p.url.replace(/\/$/, ''), p); });
  const inLinks = new Map(), outLinks = new Map();
  pages.forEach(p => {
    const k = (p.url || '').replace(/\/$/, '');
    inLinks.set(k, new Set());
    outLinks.set(k, new Set());
  });
  pages.forEach(p => {
    if (!p.parse) return;
    const src = p.url.replace(/\/$/, '');
    (p.parse.links || []).forEach(l => {
      if (!l.internal || !l.href) return;
      const key = l.href.replace(/\/$/, '');
      if (outLinks.has(src)) outLinks.get(src).add(key);
      if (inLinks.has(key)) inLinks.get(key).add(src);
    });
  });
  const depth = new Map();
  const home = pages[0] ? pages[0].url.replace(/\/$/, '') : null;
  const q = [];
  if (home) { depth.set(home, 0); q.push(home); }
  while (q.length) {
    const cur = q.shift();
    const d = depth.get(cur);
    const outs = outLinks.get(cur);
    if (!outs) continue;
    outs.forEach(t => {
      if (!depth.has(t) && idx.has(t)) { depth.set(t, d + 1); q.push(t); }
    });
  }
  return { inLinks, outLinks, depth, home };
}

function analyzeUX(pages, ctx) {
  const out = [];
  const graph = buildGraph(pages);
  ctx.graph = graph;
  let missingViewport = 0;
  let missingNav = 0;
  let popups = 0;
  let emptyNav = 0;
  let autoplay = 0;

  pages.forEach(p => {
    if (!p.parse) return;
    const path = U.pathOf(p.url);
    const pa = p.parse;
    const vpOk = /width\s*=\s*device-width/i.test(pa.viewport || '');
    if (!vpOk) {
      missingViewport++;
      out.push({
        id: 'UX_VIEWPORT',
        category: 'ux',
        name: 'Mobile viewport',
        status: 'high',
        severity: 'high',
        page: path,
        evidence: pa.viewport ? 'viewport meta is “' + pa.viewport + '”' : 'No viewport meta tag.',
        why: 'Heuristic. Mobile-unfriendly pages perform poorly with ads.',
        fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
        confidence: 95,
        sourceType: 'heuristic',
        automated: true,
        weight: 3
      });
    }
    if (!pa.hasNav) {
      missingNav++;
      out.push({
        id: 'UX_NAV',
        category: 'ux',
        name: 'Missing navigation',
        status: 'high',
        severity: 'high',
        page: path,
        evidence: 'No <nav>, role=navigation, or common menu landmark found.',
        why: 'Heuristic. Ezoic quality notes expect a usable entry structure.',
        fix: 'Add an accessible main navigation.',
        confidence: 82,
        sourceType: 'heuristic',
        automated: true,
        weight: 3
      });
    } else if (pa.navLinks === 0) {
      emptyNav++;
      out.push({
        id: 'UX_NAV',
        category: 'ux',
        name: 'Empty navigation',
        status: 'medium',
        severity: 'medium',
        page: path,
        evidence: 'A navigation landmark exists but contains no links.',
        why: 'Heuristic.',
        fix: 'Put real section links in the main menu.',
        confidence: 70,
        sourceType: 'heuristic',
        automated: true,
        weight: 2
      });
    }
    if (!pa.hasFooter) {
      out.push({
        id: 'UX_FOOTER',
        category: 'ux',
        name: 'Missing footer',
        status: 'low',
        severity: 'low',
        page: path,
        evidence: 'No footer landmark detected.',
        why: 'Heuristic. Footers usually carry privacy and contact links, which Ezoic wants accessible from every page.',
        fix: 'Add a footer with policy links.',
        confidence: 70,
        sourceType: 'heuristic',
        automated: true,
        weight: 1
      });
    }
    if (pa.popups >= 2) {
      popups++;
      out.push(R.finding(R.get('EZ-REDIRECTS-POPUPS'), path, 'medium',
        pa.popups + ' popup/modal/overlay element(s) detected in markup.',
        { confidence: 0.55 }));
    }
    if (pa.autoplay) {
      autoplay++;
      out.push({
        id: 'UX_AUTOPLAY',
        category: 'ux',
        name: 'Auto-playing media',
        status: 'low',
        severity: 'low',
        page: path,
        evidence: pa.autoplay + ' autoplaying media element(s).',
        why: 'Heuristic.',
        fix: 'Require a user gesture before playback.',
        confidence: 70,
        sourceType: 'heuristic',
        automated: true,
        weight: 1
      });
    }
    if (pa.emptyLinks >= 3) {
      out.push({
        id: 'UX_EMPTY_LINK',
        category: 'ux',
        name: 'Empty links',
        status: 'medium',
        severity: 'medium',
        page: path,
        evidence: pa.emptyLinks + ' links have no text or accessible name.',
        why: 'Heuristic. Empty links look broken.',
        fix: 'Add link text or aria-label.',
        confidence: 80,
        sourceType: 'heuristic',
        automated: true,
        weight: 2
      });
    }
    if (pa.emptyButtons >= 2) {
      out.push({
        id: 'UX_EMPTY_BUTTON',
        category: 'ux',
        name: 'Empty buttons',
        status: 'low',
        severity: 'low',
        page: path,
        evidence: pa.emptyButtons + ' buttons have no label.',
        why: 'Heuristic.',
        fix: 'Label every button.',
        confidence: 75,
        sourceType: 'heuristic',
        automated: true,
        weight: 1
      });
    }
    if (!pa.mediaQueries && !vpOk) {
      out.push({
        id: 'UX_RESPONSIVE',
        category: 'ux',
        name: 'Mobile-unfriendly structure',
        status: 'medium',
        severity: 'medium',
        page: path,
        evidence: 'No viewport device-width and no @media rules detected in HTML/CSS references.',
        why: 'Heuristic. Cannot fully prove overflow without rendering.',
        fix: 'Use a responsive layout.',
        confidence: 60,
        sourceType: 'heuristic',
        automated: true,
        weight: 2
      });
    }

    const key = p.url.replace(/\/$/, '');
    const ins = graph.inLinks.get(key);
    const outs = graph.outLinks.get(key);
    const inCount = ins ? ins.size : 0;
    const outCount = outs ? outs.size : 0;
    if (key !== graph.home && inCount === 0 && pages.length > 4) {
      out.push({
        id: 'ARCH_ORPHAN',
        category: 'ux',
        name: 'Orphan candidate',
        status: 'medium',
        severity: 'medium',
        page: path,
        evidence: 'No internal links from other crawled pages point here.',
        why: 'Heuristic. Orphan pages are hard to discover.',
        fix: 'Link to it from related content or the sitemap navigation.',
        confidence: 65,
        sourceType: 'heuristic',
        automated: true,
        weight: 3
      });
    }
    if (outCount === 0 && ctx.pageType.get(p.url) !== 'product') {
      out.push({
        id: 'ARCH_DEAD_END',
        category: 'ux',
        name: 'Dead-end page',
        status: 'low',
        severity: 'low',
        page: path,
        evidence: 'Page has no internal links to other pages.',
        why: 'Heuristic.',
        fix: 'Add related links.',
        confidence: 60,
        sourceType: 'heuristic',
        automated: true,
        weight: 2
      });
    }
    const d = graph.depth.get(key);
    if (d != null && d > 4) {
      out.push({
        id: 'ARCH_DEEP',
        category: 'ux',
        name: 'Deep page',
        status: 'low',
        severity: 'low',
        page: path,
        evidence: 'Page is ' + d + ' clicks from the homepage in the crawl graph.',
        why: 'Heuristic.',
        fix: 'Add higher-level links.',
        confidence: 58,
        sourceType: 'heuristic',
        automated: true,
        weight: 1
      });
    }
  });

  const depths = [...graph.depth.values()];
  ctx.archStats = {
    avgDepth: depths.length ? U.round(depths.reduce((a, b) => a + b, 0) / depths.length, 1) : 0,
    maxDepth: depths.length ? Math.max.apply(null, depths) : 0,
    missingViewport, missingNav, popups, autoplay
  };
  return out;
}

module.exports = { analyzeUX, buildGraph };
