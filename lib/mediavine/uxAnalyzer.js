'use strict';

const U = require('./util');
const R = require('./mediavineRules');

function buildGraph(pages) {
  const idx = new Map();
  pages.forEach(p => { if (p.parse) idx.set(p.url.replace(/\/$/, ''), p); });
  const inLinks = new Map(), outLinks = new Map();
  pages.forEach(p => { const k = (p.url || '').replace(/\/$/, ''); inLinks.set(k, new Set()); outLinks.set(k, new Set()); });
  pages.forEach(p => {
    if (!p.parse) return;
    const src = p.url.replace(/\/$/, '');
    (p.parse.links || []).forEach(l => { if (!l.internal || !l.href) return; const key = l.href.replace(/\/$/, ''); if (outLinks.has(src)) outLinks.get(src).add(key); if (inLinks.has(key)) inLinks.get(key).add(src); });
  });
  const depth = new Map();
  const home = pages[0] ? pages[0].url.replace(/\/$/, '') : null;
  const q = [];
  if (home) { depth.set(home, 0); q.push(home); }
  while (q.length) { const cur = q.shift(); const d = depth.get(cur); const outs = outLinks.get(cur); if (!outs) continue; outs.forEach(t => { if (!depth.has(t) && idx.has(t)) { depth.set(t, d + 1); q.push(t); } }); }
  return { inLinks, outLinks, depth, home };
}

function analyzeUX(pages, ctx) {
  const out = [];
  const graph = buildGraph(pages);
  ctx.graph = graph;
  const counts = { missingViewport: 0, missingNav: 0, popups: 0, autoplay: 0, sticky: 0, fixedOverlays: 0, hOverflow: 0, emptyButtons: 0, emptyLinks: 0, clutter: 0 };
  const overlayUrls = [];

  pages.forEach(p => {
    if (!p.parse) return;
    const path = U.pathOf(p.url);
    const pa = p.parse;
    const vpOk = /width\s*=\s*device-width/i.test(pa.viewport || '');

    if (!vpOk) {
      counts.missingViewport++;
      out.push(R.finding(R.get('MV-APPROVE-READER-EXPERIENCE'), path, 'high',
        pa.viewport ? 'viewport meta is "' + pa.viewport + '" (missing width=device-width)' : 'No viewport meta tag — mobile readers are not supported properly.',
        { confidence: 0.95, severity: 'high' }));
    }
    if (!pa.hasNav) {
      counts.missingNav++;
      out.push(R.finding(R.get('MV-APPROVE-READER-EXPERIENCE'), path, 'high',
        'No <nav>, role=navigation, or common menu landmark found.',
        { confidence: 0.82, severity: 'high' }));
    } else if (pa.navLinks === 0) {
      out.push(R.finding(R.get('MV-APPROVE-READER-EXPERIENCE'), path, 'medium',
        'A navigation landmark exists but contains no links.',
        { confidence: 0.7, severity: 'medium' }));
    }
    if (!pa.hasFooter) {
      out.push(R.finding(R.get('MV-APPROVE-READER-EXPERIENCE'), path, 'low',
        'No footer landmark detected.',
        { confidence: 0.7, severity: 'low' }));
    }
    if (pa.popups >= 2) {
      counts.popups++;
      out.push(R.finding(R.get('MV-APPROVE-READER-EXPERIENCE'), path, 'medium',
        pa.popups + ' popup/modal/overlay/interstitial element(s) detected in markup. Intrusive overlays are a documented reader-experience concern.',
        { confidence: 0.6, severity: 'medium' }));
    }
    if (pa.autoplay) {
      counts.autoplay++;
      out.push(R.finding(R.get('MV-APPROVE-READER-EXPERIENCE'), path, 'low',
        pa.autoplay + ' auto-playing media element(s). Auto-playing media disrupts readers and ads.',
        { confidence: 0.7, severity: 'low' }));
    }
    if (pa.stickyElements || pa.fixedOverlays) {
      counts.sticky += pa.stickyElements; counts.fixedOverlays += pa.fixedOverlays;
      if (pa.fixedOverlays >= 2) overlayUrls.push(path);
      out.push(R.finding(R.get('MV-APPROVE-READER-EXPERIENCE'), path, pa.fixedOverlays >= 3 ? 'high' : 'medium',
        pa.fixedOverlays + ' fixed-position overlay(s)/sticky element(s) detected from CSS positioning' + (pa.stickyElements ? ' (' + pa.stickyElements + ' sticky hints)' : '') + '. Fixed overlays can obstruct content and ads.',
        { confidence: 0.55, severity: pa.fixedOverlays >= 3 ? 'high' : 'medium' }));
    }
    if (pa.horizontalOverflowHints) {
      counts.hOverflow += pa.horizontalOverflowHints;
      out.push(R.finding(R.get('MV-APPROVE-READER-EXPERIENCE'), path, 'low',
        pa.horizontalOverflowHints + ' very-wide fixed layout hint(s) (e.g. width:NNNNpx). Can cause horizontal overflow on mobile.',
        { confidence: 0.5, severity: 'low' }));
    }
    if (pa.emptyLinks >= 3) {
      counts.emptyLinks += pa.emptyLinks;
      out.push(R.finding(R.get('MV-APPROVE-READER-EXPERIENCE'), path, 'medium',
        pa.emptyLinks + ' links have no text or accessible name.',
        { confidence: 0.8, severity: 'medium' }));
    }
    if (pa.emptyButtons >= 2) {
      counts.emptyButtons += pa.emptyButtons;
      out.push(R.finding(R.get('MV-APPROVE-READER-EXPERIENCE'), path, 'low',
        pa.emptyButtons + ' buttons have no label.',
        { confidence: 0.75, severity: 'low' }));
    }
    // Content obstruction / clutter
    const clutter = (pa.adContainers || 0) + (pa.popups || 0) + (pa.fixedOverlays || 0);
    if (clutter >= 6 && pa.wordCount < 300) {
      counts.clutter++;
      out.push(R.finding(R.get('MV-APPROVE-READER-EXPERIENCE'), path, 'medium',
        '~' + clutter + ' ad-container/popup/fixed-overlay signals on a ' + pa.wordCount + '-word page — content may be crowded by chrome.',
        { confidence: 0.6, severity: 'medium' }));
    }
    // heading hierarchy
    if (pa.wordCount > 120 && pa.h1.length !== 1) {
      out.push(R.finding(R.get('MV-APPROVE-READER-EXPERIENCE'), path, pa.h1.length === 0 ? 'medium' : 'low',
        pa.h1.length + ' H1 tag(s). A single descriptive H1 supports hierarchy.',
        { confidence: 0.8, severity: pa.h1.length === 0 ? 'medium' : 'low' }));
    }

    const key = p.url.replace(/\/$/, '');
    const ins = graph.inLinks.get(key), outs = graph.outLinks.get(key);
    const inCount = ins ? ins.size : 0, outCount = outs ? outs.size : 0;
    if (key !== graph.home && inCount === 0 && pages.length > 4) {
      out.push({ id: 'ARCH_ORPHAN', category: 'architecture', name: 'Orphan candidate', status: 'medium', severity: 'medium', page: path,
        evidence: 'No internal links from other crawled pages point here.', why: 'Heuristic. Orphans are hard to discover.', fix: 'Link to it from related content or navigation.', confidence: 65, sourceType: 'heuristic', automated: true, weight: 3 });
    }
    if (outCount === 0 && ctx.pageType.get(p.url) !== 'product') {
      out.push({ id: 'ARCH_DEAD_END', category: 'architecture', name: 'Dead-end page', status: 'low', severity: 'low', page: path,
        evidence: 'Page has no internal links to other pages.', why: 'Heuristic.', fix: 'Add related links.', confidence: 60, sourceType: 'heuristic', automated: true, weight: 2 });
    }
    const d = graph.depth.get(key);
    if (d != null && d > 4) {
      out.push({ id: 'ARCH_DEEP', category: 'architecture', name: 'Deep page', status: 'low', severity: 'low', page: path,
        evidence: 'Page is ' + d + ' clicks from the homepage in the crawl graph.', why: 'Heuristic.', fix: 'Add higher-level links.', confidence: 58, sourceType: 'heuristic', automated: true, weight: 1 });
    }
  });

  const depths = [...graph.depth.values()];
  ctx.archStats = { avgDepth: depths.length ? U.round(depths.reduce((a, b) => a + b, 0) / depths.length, 1) : 0, maxDepth: depths.length ? Math.max.apply(null, depths) : 0, ...counts };

  // Architecture aggregate
  if (graph.home && pages.length > 4) {
    const orphans = [...graph.inLinks.keys()].filter(k => k !== graph.home && (graph.inLinks.get(k) ? graph.inLinks.get(k).size : 0) === 0);
    if (orphans.length) {
      out.push(R.finding(R.get('MV-H-ARCHITECTURE'), 'Site', orphans.length / pages.length >= 0.3 ? 'high' : 'medium',
        orphans.length + ' of ' + pages.length + ' pages receive no internal links (orphan candidates)',
        { confidence: 0.7, affected: orphans.length + '/' + pages.length, severity: orphans.length / pages.length >= 0.3 ? 'high' : 'medium' }));
    }
  }

  if (overlayUrls.length >= 2) {
    out.push(R.finding(R.get('MV-APPROVE-READER-EXPERIENCE'), 'Site', 'high',
      overlayUrls.length + ' page(s) contain multiple fixed-position overlays covering content (e.g. ' + overlayUrls.slice(0, 3).join(', ') + '). Fixed overlays that cover >30% of the initial viewport can obstruct reading.',
      { confidence: 0.5, affected: overlayUrls.length + '/' + pages.filter(p => p.parse).length, severity: 'high', urls: overlayUrls.slice(0, 6) }));
  }

  return out;
}

module.exports = { analyzeUX, buildGraph };
