'use strict';

/*
 * Redirect chain analysis, factual, non-alarmist.
 * Every redirect is classified; problems (loops, excessive hops) are reported,
 * but ordinary http→https / www-normalization redirects are described as the
 * normal, recommended behaviour they are.
 */

function classify(status) {
  const s = Number(status);
  if (s === 301 || s === 308) return 'permanent';
  if (s === 302 || s === 303 || s === 307) return 'temporary';
  return 'unknown';
}

function analyzeRedirectChain(chain, domain) {
  const out = {
    hops: [],
    httpToHttps: false,
    httpsToHttp: false,
    wwwNormalized: false,
    loopDetected: false,
    excessive: false,
    notes: []
  };
  if (!chain || !chain.length) return out;

  const seen = new Set();
  for (const hop of chain) {
    out.hops.push({
      url: hop.url,
      status: hop.status,
      kind: classify(hop.status),
      location: hop.location || null,
      note: hop.status >= 300 && hop.status < 400
        ? (classify(hop.status) === 'permanent' ? 'Permanent redirect (301/308).' : 'Temporary redirect (302/303/307).')
        : null
    });
    const u = hop.url;
    if (seen.has(u)) {
      out.loopDetected = true;
      out.notes.push('A redirect loop was detected (' + u + ' appeared twice in the chain).');
      break;
    }
    seen.add(u);
  }

  // every hop describes url → location; analyse each such pair directly
  for (const hop of chain) {
    const from = hop.url;
    const to = hop.location || '';
    if (!to) continue;
    if (from.startsWith('http://') && to.startsWith('https://')) {
      out.httpToHttps = true;
      out.notes.push('HTTP → HTTPS upgrade detected, this is recommended behaviour.');
    }
    if (from.startsWith('https://') && to.startsWith('http://')) {
      out.httpsToHttp = true;
      out.notes.push('The redirect chain downgrades HTTPS → HTTP, which browsers may block or warn about.');
    }
    try {
      const fromHost = (new URL(from)).hostname;
      const toHost = (new URL(to)).hostname;
      if (fromHost.replace(/^www\./, '') === toHost.replace(/^www\./, '') && fromHost !== toHost) {
        out.wwwNormalized = true;
        out.notes.push('The chain normalizes between the www and non-www hostname.');
      }
    } catch (e) { /* ignore malformed hop */ }
  }

  if (chain.length - 1 > 5) {
    out.excessive = true;
    out.notes.push('The chain has ' + (chain.length - 1) + ' redirects, unusually long. Each extra hop adds latency.');
  }

  if (!out.notes.length) out.notes.push('No notable redirect patterns detected.');
  return out;
}

module.exports = { analyzeRedirectChain, classify };
