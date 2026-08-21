'use strict';

/*
 * Email infrastructure analysis — MX, SPF, DMARC, DKIM (common selectors).
 *
 * DKIM: only a small set of well-known/publicly common selectors is checked
 * (NOT brute-forced). A missing selector never means "no DKIM" — it is
 * reported as "no publicly visible DKIM for the checked selectors".
 * SPF/DMARC presence is never presented as "email fully protected".
 */

const U = require('./util');

const COMMON_SELECTORS = ['default', 'google', 'k1', 'mail', 'dkim', 'smtp', 'selector1', 'selector2', 'mandrill', 'sendgrid', 'protonmail', 'zoho', 'm365', 's1', 's2'];

const MX_PROVIDERS = [
  { re: /(^|\.)google\.com$|(^|\.)googlemail\.com$/i, name: 'Google Workspace' },
  { re: /(^|\.)mail\.protection\.outlook\.com$/i, name: 'Microsoft 365' },
  { re: /(^|\.)pphosted\.com$|(^|\.)proofpointessentials\.com$/i, name: 'Proofpoint' },
  { re: /(^|\.)cf-emailsecurity\.net$/i, name: 'Cloudflare Email Routing' },
  { re: /(^|\.)zoho\.(com|eu|in|com\.au|com\.cn)$/i, name: 'Zoho Mail' },
  { re: /(^|\.)protonmail\.ch$|(^|\.)proton\.me$/i, name: 'Proton Mail' },
  { re: /(^|\.)mx\.mailbox\.org$/i, name: 'Mailbox.org' },
  { re: /(^|\.)fastmail\.com$|(^|\.)fastmailteam\.com$/i, name: 'Fastmail' },
  { re: /(^|\.)mxroute\.com$/i, name: 'MXroute' },
  { re: /(^|\.)yandex\.net$/i, name: 'Yandex Mail' },
  { re: /(^|\.)qq\.com$/i, name: 'QQ Mail' },
  { re: /(^|\.)icloud\.com$|(^|\.)mx\.icloud\.com$/i, name: 'iCloud Mail' },
  { re: /(^|\.)mail\.gandi\.net$/i, name: 'Gandi Mail' },
  { re: /(^|\.)mx\.ovh\.net$/i, name: 'OVH Mail' },
  { re: /(^|\.)mx\.ionos\.(com|de|co\.uk)$/i, name: 'IONOS Mail' },
  { re: /(^|\.)mx1\.hostinger\.com$/i, name: 'Hostinger (Titan) Mail' },
  { re: /(^|\.)titan\.(email|mx)$/i, name: 'Titan Email' },
  { re: /(^|\.)secureserver\.net$/i, name: 'GoDaddy (Workspace) Mail' },
  { re: /(^|\.)emailsrvr\.com$/i, name: 'Rackspace Email' },
  { re: /(^|\.)spamtitan\.com$/i, name: 'SpamTitan' },
  { re: /(^|\.)mx\.csoft\.net$/i, name: 'CSoft Mail' },
  { re: /(^|\.)barracudanetworks\.com$/i, name: 'Barracuda' },
  { re: /(^|\.)mx\.porkbun\.com$/i, name: 'Porkbun Email' },
  { re: /(^|\.)mail\.ovh\.net$/i, name: 'OVH Mail' },
  { re: /(^|\.)mx\.namecheap\.com$/i, name: 'Namecheap Private Email' },
  { re: /(^|\.)mx\.web\.com$/i, name: 'Web.com Mail' },
  { re: /(^|\.)mx\.mail\.ru$/i, name: 'Mail.ru' },
  { re: /(^|\.)cluster[0-9a-z]*\.eu\.messaging\.oraclecloud\.com$/i, name: 'Oracle Cloud Mail' }
];

function parseSpf(value) {
  const v = String(value || '');
  if (!/^v=spf1\b/i.test(v.trim())) return null;
  const terms = v.trim().split(/\s+/).slice(1);
  const mechanisms = [];
  let redirect = null;
  let all = null;
  for (const t of terms) {
    const m = t.match(/^([+~?-]?)(a|mx|ptr|ip4|ip6|include|exists|redirect|all)(?::([^\s]*))?$/i);
    if (m) {
      const qual = m[1] || '+';
      const mech = m[2].toLowerCase();
      if (mech === 'redirect') redirect = m[3] || null;
      else if (mech === 'all') all = qual;
      else mechanisms.push({ qualifier: qual, mechanism: mech, value: m[3] || null });
    }
  }
  return {
    raw: v.trim(),
    mechanisms,
    redirect,
    all,
    hardFail: all === '-',
    softFail: all === '~',
    neutral: all === '?',
    permissive: all === '+',
    includesCount: mechanisms.filter(m => m.mechanism === 'include').length,
    includeCount: mechanisms.filter(m => m.mechanism === 'include').length
  };
}

function parseDmarc(value) {
  const v = String(value || '');
  if (!/^v=dmarc1\b/i.test(v.trim())) return null;
  const tags = {};
  for (const part of v.trim().split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim().toLowerCase();
    const val = part.slice(eq + 1).trim();
    if (k && !(k in tags)) tags[k] = val;
  }
  return {
    raw: v.trim(),
    policy: tags.p || null,
    subdomainPolicy: tags.sp || null,
    pct: tags.pct || null,
    rua: tags.rua || null,
    ruf: tags.ruf || null,
    adkim: tags.adkim || null,
    aspf: tags.aspf || null,
    fo: tags.fo || null,
    failureOptions: tags.fo || null
  };
}

async function analyzeEmail(dns, domain, opt) {
  opt = opt || {};
  const out = {
    mx: [],
    spf: null,
    dmarc: null,
    dkim: { checkedSelectors: COMMON_SELECTORS.slice(), found: [], note: null },
    provider: null,
    security: { spf: 'not-detected', dmarc: 'not-detected', dkim: 'not-detected' },
    notes: []
  };

  // MX
  try {
    const res = await dns.query(domain, 'MX');
    if (res.rcode === 0) {
      const mxRecords = (res.answers || []).filter(a => a.type === 15);
      // Resolve each MX host to IPs
      const hosts = Array.from(new Set(mxRecords.map(a => a.value)));
      const ipMap = {};
      await Promise.all(hosts.map(async h => {
        const [a4, a6] = await Promise.all([
          dns.query(h, 'A').catch(() => null),
          dns.query(h, 'AAAA').catch(() => null)
        ]);
        ipMap[h] = {
          a: a4 && a4.rcode === 0 ? (a4.answers || []).filter(x => x.type === 1).map(x => x.value) : [],
          aaaa: a6 && a6.rcode === 0 ? (a6.answers || []).filter(x => x.type === 28).map(x => x.value) : []
        };
      }));
      const nullMx = mxRecords.filter(a => !a.value).length > 0;
      if (nullMx) {
        out.nullMx = true;
        out.mx = [{
          host: '', priority: 0, ttl: 0, ips: { a: [], aaaa: [] }, provider: null,
          note: 'Null MX record (".") — RFC 7505: this domain accepts no email.'
        }];
        out.notes.push('A null MX record is published: the domain explicitly accepts no email.');
      } else {
        out.mx = mxRecords.map(a => {
          const prov = MX_PROVIDERS.filter(p => p.re.test(a.value)).map(p => p.name)[0] || null;
          return {
            host: a.value, priority: a.priority != null ? a.priority : 0, ttl: a.ttl,
            ips: ipMap[a.value] || { a: [], aaaa: [] },
            provider: prov
          };
        });
        const provs = Array.from(new Set(out.mx.map(m => m.provider).filter(Boolean)));
        if (provs.length === 1) out.provider = provs[0];
        else if (provs.length > 1) { out.provider = provs.join(' + '); out.notes.push('MX servers map to multiple mail providers.'); }
      }
    }
  } catch (e) {
    out.notes.push('MX lookup failed: ' + (e.message || e.code));
  }

  // SPF
  try {
    const res = await dns.query(domain, 'TXT');
    if (res.rcode === 0) {
      const spfValue = (res.answers || []).map(a => a.value).filter(v => /^v=spf1\b/i.test(String(v))).map(parseSpf)[0] || null;
      if (spfValue) {
        out.spf = spfValue;
        out.security.spf = 'detected';
      }
    }
  } catch (e) { /* keep null */ }

  // DMARC
  try {
    const res = await dns.query('_dmarc.' + domain, 'TXT');
    if (res.rcode === 0) {
      const dmarcValue = (res.answers || []).map(a => a.value).filter(v => /^v=dmarc1\b/i.test(String(v))).map(parseDmarc)[0] || null;
      if (dmarcValue) {
        out.dmarc = dmarcValue;
        out.security.dmarc = 'detected';
        out.dmarcPolicyText = dmarcValue.policy || 'none';
      }
    }
  } catch (e) { /* keep null */ }

  // DKIM — bounded common-selector check (NOT brute force). Only probed when
  // the domain actually publishes mail infrastructure (MX/SPF/DMARC).
  const hasMailSignals = out.mx.length > 0 || !!out.spf || !!out.dmarc;
  const selFound = [];
  if (hasMailSignals) {
    await Promise.all(COMMON_SELECTORS.map(async sel => {
      try {
        const name = sel + '._domainkey.' + domain;
        const res = await dns.query(name, 'TXT');
        if (res.rcode === 0 && (res.answers || []).length) {
          const v = (res.answers || []).map(a => a.value).filter(x => /^v=dkim1\b|^k=/i.test(String(x)) || /p=/i.test(String(x)))[0];
          if (v) selFound.push({ selector: sel, value: String(v).slice(0, 160) });
        }
      } catch (e) { /* skip */ }
    }));
  }
  if (selFound.length) {
    out.dkim.found = selFound;
    out.security.dkim = 'detected';
  }
  out.dkim.note = (hasMailSignals
    ? 'Checked ' + COMMON_SELECTORS.length + ' common selectors only — DKIM under another selector would not be visible here, and absence is never claimed as "no DKIM".'
    : 'No MX, SPF or DMARC records were found, so DKIM selectors were not probed (the domain shows no mail infrastructure).');

  // Honest framing: presence of SPF does not mean "protected"
  if (out.security.spf === 'detected' && out.security.dmarc !== 'detected') {
    out.notes.push('SPF exists but no DMARC policy was found — SPF alone does not give full protection against domain spoofing in all receivers.');
  }
  return out;
}

module.exports = { analyzeEmail, parseSpf, parseDmarc, COMMON_SELECTORS, MX_PROVIDERS };
