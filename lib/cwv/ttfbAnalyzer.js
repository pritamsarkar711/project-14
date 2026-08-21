'use strict';

/*
 * Core Web Vitals & INP Auditor — TTFB analyzer.
 *
 * Breaks TTFB into DNS / connection / TLS / server-response where the
 * transport measured those phases (server-side pinned fetch). TTFB alone
 * never "proves" a backend problem — a slow server-response phase is
 * reported as *likely* server-side latency, not a diagnosis.
 */

const TH = require('./thresholds');

function analyzeTtfb(docPhases, docHeaders, nav, transport) {
  const out = {
    status: 'unavailable',
    value: null,
    reason: null,
    classification: null,
    phases: null,
    notes: [],
    advisory: true,
    source: null
  };
  const p = docPhases || {};
  const hasPhases = typeof p.ttfbMs === 'number';
  const hasNav = nav && typeof nav.ttfb === 'number' && nav.ttfb > 0;

  if (hasPhases) {
    out.source = 'server-measured';
    out.value = Math.round(p.ttfbMs * 10) / 10;
    out.status = 'measured';
    out.phases = {
      dns: Math.round(p.dnsMs || 0),
      connect: Math.round(p.connectMs || 0),
      tls: Math.round(p.tlsMs || 0),
      server: Math.round(p.serverMs || 0),
      ttfb: Math.round(p.ttfbMs || 0),
      download: Math.round(p.downloadMs || 0),
      dnsCached: !!p.dnsCached
    };
    out.notes.push('Measured server-side with a pinned direct connection to the origin — not through the visitor\u2019s network.');
    if (p.serverMs && p.ttfbMs && p.serverMs > Math.max(300, p.ttfbMs * 0.6)) {
      out.notes.push('The server-response phase dominates TTFB — likely server-side latency (processing/DB/upstream). TTFB alone cannot prove which part of the backend is slow.');
    }
    if (p.dnsMs > 150) out.notes.push('DNS resolution took ' + Math.round(p.dnsMs) + ' ms — a slow or distant DNS provider could contribute.');
    if (p.tlsMs > 300) out.notes.push('The TLS handshake took ' + Math.round(p.tlsMs) + ' ms — session resumption or certificate chain size may be relevant.');
  } else if (hasNav) {
    out.source = 'proxied-navigation';
    out.value = Math.round(nav.ttfb * 10) / 10;
    out.status = 'measured';
    out.notes.push('TTFB read from the proxied iframe navigation — includes one auditor proxy hop, so it is approximate.');
  } else {
    out.reason = 'TTFB could not be measured: no server-measured transport phases and no readable navigation timing (' + (transport || 'unknown transport') + ').';
    return out;
  }
  out.classification = TH.classify(out.value, TH.advisory.ttfb);
  return out;
}

module.exports = { analyzeTtfb };
