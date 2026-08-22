'use strict';

/*
 * HTTP analysis, pinned, SSRF-guarded, budgeted.
 *   - HTTPS and HTTP (port 80) probes
 *   - full redirect chain with per-hop re-validation
 *   - response headers of interest (Server, Content-Type, compression,
 *     caching, HSTS, X-Powered-By …)
 *   - gzip/deflate/brotli decoding for HTML-based analysis
 *   - strict time/size/redirect budgets
 *
 * When this server has no direct HTTP egress (this preview sandbox), the
 * outcome is 'unavailable' with the transport reason. The page can then ask
 * the visitor's browser for a CORS-permitting fetch and submit it to
 * /api/domaincheck-analyze (analyzeBrowserBundle below).
 */

const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { assertPublicUrl, assertSafeHostname, resolveAndPin } = require('../wptheme/ssrf');
const U = require('./util');

const TIMEOUT_MS = 10000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 8;
const UA = 'huvanti-domain-checker/1.0 (+https://huvanti.com/domain-information-checker)';

const HEADERS_OF_INTEREST = [
  'server', 'content-type', 'content-encoding', 'content-length', 'cache-control',
  'etag', 'last-modified', 'expires', 'age', 'vary', 'strict-transport-security',
  'x-powered-by', 'x-generator', 'x-frame-options', 'x-content-type-options',
  'referrer-policy', 'permissions-policy', 'content-security-policy',
  'x-xss-protection', 'x-aspnet-version', 'x-aspnetmvc-version', 'x-drupal-cache',
  'x-drupal-dynamic-cache', 'x-litespeed-cache', 'link', 'location', 'set-cookie',
  'x-request-id', 'via', 'x-cache', 'x-served-by', 'x-cache-hits', 'x-varnish',
  'cf-ray', 'cf-cache-status', 'x-turbo-charged-by', 'x-technology', 'report-to', 'nel'
];

function decodeBody(buf, encoding) {
  const enc = String(encoding || '').toLowerCase();
  try {
    if (enc.includes('gzip')) return zlib.gunzipSync(buf).toString('utf8');
    if (enc.includes('br')) return zlib.brotliDecompressSync(buf).toString('utf8');
    if (enc.includes('deflate')) {
      try { return zlib.inflateSync(buf).toString('utf8'); }
      catch (e) { return zlib.inflateRawSync(buf).toString('utf8'); }
    }
  } catch (e) { /* leave undecoded */ }
  return buf.toString('utf8');
}

function requestOnce(urlObj, pin, opt) {
  opt = opt || {};
  const isHttps = urlObj.protocol === 'https:';
  const lib = isHttps ? https : http;
  const port = urlObj.port ? Number(urlObj.port) : (isHttps ? 443 : 80);
  const timeout = opt.timeout || TIMEOUT_MS;
  const headers = Object.assign({
    'Host': urlObj.host,
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br'
  }, opt.headers || {});

  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const reqOpts = {
      hostname: urlObj.hostname, port, path: urlObj.pathname + urlObj.search, method: opt.method || 'GET', headers,
      servername: isHttps ? urlObj.hostname : undefined,
      lookup: (hostname, options, cb) => {
        if (options && options.all) cb(null, [{ address: pin.address, family: pin.family || 4 }]);
        else cb(null, pin.address, pin.family || 4);
      }
    };
    const req = lib.request(reqOpts, res => {
      const chunks = [];
      let size = 0;
      const head = { status: res.statusCode || 0, statusText: res.statusMessage || '', httpVersion: res.httpVersion || null, headers: {}, rawHeaders: {} };
      for (const k of Object.keys(res.headers || {})) {
        const v = res.headers[k];
        head.headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
        head.rawHeaders[k.toLowerCase()] = v;
      }
      res.on('data', c => {
        size += c.length;
        if (size <= MAX_BYTES) chunks.push(c);
        else { res.destroy(); }
      });
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const truncated = size > MAX_BYTES;
        const body = truncated ? '' : decodeBody(buf, head.headers['content-encoding']);
        resolve({ ...head, body, bytes: size, truncated, ms: Date.now() - t0, encoding: head.headers['content-encoding'] || null });
      });
      res.on('error', e => reject(U.makeError('fetch_failed', 'HTTP response error: ' + e.message, e)));
    });
    req.on('timeout', () => { req.destroy(); reject(U.makeError('timeout', 'The HTTP request timed out.')); });
    req.on('error', e => {
      const c = String(e.code || '');
      const m = String(e.message || '');
      if (/UNABLE_TO_VERIFY|DEPTH_ZERO|SELF_SIGNED|CERT_HAS_EXPIRED|CERT_NOT_YET_VALID|ALTNAME_INVALID|NO_CERT|EDEPTH|CERT_CHAIN|ERR_TLS_CERT/.test(c) || /certificate/.test(m)) {
        reject(U.makeError('ssl', 'SSL/TLS certificate validation failed, the site’s certificate could not be verified (expired, self-signed or incomplete chain).', e));
      } else if (isHttps && (/ECONNRESET|EPIPE|EPROTO|ECONNABORTED|ERR_SSL_WRONG_VERSION_NUMBER/.test(c) || /socket disconnected before secure tls|connection reset|wrong version number|handshake/.test(m))) {
        reject(U.makeError('tls_blocked', 'The HTTPS connection was reset before TLS completed, either the site refuses this scanner or this server has no direct HTTPS egress.', e));
      } else if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/.test(c)) reject(U.makeError('unreachable', 'Could not reach the server (connection refused or unreachable).', e));
      else if (/ENOTFOUND|EAI_AGAIN/.test(c)) reject(U.makeError('dns', 'The domain could not be resolved.', e));
      else reject(U.makeError('unreachable', 'The request failed: ' + m, e));
    });
    req.setTimeout(timeout);
    if (opt.signal) {
      const onAbort = () => { req.destroy(); reject(U.makeError('cancelled', 'Scan cancelled.')); };
      if (opt.signal.aborted) return onAbort();
      opt.signal.addEventListener('abort', onAbort, { once: true });
    }
    req.end();
  });
}

function parseHsts(headerValue) {
  const v = String(headerValue || '');
  const maxAge = (v.match(/max-age\s*=\s*(\d+)/i) || [])[1];
  return {
    present: /max-age\s*=/i.test(v),
    maxAge: maxAge ? Number(maxAge) : null,
    includeSubDomains: /includeSubDomains/i.test(v),
    preload: /preload/i.test(v)
  };
}

async function fetchWithRedirects(rawUrl, opt) {
  opt = opt || {};
  const transport = opt.request || null; // injectable for offline tests
  const chain = [];
  let current = assertPublicUrl(rawUrl);
  let result = null;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    assertSafeHostname(current.hostname);
    const pin = transport ? { address: '93.184.216.34', family: 4 } : await resolveAndPin(current);
    const res = transport ? await transport(current, pin, opt) : await requestOnce(current, pin, opt);
    chain.push({
      url: current.href,
      status: res.status,
      statusText: res.statusText,
      location: res.headers['location'] || null,
      httpVersion: res.httpVersion,
      ms: res.ms,
      ip: pin.address
    });
    if (res.status >= 300 && res.status < 400 && res.headers['location']) {
      let next;
      try { next = new URL(res.headers['location'], current.href); } catch (e) {
        return { outcome: 'error', error: { code: 'bad_redirect', message: 'Invalid redirect location.' }, chain };
      }
      if (!/^https?:$/.test(next.protocol)) {
        return { outcome: 'error', error: { code: 'bad_redirect', message: 'Redirect used a non-http(s) protocol.' }, chain };
      }
      assertPublicUrl(next.href);
      current = next;
      continue;
    }
    result = { ...res, finalUrl: current.href };
    break;
  }
  if (!result) {
    return { outcome: 'error', error: { code: 'too_many_redirects', message: 'More than ' + MAX_REDIRECTS + ' redirects.' }, chain };
  }
  return { outcome: 'ok', result, chain };
}

async function analyzeHttp(domain, opt) {
  opt = opt || {};
  const out = {
    status: 'unavailable',
    source: 'http',
    https: { status: null, finalUrl: null, httpVersion: null, responseTimeMs: null, headers: null, note: null },
    http: { status: null, note: null },
    redirects: { count: 0, chain: [], analysis: null },
    hsts: { present: false, maxAge: null, includeSubDomains: false, preload: false },
    httpsRedirect: null,
    note: null
  };

  const httpsUrl = 'https://' + domain + '/';
  try {
    const r = await fetchWithRedirects(httpsUrl, opt);
    if (r.outcome === 'ok') {
      const res = r.result;
      out.status = 'ok';
      const hdrs = {};
      for (const k of HEADERS_OF_INTEREST) {
        if (res.headers[k] != null) hdrs[k] = res.headers[k];
      }
      out.https = {
        status: res.status,
        statusText: res.statusText,
        finalUrl: res.finalUrl,
        httpVersion: res.httpVersion,
        responseTimeMs: res.ms,
        contentType: res.headers['content-type'] || null,
        contentEncoding: res.headers['content-encoding'] || null,
        compressed: !!res.headers['content-encoding'],
        truncated: !!res.truncated,
        bytes: res.bytes,
        headers: hdrs,
        server: res.headers['server'] || null,
        cacheControl: res.headers['cache-control'] || null,
        etag: res.headers['etag'] || null,
        lastModified: res.headers['last-modified'] || null,
        bodyAvailable: !!res.body && !res.truncated,
        body: (opt.includeBody !== false && res.body && res.body.length <= 300000 && !res.truncated) ? res.body : null,
        note: null
      };
      out.redirects.chain = r.chain;
      out.redirects.count = Math.max(0, r.chain.length - 1);
      out.hsts = parseHsts(res.headers['strict-transport-security']);
    } else {
      out.status = 'error';
      out.note = r.error.message;
      out.redirects.chain = r.chain;
    }
  } catch (e) {
    out.status = 'unavailable';
    out.reason = e.code || 'error';
    out.note = (e.code === 'tls_blocked' || e.code === 'timeout' || e.code === 'unreachable' || e.code === 'dns')
      ? 'Direct HTTPS from this environment failed (' + e.code + '). The site could not be checked over HTTP here.'
      : 'HTTPS check failed: ' + e.message;
    return out;
  }

  // HTTP (port 80) probe, to verify http→https redirect
  try {
    const r = await fetchWithRedirects('http://' + domain + '/', opt);
    if (r.outcome === 'ok') {
      const res = r.result;
      const finalIsHttps = res.finalUrl.startsWith('https://');
      out.http = {
        status: res.status,
        finalUrl: res.finalUrl,
        redirectsToHttps: finalIsHttps,
        note: finalIsHttps ? 'HTTP redirects to HTTPS.' : (res.status >= 200 && res.status < 400 ? 'HTTP does not redirect to HTTPS (site served over plain HTTP).' : null)
      };
      out.httpsRedirect = finalIsHttps;
    }
  } catch (e) {
    out.http = { status: null, note: 'Port 80 probe failed: ' + (e.message || e.code) };
    if (out.status === 'ok') out.httpsRedirect = null;
  }

  // Redirect analysis
  const { analyzeRedirectChain } = require('./redirectAnalyzer');
  out.redirects.analysis = analyzeRedirectChain(out.redirects.chain, domain);
  return out;
}

/* Browser-relayed bundle analysis (CORS-permitting environments only). */
function analyzeBrowserBundle(bundle, domain) {
  const out = {
    status: 'ok', source: 'browser-relay', via: 'browser',
    https: { status: null, finalUrl: null, httpVersion: null, responseTimeMs: null, headers: null, note: 'Collected through the visitor’s browser (only CORS-exposed headers are visible).' },
    http: { status: null, note: null },
    redirects: { count: 0, chain: [], analysis: null },
    hsts: { present: false, maxAge: null, includeSubDomains: false, preload: false },
    httpsRedirect: null,
    note: 'The scanner server could not reach the site directly, so this section was collected by the visitor’s browser where the site allowed cross-origin reads.'
  };
  if (!bundle || !bundle.https || !bundle.https.status) {
    out.status = 'unavailable';
    out.note = 'The browser relay did not provide usable HTTP data (the site does not allow cross-origin reads).';
    return out;
  }
  const h = bundle.https;
  const hdrs = {};
  for (const k of HEADERS_OF_INTEREST) {
    if (h.headers && h.headers[k] != null) hdrs[k] = h.headers[k];
  }
  out.https = {
    status: h.status,
    statusText: h.statusText || '',
    finalUrl: h.finalUrl || ('https://' + domain + '/'),
    httpVersion: null,
    responseTimeMs: h.responseTimeMs || null,
    contentType: (h.headers && h.headers['content-type']) || null,
    contentEncoding: (h.headers && h.headers['content-encoding']) || null,
    compressed: !!(h.headers && h.headers['content-encoding']),
    truncated: false,
    bytes: h.bytes || null,
    headers: hdrs,
    server: (h.headers && h.headers['server']) || null,
    cacheControl: (h.headers && h.headers['cache-control']) || null,
    etag: (h.headers && h.headers['etag']) || null,
    lastModified: (h.headers && h.headers['last-modified']) || null,
    bodyAvailable: !!h.body,
    body: h.body ? String(h.body).slice(0, 300000) : null,
    note: 'CORS-exposed headers only.'
  };
  out.hsts = parseHsts((h.headers && h.headers['strict-transport-security']) || '');
  if (bundle.http && bundle.http.status) {
    out.http = {
      status: bundle.http.status,
      finalUrl: bundle.http.finalUrl || null,
      redirectsToHttps: !!(bundle.http.finalUrl && String(bundle.http.finalUrl).startsWith('https://')),
      note: 'Browser-collected port 80 response.'
    };
    out.httpsRedirect = out.http.redirectsToHttps;
  }
  if (bundle.redirectChain && bundle.redirectChain.length) {
    out.redirects.chain = bundle.redirectChain;
    out.redirects.count = Math.max(0, bundle.redirectChain.length - 1);
    const { analyzeRedirectChain } = require('./redirectAnalyzer');
    out.redirects.analysis = analyzeRedirectChain(bundle.redirectChain, domain);
  }
  return out;
}

module.exports = { analyzeHttp, analyzeBrowserBundle, fetchWithRedirects, requestOnce, parseHsts, HEADERS_OF_INTEREST, decodeBody };
