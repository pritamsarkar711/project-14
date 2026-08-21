'use strict';

/**
 * Secure Crawler - Safe Fetcher
 * Protects against:
 * - SSRF
 * - localhost access
 * - private networks
 * - internal services
 * - cloud metadata endpoints
 * - DNS rebinding
 * - malicious redirects
 * - infinite redirects
 * - redirect loops
 * - enormous responses
 * - decompression bombs
 * - excessive crawling
 * - request flooding
 */

const { assertPublicUrl, resolvePublic } = require('./ssrf');

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_MAX_BYTES = 1.5 * 1024 * 1024; // 1.5MB for HTML
const MAX_REDIRECTS = 8;
const UA = 'huvanti-broken-link-checker/1.0 (+https://huvanti.com/broken-link-checker)';

function makeError(code, message, extra) {
  const e = new Error(message);
  e.code = code;
  if (extra) Object.assign(e, extra);
  return e;
}

function headersToObject(headers) {
  const o = {};
  try {
    headers.forEach((v, k) => {
      const lk = k.toLowerCase();
      // Keep first value, but handle set-cookie as array?
      if (o[lk]) {
        if (Array.isArray(o[lk])) o[lk].push(v);
        else o[lk] = [o[lk], v];
      } else o[lk] = v;
    });
  } catch {}
  return o;
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

async function safeFetch(raw, opts = {}) {
  const maxBytes = opts.maxBytes || DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeout || DEFAULT_TIMEOUT;
  const method = (opts.method || 'GET').toUpperCase();
  const accept = opts.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
  const signal = opts.signal;

  let url = String(raw || '');
  let redirects = [];
  let redirectSet = new Set();

  const allowPrivate = opts.allowPrivate || process.env.ALLOW_PRIVATE === '1';
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    // Validate URL is public before each request
    let urlObj;
    try {
      urlObj = assertPublicUrl(url, { allowPrivate });
    } catch (e) {
      throw makeError(e.code || 'ssrf', e.message || 'Blocked URL');
    }

    // DNS validation (prevents rebinding)
    try {
      await resolvePublic(urlObj.hostname, { allowPrivate });
    } catch (e) {
      if (e.code === 'ssrf') throw e;
      throw makeError(e.code || 'dns', e.message);
    }

    // Check redirect loop
    const urlKey = urlObj.toString();
    if (redirectSet.has(urlKey)) {
      throw makeError('redirect_loop', `Redirect loop detected at ${urlKey}`, { redirects });
    }
    redirectSet.add(urlKey);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let combinedSignal = ac.signal;
    if (signal) {
      try {
        combinedSignal = AbortSignal.any([signal, ac.signal]);
      } catch {
        // Fallback for Node versions without AbortSignal.any
        combinedSignal = ac.signal;
        if (signal.aborted) ac.abort();
        else signal.addEventListener('abort', () => ac.abort(), { once: true });
      }
    }

    let res;
    try {
      res = await fetch(urlObj.toString(), {
        method,
        redirect: 'manual',
        signal: combinedSignal,
        headers: {
          'user-agent': UA,
          'accept': accept,
          'accept-encoding': 'gzip, deflate, br',
          'accept-language': 'en-US,en;q=0.9'
        }
      });
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        if (signal && signal.aborted) throw makeError('cancelled', 'The scan was cancelled.');
        throw makeError('timeout', `Request timeout for ${urlObj.toString()}`);
      }
      // Map TLS errors
      const msg = String(e.message || e);
      if (/certificate|tls|ssl/i.test(msg)) {
        throw makeError('tls_error', msg, { originalUrl: url });
      }
      if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) {
        throw makeError('dns', msg, { originalUrl: url });
      }
      throw makeError('fetch_failed', msg, { originalUrl: url });
    }
    clearTimeout(timer);

    const status = res.status;
    const location = res.headers.get('location');

    if (isRedirect(status) && location) {
      let nextUrl;
      try {
        nextUrl = new URL(location, urlObj).toString();
      } catch {
        throw makeError('redirect_invalid', `Invalid redirect location: ${location}`, { redirects });
      }
      // Validate redirect destination again (never trust original hostname after redirect)
      try {
        assertPublicUrl(nextUrl, { allowPrivate });
        const nextObj = new URL(nextUrl);
        await resolvePublic(nextObj.hostname, { allowPrivate });
      } catch (e) {
        throw makeError(e.code || 'ssrf', `Blocked redirect to ${nextUrl}: ${e.message}`, { redirects });
      }

      redirects.push({ from: urlObj.toString(), to: nextUrl, status, headers: headersToObject(res.headers) });
      url = nextUrl;
      if (redirects.length > MAX_REDIRECTS) {
        throw makeError('redirect_too_many', 'Too many redirects', { redirects });
      }
      continue;
    }

    // Not a redirect, process body
    let body = '';
    let bytes = 0;
    const contentLength = res.headers.get('content-length');
    if (contentLength) {
      const cl = Number(contentLength);
      if (!Number.isNaN(cl) && cl > maxBytes * 3) {
        // Allow but will enforce during streaming
      }
    }

    if (method !== 'HEAD') {
      try {
        // Use reader if available for size limiting
        if (res.body && res.body.getReader) {
          const reader = res.body.getReader();
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              bytes += value.byteLength;
              if (bytes > maxBytes) {
                try { await reader.cancel(); } catch {}
                throw makeError('too_large', `Response too large (${bytes} bytes) for ${urlObj.toString()}`);
              }
              chunks.push(value);
            }
          }
          // Concatenate
          const total = chunks.reduce((n, c) => n + c.byteLength, 0);
          const buf = new Uint8Array(total);
          let offset = 0;
          for (const c of chunks) {
            buf.set(c, offset);
            offset += c.byteLength;
          }
          body = new TextDecoder().decode(buf);
        } else {
          // Fallback
          const text = await res.text();
          bytes = Buffer.byteLength(text, 'utf8');
          if (bytes > maxBytes) throw makeError('too_large', `Response too large (${bytes} bytes)`);
          body = text;
        }
      } catch (e) {
        if (e.code) throw e;
        throw makeError('read_failed', e.message || 'Failed to read response');
      }
    }

    return {
      url: urlObj.toString(),
      finalUrl: urlObj.toString(),
      status,
      ok: res.ok,
      headers: headersToObject(res.headers),
      body,
      redirects,
      bytes,
      method
    };
  }

  throw makeError('redirect', 'Too many redirects or redirect loop', { redirects });
}

// HEAD with GET fallback
async function fetchWithFallback(url, opts = {}) {
  const headOpts = { ...opts, method: 'HEAD', maxBytes: 0 };
  try {
    const r = await safeFetch(url, headOpts);
    // If HEAD returns 405 or 501 or 403 that might be HEAD not supported, fallback
    if (r.status === 405 || r.status === 501) {
      return await safeFetch(url, { ...opts, method: 'GET' });
    }
    // Some servers return 403 for HEAD but 200 for GET - we should try GET for 403? But spec says don't automatically call broken for 403
    // For our checker, we want to try GET if HEAD fails with 403? Let's fallback for 403 as well to avoid false positives
    if (r.status === 403) {
      try {
        const g = await safeFetch(url, { ...opts, method: 'GET' });
        return g;
      } catch {
        return r; // keep HEAD result if GET fails
      }
    }
    return r;
  } catch (e) {
    // If HEAD fails with method not allowed or timeout, try GET
    if (e.code === 'fetch_failed' || e.code === 'timeout' || e.code === 'too_large' || /method/i.test(e.message)) {
      return await safeFetch(url, { ...opts, method: 'GET' });
    }
    throw e;
  }
}

module.exports = { safeFetch, fetchWithFallback, UA };
