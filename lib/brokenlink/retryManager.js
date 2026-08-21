'use strict';

const { checkUrl } = require('./httpChecker');

function isTemporaryFailure(result) {
  if (!result) return true;
  if (result.errorCode === 'timeout' || result.errorCode === 'fetch_failed' || result.errorCode === 'read_failed') return true;
  if (result.status === 429) return true;
  if (result.status >= 500 && result.status <= 599) return true;
  if (result.status === 0 && result.error) return true;
  return false;
}

function isConfirmedBrokenStatus(status) {
  return status === 404 || status === 410;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function checkWithRetry(url, opts = {}) {
  const maxRetries = opts.maxRetries != null ? opts.maxRetries : 2;
  const baseDelay = opts.baseDelay || 400;
  const maxDelay = opts.maxDelay || 4000;

  let attempts = [];
  let lastResult = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1) + Math.random() * 200, maxDelay);
      await sleep(delay);
    }
    if (opts.signal && opts.signal.aborted) {
      throw Object.assign(new Error('The scan was cancelled.'), { code: 'cancelled' });
    }
    const result = await checkUrl(url, opts);
    attempts.push(result);
    lastResult = result;

    if (result.status >= 200 && result.status < 300) break;
    if (isConfirmedBrokenStatus(result.status)) {
      if (attempt < maxRetries) continue; else break;
    }
    if (result.status === 401 || result.status === 403 || result.status === 429 || (result.botProtection && result.botProtection.detected)) {
      if (attempt < maxRetries) continue; else break;
    }
    if (isTemporaryFailure(result)) {
      if (attempt < maxRetries) continue; else break;
    }
    break;
  }

  // Build evidence without circular references
  const evidence = attempts.map(a => ({
    status: a.status,
    finalUrl: a.finalUrl,
    error: a.error,
    errorCode: a.errorCode,
    responseTime: a.responseTime,
    botProtection: a.botProtection,
    tls: a.tls ? { status: a.tls.status, reason: a.tls.reason } : null,
    dns: a.dns ? { code: a.dns.code, error: a.dns.error } : null
  }));

  const allSameStatus = attempts.every(a => a.status === lastResult.status);
  const hasSuccess = attempts.some(a => a.status >= 200 && a.status < 300);

  let verifiedStatus = 'unknown';
  if (hasSuccess) verifiedStatus = 'working';
  else if (allSameStatus && isConfirmedBrokenStatus(lastResult.status)) verifiedStatus = 'confirmed_broken';
  else if (lastResult.status === 404 || lastResult.status === 410) verifiedStatus = 'confirmed_broken';
  else if (lastResult.status === 401 || lastResult.status === 403 || (lastResult.botProtection && lastResult.botProtection.detected)) verifiedStatus = 'blocked';
  else if (lastResult.status === 429) verifiedStatus = 'rate_limited';
  else if (isTemporaryFailure(lastResult) && attempts.length > 1) verifiedStatus = 'temporary_failure';
  else if (lastResult.errorCode && lastResult.errorCode.startsWith('dns')) verifiedStatus = 'dns_error';
  else if (lastResult.tls && !lastResult.tls.ok) verifiedStatus = 'ssl_error';
  else if (lastResult.status >= 500) verifiedStatus = 'server_error';

  // Return a clean object without circular refs
  return {
    url: lastResult.url,
    finalUrl: lastResult.finalUrl,
    status: lastResult.status,
    ok: lastResult.ok,
    headers: lastResult.headers,
    body: lastResult.body ? String(lastResult.body).slice(0, 5000) : '',
    redirects: lastResult.redirects || [],
    responseTime: lastResult.responseTime,
    error: lastResult.error,
    errorCode: lastResult.errorCode,
    tls: lastResult.tls,
    dns: lastResult.dns,
    botProtection: lastResult.botProtection,
    contentType: lastResult.contentType,
    method: lastResult.method,
    attempts: evidence,
    attemptCount: attempts.length,
    evidence,
    verifiedStatus
  };
}

module.exports = { checkWithRetry, isTemporaryFailure };
