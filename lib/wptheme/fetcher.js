'use strict';

/*
 * huvanti WordPress Theme Detector — safe HTTP fetcher.
 *
 * Hard limits (anti-abuse + performance):
 *   - SSRF guard on every request & redirect hop (see ssrf.js)
 *   - DNS resolution pinned per request (defeats DNS rebinding)
 *   - per-request timeout 8 s, scan-wide wall clock enforced by orchestrate
 *   - per-request byte cap, scan-wide byte budget
 *   - scan-wide request budget (never more than ~14 requests)
 *   - max 5 redirects, every hop re-validated
 */

const http = require('http');
const https = require('https');
const U = require('./util');
const { assertPublicUrl, assertSafeHostname, resolveAndPin } = require('./ssrf');

const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;
const DEFAULT_MAX_BYTES = 1.5 * 1024 * 1024;
const UA = 'huvanti-wp-theme-detector/1.0 (+https://huvanti.com/wordpress-theme-detector)';

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 6 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 6 });

function headersToObj(h) {
  const o = {};
  if (!h) return o;
  for (const k of Object.keys(h)) o[k.toLowerCase()] = Array.isArray(h[k]) ? h[k].join(', ') : String(h[k]);
  return o;
}

function looksLikeChallenge(status, headers, text) {
  const h = headers || {};
  const body = String(text || '').slice(0, 4000).toLowerCase();
  const cf = !!(h['cf-ray'] || h['cf-mitigated'] || /cloudflare/i.test(h['server'] || ''));
  if (cf && (status === 403 || status === 503 || status === 429)) return { challenge: true, guard: 'Cloudflare' };
  if (/just a moment|attention required|cf-browser-verification|challenge-platform|cdn-cgi\/challenge|_cf_chl/i.test(body)) return { challenge: true, guard: 'Cloudflare' };
  if (/checking your browser|enable javascript and cookies/i.test(body) && cf) return { challenge: true, guard: 'Cloudflare' };
  if (/perimeterx|distil networks|datadome|imperva|incapsula|akamai bot manager/i.test(h['server'] || '') || /px-captcha|datadome/i.test(body)) {
    return { challenge: true, guard: 'Bot protection' };
  }
  return { challenge: false, guard: null };
}

function requestPinned(urlObj, pin, opt) {
  opt = opt || {};
  const timeout = opt.timeout || TIMEOUT_MS;
  const maxBytes = opt.maxBytes || DEFAULT_MAX_BYTES;
  const isHttps = urlObj.protocol === 'https:';
  const port = urlObj.port ? Number(urlObj.port) : (isHttps ? 443 : 80);
  const lib = isHttps ? https : http;
  const headers = Object.assign({
    'Host': urlObj.hostname,
    'User-Agent': UA,
    'Accept': opt.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,text/css;q=0.8,*/*;q=0.5',
    'Accept-Language': 'en-US,en;q=0.8',
    'Accept-Encoding': 'identity'
  }, opt.headers || {});

  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const family = pin.family || (String(pin.address).includes(':') ? 6 : 4);
    const reqOpts = {
      protocol: urlObj.protocol, hostname: urlObj.hostname, port, path: urlObj.pathname + urlObj.search,
      method: 'GET', agent: isHttps ? httpsAgent : httpAgent, timeout, headers,
      servername: isHttps ? urlObj.hostname : undefined
    };
    reqOpts.lookup = (hostname, options, cb) => {
      if (options && options.all) cb(null, [{ address: pin.address, family }]);
      else cb(null, pin.address, family);
    };
    const req = lib.request(reqOpts, res => {
      const chunks = [];
      let size = 0;
      const abort = () => { res.destroy(); resolve({ status: res.statusCode || 0, headers: headersToObj(res.headers), text: Buffer.concat(chunks).toString('utf8'), bytes: size, ms: Date.now() - t0, truncated: true }); };
      res.on('data', c => { size += c.length; if (size > maxBytes) { abort(); return; } if (chunks.length < 4000) chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: headersToObj(res.headers), text: Buffer.concat(chunks).toString('utf8'), bytes: size, ms: Date.now() - t0, truncated: size > maxBytes }));
      res.on('error', e => reject(U.makeError('fetch_failed', e.message, e)));
    });
    req.on('timeout', () => { req.destroy(); reject(U.makeError('timeout', 'The request timed out.')); });
    req.on('error', e => {
      const m = String(e.message || '').toLowerCase();
      const c = String(e.code || '');
      // Genuine certificate problems → 'ssl' (site-side issue)
      if (/UNABLE_TO_VERIFY|DEPTH_ZERO|SELF_SIGNED|CERT_HAS_EXPIRED|CERT_NOT_YET_VALID|ALTNAME_INVALID|NO_CERT|EDEPTH|CERT_CHAIN|ERR_TLS_CERT/.test(c)
        || /certificate|unable to verify the first certificate/i.test(e.message || '')) {
        reject(U.makeError('ssl', 'SSL/TLS certificate validation failed — the site’s certificate could not be verified (expired, self-signed or incomplete chain).', e));
      }
      // Handshake-stage resets/disconnects → the target or the network path refused TLS.
      // This is NOT a certificate error and must not be reported as one.
      else if (isHttps && (/ECONNRESET|EPIPE|EPROTO|ECONNABORTED|ERR_SSL_WRONG_VERSION_NUMBER/.test(c) || /socket disconnected before secure tls|connection reset|wrong version number|handshake/.test(m))) {
        reject(U.makeError('tls_blocked', 'The secure connection was reset before TLS completed. Either the website refuses this scanner, or this server has no direct outbound access to it (the scan will be retried through the browser).', e));
      }
      else if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/.test(c)) reject(U.makeError('unreachable', 'Could not reach the server (connection refused or unreachable).', e));
      else if (/ENOTFOUND|EAI_AGAIN/.test(c)) reject(U.makeError('dns', 'The domain could not be resolved.', e));
      else reject(U.makeError('unreachable', 'The request failed: ' + e.message, e));
    });
    if (opt.signal) {
      const onAbort = () => { req.destroy(); reject(U.makeError('cancelled', 'Scan cancelled.')); };
      if (opt.signal.aborted) return onAbort();
      opt.signal.addEventListener('abort', onAbort, { once: true });
    }
    req.end();
  });
}

/*
 * Fetcher with a scan-wide budget. `transport` is injectable for offline tests.
 */
function createFetcher(opt) {
  opt = opt || {};
  const maxRequests = opt.maxRequests || 20;
  const maxTotalBytes = opt.maxTotalBytes || 6 * 1024 * 1024;
  const transport = opt.transport || null; // async (urlObj, pin, reqOpt) => response
  const state = { requests: 0, bytes: 0, log: [] };

  async function fetchFollow(rawUrl, fopt) {
    fopt = fopt || {};
    if (state.requests >= maxRequests) throw U.makeError('budget', 'Scan request budget reached.');
    let current;
    try { current = assertPublicUrl(rawUrl); } catch (e) { throw e; }
    const hops = [];
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      assertSafeHostname(current.hostname);
      const pin = await resolveAndPin(current);
      if (state.requests >= maxRequests) throw U.makeError('budget', 'Scan request budget reached.');
      state.requests += 1;
      let res;
      if (transport) {
        res = await transport(current, pin, fopt);
      } else {
        res = await requestPinned(current, pin, fopt);
      }
      state.bytes += res.bytes || 0;
      if (state.bytes > maxTotalBytes) throw U.makeError('too_large', 'Scan byte budget reached.');
      hops.push({ url: current.href, ip: pin.address, status: res.status, ms: res.ms });
      if (res.status >= 300 && res.status < 400 && res.headers && res.headers.location) {
        let next;
        try { next = new URL(res.headers.location, current.href); } catch (e) { throw U.makeError('redirect', 'Invalid redirect location.'); }
        if (!/^https?:$/.test(next.protocol)) throw U.makeError('redirect', 'Redirect used a non-http protocol.');
        assertPublicUrl(next.href); // revalidate every hop
        current = next;
        continue;
      }
      const ch = looksLikeChallenge(res.status, res.headers, res.text);
      const out = {
        url: rawUrl, finalUrl: current.href, status: res.status,
        ok: res.status >= 200 && res.status < 300,
        redirected: hops.length > 1, hops, headers: res.headers, text: res.text || '',
        bytes: res.bytes, ms: res.ms, ip: pin.address,
        challenge: ch.challenge, guard: ch.guard, truncated: !!res.truncated
      };
      state.log.push({ url: rawUrl, finalUrl: out.finalUrl, status: out.status, bytes: out.bytes, ms: out.ms });
      return out;
    }
    throw U.makeError('redirect', 'Too many redirects (more than ' + MAX_REDIRECTS + ').');
  }

  return { fetchFollow, state };
}

module.exports = { createFetcher, looksLikeChallenge, UA, TIMEOUT_MS };
