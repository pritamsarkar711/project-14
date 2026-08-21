'use strict';
function stripDefaultPort(u){ if((u.protocol==='https:'&&u.port==='443')||(u.protocol==='http:'&&u.port==='80')) u.port=''; }
function normalizeUrl(raw, base) {
  let u; try { u = new URL(String(raw||''), base); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  stripDefaultPort(u);
  u.pathname = u.pathname.replace(/\/+/g, '/');
  try { u.pathname = decodeURI(u.pathname); } catch {}
  // Deduplicate exact repeated query pairs but keep meaningful parameters and order stable.
  if (u.search) {
    const seen = new Set(); const kept=[];
    for (const [k,v] of u.searchParams.entries()) { const id=k+'\u0000'+v; if(!seen.has(id)){seen.add(id); kept.push([k,v]);} }
    u.search = ''; kept.forEach(([k,v])=>u.searchParams.append(k,v));
  }
  return u.toString();
}
function registrableHost(h){ return String(h||'').toLowerCase().replace(/^www\./,''); }
function isInternal(url, root, includeSubdomains) {
  let a,b; try { a=new URL(url); b=new URL(root); } catch { return false; }
  const ah=a.hostname.toLowerCase(), bh=b.hostname.toLowerCase();
  if (registrableHost(ah) === registrableHost(bh)) return true;
  return !!includeSubdomains && ah.endsWith('.'+registrableHost(bh));
}
function canonicalKey(url) { const u = new URL(url); u.hash=''; stripDefaultPort(u); u.hostname = u.hostname.toLowerCase().replace(/^www\./,''); return u.toString().replace(/\/$/,''); }
module.exports = { normalizeUrl, isInternal, canonicalKey };
