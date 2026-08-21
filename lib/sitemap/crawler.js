'use strict';
const { validateUrl } = require('./urlValidator');
const { safeFetch } = require('./safeFetcher');
const { fetchRobots } = require('./robotsParser');
const { discoverSitemaps } = require('./sitemapDiscovery');
const { normalizeUrl, isInternal, canonicalKey } = require('./urlNormalizer');
const { parsePage } = require('./pageParser');
const { analyzeIndexability } = require('./indexabilityAnalyzer');
const { canonicalDecision } = require('./canonicalAnalyzer');
const { dedupePages } = require('./duplicateAnalyzer');
const { splitSitemaps } = require('./sitemapSplitter');
const { validateXml } = require('./sitemapValidator');
const { summarize } = require('./reportEngine');
async function crawlSite(raw, options={}) {
  const started=Date.now(); const maxUrls=Math.min(Number(options.maxUrls)||500,10000); const maxDepth=options.depth==='unlimited'?10:Math.min(Number(options.depth)||3,10); const includeSubdomains=!!options.includeSubdomains;
  const input=await validateUrl(raw); options.onProgress&&options.onProgress({stage:'connect',message:'Website connected'});
  const home=await safeFetch(input.toString(), options); const root=home.finalUrl; const origin=new URL(root).origin;
  const robots=await fetchRobots(origin, options); options.onProgress&&options.onProgress({stage:'robots',message:'Robots.txt analyzed'});
  if(!robots.allowed(root)) { const e=new Error('Crawling restricted by robots.txt'); e.code='robots'; throw e; }
  const sitemaps=await discoverSitemaps(origin, robots, options); options.onProgress&&options.onProgress({stage:'sitemaps',message:sitemaps.length?'Existing Sitemap Detected':'Sitemap discovery completed', existingSitemaps:sitemaps.map(s=>s.url)});
  const queue=[{url:root,depth:0}]; const qSeen=new Set([canonicalKey(root)]); let discovered=1; for(const sm of sitemaps) for(const loc of sm.urls.slice(0,maxUrls)){ if(isInternal(loc,root,includeSubdomains)&&!qSeen.has(canonicalKey(loc))){ qSeen.add(canonicalKey(loc)); queue.push({url:loc,depth:1}); discovered++; } }
  const pages=[]; let idx=0; const concurrency=Math.min(Number(options.concurrency)||4,6);
  async function worker(){ while(idx<queue.length && pages.length<maxUrls){ const item=queue[idx++]; const blocked=!robots.allowed(item.url); if(blocked){ pages.push({url:item.url,status:0,indexable:false,included:false,blocked:true,reason:'Excluded: robots.txt restriction',depth:item.depth}); continue; }
      let page={url:item.url,depth:item.depth,included:false,indexable:false,reason:''};
      try{ const r=await safeFetch(item.url,{...options,maxBytes:900*1024}); page.url=r.finalUrl; page.status=r.status; page.headers=r.headers; page.redirected=r.redirects.length>0; page.lastmod=parseLastmod(r.headers['last-modified']); const ct=String(r.headers['content-type']||''); const parsed = /html/i.test(ct) ? parsePage(r.body, r.finalUrl) : {links:[],images:[],canonical:null,noindex:false,jsHeavy:false,wordpress:false}; Object.assign(page, parsed); const ix=analyzeIndexability(page, options); Object.assign(page, ix); const cd=canonicalDecision(page, root, includeSubdomains); page.canonical=cd.canonical; if(cd.canonicalized){ page.included=false; page.indexable=false; page.reason=cd.reason; if(cd.canonical && isInternal(cd.canonical,root,includeSubdomains) && !qSeen.has(canonicalKey(cd.canonical)) && queue.length<maxUrls){ qSeen.add(canonicalKey(cd.canonical)); queue.push({url:cd.canonical,depth:item.depth+1}); discovered++; } } else page.included=ix.indexable;
        if(item.depth<maxDepth) for(const link of parsed.links||[]){ if(queue.length>=maxUrls) break; if(!isInternal(link,root,includeSubdomains)) continue; if(!robots.allowed(link)) continue; const ext=new URL(link).pathname.toLowerCase(); if(/\.(pdf|zip|rar|7z|mp4|mov|avi|mp3|woff2?|ttf|eot|css|js)(\?|$)/.test(ext)) continue; const k=canonicalKey(link); if(!qSeen.has(k)){ qSeen.add(k); queue.push({url:link,depth:item.depth+1}); discovered++; } }
      } catch(e){ page.status=0; page.indexable=false; page.included=false; page.reason=e.code==='too_large'?'Excluded: Unsupported content type or oversized response':(e.message||'Excluded: fetch failed'); }
      pages.push(page); options.onProgress&&options.onProgress({stage:'crawl',message:`${pages.length} URLs analyzed`,discovered,crawled:pages.length});
    }}
  await Promise.all(Array.from({length:concurrency}, worker));
  dedupePages(pages); const included=pages.filter(p=>p.included).map(p=>({url:p.canonical||p.url,loc:p.canonical||p.url,lastmod:p.lastmod,images:options.includeImages?p.images:[]}));
  const split=splitSitemaps(included,{origin, includeImages:!!options.includeImages, changefreq:options.changefreq||'', includePriority:false, maxPerFile:50000});
  const validations=split.files.map(f=>({name:f.name,...validateXml(f.xml)})); if(split.indexXml) validations.push({name:split.indexName,...validateXml(split.indexXml,'index')});
  if(validations.some(v=>!v.valid)){ const e=new Error('Generated XML failed validation.'); e.code='xml_invalid'; e.validation=validations; throw e; }
  return { mode:'generate', input:input.toString(), finalUrl:root, existingSitemaps:sitemaps.map(s=>({url:s.url,count:s.urls.length,isIndex:s.isIndex})), robots:{exists:robots.exists,url:robots.url,crawlDelay:robots.crawlDelay}, limitedCrawlability:pages.some(p=>p.jsHeavy), urls:pages.map(p=>({url:p.url,status:p.status,indexable:!!p.indexable,canonical:p.canonical||'',included:!!p.included,reason:p.reason,depth:p.depth})), files:split.files, indexXml:split.indexXml, indexName:split.indexName, validations, stats:{...summarize(pages,discovered,started), sitemapFiles:split.files.length, sitemapIndex:split.indexXml?1:0} };
}
function parseLastmod(v){ if(!v) return null; const d=new Date(v); if(Number.isNaN(d.getTime())) return null; return d.toISOString().slice(0,10); }
module.exports={crawlSite};
