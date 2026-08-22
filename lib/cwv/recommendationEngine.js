'use strict';

/*
 * Core Web Vitals & INP Auditor, recommendation engine.
 *
 * Every issue carries: problem, evidence (concrete measured facts),
 * impact (which metric), the affected resource and a recommended fix.
 * Savings numbers appear only when they can be calculated from actual
 * measurements; otherwise "Potentially reducible" is used. Claims that a
 * fix will improve a metric by a specific amount are never generated.
 */

const TH = require('./thresholds');
const SEV = { critical: 0, high: 1, medium: 2, low: 3 };

function issue(sev, title, o) {
  return {
    id: o.id || 'iss-' + Math.random().toString(36).slice(2, 8),
    severity: sev,
    title,
    problem: o.problem || title,
    evidence: Array.isArray(o.evidence) ? o.evidence : [o.evidence].filter(Boolean),
    impact: o.impact || null,          // metric or behaviour affected
    affectedResource: o.affectedResource || null,
    fix: o.fix || null,
    savings: o.savings || null,        // { kind, current, potential, label }
    wording: o.wording || 'measured'   // measured | likely
  };
}

function buildRecommendations(ctx) {
  const out = { issues: [], critical: 0, high: 0, medium: 0, low: 0, note: null };
  const add = (sev, title, o) => {
    const i = issue(sev, title, o);
    out.issues.push(i);
    if (sev === 'critical') out.critical++; else if (sev === 'high') out.high++;
    else if (sev === 'medium') out.medium++; else out.low++;
  };

  /* ---------- Core Web Vitals ---------- */
  const lcp = ctx.lcp, inp = ctx.inp, cls = ctx.cls;
  if (lcp && lcp.status === 'measured' && lcp.classification) {
    const s = lcp.classification.status;
    if (s === 'poor') add('critical', 'LCP is Poor (' + lcp.value + ' ms), above the 4.0 s threshold', {
      id: 'cwv-lcp-poor', impact: 'LCP',
      problem: 'The largest contentful paint of ' + lcp.value + ' ms exceeds the 4,000 ms "poor" threshold for the official LCP metric.',
      evidence: ['Measured LCP: ' + lcp.value + ' ms (lab).', lcp.bottleneck ? 'Dominant phase: ' + lcp.bottleneck.phase + ' (' + lcp.bottleneck.value + ' ms).' : null],
      fix: 'Address the dominant LCP phase identified in the LCP analysis below (TTFB, resource load delay, load duration, or render delay).'
    });
    else if (s === 'needs-improvement') add('high', 'LCP needs improvement (' + lcp.value + ' ms), above 2.5 s', {
      id: 'cwv-lcp-ni', impact: 'LCP',
      problem: 'LCP of ' + lcp.value + ' ms is above the 2,500 ms "good" threshold.',
      evidence: ['Measured LCP: ' + lcp.value + ' ms (lab).', lcp.bottleneck ? 'Dominant phase: ' + lcp.bottleneck.phase + ' (' + lcp.bottleneck.value + ' ms).' : null],
      fix: 'Optimize the dominant LCP phase identified in the LCP analysis.'
    });
    (lcp.issues || []).forEach(i => add(i.severity, i.title, {
      id: i.id, impact: 'LCP', problem: i.detail, evidence: [i.evidence], affectedResource: lcp.element && lcp.element.url || null, fix: i.fix || 'See the LCP analysis section.', wording: 'measured'
    }));
  }
  if (inp && inp.status === 'measured' && inp.classification) {
    const s = inp.classification.status;
    if (s === 'poor') add('critical', 'Lab INP is Poor (' + inp.value + ' ms), interactions exceed 500 ms', {
      id: 'cwv-inp-poor', impact: 'INP',
      problem: 'The slowest measured interaction took ' + inp.value + ' ms, above the 500 ms "poor" threshold for INP.',
      evidence: ['Lab INP (synthetic interactions): ' + inp.value + ' ms.', inp.worst && inp.worst.target ? 'Slowest interaction: ' + (inp.worst.target.selector || inp.worst.target.tag || 'interaction') : null],
      fix: 'Use the INP breakdown (input delay / processing / presentation) to target the dominant phase, and check the long tasks overlapping the slowest interaction.'
    });
    else if (s === 'needs-improvement') add('high', 'Lab INP needs improvement (' + inp.value + ' ms)', {
      id: 'cwv-inp-ni', impact: 'INP',
      problem: 'The slowest measured interaction took ' + inp.value + ' ms, above the 200 ms "good" threshold.',
      evidence: ['Lab INP (synthetic interactions): ' + inp.value + ' ms.'],
      fix: 'Review the per-interaction breakdown and overlapping long tasks in the INP analysis.'
    });
    (inp.rootCauses || []).forEach(c => {
      const headline = c.headline || 'Likely contributor to the lab INP';
      add('high', headline, {
        id: 'inp-root-' + (c.interaction && c.interaction.id != null ? c.interaction.id : 'x'), impact: 'INP',
        problem: headline,
        evidence: c.findings.map(f => f.evidence),
        affectedResource: null,
        fix: 'Break up or defer the long tasks overlapping the interaction; reduce handler work if processing dominates; reduce forced layout/rendering if presentation dominates.',
        wording: 'likely'
      });
    });
  }
  if (cls && cls.status === 'measured' && cls.classification) {
    const s = cls.classification.status;
    if (s === 'poor') add('critical', 'CLS is Poor (' + cls.value + '), above 0.25', {
      id: 'cwv-cls-poor', impact: 'CLS',
      problem: 'Cumulative layout shift of ' + cls.value + ' exceeds the 0.25 "poor" threshold.',
      evidence: ['Final CLS (largest session window): ' + cls.value + '.', cls.largestWindow ? 'Largest shift cluster: ' + cls.largestWindow.value + ' across ' + cls.largestWindow.shifts.length + ' shift(s).' : null],
      fix: 'Fix the largest shift cluster listed in the CLS analysis (reserve space for images/fonts/ads, avoid late DOM injection).'
    });
    else if (s === 'needs-improvement') add('high', 'CLS needs improvement (' + cls.value + ')', {
      id: 'cwv-cls-ni', impact: 'CLS',
      problem: 'Cumulative layout shift of ' + cls.value + ' is above the 0.1 "good" threshold.',
      evidence: ['Final CLS (largest session window): ' + cls.value + '.'],
      fix: 'Address the largest contributors in the CLS analysis.'
    });
    if (cls.largestWindow && cls.largestWindow.shifts && cls.largestWindow.shifts.length) {
      cls.largestWindow.shifts.slice(0, 4).forEach((sh, idx) => {
        const src = sh.sources && sh.sources[0];
        add(s === 'poor' ? 'high' : 'medium', 'Layout shift of ' + sh.value + (src && src.selector ? ' at ' + src.selector : ''), {
          id: 'cls-shift-' + idx, impact: 'CLS',
          problem: 'A shift scored ' + sh.value + ' CLS at ' + sh.startTime + ' ms.' + (src ? ' The shifted element: ' + (src.selector || src.tag || 'unknown') + '.' : ''),
          evidence: src ? ['Previous position: ' + JSON.stringify(src.prevRect), 'New position: ' + JSON.stringify(src.curRect)] : ['Shift captured with no attributable source.'],
          affectedResource: src ? src.selector : null,
          fix: clsShiftFix(src),
          wording: 'likely'
        });
      });
    }
  }

  /* ---------- TTFB / FCP ---------- */
  if (ctx.ttfb && ctx.ttfb.status === 'measured' && ctx.ttfb.classification && ctx.ttfb.classification.status !== 'good') {
    const dom = ctx.ttfb.phases && ctx.ttfb.phases.server;
    add(ctx.ttfb.classification.status === 'poor' ? 'high' : 'medium', 'TTFB is slow (' + ctx.ttfb.value + ' ms)', {
      id: 'ttfb-slow', impact: 'TTFB',
      problem: 'Time to first byte of ' + ctx.ttfb.value + ' ms.' + (dom ? ' The server-response phase (' + dom + ' ms) dominates.' : ''),
      evidence: ctx.ttfb.phases ? ['DNS ' + ctx.ttfb.phases.dns + ' ms, Connection ' + ctx.ttfb.phases.connect + ' ms, TLS ' + ctx.ttfb.phases.tls + ' ms, Server response ' + ctx.ttfb.phases.server + ' ms.'] : ['TTFB: ' + ctx.ttfb.value + ' ms.'],
      fix: 'The server-response phase points to server-side latency (app code, database, upstream APIs), profile the backend. TTFB alone cannot prove which backend part is slow.',
      wording: 'likely'
    });
  }
  if (ctx.fcp && ctx.fcp.status === 'measured' && ctx.fcp.classification && ctx.fcp.classification.status !== 'good') {
    add('medium', 'FCP is slow (' + ctx.fcp.value + ' ms)', {
      id: 'fcp-slow', impact: 'FCP',
      problem: 'First contentful paint of ' + ctx.fcp.value + ' ms (advisory target 1,800 ms).',
      evidence: (ctx.fcp.causes || []).map(c => c.evidence).slice(0, 3),
      fix: 'Address the FCP causes listed in the FCP section (server latency, render-blocking CSS/JS, font delays).'
    });
  }

  /* ---------- Render-blocking resources ---------- */
  const rbCss = ctx.css && ctx.css.blocking ? ctx.css.blocking.filter(c => c.bytes == null || c.bytes > 10 * 1024) : [];
  if (rbCss.length) {
    add('high', rbCss.length + ' render-blocking stylesheet(s)', {
      id: 'rb-css', impact: 'FCP / LCP',
      problem: rbCss.length + ' stylesheet(s) in <head> block rendering until downloaded and parsed' + (ctx.css.bytesMeasurable ? ' (' + Math.round(rbCss.reduce((s, c) => s + (c.bytes || 0), 0) / 1024) + ' KB total)' : '') + '.',
      evidence: rbCss.slice(0, 4).map(c => c.url + (c.bytesKnown ? ', ' + Math.round(c.bytes / 1024) + ' KB' : ', size not measurable') ),
      affectedResource: rbCss[0].url,
      fix: 'Inline critical CSS for above-the-fold styles, load the rest with media queries or preload + swap; remove unused CSS. Keep @import out of render-critical CSS.',
      savings: ctx.css.bytesMeasurable && rbCss.reduce((s, c) => s + (c.bytes || 0), 0) > 0 ? { kind: 'blocking', current: Math.round(rbCss.reduce((s, c) => s + (c.bytes || 0), 0) / 1024) + ' KB', potential: null, label: 'Potentially reducible' } : null
    });
  }
  const rbJs = ctx.js && ctx.js.blocking ? ctx.js.blocking.filter(j => j.bytes == null || j.bytes > 10 * 1024) : [];
  if (rbJs.length) {
    add('high', rbJs.length + ' parser-blocking script(s)', {
      id: 'rb-js', impact: 'FCP / LCP',
      problem: rbJs.length + ' synchronous script(s) block HTML parsing while downloaded and executed.',
      evidence: rbJs.slice(0, 4).map(j => j.url + (j.bytesKnown ? ', ' + Math.round(j.bytes / 1024) + ' KB' : '')),
      affectedResource: rbJs[0].url,
      fix: 'Add defer (or async for independent scripts) so parsing continues; move non-critical scripts out of <head>.'
    });
  }
  const imports = ctx.css && ctx.css.imports || [];
  if (imports.length) {
    add('medium', imports.length + ' CSS @import chain(s) serialize stylesheet loading', {
      id: 'css-imports', impact: 'FCP / LCP',
      problem: '@import inside a stylesheet forces the browser to fetch the parent before it can even request the imported file.',
      evidence: imports.slice(0, 4).map(im => im.from + ' → @import ' + im.url),
      affectedResource: imports[0].url,
      fix: 'Replace @import with <link rel="stylesheet"> elements or inline the imported CSS into the bundle.'
    });
  }

  /* ---------- Long tasks ---------- */
  const ltGroups = ctx.longTasks ? ctx.longTasks.groups : [];
  ltGroups.slice(0, 3).forEach(g => {
    if (g.totalDuration < 150) return;
    add('high', 'Repeated long tasks from ' + g.source, {
      id: 'longtask-' + g.source.slice(0, 24), impact: 'INP',
      problem: g.occurrences + ' long task(s) totaling ' + g.totalDuration + ' ms attributed to ' + g.source + '.',
      evidence: ['Occurrences: ' + g.occurrences, 'Total: ' + g.totalDuration + ' ms, longest: ' + g.maxDuration + ' ms.'],
      affectedResource: g.source,
      fix: 'Split the long task into smaller chunks (yield to the main thread), defer non-urgent work to idle, or move it to a worker.',
      wording: 'likely'
    });
  });

  /* ---------- Compression ---------- */
  if (ctx.resources && ctx.resources.compression && ctx.resources.compression.uncompressed) {
    const items = ctx.resources.compression.uncompressed;
    const withBytes = items.filter(i => i.bytes != null);
    add('medium', 'Text resources served without compression', {
      id: 'compression', impact: 'Network / TTFB',
      problem: items.length + ' text resource(s) of ≥ 10 KB are served without gzip/Brotli.',
      evidence: items.slice(0, 5).map(i => i.url + (i.bytes != null ? ', ' + Math.round(i.bytes / 1024) + ' KB uncompressed' : '')),
      affectedResource: items[0].url,
      fix: 'Enable Brotli or gzip on the server/CDN for text assets (HTML, CSS, JS, JSON, SVG).',
      savings: withBytes.length ? { kind: 'bytes', current: withBytes.reduce((s, i) => s + i.bytes, 0), potential: null, label: 'Potentially reducible (typical text compression 60–90%; exact size not measured)' } : null
    });
  }

  /* ---------- Caching ---------- */
  if (ctx.cache && ctx.cache.status === 'measured') {
    if (ctx.cache.static.noCacheHeaders.length) {
      add('medium', ctx.cache.static.noCacheHeaders.length + ' static asset(s) without cache headers', {
        id: 'cache-static', impact: 'Repeat visits',
        problem: 'Static assets with no effective Cache-Control will be re-downloaded on every visit.',
        evidence: ctx.cache.static.noCacheHeaders.slice(0, 5).map(i => i.url + ', header: ' + i.header),
        affectedResource: ctx.cache.static.noCacheHeaders[0].url,
        fix: 'Serve versioned static assets with a long max-age and immutable (or a CDN default).'
      });
    }
    if (ctx.cache.static.shortTtl.length) {
      add('low', ctx.cache.static.shortTtl.length + ' static asset(s) with very short TTL (< 1 h)', {
        id: 'cache-ttl', impact: 'Repeat visits',
        problem: 'Short TTLs force frequent revalidation of static assets.',
        evidence: ctx.cache.static.shortTtl.slice(0, 5).map(i => i.url + ', ' + i.ttlSeconds + ' s'),
        affectedResource: ctx.cache.static.shortTtl[0].url,
        fix: 'Increase max-age for fingerprinted/versioned static files.'
      });
    }
    if (ctx.cache.html && ctx.cache.html.status === 'long-lived') {
      add('medium', 'HTML document cached for a long time', {
        id: 'cache-html', impact: 'Content freshness',
        problem: ctx.cache.html.note,
        evidence: ['Cache-Control: ' + (ctx.cache.html.headers && ctx.cache.html.headers['cache-control'] || '(unobserved)')],
        affectedResource: ctx.doc && ctx.doc.finalUrl || null,
        fix: 'Use short/no caching for HTML that changes, with ETag revalidation.'
      });
    }
  }

  /* ---------- Third parties with measured main-thread activity ---------- */
  const tp = ctx.thirdParties && ctx.thirdParties.parties || [];
  tp.filter(p => p.mainThreadMs && p.mainThreadMs >= 150).slice(0, 3).forEach(p => {
    add('high', 'Third-party ' + p.domain + ' uses ' + p.mainThreadMs + ' ms of main thread (long tasks)', {
      id: 'tp-mainthread-' + p.domain, impact: 'INP',
      problem: p.requests + ' request(s) from ' + p.domain + '; ' + p.mainThreadMs + ' ms of measured long-task time.',
      evidence: ['Long-task time: ' + p.mainThreadMs + ' ms', 'Requests: ' + p.requests + (p.bytes != null ? ', ' + Math.round(p.bytes / 1024) + ' KB' : '')],
      affectedResource: p.domain,
      fix: 'Load the third party lazily/on user interaction, use facades, or evaluate a lighter alternative. Third-party presence alone is not the problem, measured main-thread time is.',
      wording: 'likely'
    });
  });

  /* ---------- Image / font / DOM analyzer issues ---------- */
  (ctx.images && ctx.images.issues || []).forEach(i => {
    add(i.severity, i.title, {
      id: i.id, impact: i.id.indexOf('dimension') >= 0 ? 'CLS' : 'LCP / network',
      problem: i.detail, evidence: [i.evidence], affectedResource: i.image || null,
      fix: i.fix || 'See the image audit section.', savings: i.savings || null
    });
  });
  (ctx.fonts && ctx.fonts.issues || []).forEach(i => {
    add(i.severity, i.title, {
      id: i.id, impact: 'CLS / FCP', problem: i.detail, evidence: [i.evidence],
      affectedResource: null, fix: i.fix || 'See the font audit section.'
    });
  });
  (ctx.dom && ctx.dom.issues || []).forEach(i => {
    add(i.severity, i.title, {
      id: i.id, impact: 'Rendering', problem: i.detail, evidence: [i.evidence],
      affectedResource: null, fix: 'Reduce DOM size: trim repeated subtrees, paginate long lists, simplify wrappers (heuristic guidance).'
    });
  });
  (ctx.rendering && ctx.rendering.issues || []).forEach(i => {
    add(i.severity, i.title, {
      id: i.id, impact: i.impact || 'Rendering', problem: i.detail, evidence: [i.evidence],
      affectedResource: null, fix: 'Identify the scripts driving the long frames (see rendering section) and split/defer that work.'
    });
  });

  /* ---------- Resource hints ---------- */
  if (ctx.hints) {
    const preloads = ctx.hints.preload || [];
    const requested = new Set((ctx.waterfall && ctx.waterfall.rows || []).map(r => r.url));
    const unused = preloads.filter(p => p.href && !requested.has(p.href));
    if (unused.length) {
      add('low', unused.length + ' preload hint(s) for resources that were not requested', {
        id: 'hint-unused-preload', impact: 'Network',
        problem: 'Preloading resources the page never requests wastes bandwidth and competes with critical resources.',
        evidence: unused.slice(0, 4).map(p => p.href),
        affectedResource: unused[0].href,
        fix: 'Remove preload hints for unused resources. Preload only what the next navigation/paint actually needs.'
      });
    }
    if (ctx.hints.preconnect && ctx.hints.preconnect.length > 6) {
      add('low', ctx.hints.preconnect.length + ' preconnect hints', {
        id: 'hint-preconnect', impact: 'Network',
        problem: 'Many preconnect hints can waste connections and delay higher-priority requests.',
        evidence: ['preconnect hints: ' + ctx.hints.preconnect.length],
        affectedResource: null,
        fix: 'Keep preconnect to a handful of origins you actually fetch from immediately.'
      });
    }
  }

  out.issues.sort((a, b) => (SEV[a.severity] - SEV[b.severity]) || ((a.impact || '').localeCompare(b.impact || '')));
  out.note = 'Every issue is derived from measured audit data. "Likely contributor" wording marks indirect evidence; savings labelled "Potentially reducible" were not computed because the optimized size was not measured.';
  return out;
}

function clsShiftFix(src) {
  if (!src) return 'Reserve space for the shifting content (fixed dimensions, aspect-ratio boxes, placeholders) so late content cannot move the layout.';
  if (src.tag === 'img') return 'Give the image explicit width/height (or CSS aspect-ratio) so its layout box is reserved before it loads.';
  return 'Reserve space for the element (min-height placeholders, aspect-ratio) or insert it outside the visible layout flow until it is ready.';
}

module.exports = { buildRecommendations };
