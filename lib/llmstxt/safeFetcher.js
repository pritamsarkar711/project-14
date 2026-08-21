'use strict';

/*
 * LLMs.txt Generator — SSRF-safe HTTP fetcher.
 * Reuses the shared SSRF guard (lib/wptheme/ssrf) and error helper (lib/wptheme/util).
 * Deterministic only: no AI, no paid APIs.
 *
 * Hard limits: max redirects, per-request timeout, per-response byte cap,
 * connection budget, plus bot-protection detection so we can report
 * 401/403/429/Cloudflare honestly instead of claiming "no pages".
 */

const { assertPublicUrl, resolvePublic } = require('../wptheme/ssrf');
const { makeError } = require('../wptheme/util');

const MAX_REDIRECTS = 6;
const DEFAULT_TIMEOUT = 9000;
const DEFAULT_BYTES = 900 * 1024;
const UA = 'huvanti-llmstxt/1.0 (+https://huvanti.com/llms-txt-generator)';

function headersObj(headers) {
  const o = {};
  headers.forEach((v, k) => { o[k.toLowerCase()] = v; });
  return o;
}

/* Lightweight bot-protection / challenge detection from headers + body. */
function detectChallenge(body, headers, status) {
  const h = headers || {};
  const s = String(body || '').slice(0, 12000).toLowerCase();
  if (h['cf-ray'] || h['cf-mitigated']) return { detected: true, provider: 'Cloudflare' };
  if (s.includes('just a moment') || s.includes('cf-browser-verification') || s.includes('cf-challenge') || s.includes('checking your browser')) return { detected: true, provider: 'Cloudflare' };
  if (s.includes('captcha') && (s.includes('recaptcha') || s.includes('hcaptcha') || s.includes('turnstile'))) return { detected: true, provider: 'CAPTCHA' };
  if (s.includes('datadome') || h['x-datadome']) return { detected: true, provider: 'DataDome' };
  if ((status === 403 || status === 503) && /(blocked|denied)/.test(s) && /(bot|automated|access)/.test(s)) return { detected: true, provider: 'Unknown' };
  return { detected: false, provider: null };
}

async function safeFetch(raw, opts = {}) {
  let url = String(raw || '');
  const redirects = [];
  const maxBytes = opts.maxBytes || DEFAULT_BYTES;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const u = assertPublicUrl(url);
    await resolvePublic(u.hostname);
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), opts.timeout || DEFAULT_TIMEOUT);
    const signal = opts.signal ? AbortSignal.any([opts.signal, ac.signal]) : ac.signal;
    let res;
    try {
      res = await fetch(u.toString(), {
        method: opts.method || 'GET',
        redirect: 'manual',
        signal,
        headers: {
          'user-agent': UA,
          'accept': opts.accept || 'text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.6'
        }
      });
    } catch (e) {
      clearTimeout(t);
      if (opts.signal && opts.signal.aborted) throw makeError('cancelled', 'The crawl was cancelled.');
      if (e.name === 'AbortError') throw makeError('timeout', 'The website took too long to respond.');
      if (e.cause && e.cause.code && /^(ENOTFOUND|EAI_AGAIN)$/.test(e.cause.code)) throw makeError('dns', 'Could not resolve DNS for the website.');
      throw makeError('unreachable', 'The website could not be reached: ' + (e.message || 'network error'));
    }
    clearTimeout(t);
    const status = res.status;
    const loc = res.headers.get('location');
    if ([301, 302, 303, 307, 308].includes(status) && loc) {
      const next = new URL(loc, u).toString();
      assertPublicUrl(next); // revalidate every redirect destination (SSRF guard)
      redirects.push({ from: u.toString(), to: next, status });
      url = next;
      continue;
    }
    let body = '';
    let bytes = 0;
    if (opts.method !== 'HEAD') {
      const reader = res.body && res.body.getReader ? res.body.getReader() : null;
      if (reader) {
        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) { try { await reader.cancel(); } catch {} throw makeError('too_large', 'A response was too large to analyse safely.'); }
          chunks.push(value);
        }
        body = Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8');
      } else {
        body = await res.text();
        bytes = Buffer.byteLength(body, 'utf8');
        if (bytes > maxBytes) body = body.slice(0, maxBytes);
      }
    }
    const headers = headersObj(res.headers);
    return {
      url: u.toString(),
      finalUrl: u.toString(),
      status,
      ok: res.ok,
      headers,
      contentType: String(headers['content-type'] || ''),
      body,
      redirects,
      bytes,
      challenge: detectChallenge(body, headers, status)
    };
  }
  throw makeError('redirect', 'Too many redirects or an unsafe redirect.');
}

module.exports = { safeFetch, UA, detectChallenge };
