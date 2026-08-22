'use strict';

/*
 * Core Web Vitals & INP Auditor, safe HTTP fetcher.
 *
 * Every request (and every redirect hop) is:
 *   - re-validated with the SSRF guard (private/loopback/metadata blocked)
 *   - resolved via DNS with the resolved IP pinned for the connection
 *     (defeats DNS rebinding)
 *   - bounded by byte caps, a request timeout and a redirect cap
 *
 * Phase timings (DNS / connect / TLS / server response / TTFB / download)
 * are measured per request so TTFB can be broken down with real evidence.
 * A per-host pin cache provides connection reuse; cached lookups are
 * labelled (dnsCached) so timing math stays honest.
 *
 * A fixture transport can be injected for offline tests; production uses
 * pinned https/http sockets.
 */

const http = require('http');
const https = require('https');
const zlib = require('zlib');
const U = require('../wptheme/util');
const { assertPublicUrl, resolveAndPin } = require('../wptheme/ssrf');

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 3;
// The TCP/TLS connect phase must finish within this window. A site whose
// connection cannot be established this quickly is unreachable for an
// audit, and a short cap guarantees the API answers fast (important behind
// streaming proxies that cut idle SSE responses).
const CONNECT_TIMEOUT_MS = 3500;
const UA = 'huvanti-cwv-auditor/1.0 (+https://huvanti.com/core-web-vitals-auditor)';

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 8 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 8 });

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
  if (/just a moment|attention required|cf-browser-verification|challenge-platform|cdn-cgi\/challenge|_cf_chl/.test(body)) return { challenge: true, guard: 'Cloudflare' };
  if (/perimeterx|distil networks|datadome|imperva|incapsula|akamai bot manager/i.test(h['server'] || '') || /px-captcha|datadome/i.test(body)) return { challenge: true, guard: 'Bot protection' };
  return { challenge: false, guard: null };
}

function decodeBody(buffer, encoding) {
  const enc = String(encoding || '').toLowerCase().trim();
  if (enc === 'gzip' || enc === 'x-gzip') return zlib.gunzipSync(buffer);
  if (enc === 'deflate' || enc === 'x-deflate') {
    try { return zlib.inflateSync(buffer); } catch (e) { return zlib.inflateRawSync(buffer); }
  }
  if (enc === 'br') return zlib.brotliDecompressSync(buffer);
  return buffer;
}

function createFetcher(opt) {
  opt = opt || {};
  const fixture = opt.transport || null;

  function requestPinned(urlObj, pin, fopt) {
    return new Promise((resolve, reject) => {
      const timeoutMs = fopt.timeout || DEFAULT_TIMEOUT_MS;
      const maxBytes = fopt.maxBytes || DEFAULT_MAX_BYTES;
      const isHttps = urlObj.protocol === 'https:';
      const port = urlObj.port ? Number(urlObj.port) : (isHttps ? 443 : 80);
      const lib = isHttps ? https : http;
      const t0 = Date.now();
      const family = pin.family || (String(pin.address).includes(':') ? 6 : 4);
      const headers = Object.assign({
        'Host': urlObj.hostname,
        'User-Agent': UA,
        'Accept': fopt.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,text/css;q=0.8,*/*;q=0.5',
        'Accept-Language': 'en-US,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive'
      }, fopt.headers || {});

      const reqOpts = {
        protocol: urlObj.protocol, hostname: urlObj.hostname, port,
        path: urlObj.pathname + urlObj.search, method: 'GET',
        agent: isHttps ? httpsAgent : httpAgent, timeout: timeoutMs, headers,
        servername: isHttps ? urlObj.hostname : undefined
      };
      reqOpts.lookup = (hostname, options, cb) => {
        if (options && options.all) cb(null, [{ address: pin.address, family }]);
        else cb(null, pin.address, family);
      };

      let dnsAt = t0, connectAt = 0, tlsAt = 0, firstByteAt = 0;
      let rawEncs = '';
      let settled = false;

      function cleanup() {
        if (connectTimer) clearTimeout(connectTimer);
        if (onAbort && fopt.signal) {
          try { fopt.signal.removeEventListener('abort', onAbort); } catch (e) {}
        }
      }
      function failWith(e) {
        if (settled) return;
        settled = true;
        cleanup();
        const code = e.code === 'ETIMEDOUT' ? 'timeout' : (e.code || 'network');
        const wrapped = U.makeError(code, (e.code || 'Network error') + ' while requesting ' + urlObj.hostname);
        // Did the connection ever get established?
        wrapped.connectPhase = connectAt === 0;
        // Did any response bytes arrive before the failure? A connection-level
        // error with zero response bytes means the network path itself failed
        // (sandboxed egress, reset upstream) rather than the target site.
        wrapped.noResponse = firstByteAt === 0;
        wrapped.originalCode = e.code || null;
        reject(wrapped);
      }

      const req = lib.request(reqOpts, res => {
        firstByteAt = Date.now();
        const phases = {
          dnsMs: Math.max(0, dnsAt - t0),
          dnsCached: !!pin.dnsCached,
          connectMs: connectAt ? Math.max(0, connectAt - dnsAt) : 0,
          tlsMs: (tlsAt && connectAt) ? Math.max(0, tlsAt - connectAt) : 0,
          requestMs: 0, // GET: no request body; labelled in the UI
          ttfbMs: Math.max(0, firstByteAt - t0),
          serverMs: 0,
          downloadMs: 0,
          totalMs: 0
        };
        const socketReadyAt = (tlsAt || connectAt || dnsAt);
        phases.serverMs = Math.max(0, firstByteAt - socketReadyAt);
        rawEncs = String((res.headers['content-encoding'] || '')).toLowerCase();

        const out = {
          status: res.statusCode || 0,
          headers: headersToObj(res.headers),
          chunks: [], bytes: 0, rawBytes: 0, truncated: false,
          protocol: (res.socket && res.socket.alpnProtocol) || null,
          ms: 0, phases, ip: pin.address, finished: false, destroyed: false,
          pending: null, decoded: rawEncs && rawEncs !== 'identity'
        };
        const cap = () => {
          if (out.bytes > maxBytes) { out.truncated = true; out.destroyed = true; res.destroy(); finish(); }
        };
        res.on('data', c => {
          if (out.finished) return;
          out.rawBytes += c.length;
          if (fopt.stream) { // passthrough mode: no buffering, bytes still counted
            out.bytes += c.length;
            try { fopt.stream(c); } catch (e) {}
            cap();
            return;
          }
          if (out.decoded) { out.pending = out.pending ? Buffer.concat([out.pending, c]) : c; return; }
          out.bytes += c.length;
          if (out.chunks.length < 8000) out.chunks.push(c);
          cap();
        });
        res.on('end', () => {
          if (out.finished) return;
          if (out.decoded && out.pending) {
            try {
              const decoded = decodeBody(out.pending, rawEncs);
              out.bytes = decoded.length;
              if (out.bytes > maxBytes) { out.truncated = true; finish(); return; }
              if (out.chunks.length < 8000) out.chunks.push(decoded);
            } catch (e) {
              out.decoded = false;
              out.bytes = out.pending.length;
              if (out.chunks.length < 8000) out.chunks.push(out.pending);
            }
            out.pending = null;
          }
          finish();
        });
        res.on('error', () => { if (!out.finished) finish(); });
        function finish() {
          if (out.finished) return;
          out.finished = true;
          cleanup();
          out.ms = Date.now() - t0;
          phases.downloadMs = Math.max(0, out.ms - (firstByteAt - t0));
          phases.totalMs = out.ms;
          const buffer = Buffer.concat(out.chunks);
          const text = buffer.toString('utf8');
          out.text = text;
          out.buffer = buffer;
          const ch = looksLikeChallenge(out.status, out.headers, text);
          out.challenge = ch.challenge;
          out.guard = ch.guard;
          resolve(out);
        }
      });

      // Connect-phase deadline: never stall the caller (or an SSE stream
      // behind a proxy) on a connection that will never be established.
      let connectTimer = setTimeout(() => {
        if (connectAt === 0 && !settled) {
          req.destroy(Object.assign(new Error('The connection could not be established in time.'), { code: 'connect_timeout' }));
        }
      }, CONNECT_TIMEOUT_MS);

      // External cancellation (client disconnect / scan timeout).
      let onAbort = null;
      if (fopt.signal) {
        onAbort = () => {
          if (!settled) req.destroy(Object.assign(new Error('aborted'), { code: 'aborted' }));
        };
        if (fopt.signal.aborted) { onAbort(); }
        else {
          try { fopt.signal.addEventListener('abort', onAbort, { once: true }); } catch (e) {}
        }
      }

      req.on('socket', s => {
        s.once('lookup', () => { dnsAt = Date.now(); });
        s.once('connect', () => { connectAt = Date.now(); });
        s.once('secureConnect', () => { tlsAt = Date.now(); });
      });
      req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'timeout' })));
      req.on('error', failWith);
      req.end();
    });
  }

  async function fetchUrl(rawUrl, fopt) {
    fopt = fopt || {};
    let current = rawUrl;
    const hops = [];
    const redirectChain = [];
    let response = null;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const urlObj = assertPublicUrl(current); // SSRF re-validation every hop
      let res;
      if (fixture) {
        res = await fixture(urlObj, { address: '93.184.216.34', family: 4, dnsMs: 0, dnsCached: true }, fopt);
        if (!res || typeof res !== 'object') throw U.makeError('network', 'Fixture transport returned nothing.');
        res.phases = res.phases || { dnsMs: 0, dnsCached: true, connectMs: 0, tlsMs: 0, requestMs: 0, ttfbMs: res.ms || 0, serverMs: res.ms || 0, downloadMs: 0, totalMs: res.ms || 0 };
        res.ip = res.ip || '93.184.216.34';
        res.protocol = res.protocol || null;
        res.text = res.text != null ? String(res.text) : (res.buffer ? res.buffer.toString('utf8') : '');
        res.buffer = res.buffer || (res.text != null ? Buffer.from(res.text) : Buffer.alloc(0));
        res.bytes = res.bytes != null ? res.bytes : res.buffer.length;
        res.rawBytes = res.rawBytes != null ? res.rawBytes : res.bytes;
        res.truncated = !!res.truncated;
        res.challenge = !!res.challenge;
        res.guard = res.guard || null;
      } else {
        const pin = await pinFor(urlObj);
        res = await requestPinned(urlObj, pin, fopt);
      }
      hops.push({ url: urlObj.href, status: res.status, protocol: res.protocol });
      const loc = res.status >= 300 && res.status < 400 ? (res.headers['location'] || '') : '';
      if (loc && hop < MAX_REDIRECTS) {
        let next = null;
        try { next = new URL(loc, urlObj).href; } catch (e) {}
        if (!next) break;
        redirectChain.push({ from: urlObj.href, status: res.status, to: next });
        current = next;
        continue;
      }
      response = res;
      break;
    }
    if (!response) throw U.makeError('redirect', 'Too many redirects or an invalid redirect target.');
    return {
      status: response.status,
      headers: response.headers || {},
      text: response.text || '',
      buffer: response.buffer || Buffer.alloc(0),
      bytes: response.bytes || 0,
      rawBytes: response.rawBytes || response.bytes || 0,
      truncated: !!response.truncated,
      ms: response.ms || 0,
      phases: response.phases,
      protocol: response.protocol || null,
      ip: response.ip || null,
      hops,
      redirects: redirectChain,
      finalUrl: hops.length ? hops[hops.length - 1].url : rawUrl,
      redirected: redirectChain.length > 0,
      challenge: !!response.challenge,
      guard: response.guard || null
    };
  }

  // Per-host pin cache (60 s) → connection reuse + fewer DNS lookups.
  const pinCache = new Map();
  async function pinFor(urlObj) {
    const key = (urlObj.protocol === 'https:' ? 's|' : 'p|') + urlObj.hostname.toLowerCase();
    const hit = pinCache.get(key);
    if (hit && Date.now() - hit.at < 60000) return { address: hit.address, family: hit.family, dnsMs: 0, dnsCached: true };
    const t0 = Date.now();
    const pin = await resolveAndPin(urlObj);
    const entry = { address: pin.address, family: pin.family, at: Date.now(), dnsMs: Date.now() - t0, dnsCached: false };
    pinCache.set(key, entry);
    if (pinCache.size > 300) {
      let oldestKey = null, oldestAt = Infinity;
      for (const [k, v] of pinCache) { if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k; } }
      if (oldestKey) pinCache.delete(oldestKey);
    }
    return entry;
  }

  return { fetchUrl, pinFor };
}

module.exports = { createFetcher, decodeBody, looksLikeChallenge, classifyFetchError };

/*
 * Classify a transport error for the API layer:
 *   - connect-phase failures (connection never established) → no_egress:
 *     the server environment likely has no outbound route to the target.
 *   - abort → cancelled
 *   - slow/other → keeps its own code, never masquerades as no_egress.
 */
function classifyFetchError(e) {
  const code = (e && e.code) || 'network';
  if (code === 'aborted') return { code: 'cancelled', message: 'The audit was cancelled.' };
  const connectLevel = ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ECONNABORTED'].includes(code);
  const egressFailure =
    code === 'connect_timeout' ||
    (e && e.connectPhase === true) ||
    // connection reset/refused with zero response bytes: the network path
    // failed (e.g. sandboxed egress), not the target site
    ((e && e.noResponse === true) && connectLevel);
  if (egressFailure) {
    return {
      code: 'no_egress',
      message: 'The server could not reach the site directly (' + ((e && e.originalCode) || code) + '). The page will fall back to a browser-based measurement.'
    };
  }
  if (code === 'timeout') {
    return { code: 'unreachable', message: 'The site did not respond in time (' + (e && e.message || 'timeout') + ').' };
  }
  return { code: code === 'network' ? 'network' : code, message: (e && e.message) || 'Fetch failed.' };
}
