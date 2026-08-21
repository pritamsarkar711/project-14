'use strict';

/*
 * CDN / reverse-proxy detection.
 *
 * Multi-signal, evidence-based:
 *   - HTTP headers (cf-ray, server, x-cache, x-served-by, x-sucuri-id …)
 *   - Edge IP CIDR fingerprints (see asnAnalyzer local database)
 *   - CNAME targets (cdn.cloudflare.net, cloudfront.net, fastly.net, …)
 *   - Nameserver names (Cloudflare DNS ≠ Cloudflare proxy — reported separately)
 *   - TLS issuer (production)
 *
 * Every claim carries its evidence list. A proxy detection NEVER implies the
 * origin host: origin hosting is resolved separately (hostingDetector).
 */

const U = require('./util');

const CNAME_PATTERNS = [
  { re: /(^|\.)cdn\.cloudflare\.net$/i, provider: 'Cloudflare', signal: 'cname' },
  { re: /(^|\.)cloudfront\.net$/i, provider: 'Amazon CloudFront', signal: 'cname' },
  { re: /(^|\.)fastly\.net$/i, provider: 'Fastly', signal: 'cname' },
  { re: /(^|\.)edgekey\.net$|(^|\.)edgesuite\.net$|(^|\.)akamaiedge\.net$|(^|\.)akamaitechnologies\.com$/i, provider: 'Akamai', signal: 'cname' },
  { re: /(^|\.)b-cdn\.net$/i, provider: 'Bunny CDN', signal: 'cname' },
  { re: /(^|\.)xcdn\.sucuri\.net$|(^|\.)cloudproxy\.sucuri\.net$/i, provider: 'Sucuri', signal: 'cname' },
  { re: /(^|\.)incapdns\.net$/i, provider: 'Imperva (Incapsula)', signal: 'cname' },
  { re: /(^|\.)hwcdn\.net$/i, provider: 'StackPath (Highwinds)', signal: 'cname' },
  { re: /(^|\.)gcdn\.co$/i, provider: 'Gcore', signal: 'cname' },
  { re: /(^|\.)kxcdn\.com$/i, provider: 'KeyCDN', signal: 'cname' },
  { re: /(^|\.)stackpathcdn\.com$|(^|\.)stackpathdns\.com$/i, provider: 'StackPath', signal: 'cname' },
  { re: /(^|\.)quic\.cloud$/i, provider: 'QUIC.cloud', signal: 'cname' },
  { re: /(^|\.)ddos-guard\.net$/i, provider: 'DDoS-Guard', signal: 'cname' },
  { re: /(^|\.)cachefly\.net$/i, provider: 'CacheFly', signal: 'cname' },
  { re: /(^|\.)wpengine\.com$/i, provider: 'WP Engine (managed host)', signal: 'cname' },
  { re: /(^|\.)pantheon\.io$/i, provider: 'Pantheon', signal: 'cname' },
  { re: /(^|\.)netlifyglobalcdn\.com$|(^|\.)netlify\.app$/i, provider: 'Netlify', signal: 'cname' },
  { re: /(^|\.)vercel-dns\.com$/i, provider: 'Vercel', signal: 'cname' }
];

const HEADER_PATTERNS = [
  { header: 'server', re: /cloudflare/i, provider: 'Cloudflare', signal: 'server-header' },
  { header: 'cf-ray', re: /.+/, provider: 'Cloudflare', signal: 'cf-ray-header' },
  { header: 'cf-cache-status', re: /.+/, provider: 'Cloudflare', signal: 'cf-cache-status' },
  { header: 'server', re: /cloudfront/i, provider: 'Amazon CloudFront', signal: 'server-header' },
  { header: 'x-amz-cf-id', re: /.+/, provider: 'Amazon CloudFront', signal: 'x-amz-cf-id' },
  { header: 'x-cache', re: /cloudfront/i, provider: 'Amazon CloudFront', signal: 'x-cache' },
  { header: 'x-served-by', re: /cloudfront/i, provider: 'Amazon CloudFront', signal: 'x-served-by' },
  { header: 'via', re: /varnish/i, provider: 'Fastly', signal: 'via-varnish' },
  { header: 'x-fastly-request-id', re: /.+/, provider: 'Fastly', signal: 'x-fastly-request-id' },
  { header: 'x-served-by', re: /cache-\w+-\w+/i, provider: 'Fastly', signal: 'x-served-by' },
  { header: 'server', re: /akamaighost/i, provider: 'Akamai', signal: 'server-header' },
  { header: 'x-akamai-transformed', re: /.+/, provider: 'Akamai', signal: 'x-akamai-transformed' },
  { header: 'x-sucuri-id', re: /.+/, provider: 'Sucuri', signal: 'x-sucuri-id' },
  { header: 'x-sucuri-cache', re: /.+/, provider: 'Sucuri', signal: 'x-sucuri-cache' },
  { header: 'x-iinfo', re: /.+/, provider: 'Imperva (Incapsula)', signal: 'x-iinfo' },
  { header: 'x-cdn', re: /incap/i, provider: 'Imperva (Incapsula)', signal: 'x-cdn' },
  { header: 'server', re: /bunnycdn|bunny/i, provider: 'Bunny CDN', signal: 'server-header' },
  { header: 'cdn-pullzone', re: /.+/, provider: 'Bunny CDN', signal: 'cdn-pullzone' },
  { header: 'x-cdn-request-id', re: /.+/, provider: 'Bunny CDN', signal: 'x-cdn-request-id' },
  { header: 'x-qc-pop', re: /.+/, provider: 'QUIC.cloud', signal: 'x-qc-pop' },
  { header: 'x-qc-cache', re: /.+/, provider: 'QUIC.cloud', signal: 'x-qc-cache' },
  { header: 'x-litespeed-cache', re: /.+/, provider: 'QUIC.cloud / LiteSpeed Cache', signal: 'x-litespeed-cache' },
  { header: 'x-gcdn', re: /.+/, provider: 'Gcore', signal: 'x-gcdn' },
  { header: 'x-ddos-guard-request-id', re: /.+/, provider: 'DDoS-Guard', signal: 'x-ddos-guard' },
  { header: 'server', re: /ddos-guard/i, provider: 'DDoS-Guard', signal: 'server-header' },
  { header: 'x-hw', re: /.+/, provider: 'StackPath (Highwinds)', signal: 'x-hw' },
  { header: 'x-cdn', re: /stackpath/i, provider: 'StackPath', signal: 'x-cdn' },
  { header: 'server', re: /keycdn/i, provider: 'KeyCDN', signal: 'server-header' },
  { header: 'server', re: /netlify/i, provider: 'Netlify', signal: 'server-header' },
  { header: 'x-vercel-cache', re: /.+/, provider: 'Vercel', signal: 'x-vercel-cache' },
  { header: 'x-vercel-id', re: /.+/, provider: 'Vercel', signal: 'x-vercel-id' },
  { header: 'x-lw-cache', re: /.+/, provider: 'LiteSpeed Web Server', signal: 'x-lw-cache' },
  { header: 'x-wix-request-id', re: /.+/, provider: 'Wix', signal: 'x-wix-request-id' },
  { header: 'x-servedby', re: /squarespace/i, provider: 'Squarespace', signal: 'x-servedby' },
  { header: 'server', re: /squarespace/i, provider: 'Squarespace', signal: 'server-header' }
];

const NS_PATTERNS = [
  { re: /^ns\d+\.cloudflare\.com$/i, provider: 'Cloudflare DNS', category: 'dns' },
  { re: /\.ns\.cloudflare\.com$/i, provider: 'Cloudflare DNS', category: 'dns' },
  { re: /\.awsdns-\d+\.(net|com|co\.uk|org)$/i, provider: 'Amazon Route 53', category: 'dns' },
  { re: /\.dns\.hetzner\.com$/i, provider: 'Hetzner DNS', category: 'dns' },
  { re: /\.dns\.comcast\.net$/i, provider: 'Comcast DNS', category: 'dns' },
  { re: /\.google\.com$|\.googledomains\.com$/i, provider: 'Google Cloud DNS', category: 'dns' },
  { re: /ns1\.dreamhost\.com$/i, provider: 'DreamHost DNS', category: 'dns' },
  { re: /\.dreamhost\.com$/i, provider: 'DreamHost DNS', category: 'dns' },
  { re: /\.nsone\.net$/i, provider: 'NS1', category: 'dns' },
  { re: /\.dnsimple\.com$/i, provider: 'DNSimple', category: 'dns' },
  { re: /\.dynect\.net$/i, provider: 'Oracle Dyn', category: 'dns' },
  { re: /\.oraclecloud\.net$/i, provider: 'Oracle Cloud DNS', category: 'dns' },
  { re: /\.domaincontrol\.com$/i, provider: 'GoDaddy DNS', category: 'dns' },
  { re: /\.registrar-servers\.com$/i, provider: 'Namecheap DNS', category: 'dns' },
  { re: /\.name-services\.com$/i, provider: 'Network Solutions DNS', category: 'dns' },
  { re: /\.bluehost\.com$/i, provider: 'Bluehost (Newfold) DNS', category: 'dns' },
  { re: /\.hostgator\.com$/i, provider: 'HostGator (Newfold) DNS', category: 'dns' },
  { re: /\.parklogic\.com$/i, provider: 'ParkLogic (parking)', category: 'dns' },
  { re: /\.dnspod\.net$/i, provider: 'DNSPod (Tencent)', category: 'dns' },
  { re: /\.hichina\.com$/i, provider: 'Alibaba (HiChina) DNS', category: 'dns' },
  { re: /\.alidns\.com$/i, provider: 'Alibaba Cloud DNS', category: 'dns' },
  { re: /\.ns\.vercel\.com$/i, provider: 'Vercel DNS', category: 'dns' },
  { re: /\.ns\.netlify\.com$/i, provider: 'Netlify DNS', category: 'dns' },
  { re: /\.squarespacedns\.com$/i, provider: 'Squarespace DNS', category: 'dns' },
  { re: /\.wixdns\.net$/i, provider: 'Wix DNS', category: 'dns' },
  { re: /\.ns\.one\.com$/i, provider: 'one.com DNS', category: 'dns' },
  { re: /\.ns\.liquidweb\.com$/i, provider: 'Liquid Web DNS', category: 'dns' },
  { re: /\.ns\.wpengine\.com$/i, provider: 'WP Engine DNS', category: 'dns' },
  { re: /\.ns\.rackspace\.com$/i, provider: 'Rackspace DNS', category: 'dns' },
  { re: /\.ns\.digitalocean\.com$/i, provider: 'DigitalOcean DNS', category: 'dns' },
  { re: /\.ns\.zonomi\.com$/i, provider: 'Zonomi DNS', category: 'dns' },
  { re: /\.ns\.cloudns\.net$/i, provider: 'ClouDNS', category: 'dns' },
  { re: /\.deez\.nz$/i, provider: 'FreeDNS (deez)', category: 'dns' },
  { re: /\.afraid\.org$/i, provider: 'FreeDNS (afraid.org)', category: 'dns' },
  { re: /\.dnsowl\.com$/i, provider: 'DNS Owl (parking)', category: 'dns' },
  { re: /\.above\.com$/i, provider: 'Above.com (parking)', category: 'dns' },
  { re: /\.sedoparking\.com$/i, provider: 'Sedo (parking)', category: 'dns' },
  { re: /\.bodis\.com$/i, provider: 'Bodis (parking)', category: 'dns' },
  { re: /\.trafficclub\.com$/i, provider: 'TrafficClub (parking)', category: 'dns' },
  { re: /\.freenom\.com$/i, provider: 'Freenom', category: 'dns' },
  { re: /\.tier\.net$/i, provider: 'Tier.Net (parking)', category: 'dns' },
  { re: /\.epik\.com$/i, provider: 'Epik DNS', category: 'dns' },
  { re: /\.nic\.ru$/i, provider: 'RU-CENTER DNS', category: 'dns' },
  { re: /\.srv53\.(net|org|com)$/i, provider: 'DNS provider (srv53)', category: 'dns' },
  { re: /\.ns\.nic\.fr$/i, provider: 'AFNIC DNS', category: 'dns' },
  { re: /\.anycast\.me$/i, provider: 'DNS Made Easy', category: 'dns' },
  { re: /\.dnsmadeeasy\.com$/i, provider: 'DNS Made Easy', category: 'dns' },
  { re: /\.he\.net$/i, provider: 'Hurricane Electric DNS', category: 'dns' },
  { re: /\.ns\.ezoicns\.com$/i, provider: 'Ezoic DNS', category: 'dns' },
  { re: /\.domain\.com$/i, provider: 'Domain.com DNS', category: 'dns' },
  { re: /\.sav\.com$/i, provider: 'Sav DNS', category: 'dns' },
  { re: /\.hostinger\.com$/i, provider: 'Hostinger DNS', category: 'dns' },
  { re: /\.dns\.hostinger\.com$/i, provider: 'Hostinger DNS', category: 'dns' },
  { re: /\.contabo\.net$/i, provider: 'Contabo DNS', category: 'dns' },
  { re: /\.zoho\.com$/i, provider: 'Zoho DNS', category: 'dns' },
  { re: /\.eurodns\.com$/i, provider: 'EuroDNS', category: 'dns' },
  { re: /\.ovh\.net$/i, provider: 'OVH DNS', category: 'dns' },
  { re: /\.dns\.ovh\.net$/i, provider: 'OVH DNS', category: 'dns' },
  { re: /\.n0c\.com$/i, provider: 'Hetzner (n0c) DNS', category: 'dns' },
  { re: /\.nserver\.de$/i, provider: 'nserver.de DNS', category: 'dns' },
  { re: /\.ui-dns\.(org|com|de|biz)$/i, provider: 'IONOS DNS', category: 'dns' },
];

const TLS_ISSUER_PATTERNS = [
  { re: /cloudflare/i, provider: 'Cloudflare' },
  { re: /amazon/i, provider: 'Amazon' },
  { re: /google trust services/i, provider: 'Google' },
  { re: /let's encrypt|letsencrypt/i, provider: "Let's Encrypt" },
  { re: /digicert/i, provider: 'DigiCert' },
  { re: /sectigo/i, provider: 'Sectigo' },
  { re: /globalsign/i, provider: 'GlobalSign' },
  { re: /zerossl/i, provider: 'ZeroSSL' },
  { re: /buypass/i, provider: 'Buypass' },
  { re: /ssl\.com/i, provider: 'SSL.com' },
  { re: /certsentry/i, provider: 'CertSentry' }
];

function detectCdn(ctx) {
  const evidence = [];
  const votes = new Map();
  function vote(provider, signal, detail) {
    if (!provider) return;
    // A CNAME that points the zone straight at a CDN edge hostname, or an
    // apex IP inside a CDN's published ranges, is hard evidence (weight 3);
    // headers are strong (1.5 each) but individually weaker.
    votes.set(provider, (votes.get(provider) || 0) + (signal === 'ip-range' || signal === 'cname' ? 3 : 1.5));
    evidence.push({ provider, signal, detail: U.safeString(detail, 200) });
  }

  // 1. HTTP headers
  const headers = ctx.headers || {};
  for (const p of HEADER_PATTERNS) {
    const v = headers[p.header];
    if (v != null && String(v) !== '' && p.re.test(String(v))) vote(p.provider, p.signal, p.header + ': ' + String(v).slice(0, 120));
  }

  // 2. CNAME chains
  for (const cname of ctx.cnameTargets || []) {
    for (const p of CNAME_PATTERNS) {
      if (p.re.test(cname)) vote(p.provider, 'cname', 'CNAME → ' + cname);
    }
  }

  // 3. Edge IP fingerprints
  for (const ipInfo of ctx.ipInfos || []) {
    if (ipInfo && ipInfo.providerKind === 'cdn' && ipInfo.provider) {
      vote(ipInfo.provider, 'ip-range', 'IP ' + ipInfo.ip + ' in ' + ipInfo.provider + ' network' + (ipInfo.asn ? ' (AS' + ipInfo.asn + ')' : ''));
    }
  }

  // 4. TLS issuer (production)
  const issuer = ctx.tlsIssuer || '';
  if (issuer) {
    for (const p of TLS_ISSUER_PATTERNS) {
      if (p.re.test(issuer)) vote(p.provider, 'tls-issuer', 'Certificate issuer: ' + issuer);
    }
  }

  // 5. Nameserver-based DNS provider (NOT a CDN claim — reported separately)
  let dnsProvider = null;
  let dnsProviderSignals = [];
  for (const ns of ctx.nameservers || []) {
    for (const p of NS_PATTERNS) {
      if (p.re.test(ns)) {
        if (!dnsProvider) {
          dnsProvider = p.provider;
          dnsProviderSignals = ['nameserver ' + ns];
        } else if (dnsProvider === p.provider) {
          if (!dnsProviderSignals.includes('nameserver ' + ns)) dnsProviderSignals.push('nameserver ' + ns);
        }
      }
    }
  }
  // Consistency check: all NS must point at the same provider for a claim
  const matched = ctx.nameservers ? ctx.nameservers.filter(ns => NS_PATTERNS.some(p => p.re.test(ns) && p.provider === dnsProvider)).length : 0;
  const dnsProviderConfident = ctx.nameservers && matched === ctx.nameservers.length;

  // Decide
  let winner = null;
  let winnerScore = 0;
  for (const [provider, score] of votes) {
    if (score > winnerScore) { winnerScore = score; winner = provider; }
  }
  let status = 'not-detected';
  let confidence = 0;
  if (winner && winnerScore >= 3) {
    status = 'detected';
    confidence = U.conf(Math.min(99, 55 + winnerScore * 7));
  } else if (winner && winnerScore > 0) {
    status = 'possible';
    confidence = U.conf(Math.min(55, 30 + winnerScore * 6));
  }

  // DNS provider ≠ proxy — make the distinction explicit.
  let proxyNote = null;
  if (status === 'not-detected' && dnsProvider) {
    proxyNote = dnsProvider + ' is detected as the DNS provider. No proxy/CDN signal (HTTP headers, edge IP or CNAME) was observed, so a ' +
      (dnsProvider.replace(/\s*DNS$/i, '') || dnsProvider) + ' reverse proxy is NOT claimed.';
  } else if (winner === 'Cloudflare' && !evidence.some(e => /ip-range|cf-ray|cname/.test(e.signal)) && dnsProvider === 'Cloudflare DNS') {
    proxyNote = 'Cloudflare is detected as the DNS provider. No proxy/CDN signal (HTTP headers, edge IP or CNAME) was observed, so a Cloudflare reverse proxy is NOT claimed.';
    if (status === 'possible') { status = 'not-detected'; winner = null; confidence = 0; }
  }

  return {
    status, // 'detected' | 'possible' | 'not-detected'
    provider: status === 'not-detected' ? null : winner,
    confidence,
    evidence,
    dnsProvider: dnsProviderConfident ? dnsProvider : (dnsProvider ? dnsProvider + ' (partial nameserver match)' : null),
    dnsProviderConfident,
    dnsProviderSignals,
    note: proxyNote
  };
}

module.exports = { detectCdn, CNAME_PATTERNS, HEADER_PATTERNS, NS_PATTERNS, TLS_ISSUER_PATTERNS };
