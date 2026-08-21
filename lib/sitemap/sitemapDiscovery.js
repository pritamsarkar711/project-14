'use strict';
const { safeFetch } = require('./safeFetcher');
const { normalizeUrl } = require('./urlNormalizer');
const CANDIDATES=['/sitemap.xml','/sitemap_index.xml','/sitemap-index.xml'];
async function readSitemap(url, opts={}) { const r=await safeFetch(url,{...opts,accept:'application/xml,text/xml,*/*',maxBytes:2*1024*1024}); const ct=String(r.headers['content-type']||'').toLowerCase(); const isXml=ct.includes('xml') || /<(urlset|sitemapindex)\b/i.test(r.body); if(r.status===200 && isXml) return { url:r.finalUrl, status:r.status, xml:r.body, valid:true, urls:extractLocs(r.body, r.finalUrl), isIndex:/<sitemapindex\b/i.test(r.body) }; return {url,status:r.status,valid:false,urls:[]}; }
function extractLocs(xml, base){ return [...String(xml||'').matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map(m=>m[1].replace(/&amp;/g,'&').trim()).map(x=>normalizeUrl(x,base)).filter(Boolean); }
async function discoverSitemaps(origin, robots, opts={}) { const found=[]; const candidates=[...CANDIDATES.map(p=>new URL(p,origin).toString()), ...((robots&&robots.sitemaps)||[])]; const seen=new Set(); for(const c of candidates){ if(seen.has(c)) continue; seen.add(c); try{ const s=await readSitemap(c,opts); if(s.valid) found.push(s); }catch(e){} } return found; }
module.exports={discoverSitemaps,readSitemap,extractLocs};
