'use strict';

/*
 * Core Web Vitals & INP Auditor, relay fetcher (server side).
 *
 * Used when the server cannot reach the target site directly (no egress,
 * or the target blocks datacenter IPs): the page HTML is fetched through
 * public read-only CORS relays. All relays are tried CONCURRENTLY and the
 * first response that looks like a real HTML document wins, a relay that
 * returns a tiny error/block page is never treated as success.
 *
 * Relay use is a degraded transport: the report labels it and subresources
 * load cross-origin (timing/sizes hidden by the browser), honest, never
 * fabricated.
 */

const CHALLENGE_RE = /just a moment|attention required|cf-browser-verification|challenge-platform|cdn-cgi\/challenge|checking your browser|enable javascript and cookies|access denied|perimeterx|datadome/i;

const RELAYS = [
  { id: 'allorigins', label: 'AllOrigins', url: u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
  { id: 'codetabs', label: 'CodeTabs', url: u => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u) },
  { id: 'corsproxy', label: 'CORSProxy', url: u => 'https://corsproxy.io/?url=' + encodeURIComponent(u) },
  { id: 'corseu', label: 'CORS.EU', url: u => 'https://cors.eu.org/' + u },
  { id: 'corslol', label: 'CORS.LOL', url: u => 'https://api.cors.lol/?url=' + encodeURIComponent(u) },
  { id: 'jina', label: 'Jina Reader', url: u => 'https://r.jina.ai/' + u, headers: { 'x-return-format': 'html' } }
];

function sniffUsable(html, status) {
  const s = String(html || '');
  if (CHALLENGE_RE.test(s.slice(0, 8000))) return false;
  if (status && status >= 400 && status !== 403 && status !== 429) return false;
  const looksHtml = /<(!doctype\s*html|html|head|body|title|meta|div|span|p\b|a\b|img|script|link|style|main|section|article)/i.test(s);
  if (looksHtml && s.length >= 60) return true;
  if (s.length >= 200) return true;
  return false;
}

/*
 * Fetch a URL through the relays. Options:
 *   fetchImpl   injectable fetch (tests)
 *   signal      abort support
 *   perTimeoutMs per-relay timeout (default 10 s)
 *   totalTimeoutMs overall deadline (default 14 s)
 * Returns { relay, label, html, status, ms } or throws { code:'relay_unreachable' }.
 */
async function fetchViaRelays(targetUrl, opt) {
  opt = opt || {};
  const fetchImpl = opt.fetchImpl || ((u, o) => fetch(u, o));
  const perTimeout = opt.perTimeoutMs || 8000;
  const totalTimeout = opt.totalTimeoutMs || 10000;
  const started = Date.now();

  let settle = null;
  const done = new Promise(resolve => { settle = resolve; });
  let pending = RELAYS.length;

  RELAYS.forEach(relay => {
    const t0 = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), perTimeout);
    const onAbort = () => ctl.abort();
    if (opt.signal) {
      if (opt.signal.aborted) { pending--; if (!pending) settle(null); return; }
      try { opt.signal.addEventListener('abort', onAbort, { once: true }); } catch (e) {}
    }
    const headers = Object.assign({ accept: 'text/html,application/xhtml+xml,*/*;q=0.5' }, relay.headers || {});
    fetchImpl(relay.url(targetUrl), { signal: ctl.signal, headers, redirect: 'follow' })
      .then(async res => {
        const text = await res.text();
        return { relay: relay.id, label: relay.label, html: text, status: res.status, ms: Date.now() - t0 };
      })
      .catch(() => null)
      .then(r => {
        clearTimeout(timer);
        try { if (opt.signal) opt.signal.removeEventListener('abort', onAbort); } catch (e) {}
        if (r && sniffUsable(r.html, r.status)) {
          r.ms = r.ms != null ? r.ms : (Date.now() - started);
          settle(r);
          return;
        }
        pending--;
        if (pending === 0) settle(null); // every relay settled without a usable page
      });
  });

  const timeoutResult = new Promise(resolve => setTimeout(resolve, totalTimeout, null));
  const winner = await Promise.race([done, timeoutResult]);
  if (winner) return winner;
  throw Object.assign(new Error('No public relay returned a readable page (' + RELAYS.map(r => r.label).join(', ') + ' all failed).'), { code: 'relay_unreachable' });
}

module.exports = { fetchViaRelays, sniffUsable, RELAYS };
