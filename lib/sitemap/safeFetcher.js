'use strict';
const { assertPublicUrl, resolvePublic } = require('../wptheme/ssrf');
const { makeError } = require('../wptheme/util');
const MAX_REDIRECTS = 6;
const DEFAULT_TIMEOUT = 9000;
const DEFAULT_BYTES = 900 * 1024;
const UA = 'huvanti-sitemap-generator/1.0 (+https://huvanti.com/xml-sitemap-generator)';
function headersObj(headers){ const o={}; headers.forEach((v,k)=>o[k.toLowerCase()]=v); return o; }
async function safeFetch(raw, opts={}) {
  let url = String(raw||''); let redirects=[]; const maxBytes=opts.maxBytes||DEFAULT_BYTES;
  for (let i=0;i<=MAX_REDIRECTS;i++) {
    const u = assertPublicUrl(url); await resolvePublic(u.hostname);
    const ac = new AbortController(); const t=setTimeout(()=>ac.abort(), opts.timeout||DEFAULT_TIMEOUT);
    const signal = opts.signal ? AbortSignal.any([opts.signal, ac.signal]) : ac.signal;
    let res;
    try { res = await fetch(u.toString(), { method: opts.method||'GET', redirect:'manual', signal, headers:{'user-agent':UA,'accept':opts.accept||'text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.6'} }); }
    catch(e){ clearTimeout(t); if(e.name==='AbortError') throw makeError('timeout','The website took too long to respond.'); throw makeError('unreachable','The website could not be reached: '+e.message); }
    clearTimeout(t);
    const status=res.status; const loc=res.headers.get('location');
    if ([301,302,303,307,308].includes(status) && loc) { const next = new URL(loc, u).toString(); assertPublicUrl(next); redirects.push({from:u.toString(),to:next,status}); url=next; continue; }
    let body=''; let bytes=0;
    if (opts.method !== 'HEAD') {
      const reader=res.body && res.body.getReader ? res.body.getReader() : null;
      if (reader) {
        const chunks=[];
        while(true){ const {done,value}=await reader.read(); if(done) break; bytes += value.byteLength; if(bytes > maxBytes) { try{ await reader.cancel(); }catch{} throw makeError('too_large','A response was too large to analyse safely.'); } chunks.push(value); }
        body = Buffer.concat(chunks.map(c=>Buffer.from(c))).toString('utf8');
      } else body = await res.text();
    }
    return { url:u.toString(), finalUrl:u.toString(), status, ok:res.ok, headers:headersObj(res.headers), body, redirects, bytes };
  }
  throw makeError('redirect','Too many redirects or an unsafe redirect.');
}
module.exports = { safeFetch, UA };
