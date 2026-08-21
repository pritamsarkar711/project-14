'use strict';

/**
 * Broken Link Classifier
 * Accurate classification per spec:
 * - Healthy: 200,204
 * - Redirect: 301,302,303,307,308
 * - Broken: 404,410,persistent 5xx,DNS failure,persistent connection failure,invalid destination
 * - Restricted: 401,403
 * - Rate Limited: 429
 * - Temporary Failure: timeout, connection reset, temporary 5xx
 * - Bot Protection: CAPTCHA, Cloudflare challenge, anti-bot page
 * - Unknown: Insufficient evidence
 * Never classify 401,403,429,CAPTCHA,Cloudflare,bot protection, temporary timeout, HEAD failure, robots.txt restriction as broken.
 */

function classify(result) {
  // result is from httpChecker / retryManager
  const status = result.status || 0;
  const errorCode = result.errorCode || '';
  const error = String(result.error || '').toLowerCase();
  const bot = result.botProtection;
  const dns = result.dns;
  const tls = result.tls;

  // Redirect loop
  if (errorCode === 'redirect_loop' || errorCode === 'redirect_too_many' || String(result.error || '').toLowerCase().includes('redirect loop')) {
    return { classification: 'Redirect Loop Detected', category: 'redirect_loop', severity: 'critical', reason: result.error || 'Redirect loop detected', status, evidence: result.redirects || result.error, isLoop: true };
  }

  // Robots.txt blocked
  if (result.blockedByRobots) {
    return { classification: 'Blocked by robots.txt', category: 'blocked', severity: 'low', reason: 'Blocked by robots.txt', status, evidence: 'robots.txt disallow' };
  }

  // Bot protection first (should not be called broken)
  if (bot && bot.detected) {
    return {
      classification: 'Bot Protection / Unable to Verify',
      category: 'bot_protection',
      severity: 'low',
      reason: `Bot protection detected: ${bot.provider} (${bot.type})`,
      status,
      evidence: bot,
      provider: bot.provider
    };
  }

  // DNS errors
  if (errorCode && errorCode.toLowerCase().includes('dns') || dns && !dns.ok) {
    const dnsCode = (dns && dns.code) || errorCode;
    if (dnsCode === 'NXDOMAIN' || error.includes('nxdomain') || error.includes('enotfound')) {
      return { classification: 'Confirmed Broken', category: 'dns_error', severity: 'high', reason: `DNS resolution failed: NXDOMAIN`, status, evidence: dns || error };
    }
    return { classification: 'Confirmed Broken', category: 'dns_error', severity: 'high', reason: `DNS resolution failed: ${dns ? dns.code : errorCode}`, status, evidence: dns || error };
  }

  // TLS errors
  if (tls && !tls.ok) {
    if (tls.status === 'expired') return { classification: 'SSL/TLS Error', category: 'ssl_error', severity: 'high', reason: `SSL/TLS Error: expired certificate`, status, evidence: tls };
    if (tls.status === 'hostname_mismatch') return { classification: 'SSL/TLS Error', category: 'ssl_error', severity: 'high', reason: `SSL/TLS Error: hostname mismatch`, status, evidence: tls };
    return { classification: 'SSL/TLS Error', category: 'ssl_error', severity: 'medium', reason: `SSL/TLS Error: ${tls.reason || tls.status}`, status, evidence: tls };
  }
  if (errorCode === 'tls_error') {
    return { classification: 'SSL/TLS Error', category: 'ssl_error', severity: 'high', reason: `SSL/TLS Error: ${result.error}`, status, evidence: result.error };
  }

  // Timeout / connection
  if (errorCode === 'timeout' || error.includes('timeout')) {
    // Check if persistent after retries
    if (result.attemptCount >= 3) {
      return { classification: 'Timeout', category: 'timeout', severity: 'medium', reason: 'Persistent timeout after retries', status, evidence: result.evidence || result.error };
    }
    return { classification: 'Timeout', category: 'timeout', severity: 'low', reason: 'Request timeout', status, evidence: result.error };
  }

  if (errorCode === 'fetch_failed' || errorCode === 'read_failed') {
    if (result.attemptCount >= 3) {
      return { classification: 'Confirmed Broken', category: 'connection_failed', severity: 'high', reason: `Persistent connection failure: ${result.error}`, status, evidence: result.evidence };
    }
    return { classification: 'Unable to Verify', category: 'temporary_failure', severity: 'low', reason: `Connection failure: ${result.error}`, status, evidence: result.error };
  }

  // HTTP status based
  if (status === 200 || status === 204) {
    return { classification: 'Healthy', category: 'healthy', severity: 'none', reason: `OK (${status})`, status };
  }

  if ([301,302,303,307,308].includes(status)) {
    return { classification: 'Redirect', category: 'redirect', severity: 'low', reason: `Redirect (${status})`, status, finalUrl: result.finalUrl, redirects: result.redirects };
  }

  if (status === 404) {
    // Confirm after retries
    if (result.attemptCount >= 2) {
      return { classification: 'Confirmed Broken', category: 'broken', severity: 'high', reason: '404 Not Found (confirmed after retries)', status, evidence: result.evidence };
    }
    return { classification: 'Confirmed Broken', category: 'broken', severity: 'high', reason: '404 Not Found', status };
  }

  if (status === 410) {
    return { classification: 'Confirmed Broken', category: 'broken', severity: 'high', reason: '410 Gone', status };
  }

  if (status === 401) {
    return { classification: 'Authentication Required', category: 'restricted', severity: 'low', reason: '401 Authentication Required', status };
  }

  if (status === 403) {
    return { classification: 'Access Forbidden', category: 'restricted', severity: 'low', reason: '403 Forbidden - Unable to verify (may be bot protection or restricted)', status };
  }

  if (status === 429) {
    return { classification: 'Rate Limited', category: 'rate_limited', severity: 'low', reason: '429 Rate Limited', status };
  }

  if (status >= 500 && status <= 599) {
    // Check if persistent
    if (result.attemptCount >= 3) {
      // persistent 5xx = confirmed broken per spec? But spec says persistent 5xx = broken, temporary 5xx = temporary failure
      // We'll treat 500,502,503,504 that persist as broken if 3 attempts all same 5xx, but mark as server_error
      const all5xx = result.attempts ? result.attempts.every(a => a.status >= 500) : true;
      if (all5xx) {
        return { classification: 'Confirmed Broken', category: 'server_error', severity: 'high', reason: `Persistent server error (${status}) after ${result.attemptCount} attempts`, status, evidence: result.evidence };
      }
    }
    return { classification: 'Temporary Failure', category: 'temporary_failure', severity: 'medium', reason: `Server error (${status}) - temporary`, status };
  }

  if (status === 0) {
    return { classification: 'Unable to Verify', category: 'unknown', severity: 'low', reason: result.error || 'Unable to verify', status, evidence: result.error };
  }

  // Other 4xx
  if (status >= 400 && status < 500) {
    // 400,405, etc - treat as broken? But be conservative
    if (status === 400 || status === 405 || status === 406 || status === 408) {
      return { classification: 'Unable to Verify', category: 'unknown', severity: 'low', reason: `HTTP ${status}`, status };
    }
    return { classification: 'Confirmed Broken', category: 'broken', severity: 'medium', reason: `HTTP ${status}`, status };
  }

  return { classification: 'Unknown', category: 'unknown', severity: 'low', reason: `Insufficient evidence (status ${status})`, status };
}

function getSeverity(classification, context = {}) {
  // Context can include internal/external, count, etc
  if (classification.category === 'broken' || classification.category === 'dns_error' || classification.category === 'server_error' || classification.category === 'ssl_error') {
    if (context.isInternal) return 'critical';
    return 'high';
  }
  if (classification.category === 'redirect' && context.redirectCount > 2) return 'medium';
  if (classification.category === 'redirect_loop') return 'critical';
  if (classification.category === 'broken_anchor') return 'medium';
  if (classification.category === 'timeout' || classification.category === 'temporary_failure') return 'medium';
  if (classification.category === 'restricted' || classification.category === 'rate_limited' || classification.category === 'bot_protection' || classification.category === 'blocked') return 'low';
  return 'low';
}

module.exports = { classify, getSeverity };
