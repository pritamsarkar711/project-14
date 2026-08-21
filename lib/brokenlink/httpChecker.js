'use strict';

/**
 * HTTP Checking Engine
 * Checks:
 * - status code
 * - response headers
 * - content type
 * - final URL
 * - redirect chain
 * - response time
 * - TLS status
 * Uses:
 * 1. HEAD where appropriate
 * 2. GET fallback when HEAD isn't supported
 * 3. Safe partial downloads where possible
 * Never assumes HEAD accurately represents GET behavior.
 */

const { safeFetch, fetchWithFallback } = require('./safeFetcher');
const { checkTls } = require('./tlsChecker');
const { analyzeDns } = require('./dnsResolver');

function detectBotProtection(body, headers, status) {
  body = String(body || '').slice(0, 20000).toLowerCase();
  const h = headers || {};
  const server = String(h['server'] || '').toLowerCase();
  const cfRay = h['cf-ray'] || h['cf-mitigated'] || '';
  const contentType = String(h['content-type'] || '').toLowerCase();

  // Cloudflare challenge
  if (body.includes('just a moment') && body.includes('cloudflare') || body.includes('attention required') && body.includes('cloudflare') || body.includes('cf-browser-verification') || body.includes('checking your browser') || body.includes('cf-challenge') || cfRay) {
    if (body.includes('captcha') || body.includes('challenge') || status === 403 || status === 503) {
      return { detected: true, provider: 'Cloudflare', type: 'cloudflare_challenge', confidence: 'high' };
    }
  }
  if (body.includes('captcha') && (body.includes('recaptcha') || body.includes('hcaptcha') || body.includes('turnstile'))) {
    return { detected: true, provider: 'CAPTCHA', type: 'captcha', confidence: 'medium' };
  }
  if (server.includes('imperva') || body.includes('imperva') || h['x-iinfo']) {
    return { detected: true, provider: 'Imperva', type: 'bot_protection', confidence: 'high' };
  }
  if (body.includes('sucuri') && body.includes('cloudproxy')) {
    return { detected: true, provider: 'Sucuri', type: 'bot_protection', confidence: 'high' };
  }
  if (body.includes('akamai') && (body.includes('access denied') || status === 403)) {
    // Could be bot protection
    if (body.includes('bot') || body.includes('automated')) {
      return { detected: true, provider: 'Akamai', type: 'bot_protection', confidence: 'medium' };
    }
  }
  if (body.includes('datadome') || h['x-datadome']) {
    return { detected: true, provider: 'DataDome', type: 'bot_protection', confidence: 'high' };
  }
  if (body.includes('perimeterx') || h['x-px-']) {
    return { detected: true, provider: 'PerimeterX', type: 'bot_protection', confidence: 'high' };
  }
  // Generic bot protection
  if ((status === 403 || status === 503) && (body.includes('bot') && body.includes('blocked') || body.includes('automated') && body.includes('blocked'))) {
    return { detected: true, provider: 'Unknown', type: 'bot_protection', confidence: 'low' };
  }
  return { detected: false };
}

async function checkUrl(url, opts = {}) {
  const start = Date.now();
  let result = {
    url,
    finalUrl: url,
    status: 0,
    ok: false,
    headers: {},
    body: '',
    redirects: [],
    responseTime: 0,
    error: null,
    errorCode: null,
    tls: null,
    dns: null,
    botProtection: null,
    contentType: null,
    method: 'GET'
  };

  try {
    // First, try with fallback logic
    const fetchResult = await fetchWithFallback(url, {
      ...opts,
      timeout: opts.timeout || 12000,
      maxBytes: opts.maxBytes || 500 * 1024 // 500KB for link checking
    });

    result.status = fetchResult.status;
    result.ok = fetchResult.ok;
    result.headers = fetchResult.headers;
    result.body = fetchResult.body ? String(fetchResult.body).slice(0, 10000) : '';
    result.finalUrl = fetchResult.finalUrl || url;
    result.redirects = fetchResult.redirects || [];
    result.method = fetchResult.method || 'GET';
    result.contentType = fetchResult.headers['content-type'] || null;
    result.responseTime = Date.now() - start;

    // Bot protection detection
    result.botProtection = detectBotProtection(result.body, result.headers, result.status);

    // TLS check for https URLs if needed
    if (url.startsWith('https://') && (result.status === 0 || result.error || result.status >= 500)) {
      try {
        const u = new URL(url);
        const tlsResult = await checkTls(u.hostname, u.port ? Number(u.port) : 443, 5000);
        result.tls = tlsResult;
      } catch {}
    }

    return result;

  } catch (e) {
    result.responseTime = Date.now() - start;
    result.error = e.message;
    result.errorCode = e.code || 'fetch_failed';
    result.redirects = e.redirects || [];

    // DNS analysis
    if (e.code && e.code.toString().toLowerCase().includes('dns')) {
      try {
        const u = new URL(url);
        const dnsResult = await analyzeDns(u.hostname);
        result.dns = dnsResult;
      } catch {}
    }

    // TLS analysis on failure
    if (e.code === 'tls_error' || /tls|ssl|certificate/i.test(e.message)) {
      try {
        const u = new URL(url);
        const tlsResult = await checkTls(u.hostname, u.port ? Number(u.port) : 443, 5000);
        result.tls = tlsResult;
      } catch {}
    }

    // If error message suggests bot protection
    if (e.message) {
      const bot = detectBotProtection(e.message, {}, 0);
      if (bot.detected) result.botProtection = bot;
    }

    return result;
  }
}

module.exports = { checkUrl, detectBotProtection };
