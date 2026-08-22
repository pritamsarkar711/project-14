'use strict';

/*
 * Core Web Vitals & INP Auditor: LCP analyzer.
 *
 * Identifies the actual LCP element (from the browser's
 * largest-contentful-paint entries) and breaks the LCP time into its four
 * phases where the data allows: TTFB → resource load delay → resource
 * load duration → element render delay. Phase values that span the
 * auditor proxy are labelled approximate, never presented as exact.
 */

const TH = require('./thresholds');

function fmt(n) { return typeof n === 'number' && isFinite(n) ? Math.round(n * 10) / 10 : null; }
function resourceFor(url, resources) {
  if (!url || !Array.isArray(resources)) return null;
  const norm = String(url).replace(/^https?:\/\//, '');
  return resources.find(r => r && r.name && String(r.name).replace(/^https?:\/\//, '') === norm) || null;
}

function analyzeLcp(vitals, resources, images, docPhases, nav, linkHints) {
  const raw = (vitals && vitals.lcp) || {};
  const out = {
    status: raw.status === 'measured' ? 'measured' : 'unavailable',
    value: raw.status === 'measured' && typeof raw.value === 'number' ? Math.round(raw.value * 10) / 10 : null,
    reason: raw.reason || null,
    classification: null,
    element: null,
    candidates: [],
    resource: null,
    phases: null,
    imageAudit: null,
    issues: [],
    note: null
  };
  if (out.status !== 'measured') return out;
  out.classification = TH.classify(out.value, TH.cwv.lcp);

  const entry = raw.entry || null;
  out.candidates = (Array.isArray(raw.candidates) ? raw.candidates : []).slice(0, 12).map(c => ({
    startTime: fmt(c.startTime), size: c.size, tag: c.tag || null, url: c.url || null
  }));

  if (entry) {
    out.element = {
      tag: entry.tag || null,
      selector: entry.selector || null,
      text: entry.text ? String(entry.text).slice(0, 140) : null,
      url: entry.url || null,
      size: entry.size != null ? entry.size : null,
      rect: entry.rect || null
    };
    const res = resourceFor(entry.url, resources);
    const ttfbSource = (docPhases && typeof docPhases.ttfbMs === 'number') ? 'server-measured'
      : (nav && typeof nav.ttfb === 'number') ? 'proxied-navigation'
      : null;
    const ttfb = ttfbSource === 'server-measured' ? docPhases.ttfbMs
      : ttfbSource === 'proxied-navigation' ? nav.ttfb
      : null;
    const phases = { ttfb: fmt(ttfb), loadDelay: null, loadDuration: null, renderDelay: null, note: [] };
    if (ttfbSource === 'proxied-navigation') phases.note.push('TTFB taken from the proxied navigation (includes one auditor proxy hop).');
    if (res && res.timingAvailable && typeof res.startTime === 'number') {
      const navTtfb = nav && typeof nav.ttfb === 'number' ? nav.ttfb : 0;
      phases.loadDelay = fmt(Math.max(0, res.startTime - navTtfb));
      phases.loadDuration = typeof res.duration === 'number' ? fmt(res.duration) : null;
      const responseEnd = res.startTime + (typeof res.duration === 'number' ? res.duration : 0);
      phases.renderDelay = typeof entry.startTime === 'number' ? fmt(Math.max(0, entry.startTime - responseEnd)) : null;
    } else if (entry.url) {
      phases.loadDelay = null;
      phases.note.push('LCP resource timing not fully exposed (cross-origin), load duration / render delay unavailable.');
    }
    if (entry.url) {
      out.resource = {
        url: entry.url,
        sizeBytes: res && (res.transferSize || res.encodedBodySize || res.decodedBodySize) || null,
        format: (String(entry.url).match(/\.([a-z0-9]+)([?#]|$)/i) || [])[1] || null,
        timingAvailable: !!(res && res.timingAvailable),
        type: res ? (res.initiatorType || 'resource') : 'resource'
      };
      // Image-specific audit (LCP image).
      const img = Array.isArray(images) ? images.find(i => i && i.src && entry.url && String(i.src).replace(/^https?:\/\//, '') === String(entry.url).replace(/^https?:\/\//, '')) : null;
      if (img) {
        const ia = {
          isImage: true,
          renderedW: img.renderedW, renderedH: img.renderedH,
          naturalW: img.naturalW, naturalH: img.naturalH,
          loading: img.loading || null,
          fetchpriority: img.fetchpriority || null,
          decoding: img.decoding || null,
          hasSrcset: !!img.srcset, hasSizes: !!img.sizes,
          hasDimensions: !!img.hasDimensions,
          inViewport: !!img.inViewport,
          preloaded: !!(Array.isArray(linkHints && linkHints.preload) && linkHints.preload.some(p => p && p.href && entry.url && String(p.href).replace(/^https?:\/\//, '') === String(entry.url).replace(/^https?:\/\//, ''))),
          bytes: img.bytes != null ? img.bytes : null
        };
        if (ia.loading === 'lazy' && ia.inViewport) {
          ia.lazyAboveFold = true;
          out.issues.push({ id: 'lcp-lazy', severity: 'critical', title: 'LCP image is lazy-loaded', detail: 'loading="lazy" is set on the above-the-fold LCP image, delaying the largest paint until the image is discovered late. Never lazy-load the LCP image.', evidence: 'LCP element <img loading="lazy"> rendered in the initial viewport.' });
        }
        if (!ia.preloaded && ia.fetchpriority !== 'high') {
          out.issues.push({ id: 'lcp-priority', severity: 'high', title: 'LCP image has no high priority', detail: 'The LCP image is not preloaded and has no fetchpriority="high", so the browser may start it after competing resources.', evidence: 'fetchpriority="' + (ia.fetchpriority || 'auto') + '", no matching <link rel="preload">.' });
        }
        if (ia.naturalW && ia.renderedW && ia.naturalW > ia.renderedW * 2) {
          out.issues.push({ id: 'lcp-oversized', severity: 'high', title: 'LCP image is much larger than it renders', detail: 'The image intrinsic width (' + ia.naturalW + 'px) is more than 2× its rendered width (' + ia.renderedW + 'px), the browser downloads far more pixels than needed.', evidence: 'Intrinsic ' + ia.naturalW + '×' + ia.naturalH + ' vs rendered ' + ia.renderedW + '×' + ia.renderedH + (ia.bytes ? ', ' + Math.round(ia.bytes / 1024) + ' KB downloaded' : '') + '.' });
        }
        if (ia.bytes && ia.bytes > 500 * 1024 && /\.(png|jpe?g|gif)([?#]|$)/i.test(String(entry.url))) {
          out.issues.push({ id: 'lcp-format', severity: 'medium', title: 'LCP image uses a legacy format', detail: 'A ' + Math.round(ia.bytes / 1024) + ' KB ' + (String(entry.url).match(/\.([a-z0-9]+)([?#]|$)/i) || [])[1] + ' is used for the LCP image; WebP/AVIF typically encodes this content much smaller.', evidence: 'Format ' + (String(entry.url).match(/\.([a-z0-9]+)([?#]|$)/i) || [])[1] + ', ' + Math.round(ia.bytes / 1024) + ' KB.' });
        }
        out.imageAudit = ia;
      }
    }
    // Bottleneck phase.
    if (phases.renderDelay != null && phases.loadDuration != null && phases.loadDelay != null) {
      const parts = [
        { k: 'TTFB', v: phases.ttfb },
        { k: 'Load delay', v: phases.loadDelay },
        { k: 'Load duration', v: phases.loadDuration },
        { k: 'Render delay', v: phases.renderDelay }
      ].filter(p => p.v != null && isFinite(p.v));
      const worst = parts.reduce((m, p) => (p.v > m.v ? p : m), parts[0]);
      if (worst) out.bottleneck = { phase: worst.k, value: worst.v };
    }
    out.phases = phases;
  } else {
    out.note = 'The LCP element could not be attributed (no largest-contentful-paint entry with an element).';
  }
  return out;
}

module.exports = { analyzeLcp };
