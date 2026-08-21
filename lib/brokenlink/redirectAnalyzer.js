'use strict';

/**
 * Redirect Analyzer
 * For every redirect, record the complete chain.
 * Detects:
 * - single redirect
 * - multiple redirects
 * - redirect chains
 * - redirect loops
 * - cross-domain redirects
 * - HTTP → HTTPS
 * - www → non-www
 * - non-www → www
 */

function analyzeRedirects(redirects, finalUrl, originalUrl) {
  redirects = redirects || [];
  const chain = [...redirects];
  // Add final hop if redirects exist
  if (chain.length && finalUrl) {
    // finalUrl is already last destination, but we have from->to chain
  }

  const result = {
    count: chain.length,
    chain,
    finalUrl: finalUrl || originalUrl,
    originalUrl,
    type: 'none',
    issues: [],
    isLoop: false,
    isCrossDomain: false,
    isHttpToHttps: false,
    isHttpsToHttp: false,
    isWwwToNonWww: false,
    isNonWwwToWww: false
  };

  if (chain.length === 0) {
    result.type = 'none';
    return result;
  }

  if (chain.length === 1) result.type = 'single';
  else if (chain.length <= 3) result.type = 'chain';
  else result.type = 'long_chain';

  // Detect loop
  const seen = new Set();
  let loopDetected = false;
  for (const hop of chain) {
    const to = hop.to;
    if (seen.has(to)) {
      loopDetected = true;
      break;
    }
    seen.add(hop.from);
  }
  // Also check if finalUrl loops back
  if (finalUrl && seen.has(finalUrl) && chain.length > 0) {
    // If finalUrl equals some earlier URL, it's a loop
    // But finalUrl is already in chain as last to, so check if it appears earlier
    const earlier = chain.slice(0, -1).some(h => h.from === finalUrl || h.to === finalUrl);
    if (earlier) loopDetected = true;
  }

  if (loopDetected) {
    result.isLoop = true;
    result.type = 'loop';
    result.issues.push('Redirect Loop Detected');
  }

  // Cross-domain, http->https, www checks
  try {
    const orig = new URL(originalUrl);
    const fin = new URL(finalUrl || originalUrl);
    if (orig.hostname.toLowerCase() !== fin.hostname.toLowerCase()) {
      result.isCrossDomain = true;
      if (orig.hostname.toLowerCase().replace(/^www\./, '') === fin.hostname.toLowerCase().replace(/^www\./, '')) {
        // www variation
        if (orig.hostname.toLowerCase().startsWith('www.') && !fin.hostname.toLowerCase().startsWith('www.')) {
          result.isWwwToNonWww = true;
        } else if (!orig.hostname.toLowerCase().startsWith('www.') && fin.hostname.toLowerCase().startsWith('www.')) {
          result.isNonWwwToWww = true;
        }
      } else {
        result.issues.push('Cross-domain redirect');
      }
    }
    if (orig.protocol === 'http:' && fin.protocol === 'https:') {
      result.isHttpToHttps = true;
    }
    if (orig.protocol === 'https:' && fin.protocol === 'http:') {
      result.isHttpsToHttp = true;
      result.issues.push('HTTPS → HTTP downgrade');
    }

    // Check each hop for cross-domain
    for (const hop of chain) {
      try {
        const from = new URL(hop.from);
        const to = new URL(hop.to);
        if (from.hostname.toLowerCase() !== to.hostname.toLowerCase()) {
          result.isCrossDomain = true;
        }
      } catch {}
    }

    if (chain.length > 3) {
      result.issues.push(`Long redirect chain (${chain.length} hops)`);
    } else if (chain.length > 1) {
      result.issues.push(`Redirect chain (${chain.length} hops)`);
    }

    if (result.isWwwToNonWww) result.issues.push('www → non-www redirect');
    if (result.isNonWwwToWww) result.issues.push('non-www → www redirect');
    if (result.isHttpToHttps) result.issues.push('HTTP → HTTPS redirect');

  } catch {}

  return result;
}

function isRedirectLoop(redirects) {
  const seen = new Set();
  for (const r of redirects || []) {
    if (seen.has(r.to)) return true;
    seen.add(r.from);
    seen.add(r.to);
  }
  return false;
}

module.exports = { analyzeRedirects, isRedirectLoop };
