'use strict';

/*
 * Publicly observed subdomains, from passive signals only:
 *   - TLS certificate SANs (production)
 *   - MX / NS hostnames and CNAME targets in the zone
 *   - SPF include:/redirect= hosts in the zone
 *   - links found in the served HTML (bounded)
 * No DNS brute-forcing is ever performed. The list is explicitly labelled
 * "publicly observed", never a complete inventory.
 */

const U = require('./util');

function zoneOf(sub, domain) {
  const s = String(sub || '').toLowerCase().replace(/\.$/, '');
  const d = String(domain || '').toLowerCase();
  if (s === d || s.endsWith('.' + d)) return true;
  return false;
}

function subOf(host, domain) {
  const s = String(host || '').toLowerCase().replace(/\.$/, '');
  const d = String(domain || '').toLowerCase();
  if (s === d || !s.endsWith('.' + d)) return null;
  return s.slice(0, s.length - d.length - 1);
}

function collectObservations(ctx) {
  const found = new Map(); // sub -> Set(sources)
  function add(sub, source) {
    if (!sub || sub.length > 63 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(sub)) return;
    if (!found.has(sub)) found.set(sub, new Set());
    found.get(sub).add(source);
  }
  const domain = ctx.domain;
  const root = ctx.rootDomain || domain;

  // 1. Certificate SANs
  for (const san of ctx.sanDomains || []) {
    const sub = subOf(san, root);
    if (sub) add(sub, 'SSL certificate SAN');
  }

  // 2. NS hostnames
  for (const ns of ctx.nameservers || []) {
    const sub = subOf(ns, root);
    if (sub) add(sub, 'NS record');
  }

  // 3. MX hostnames
  for (const mx of ctx.mxHosts || []) {
    const sub = subOf(mx, root);
    if (sub) add(sub, 'MX record');
  }

  // 4. CNAME targets (zone-internal only)
  for (const c of ctx.cnameTargets || []) {
    const sub = subOf(c, root);
    if (sub) add(sub, 'CNAME target');
  }

  // 5. SPF mechanisms (include/redirect/a/mx hosts inside the zone)
  for (const spfHost of ctx.spfHosts || []) {
    const sub = subOf(spfHost, root);
    if (sub) add(sub, 'SPF record');
  }

  // 6. HTML links (same registrable domain only, bounded)
  for (const link of ctx.htmlLinks || []) {
    const sub = subOf(link, root);
    if (sub) add(sub, 'HTML link');
  }

  // 7. DKIM selector prefixes (observed, not brute-forced)
  for (const sel of ctx.dkimSelectors || []) {
    add(sel + '._domainkey', 'DKIM selector (common selector check)');
  }

  const list = Array.from(found.entries())
    .map(([sub, sources]) => ({ subdomain: sub, sources: Array.from(sources) }))
    .sort((a, b) => a.subdomain.localeCompare(b.subdomain));

  return {
    domain: root,
    count: list.length,
    list: list.slice(0, 60),
    truncated: list.length > 60,
    method: 'passive-observation',
    note: 'Only subdomains referenced in public DNS records, certificates, or served HTML are listed. This is NOT a complete inventory, no brute-force scanning is performed.'
  };
}

module.exports = { collectObservations, subOf, zoneOf };
