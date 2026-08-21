'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');
const U = require('./util');
const R = require('./raptiveRules');
const { assertPublicUrl, resolveAndPin } = require('./ssrf');

const RDAP_HOSTS = new Set([
  'rdap.org', 'www.rdap.org', 'rdap.verisign.com', 'rdap.iana.org',
  'rdap.nic.uk', 'rdap.nominet.uk', 'rdap.afilias.net', 'rdap.publicinterestregistry.org',
  'rdap.identitydigital.services', 'rdap.godaddy.com'
]);

function fetchJson(rawUrl, opt) {
  opt = opt || {};
  const timeout = opt.timeout || 8000;
  let current = new URL(rawUrl);
  const hops = [];
  function once(urlObj) {
    return new Promise((resolve, reject) => {
      if (!/^https?:$/.test(urlObj.protocol)) return reject(U.makeError('rdap', 'Non-http RDAP URL.'));
      const lib = urlObj.protocol === 'https:' ? https : http;
      const req = lib.request({
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        timeout,
        headers: { Accept: 'application/rdap+json, application/json', 'User-Agent': 'huvanti-raptive-checker/1.0' }
      }, res => {
        const chunks = [];
        let size = 0;
        res.on('data', c => { size += c.length; if (size > 400000) { res.destroy(); reject(U.makeError('too_large', 'RDAP response too large.')); return; } chunks.push(c); });
        res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('timeout', () => { req.destroy(); reject(U.makeError('timeout', 'RDAP lookup timed out.')); });
      req.on('error', e => reject(U.makeError('rdap', e.message, e)));
      if (opt.signal) {
        const onAbort = () => { req.destroy(); reject(U.makeError('cancelled', 'Audit cancelled.')); };
        if (opt.signal.aborted) return onAbort();
        opt.signal.addEventListener('abort', onAbort, { once: true });
      }
      req.end();
    });
  }
  return (async () => {
    for (let i = 0; i < 5; i++) {
      hops.push(current.href);
      const res = await once(current);
      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        const next = new URL(Array.isArray(res.headers.location) ? res.headers.location[0] : res.headers.location, current.href);
        if (!RDAP_HOSTS.has(next.hostname.toLowerCase()) && !/\.rdap\./i.test(next.hostname) && !/rdap\./i.test(next.hostname)) {
          throw U.makeError('rdap', 'RDAP redirect host not allowed: ' + next.hostname);
        }
        current = next;
        continue;
      }
      return res;
    }
    throw U.makeError('rdap', 'Too many RDAP redirects.');
  })();
}

function parseRegistration(json) {
  const events = Array.isArray(json.events) ? json.events : [];
  const reg = events.find(e => /registration|registered/i.test(e.eventAction || ''));
  const created = events.find(e => /created?|registration/i.test(e.eventAction || ''));
  const dateStr = (reg && reg.eventDate) || (created && created.eventDate) || json.registrationDate || '';
  const d = dateStr ? new Date(dateStr) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return d;
}

async function lookupDomainAge(hostname, opt) {
  opt = opt || {};
  const host = String(hostname || '').replace(/^www\./i, '').toLowerCase();
  if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
    return { verified: false, reason: 'Hostname is not a registrable domain.', confidence: 0 };
  }
  const labels = host.split('.');
  if (labels.length < 2) return { verified: false, reason: 'Not a registrable domain.', confidence: 0 };
  const urls = [
    'https://rdap.org/domain/' + encodeURIComponent(host)
  ];
  for (const u of urls) {
    try {
      assertPublicUrl(u);
      await resolveAndPin(new URL(u));
      const res = await fetchJson(u, opt);
      if (res.status >= 400) continue;
      let json;
      try { json = JSON.parse(res.text); } catch (e) { continue; }
      const registered = parseRegistration(json);
      if (!registered) continue;
      const ageMs = Date.now() - registered.getTime();
      const ageDays = Math.floor(ageMs / 86400000);
      const ageMonths = Math.floor(ageDays / 30.437);
      return {
        verified: true,
        hostname: host,
        registeredAt: registered.toISOString(),
        ageDays,
        ageMonths,
        atLeastSixMonths: ageMonths >= 6 || ageDays >= 183,
        source: 'RDAP',
        sourceUrl: u,
        confidence: 0.85,
        ldhName: json.ldhName || host
      };
    } catch (e) {
      continue;
    }
  }
  return { verified: false, hostname: host, reason: 'RDAP/WHOIS registration date could not be retrieved.', confidence: 0 };
}

function analyzeDomain(ctx) {
  const out = [];
  const d = ctx.domainAge || { verified: false };
  if (!d.verified) {
    out.push(R.finding(R.get('RAP-OFFICIAL-DOMAIN-AGE'), 'Site', 'manual',
      'Unable to verify. Domain registration date was not available from RDAP. Dates are never invented. Raptive currently requires the domain to be at least 6 months old.',
      { confidence: 1, reqStatus: 'Unable to Verify', severity: 'info' }));
    return out;
  }
  const when = d.registeredAt.slice(0, 10);
  if (d.atLeastSixMonths) {
    out.push(R.finding(R.get('RAP-OFFICIAL-DOMAIN-AGE'), 'Site', 'passed',
      'RDAP registration date ' + when + ' (~' + d.ageMonths + ' months / ' + d.ageDays + ' days). Meets the documented 6-month minimum. Confidence ' + Math.round(d.confidence * 100) + '%.',
      { confidence: d.confidence, severity: 'passed', reqStatus: 'Verified' }));
  } else {
    out.push(R.finding(R.get('RAP-OFFICIAL-DOMAIN-AGE'), 'Site', 'high',
      'RDAP registration date ' + when + ' (~' + d.ageMonths + ' months / ' + d.ageDays + ' days). Below Raptive’s documented 6-month minimum.',
      { confidence: d.confidence, severity: 'high', reqStatus: 'Not Met' }));
  }
  return out;
}

module.exports = { lookupDomainAge, analyzeDomain };
