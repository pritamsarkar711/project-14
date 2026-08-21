'use strict';
const { safeFetch } = require('./safeFetcher');
function parseRobots(txt) {
  const groups=[]; const sitemaps=[]; let cur=null;
  for (const raw of String(txt||'').split(/\r?\n/)) {
    const line=raw.replace(/#.*/,'').trim(); if(!line) continue;
    const m=line.match(/^([^:]+):\s*(.*)$/); if(!m) continue;
    const k=m[1].toLowerCase(), v=m[2].trim();
    if(k==='sitemap') sitemaps.push(v);
    else if(k==='user-agent'){ cur={agents:[v.toLowerCase()], rules:[], crawlDelay:null}; groups.push(cur); }
    else if(cur && (k==='allow'||k==='disallow')) cur.rules.push({type:k,path:v});
    else if(cur && k==='crawl-delay') cur.crawlDelay=parseFloat(v)||null;
  }
  function allowed(url, ua='*') {
    let u; try{u=new URL(url);}catch{return false;} const path=u.pathname+u.search;
    const matching=groups.filter(g=>g.agents.includes('*') || g.agents.some(a=>ua.toLowerCase().includes(a)));
    let best=null;
    for (const g of matching.length?matching:groups.filter(g=>g.agents.includes('*'))) for (const r of g.rules) {
      if(!r.path) continue; const re = new RegExp('^' + r.path.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*'));
      if(re.test(path) && (!best || r.path.length>best.path.length)) best=r;
    }
    return !best || best.type==='allow';
  }
  return { groups, sitemaps:[...new Set(sitemaps)], allowed, crawlDelay: (groups.find(g=>g.crawlDelay)||{}).crawlDelay || null };
}
async function fetchRobots(origin, opts={}) {
  const url=new URL('/robots.txt', origin).toString();
  try { const r=await safeFetch(url,{...opts,accept:'text/plain,*/*',maxBytes:250*1024}); if(r.status===200) return {url, exists:true, ...parseRobots(r.body)}; return {url, exists:false, groups:[], sitemaps:[], allowed:()=>true, crawlDelay:null, status:r.status}; }
  catch(e){ return {url, exists:false, error:e.message, groups:[], sitemaps:[], allowed:()=>true, crawlDelay:null}; }
}
module.exports={parseRobots,fetchRobots};
