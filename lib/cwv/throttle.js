'use strict';

/*
 * Core Web Vitals & INP Auditor — proxy network throttling.
 *
 * Applies a first-byte latency and a bandwidth limit (token bucket) to
 * responses streamed from the auditor proxy. Used by the Mobile/Custom
 * profiles. Only proxied responses can be throttled — the browser-direct
 * fallback runs unthrottled and says so.
 */

function createThrottle(opts) {
  const latencyMs = opts && opts.latencyMs ? Math.max(0, Math.min(5000, opts.latencyMs)) : 0;
  const kbps = opts && opts.downKbps ? Math.max(8, Math.min(20000, opts.downKbps)) : 0; // bytes/ms = kbps/8
  const bytesPerMs = kbps ? kbps / 8 : 0;
  let first = true;
  let budget = bytesPerMs ? bytesPerMs * 500 : Infinity; // small burst headroom
  let last = Date.now();
  let chain = Promise.resolve();

  function when(bytes) {
    if (!latencyMs && !bytesPerMs) return null;
    const now = Date.now();
    budget = Math.min(budget + bytesPerMs * (now - last), bytesPerMs * 2000);
    last = now;
    const deficit = bytes - budget;
    const wait = Math.max(0, deficit / bytesPerMs);
    budget = Math.max(0, budget - bytes);
    let total = wait;
    if (first) { total += latencyMs; first = false; }
    if (total <= 0) return null;
    return total;
  }

  function write(res, buf) {
    const wait = when(buf.length);
    if (!wait) {
      try { res.write(buf); } catch (e) {}
      return;
    }
    chain = chain.then(() => new Promise(done => {
      setTimeout(() => {
        try { res.write(buf); } catch (e) {}
        done();
      }, wait);
    }));
  }

  function end(res) {
    if (!res.writableEnded) {
      chain = chain.then(() => new Promise(done => {
        setTimeout(() => {
          try { res.end(); } catch (e) {}
          done();
        }, first ? latencyMs : 0);
      }));
    }
  }

  return { write, end, active: !!(latencyMs || bytesPerMs), label: opts && opts.label || null };
}

module.exports = { createThrottle };
