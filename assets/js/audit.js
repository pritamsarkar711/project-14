/* huvanti SEO audit — client-side, no account.
 * Fetches public pages through CORS-friendly readers and analyses
 * technical, on-page, content, image, performance, mobile, schema,
 * internal-linking, international, security, AI-search and architecture signals.
 */
(function(){
'use strict';
const form=document.getElementById('audit-form'); if(!form) return;
const input=document.getElementById('audit-url');
const limitSel=document.getElementById('crawl-limit');
const out=document.getElementById('audit-results');
let lastReport=null, currentCtrl=null;

/* ----------------------------- helpers ----------------------------- */
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const hostOf=u=>{try{return new URL(u).hostname}catch{return ''}};
const normHost=h=>h.replace(/^www\./,'').toLowerCase();
const sameSite=(a,b)=>{try{return normHost(new URL(a).hostname)===normHost(new URL(b).hostname)}catch{return false}};
const pathOf=u=>{try{return new URL(u).pathname||'/'}catch{return u}};
const abs=(raw,base)=>{try{return new URL(raw,base).href.split('#')[0]}catch{return ''}};
const trim=(s,n)=>s&&s.length>n?s.slice(0,n-1)+'…':s;
const headersToObj=h=>{const o={};if(!h)return o;if(h.forEach){h.forEach((v,k)=>o[k.toLowerCase()]=v)}else{for(const[k,v]of h)o[k.toLowerCase()]=v}return o};
const isAsset=u=>/\.(jpe?g|png|webp|gif|svg|avif|ico|bmp|css|js|mjs|json|xml|pdf|zip|woff2?|ttf|eot|mp4|webm|mp3)(\?|#|$)/i.test(u);
const iconFor=s=>s==='pass'?'check_circle':s==='fail'?'cancel':s==='warn'?'warning':'info';

/* ----------------------------- fetch layer ----------------------------- */
// Tries a direct request first (gives real status/headers when CORS allows),
// then falls back through public CORS readers that return the page markup.
async function fetchUrl(rawUrl, signal, timeoutMs=12000){
  const ctrl=new AbortController();
  const to=setTimeout(()=>ctrl.abort(),timeoutMs);
  if(signal) signal.addEventListener('abort',()=>ctrl.abort(),{once:true});
  const opts={redirect:'follow',signal:ctrl.signal,headers:{'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'}};
  let attempts=[];
  // 1) direct
  try{
    const t0=performance.now();
    const res=await fetch(rawUrl,opts);
    const text=await res.text();
    clearTimeout(to);
    return {url:rawUrl,finalUrl:res.url,status:res.status,ok:res.ok,redirected:res.redirected,
      headers:headersToObj(res.headers),text,via:'direct',ms:Math.round(performance.now()-t0)};
  }catch(e){attempts.push('direct:'+e.name); if(signal&&signal.aborted){clearTimeout(to);throw e}}
  // 2..N) Public relays raced in parallel: the first usable response wins and
  //      the remaining relays are cancelled to avoid wasted relay requests.
  const relays = [
    { name: 'allorigins', run: async (sig) => {
        const res = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(rawUrl), { signal: sig });
        const j = await res.json();
        const text = j.contents || '';
        const h = {};
        if (j.status) {
          if (j.status.content_type) h['content-type'] = j.status.content_type;
          if (j.status.content_length) h['content-length'] = String(j.status.content_length);
          if (j.status.http_code) h[':http'] = String(j.status.http_code);
        }
        const st = j.status?.http_code || 200;
        return { url: rawUrl, finalUrl: j.status?.url || rawUrl, status: st, ok: st < 400, redirected: false, headers: h, text, via: 'allorigins' };
      } },
    { name: 'corsproxy', run: async (sig) => {
        const res = await fetch('https://corsproxy.io/?url=' + encodeURIComponent(rawUrl), { signal: sig });
        const text = await res.text();
        return { url: rawUrl, finalUrl: rawUrl, status: res.ok ? 200 : res.status, ok: res.ok, redirected: false, headers: headersToObj(res.headers), text, via: 'corsproxy' };
      } },
    { name: 'codetabs', run: async (sig) => {
        const res = await fetch('https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(rawUrl), { signal: sig });
        const text = await res.text();
        if (/^[A-Za-z ]+Error/i.test(text.slice(0, 80))) throw new Error(text.slice(0, 80));
        return { url: rawUrl, finalUrl: rawUrl, status: res.ok ? 200 : res.status, ok: res.ok, redirected: false, headers: {}, text, via: 'codetabs' };
      } }
  ];
  const sub = new AbortController();
  ctrl.signal.addEventListener('abort', () => sub.abort(), { once: true });
  let winner = null;
  let remaining = relays.length;
  await new Promise(resolve => {
    const finish = () => { if (winner || remaining === 0) resolve(); };
    for (const r of relays) {
      r.run(sub.signal).then(v => { if (!winner) winner = v; sub.abort(); finish(); },
        e => { attempts.push(r.name + ':' + (e?.name || 'error')); remaining--; finish(); });
    }
  });
  if (winner) { clearTimeout(to); return winner; }
  clearTimeout(to);
  const err = new Error('Could not fetch ' + rawUrl); err.attempts = attempts; throw err;
}

// Lightweight reachability/status probe for links & images (HEAD where possible).
async function probeStatus(url, signal){
  try{
    const r=await fetch('https://corsproxy.io/?url='+encodeURIComponent(url),{method:'HEAD',mode:'cors',signal,cache:'no-store'});
    return {status:r.status,headers:headersToObj(r.headers),via:'head'};
  }catch{}
  try{
    const r=await fetch('https://api.allorigins.win/raw?url='+encodeURIComponent(url),{method:'HEAD',signal,cache:'no-store'});
    return {status:r.status,headers:headersToObj(r.headers),via:'head'};
  }catch{}
  return {status:null,unavailable:true};
}

async function poolMap(items, limit, fn){
  const out=[], rest=[...items]; let idx=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
    while(rest.length){ const i=idx++; const it=rest.shift(); try{out[i]=await fn(it,i)}catch(e){out[i]={error:e.message}} }
  }));
  return out;
}

function loadImageInfo(url){
  return new Promise(res=>{
    let done=false; const img=new Image();
    const fin=v=>{if(done)return;done=true;res(v)};
    img.onload=()=>fin({ok:true,width:img.naturalWidth,height:img.naturalHeight});
    img.onerror=()=>fin({ok:false});
    setTimeout(()=>fin({ok:false,timeout:true}),8000);
    img.src=url;
  });
}

/* ----------------------------- text analytics ----------------------------- */
const STOP=new Set(('a,about,after,all,also,an,and,any,are,as,at,be,because,been,before,being,between,both,but,by,c can,come,could,did,do,does,doing,dont,down,during,each,few,for,from,further,get,got,has,had,he,her,here,hers,herself,him,himself,his,how,i,if,in,into,is,it,its,itself,just,let,like,make,made,may,me,might,more,most,my,myself,no,nor,not,now,of,off,on,once,one,only,or,other,our,ours,ourselves,out,over,own,re,s,same,she,should,so,some,such,t,than,that,the,their,theirs,them,themselves,then,there,these,they,this,those,through,to,too,under,until,up,very,was,we,well,were,what,when,where,which,while,who,whom,why,will,with,would,you,your,yours,yourself,yourselves,page,home,post,content,image,https,http,www,com,org,net,blog,article').split(','));
function wordsOf(t){return (t.match(/[\w']+/g)||[]).filter(w=>/[a-zA-Z]/.test(w))}
function topKeywords(text,n=15){
  const freq={};
  for(const w of wordsOf(text).map(w=>w.toLowerCase())) if(w.length>3&&!STOP.has(w)) freq[w]=(freq[w]||0)+1;
  return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,n);
}
function syllables(word){
  word=word.toLowerCase().replace(/[^a-z]/g,''); if(!word)return 0; if(word.length<=3)return 1;
  word=word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/,'').replace(/^y/,'');
  const m=word.match(/[aeiouy]{1,2}/g); return Math.max(1,m?m.length:0);
}
function flesch(text){
  const words=wordsOf(text), sentences=Math.max(1,(text.match(/[.!?]+(\s|$)/g)||[]).length);
  if(!words.length)return 0;
  const syll=words.reduce((n,w)=>n+syllables(w),0);
  return Math.round(clamp(206.835-1.015*(words.length/sentences)-84.6*(syll/words.length),0,100));
}
function shingles(text,k=5){const ws=wordsOf(text).map(w=>w.toLowerCase()).filter(w=>w.length>2&&!STOP.has(w));const s=new Set();for(let i=0;i+k<=ws.length;i++)s.add(ws.slice(i,i+k).join(' '));return s}
function jaccard(a,b){if(!a.size||!b.size)return 0;let inter=0;for(const x of a)if(b.has(x))inter++;return inter/(a.size+b.size-inter)}
function entities(text){
  const found=new Set();
  const re=/\b([A-Z][a-z]+(?:\s+(?:of|the|and|de|van|von)\s+)?(?:[A-Z][a-zA-Z0-9.&-]+){1,2})\b/g;
  let m; while((m=re.exec(text))){const p=m[1]; if(p.length<40&&p.split(/\s+/).length<=4)found.add(p)}
  return [...found].slice(0,12);
}
function detectIntent(text,title,url){
  const t=(title+' '+text+' '+url).toLowerCase(); const intents=[];
  if(/\b(buy|price|pricing|discount|coupon|shipping|order|checkout|deal|sale)\b/.test(t))intents.push('Commercial');
  if(/\b(how to|guide|tutorial|learn|what is|ways|tips|steps|example)\b/.test(t))intents.push('Informational');
  if(/\b(vs|versus|review|best|top|comparison|alternative)\b/.test(t))intents.push('Comparison');
  if(/\b(near me|address|hours|directions|phone|location|appointment)\b/.test(t))intents.push('Local');
  if(/\b(login|sign in|sign up|register|dashboard|account|download)\b/.test(t))intents.push('Navigational/transactional');
  if(!intents.length)intents.push('General/informational');
  return intents;
}
function freshness(text,metas,url){
  const dates=[];
  for(const k of ['article:modified_time','article:published_time','og:updated_time','date','lastmod','dcterms.modified']) if(metas[k]&&!Array.isArray(metas[k]))dates.push(metas[k]);
  const um=url.match(/\/(20\d{2})\/(0[1-9]|1[0-2])\//); if(um)dates.push(um[1]+'-'+um[2]);
  const vm=text.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+20\d{2}\b/i); if(vm)dates.push(vm[0]);
  const ym=text.match(/\b(20\d{2})\b/g);
  let latest=null, year=null;
  for(const d of dates){const y=(String(d).match(/20\d{2}/)||[])[0];if(y){year=Number(y);if(!latest||y>latest)latest=Number(y)}}
  if(ym){const max=Math.max(...ym.map(Number).filter(y=>y>=2000&&y<=2030));if(!latest||max>latest)latest=max}
  const age=latest?new Date().getFullYear()-latest:null;
  return {dates:[...new Set(dates)].slice(0,5),latest,age};
}

/* ----------------------------- robots / sitemap ----------------------------- */
function parseRobots(txt){
  const sitemaps=[...txt.matchAll(/^Sitemap:\s*(\S+)/gim)].map(m=>m[1].trim());
  const groups=[]; let cur=null;
  for(const line of txt.split(/\r?\n/)){
    let m;
    if((m=line.match(/^User-agent:\s*(.+)/i))){cur={agent:m[1].trim().toLowerCase(),disallow:[],allow:[]};groups.push(cur);continue;}
    if(cur&&(m=line.match(/^Disallow:\s*(.*)/i))){cur.disallow.push(m[1].trim());continue;}
    if(cur&&(m=line.match(/^Allow:\s*(.*)/i))){cur.allow.push(m[1].trim());continue;}
  }
  const agentBlocked=ag=>groups.some(g=>(g.agent==='*'||g.agent===ag)&&g.disallow.some(d=>d==='/'));
  const botMentioned=ag=>groups.some(g=>g.agent===ag);
  return {txt,sitemaps,groups,blocksAll:agentBlocked('*'),agentBlocked,botMentioned};
}
async function fetchRobots(origin,signal){
  try{return (await fetchUrl(origin+'/robots.txt',signal,8000)).text||''}catch{return ''}
}
async function readSitemap(sm,origin,signal,depth=0){
  if(depth>2)return {urls:[],nested:[]};
  try{
    const txt=(await fetchUrl(sm,signal,10000)).text||'';
    const locs=[...txt.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(m=>m[1].trim()).filter(u=>sameSite(u,origin)&&!isAsset(u));
    const nested=[...txt.matchAll(/<loc>([^<]+sitemap[^<]*)<\/loc>/gi)].map(m=>m[1].trim());
    return {urls:locs,nested};
  }catch{return {urls:[],nested:[]}}
}

/* ----------------------------- page extraction ----------------------------- */
function metaAll(doc){
  const m={};
  doc.querySelectorAll('meta').forEach(el=>{
    const k=(el.getAttribute('name')||el.getAttribute('property')||el.getAttribute('http-equiv')||'').toLowerCase();
    if(k)m[k]=(m[k]?m[k]+', ':'')+(el.getAttribute('content')||'');
  });
  return m;
}
function extractPage(html,baseUrl,fetchInfo){
  const doc=new DOMParser().parseFromString(html,'text/html');
  const qs=(s,r=doc)=>r.querySelector(s);
  const qsa=(s,r=doc)=>Array.from(r.querySelectorAll(s));
  const meta=metaAll(doc);
  const metaContent=k=>meta[k.toLowerCase()]||'';
  const title=(qs('title')?.textContent||'').trim();
  const canonical=qs('link[rel="canonical"]')?.getAttribute('href')||'';
  const robotsMeta=metaContent('robots');
  const viewport=metaContent('viewport');
  const desc=metaContent('description');
  const lang=qs('html')?.getAttribute('lang')||'';
  const headings=qsa('h1,h2,h3,h4,h5,h6').map(h=>({tag:h.tagName,text:(h.textContent||'').trim().slice(0,120)}));
  const h1=headings.filter(h=>h.tag==='H1').map(h=>h.text);
  const h2=headings.filter(h=>h.tag==='H2').map(h=>h.text);
  const body=qs('body');
  const bodyText=(body?body.textContent:doc.textContent||'').replace(/\s+/g,' ').trim();
  const words=wordsOf(bodyText);
  const charset=doc.characterSet||qs('meta[charset]')?.getAttribute('charset')||'';
  const contentType=(fetchInfo?.headers?.['content-type']||'');
  const images=qsa('img').map(img=>{
    const src=abs(img.getAttribute('src')||img.getAttribute('data-src')||'',baseUrl);
    return {
      src, alt:img.getAttribute('alt')??null,
      width:img.getAttribute('width'), height:img.getAttribute('height'),
      loading:(img.getAttribute('loading')||'').toLowerCase(),
      srcset:img.getAttribute('srcset')||'',
      inPicture:!!img.closest('picture'),
      format:(src.split('.').pop()||'').toLowerCase().split('?')[0],
      bytes:null, dims:null
    };
  }).filter(i=>i.src);
  const links=qsa('a[href]').map(a=>{
    const href=abs(a.getAttribute('href')||'',baseUrl);
    const text=(a.textContent||'').trim();
    const rel=(a.getAttribute('rel')||'').toLowerCase();
    return {href,text,rel,target:a.getAttribute('target')||'',internal:sameSite(href,baseUrl),
      isAnchor:!!(a.getAttribute('href')||'').startsWith('#'),empty:!text||text.length<2,
      isNoFollow:/nofollow/.test(rel),isSponsored:/sponsored/.test(rel),isUgc:/ugc/.test(rel),
      isAsset:isAsset(href),isMail:/^(mailto|tel):/i.test(a.getAttribute('href')||'')};
  }).filter(l=>l.href&&!l.isAnchor&&!l.isMail);
  const scripts=qsa('script[src]').map(s=>({src:abs(s.getAttribute('src'),baseUrl),async:s.hasAttribute('async'),defer:s.hasAttribute('defer')}));
  const inlineScripts=qsa('script:not([src])').length;
  const stylesheets=qsa('link[rel~="stylesheet"]').map(l=>abs(l.getAttribute('href'),baseUrl)).filter(Boolean);
  const inlineStyles=qsa('style').length;
  const stylesheetsInHead=qsa('head link[rel~="stylesheet"]').length;
  const blockingScripts=qsa('head script[src]').filter(s=>!s.hasAttribute('async')&&!s.hasAttribute('defer')).length;
  const jsonLd=[];
  qsa('script[type="application/ld+json"]').forEach(s=>{
    try{ const j=JSON.parse(s.textContent); (Array.isArray(j)?j:[j]).forEach(x=>x&&jsonLd.push(x)); }catch(e){jsonLd.push({__parseError:e.message})}
  });
  const schemaTypes=[...new Set(jsonLd.flatMap(j=>{
    if(j.__parseError)return [];
    const t=j['@type']; return Array.isArray(t)?t:t?[t]:[];
  }))];
  const microdata=qsa('[itemscope]').map(e=>e.getAttribute('itemtype')||'').filter(Boolean);
  const rdfa=qsa('[typeof]').map(e=>e.getAttribute('typeof')||'').filter(Boolean);
  const hreflangs=qsa('link[rel="alternate"][hreflang]').map(l=>({lang:l.getAttribute('hreflang'),href:abs(l.getAttribute('href'),baseUrl)}));
  const fonts=[...new Set(qsa('link[rel="stylesheet"][href*="font"]').map(l=>l.getAttribute('href')))];
  const inlineFontFace=(html.match(/@font-face/g)||[]).length;
  const metaRefreshes=qsa('meta[http-equiv="refresh"]').length;
  const textLen=bodyText.length;
  const ratio=html.length?Math.round(textLen/html.length*100):0;
  return {
    url:baseUrl,title,titleLen:title.length,desc,descLen:desc.length,canonical,robotsMeta,viewport,lang,
    headings,h1,h2,headingsCount:headings.length,
    bodyText,wordCount:words.length,keywords:topKeywords(bodyText,15),
    charset,contentType,images,links,scripts,inlineScripts,stylesheets,inlineStyles,
    stylesheetsInHead,blockingScripts,jsonLd,schemaTypes,microdata,rdfa,hreflangs,
    fonts,inlineFontFace,metaRefreshes,ratio,
    noindex:/noindex/i.test(robotsMeta),nofollow:/nofollow/i.test(robotsMeta),
    htmlSize:html.length
  };
}

/* ----------------------------- issue model ----------------------------- */
function addTo(arr,g,s,page,check,value,why,fix,weight=1){arr.push({group:g,severity:s,page,check,value,why,fix,weight})}
const sevScore=s=>s==='critical'?0:s==='warning'?55:s==='info'?100:100;
const statusOf=s=>s==='critical'?'fail':s==='warning'?'warn':s==='pass'?'pass':'info';
function grade(s){return s>=90?'Excellent':s>=75?'Good':s>=60?'Needs work':s>=40?'Poor':'Critical'}

/* ----------------------------- main audit ----------------------------- */
async function audit(rawUrl,progress,signal){
  let start=rawUrl.trim(); if(!/^https?:\/\//i.test(start))start='https://'+start;
  const startUrl=new URL(start), origin=startUrl.origin;
  const limit=clamp(parseInt(limitSel?.value||'6',10)||6,1,50);
  progress('Discovering site…');

  const robotsTxt=await fetchRobots(origin,signal);
  const robots=parseRobots(robotsTxt);
  let sitemapUrls=[];
  for(const sm of robots.sitemaps.slice(0,3)){
    if(signal.aborted)throw new DOMException('aborted','AbortError');
    progress('Reading sitemap…');
    const r=await readSitemap(sm,origin,signal);
    sitemapUrls.push(...r.urls);
    for(const n of r.nested.slice(0,2)){const rr=await readSitemap(n,origin,signal,2);sitemapUrls.push(...rr.urls)}
  }
  sitemapUrls=[...new Set(sitemapUrls)].filter(u=>!isAsset(u));

  // BFS crawl starting from the entered URL, seeded with sitemap URLs.
  const visited=new Set(); const queue=[start,...sitemapUrls.filter(u=>u!==start)];
  const pages=[]; const errors=[];
  const headers=[];
  let firstInfo=null;
  while(visited.size<limit && queue.length){
    if(signal.aborted)throw new DOMException('aborted','AbortError');
    const u=new URL(queue.shift(),origin); u.hash=''; const key=u.href;
    if(visited.has(key))continue; visited.add(key);
    progress(`Crawling ${visited.size}/${Math.min(limit,visited.size+queue.length)}: ${pathOf(key)}`);
    let info;
    try{ info=await fetchUrl(key,signal,12000); }
    catch(e){ errors.push({url:key,error:e.message}); continue; }
    if(!firstInfo)firstInfo=info;
    headers.push({url:key,status:info.status,via:info.via,ms:info.ms||null,
      server:info.headers['server']||'',viaHdr:info.headers['via']||'',
      encoding:info.headers['content-encoding']||'',cache:info.headers['cache-control']||'',
      type:info.headers['content-type']||'',redirected:info.redirected,finalUrl:info.finalUrl});
    // Only parse HTML responses
    const ctype=info.headers['content-type']||'';
    if(info.text && /html|xml|text\/plain/i.test(ctype)||info.text && !/\x00/.test(info.text.slice(0,200))){
      const page=extractPage(info.text,info.finalUrl||key,info);
      page.status=info.status; page.finalUrl=info.finalUrl; page.via=info.via;
      pages.push(page);
      // discover internal links (BFS)
      for(const l of page.links){if(l.internal&&!visited.has(l.href)&&!isAsset(l.href)&&!queue.includes(l.href)&&sameSite(l.href,origin))queue.push(l.href)}
    }
  }
  if(!pages.length&&errors.length)throw new Error('No pages could be read. '+errors[0].error);
  const home=pages[0];
  const issues=[];
  const I=(g,s,p,c,v,w,f,wt)=>addTo(issues,g,s,p,c,v,w,f,wt);

  /* ----- Site / Technical ----- */
  I('Technical',startUrl.protocol==='https:'?'pass':'critical','Site','HTTPS',
    startUrl.protocol==='https:'?'Site uses HTTPS':'Site served over HTTP',
    'HTTPS protects visitors and is a confirmed Google ranking signal. Modern browsers flag HTTP as "Not secure".',
    'Install an SSL/TLS certificate (Let’s Encrypt is free) and serve every URL over HTTPS.',5);
  if(firstInfo&&firstInfo.via==='direct'){
    I('Technical','pass','Site','SSL/TLS',`Secure connection established (${firstInfo.headers['content-type']?'response readable':'direct TLS'})`,
      'A valid certificate keeps the connection encrypted and preserves referrer data.',
      'Renew certificates automatically and monitor expiry.',1);
  }else{
    I('Technical','info','Site','SSL certificate',`Detailed certificate not visible through a CORS reader (fetched via ${firstInfo?.via||'proxy'})`,
      'Certificate validity, issuer and expiry affect trust and rankings.',
      'Check certificate chain and expiry with SSL Labs Server Test.',1);
  }
  // HTTP -> HTTPS / www consistency
  try{
    const httpUrl='http://'+startUrl.host+startUrl.pathname;
    // best-effort: only detectable directly; otherwise infer from start
    if(startUrl.protocol==='http:'){
      I('Technical','critical','Site','HTTP to HTTPS redirect','No HTTPS detected on the entered URL','Redirecting HTTP to HTTPS prevents duplicate/insecure access.','301-redirect all http:// traffic to https://.',4);
   }else{
      I('Technical','pass','Site','HTTP to HTTPS redirect','Entered URL uses HTTPS','All traffic should be served over HTTPS.','Ensure the server 301-redirects http:// to https://.',3);
    }
    const www=startUrl.host.startsWith('www.');
    I('Technical','pass','Site','WWW vs non-WWW',(www?'www':'non-www')+' canonical chosen',
      'Search engines should index one host version to avoid duplicate content.',
      'Pick one version and 301-redirect the other to it.',2);
  }catch{}
  I('Technical',robots.txt?'pass':'warning','Site','robots.txt',robots.txt?'Found':'Missing',
    'robots.txt gives crawlers instructions and points to your sitemap.','Create a robots.txt that references your XML sitemap.',4);
  I('Technical',robots.blocksAll?'critical':'pass','Site','Robots block',robots.blocksAll?'Disallow: / blocks the whole site':'No global block found',
    'Blocking / removes the entire site from search results.','Remove "Disallow: /" unless the site should be private.',5);
  I('Technical',robots.sitemaps.length?'pass':'warning','Site','XML sitemap',robots.sitemaps[0]||'Not referenced in robots.txt',
    'Sitemaps help search engines discover important pages.','Submit an XML sitemap and reference it in robots.txt.',4);
  I('Technical',sitemapUrls.length?'pass':'warning','Site','Sitemap URLs',`${sitemapUrls.length} usable URLs discovered`,
    'A sitemap should list canonical, indexable pages.','Keep the sitemap current and submit it in Search Console.',3);
  // per-page indexability / canonical / status
  pages.forEach(p=>{
    const path=pathOf(p.url);
    if(p.status>=400&&p.status<500)I('Technical','critical',path,'HTTP status',String(p.status),'A 4xx status means the page is unavailable to visitors and crawlers.','Fix or 301-redirect the URL to a working page.',5);
    else if(p.status>=500)I('Technical','critical',path,'HTTP status',String(p.status),'Server errors prevent crawling.','Fix the application/server error.',5);
    else if(p.status>=300&&p.status<400)I('Technical','warning',path,'Redirect',String(p.status),'Redirects waste crawl budget and add latency.','Link directly to the final URL.',3);
    else if(p.status&&p.via==='direct')I('Technical','pass',path,'HTTP status',String(p.status),'A 200 response is the expected result for indexable pages.','',1);
    else I('Technical','info',path,'HTTP status',p.status?String(p.status):'unknown (via proxy)','Status codes confirm whether a page is reachable.','Verify directly if the proxy could not expose the status.',1);
    if(p.noindex)I('Technical','critical',path,'Noindex meta','Page carries noindex','A noindex directive removes the page from search results.','Remove noindex if the page should rank.',5);
    else I('Technical','pass',path,'Meta robots',p.robotsMeta||'index, follow (default)','Indexable pages can appear in search results.','Keep important pages indexable.',1);
    if(p.nofollow)I('Technical','warning',path,'Nofollow meta','Page carries nofollow','Nofollow on a page stops link equity flowing through its links.','Remove unless intentionally needed.',2);
    if(!p.canonical)I('Technical','warning',path,'Canonical URL','Missing','Canonical tags prevent duplicate-content issues.','Add a self-referencing canonical tag.',3);
    else if(sameSite(p.canonical,p.url)&&p.canonical.replace(/\/$/,'')!==p.url.replace(/\/$/,''))I('Technical','warning',path,'Canonical URL',trim(p.canonical,80),'Canonical points to a different URL; ensure it is intentional.','Use a self-referencing canonical unless this is a duplicate.',3);
    else I('Technical','pass',path,'Canonical URL',trim(p.canonical,80)||'(self)','Canonical helps consolidate duplicate signals.','',1);
  });
  // URL structure
  pages.forEach(p=>{
    const path=pathOf(p.url);
    if(p.url.length>75)I('Technical','warning',path,'URL length',`${p.url.length} chars`,
      'Long URLs are harder to share and may be truncated in results.','Keep URLs short, descriptive and keyword-aware.',1);
    if(/[^A-Za-z0-9\-._~!$&'()*+,;=:@/\%\?\=]/.test(decodeURIComponent(p.url)))I('Technical','warning',path,'URL structure','Contains non-ASCII/special characters','Clean URLs are easier to read and share.','Use hyphens and plain words.',1);
  });
  // trailing slash consistency + duplicate URLs
  const slashCounts={with:0,without:0}; pages.forEach(p=>{const pp=new URL(p.url); if(pp.pathname==='/')return; pp.pathname.endsWith('/')?slashCounts.with++:slashCounts.without++;});
  if(slashCounts.with&&slashCounts.without)I('Technical','warning','Site','Trailing slash',`Mixed: ${slashCounts.with} with slash, ${slashCounts.without} without`,
    'Inconsistent trailing slashes create duplicate URLs.','Standardise on one format and 301-redirect the other.',2);
  else I('Technical','pass','Site','Trailing slash',slashCounts.with?'All use trailing slash':'No trailing slash','Consistent URL format avoids duplicates.','',1);
  // duplicate URLs by path/query
  const byPath={}; pages.forEach(p=>{const k=new URL(p.url).pathname;(byPath[k]=byPath[k]||[]).push(p.url)});
  Object.entries(byPath).forEach(([k,urls])=>{if(urls.length>1)I('Technical','warning',k,'Duplicate URLs',`${urls.length} variants`,'Duplicate URLs split ranking signals.','Canonicalise and 301 variants.',3)});
  // redirect chain / loop (best effort from direct fetches)
  headers.forEach(h=>{if(h.redirected&&h.finalUrl)I('Technical','info',pathOf(h.url),'Redirect detected',`→ ${pathOf(h.finalUrl)}`,'Redirect chains waste crawl budget.','Keep redirects to a single hop.',1)});

  /* ----- On-page ----- */
  const titleMap={}, descMap={};
  pages.forEach(p=>{
    const path=pathOf(p.url); titleMap[p.title]=(titleMap[p.title]||0)+1; descMap[p.desc]=(descMap[p.desc]||0)+1;
    I('On-page',!p.title?'critical':p.titleLen>=30&&p.titleLen<=60?'pass':'warning',path,'Title tag',p.title?`${p.titleLen} chars · ${trim(p.title,70)}`:'Missing',
      'The title is the most visible on-page ranking element and drives click-through.','Write a unique 30–60 character title starting with the primary keyword.',5);
    I('On-page',!p.desc?'warning':p.descLen>=120&&p.descLen<=160?'pass':'warning',path,'Meta description',p.desc?`${p.descLen} chars`:'Missing',
      'Descriptions do not directly rank but strongly influence CTR from results.','Write a unique 120–160 character description with a clear call to action.',3);
    I('On-page',p.h1.length===1?'pass':p.h1.length?'warning':'critical',path,'H1',`${p.h1.length} H1`,
      'One clear H1 establishes the page topic for crawlers and readers.','Use exactly one descriptive H1 per page.',5);
    if(p.h1.length>1)p.h1.forEach(h=>I('On-page','warning',path,'Multiple H1',trim(h,60),'Multiple H1s dilute topic clarity.','Convert extra H1s to H2s.',3));
    I('On-page',p.h2.length>=1?'pass':'warning',path,'H2–H6 structure',`${p.headingsCount} headings`,
      'Heading hierarchy makes content scannable and semantically clear.','Use H2s for main sections and H3s for sub-points.',2);
    // heading hierarchy skips
    let prev=1, skip=false;
    p.headings.forEach(h=>{const lvl=Number(h.tag[1]);if(lvl>prev+1)skip=true;prev=lvl});
    I('On-page',skip?'warning':'pass',path,'Heading hierarchy',skip?'Skips a heading level':'Logical order',
      'Skipping levels (e.g. H1→H3) confuses document outline.','Nest headings without skipping levels.',2);
    const kw=p.keywords[0];
    if(kw){
      const inTitle=new RegExp('\\b'+kw[0].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i').test(p.title);
      const inH1=p.h1.some(h=>new RegExp('\\b'+kw[0]+'\\b','i').test(h));
      const inDesc=new RegExp('\\b'+kw[0]+'\\b','i').test(p.desc);
      const density=((kw[1]/Math.max(1,p.wordCount))*100).toFixed(1);
      I('On-page',(inTitle&&inH1)?'pass':'warning',path,'Keyword placement',`Primary "${kw[0]}" ${inTitle?'in title':'NOT in title'}, ${inH1?'in H1':'NOT in H1'}, ${inDesc?'in description':'not in description'}`,
        'Placing the primary topic in the title and H1 reinforces relevance.','Include the primary keyword in title, H1, first paragraph and meta description.',3);
      I('On-page','pass',path,'Keyword density',`"${kw[0]}" ${kw[1]}× (${density}%)`,'Natural keyword use signals relevance.','Keep density natural; avoid stuffing.',1);
    }
  });
  Object.entries(titleMap).forEach(([t,n])=>{if(t&&n>1)I('On-page','warning','Site','Duplicate titles',`${n} pages share: ${trim(t,60)}`,'Duplicate titles cannibalise relevance and reduce CTR.','Write unique titles per page.',4)});
  Object.entries(descMap).forEach(([d,n])=>{if(d&&n>1)I('On-page','warning','Site','Duplicate descriptions',`${n} pages share the same description`,'Unique descriptions improve targeting and CTR.','Write unique descriptions.',3)});

  /* ----- Content ----- */
  const pageShingles=pages.map(p=>({p,sh:shingles(p.bodyText.slice(0,8000))}));
  pages.forEach(p=>{
    const path=pathOf(p.url);
    I('Content',p.wordCount>=500?'pass':p.wordCount>=250?'warning':'critical',path,'Word count',`${p.wordCount} words`,
      'Thin content provides little value and rarely ranks for competitive queries.','Add genuinely useful, original content that satisfies intent.',4);
    I('Content',p.ratio>=10?'pass':p.ratio>=5?'warning':'warning',path,'Text-to-HTML ratio',`${p.ratio}% text`,
      'A low ratio can signal heavy markup relative to content.','Reduce bloated markup and increase useful text.',1);
    const rd=flesch(p.bodyText);
    I('Content',rd>=60?'pass':rd>=40?'warning':'warning',path,'Readability',`Flesch ${rd}/100`,
      'Readable content keeps users engaged and is favoured by many ranking systems.','Use shorter sentences, subheadings and plain language.',2);
    const fr=freshness(p.bodyText,{},p.url);
    I('Content',fr.latest?(fr.age<=1?'pass':fr.age<=2?'warning':'warning'):'info',path,'Content freshness',fr.latest?`Latest year: ${fr.latest}`:'No date detected',
      'Fresh content matters for time-sensitive queries and shows maintenance.','Update or republish with the date and new information.',2);
    I('Content',p.headings.length?'pass':'warning',path,'Missing headings',p.headings.length?`${p.headings.length} found`:'None',
      'Headings break content into digestible sections.','Add descriptive H2/H3 sections.',2);
    if(p.bodyText.trim().length<50)I('Content','critical',path,'Empty content','Very little visible text','Pages without visible content cannot rank.','Add meaningful content.',5);
  });
  // near-duplicate detection
  for(let i=0;i<pageShingles.length;i++)for(let j=i+1;j<pageShingles.length;j++){
    const sim=jaccard(pageShingles[i].sh,pageShingles[j].sh);
    if(sim>0.9)I('Content','critical','Site','Duplicate content',`${pathOf(pageShingles[i].p.url)} ≈ ${pathOf(pageShingles[j].p.url)} (${Math.round(sim*100)}%)`,'Duplicate pages compete against each other.','Consolidate or canonicalise duplicates.',4);
    else if(sim>0.6)I('Content','warning','Site','Near-duplicate content',`${pathOf(pageShingles[i].p.url)} ≈ ${pathOf(pageShingles[j].p.url)} (${Math.round(sim*100)}%)`,'Very similar pages dilute topical focus.','Differentiate or merge.',3);
  }
  // keyword cannibalization
  const primaryByPage=pages.filter(p=>p.keywords[0]).map(p=>({p,kw:p.keywords[0][0]}));
  const kwPages={}; primaryByPage.forEach(x=>{(kwPages[x.kw]=kwPages[x.kw]||[]).push(x.p)});
  Object.entries(kwPages).forEach(([kw,ps])=>{if(ps.length>1)I('Content','warning','Site','Keyword cannibalization',`"${kw}" targeted by ${ps.length} pages`,'Multiple pages targeting the same term split authority.','Consolidate into one strong page or clearly differentiate intent.',3)});
  // search intent + semantic / entity (home page)
  if(home){
    const intent=detectIntent(home.bodyText,home.title,home.url);
    I('Content','info','Site','Search intent',intent.join(', '),
      'Matching search intent is essential for ranking.','Align format and depth with the dominant intent.',1);
    const ents=entities(home.bodyText.slice(0,6000));
    I('Content','info','Site','Entities / topics',ents.length?ents.slice(0,6).join(', '):'None detected',
      'Clear entities help search engines understand the topic.','Mention well-defined people, places, organisations and concepts.',1);
    if(home.keywords.length){
      I('Content','info','Site','Semantic coverage',home.keywords.slice(0,8).map(k=>k[0]).join(', '),
        'Topical authority comes from covering related concepts, not repeating one phrase.','Add related terms, definitions, FAQs and synonyms.',1);
    }
  }

  /* ----- Images ----- */
  let allImages=[];
  pages.forEach(p=>p.images.forEach(im=>allImages.push({...im,page:pathOf(p.url)})));
  pages.forEach(p=>{
    const path=pathOf(p.url), imgs=p.images;
    const missing=imgs.filter(i=>i.alt===null).length;
    const empty=imgs.filter(i=>i.alt==='').length;
    const withAlt=imgs.length-missing;
    I('Images',!imgs.length?'info':withAlt/imgs.length>=0.8?'pass':'warning',path,'Image alt text',`${withAlt}/${imgs.length} have alt`,
      'Alt text makes images accessible and helps image-search ranking.','Add descriptive alt text to meaningful images.',3);
    if(missing)I('Images','warning',path,'Missing alt attributes',`${missing} missing`,'Missing alt hurts accessibility and image SEO.','Add alt attributes.',3);
    if(empty)I('Images','warning',path,'Empty alt text',`${empty} empty`,'Empty alt is only appropriate for purely decorative images.','Describe meaningful images; mark decorative images appropriately.',1);
    const modern=imgs.filter(i=>/^(webp|avif)$/i.test(i.format)).length;
    I('Images',!imgs.length?'info':modern?'pass':'warning',path,'Modern formats (WebP/AVIF)',`${modern}/${imgs.length} modern`,
      'WebP/AVIF reduce file size and speed up pages (a ranking factor).','Convert large images to WebP/AVIF with a fallback.',2);
    const lazy=imgs.filter(i=>i.loading==='lazy').length;
    I('Images',!imgs.length?'info':lazy>=Math.ceil(imgs.length/2)?'pass':'warning',path,'Lazy loading',`${lazy}/${imgs.length} lazy`,
      'Lazy loading offscreen images speeds up initial load.','Add loading="lazy" to below-the-fold images.',2);
    const noSize=imgs.filter(i=>!i.width||!i.height).length;
    I('Images',!imgs.length?'info':noSize?'warning':'pass',path,'Missing width/height',`${noSize} unsized`,
      'Unsized images cause layout shift (CLS) while loading.','Set width and height attributes and use CSS aspect-ratio.',3);
    const srcset=imgs.filter(i=>i.srcset).length;
    I('Images',!imgs.length?'info':srcset>=Math.ceil(imgs.length/2)?'pass':'info',path,'Responsive images (srcset)',`${srcset}/${imgs.length} with srcset`,
      'Responsive images serve appropriately sized files per device.','Use srcset/sizes for large images.',1);
  });

  /* ----- Performance / resources ----- */
  // probe a capped subset of resources for status & size
  const probeTargets=[];
  pages.forEach(p=>{
    p.images.slice(0,6).forEach(im=>probeTargets.push(im.src));
    p.links.filter(l=>l.isAsset).slice(0,6).forEach(l=>probeTargets.push(l.href));
  });
  progress('Checking resources…');
  const probes=new Map((await poolMap([...new Set(probeTargets)].slice(0,24),4,(u)=>probeStatus(u,signal))).map((r,i)=>[ [...new Set(probeTargets)].slice(0,24)[i], r]));
  // attach image dims by loading
  const dimTargets=[...new Set(pages.flatMap(p=>p.images.map(i=>i.src)).filter(Boolean))].slice(0,18);
  const dims=new Map((await poolMap(dimTargets,4,(u)=>loadImageInfo(u))).map((r,i)=>[dimTargets[i],r]));
  let bytesTotal=0, brokenImgs=0, oversized=0;
  allImages.forEach(im=>{
    const d=dims.get(im.src); if(d){im.dims=d; if(!d.ok)brokenImgs++; if(d.ok&&(d.width>2000||d.height>2000))oversized++;}
    const pr=probes.get(im.src); if(pr&&pr.headers&&pr.headers['content-length'])bytesTotal+=parseInt(pr.headers['content-length'],10)||0;
  });
  if(brokenImgs)I('Performance','warning','Site','Broken images',`${brokenImgs} failed to load`,'Broken images hurt UX and trust.','Re-upload or fix image paths.',3);
  if(oversized)I('Performance','warning','Site','Oversized images',`${oversized} images larger than 2000px`,
    'Oversized images waste bandwidth and slow mobiles.','Serve appropriately sized images and use srcset.',2);
  pages.forEach(p=>{
    const path=pathOf(p.url);
    I('Performance',p.blockingScripts?'warning':'pass',path,'Render-blocking JavaScript',`${p.blockingScripts} blocking script(s) in <head>`,
      'Blocking scripts delay rendering and hurt LCP/FCP.','Use defer/async or move scripts to the end of <body>.',3);
    I('Performance',p.stylesheetsInHead?'info':'pass',path,'Render-blocking CSS',`${p.stylesheetsInHead} stylesheet(s)`,
      'CSS is render-blocking by default; large sheets delay first paint.','Inline critical CSS and preload key stylesheets.',2);
    I('Performance',p.inlineScripts>20?'warning':'info',path,'Inline scripts',`${p.inlineScripts} inline`,
      'Many inline scripts bloat HTML and reduce caching.','Move inline scripts to external cacheable files.',1);
    const ext=p.scripts.filter(s=>!sameSite(s,origin)).length;
    I('Performance',ext>8?'warning':'info',path,'Third-party scripts',`${ext} external`,
      'Third-party scripts are a common source of slowdown and CLS.','Audit and defer/self-host where possible.',2);
    I('Performance',p.fonts.length||p.inlineFontFace?'info':'pass',path,'Font optimization',`${p.fonts.length} font stylesheet(s)`,
      'Web fonts can cause FOIT/FOUT and delay text rendering.','Use font-display:swap and preload primary weights.',1);
  });
  // compression / caching / cdn / cms from headers of first page
  const fh=firstInfo?.headers||{};
  I('Performance',/gzip|br|deflate/i.test(fh['content-encoding'])?'pass':'warning','Site','Compression',fh['content-encoding']?'Content-encoding: '+fh['content-encoding']:'No compression detected',
    'Gzip/Brotli shrinks HTML/CSS/JS and speeds delivery.','Enable Brotli or gzip on the server.',3);
  if(fh['cache-control'])I('Performance','pass','Site','Browser caching',fh['cache-control'],'Cache-control lets browsers reuse assets.','Set long max-age with versioned filenames.',2);
  else I('Performance','warning','Site','Browser caching','No cache-control header seen','Without caching headers, return visitors re-download assets.','Set Cache-Control for static assets.',2);
  const serverHdr=(fh['server']||'').toLowerCase();
  const cdnHdr=fh['via']||fh['x-cache']||fh['x-served-by']||'';
  const cdnKnown=/cloudflare|akamai|fastly|cdn|google|azure|amazon|cloudfront|netlify|vercel|nginx/i.test(cdnHdr+' '+serverHdr);
  I('Performance',cdnKnown?'pass':'info','Site','CDN detection',cdnKnown?(cdnHdr+' '+serverHdr).trim():'No CDN header detected',
    'A CDN reduces latency by serving content from edge locations.','Use a CDN for global audiences.',1);
  const cmsPatterns=[['WordPress',/wp-content|wp-includes/i],['Drupal',/drupal|sites\/default/i],['Joomla',/joomla/i],['Shopify',/cdn\.shopify/i],['Wix',/wix\.com/i],['Squarespace',/squarespace/i],['React',/_next|reactroot/i],['Next.js',/_next/i],['Vue',/data-v-|vue/i]];
  const cms=cmsPatterns.filter(([,re])=>re.test((home?.bodyText||'')+(firstInfo?.text||''))).map(([n])=>n);
  I('Performance','info','Site','CMS / technology',cms.length?[...new Set(cms)].join(', '):'Not identified','Knowing the stack helps prioritise performance fixes.','Keep core, themes and plugins updated.',1);
  I('Performance','info','Site','Core Web Vitals (LCP,INP,CLS,FCP,TTFB,TBT,Speed Index)','Requires a lab/field run',
    'Core Web Vitals are confirmed ranking factors but need a real browser or CrUX data.','Run PageSpeed Insights for lab and field metrics.',0);
  I('Performance','info','Site','Unused CSS/JavaScript','Requires rendering the page',
    'Unused code wastes bytes and delays interactivity.','Audit with Chrome DevTools Coverage or Lighthouse.',0);
  // Response time (direct only)
  const directH=headers.find(h=>h.via==='direct'&&h.ms);
  I('Performance',directH?(directH.ms<600?'pass':directH.ms<1500?'warning':'warning'):'info','Site','Server response time (TTFB)',directH?`${directH.ms} ms`:'Not measurable through CORS reader',
    'Slow time-to-first-byte delays every other metric.','Optimise hosting, database and caching.',2);

  /* ----- Mobile ----- */
  pages.forEach(p=>{
    const path=pathOf(p.url);
    I('Mobile',/width=device-width/.test(p.viewport)?'pass':p.viewport?'warning':'critical',path,'Viewport meta tag',p.viewport||'Missing',
      'A viewport tag tells mobile browsers how to scale the page.','Add <meta name="viewport" content="width=device-width, initial-scale=1">.',5);
    const mq=(firstInfo?.text.match(/@media[^{]*/g)||[]).length;
    I('Mobile',mq>0?'pass':'warning',path,'Responsive design',mq?`${mq} media queries found`:'No media queries detected',
      'Responsive layout adapts to all screen sizes.','Use fluid layouts and media queries.',3);
    I('Mobile','info',path,'Tap targets','Needs visual layout check',
      'Closely packed links/buttons are hard to tap on touchscreens.','Keep tap targets ≥48px with adequate spacing.',0);
    I('Mobile','info',path,'Horizontal overflow / small text','Needs visual layout check',
      'Horizontal scroll and tiny text hurt mobile usability.','Use relative units and test at 360px width.',0);
  });

  /* ----- Schema ----- */
  pages.forEach(p=>{
    const path=pathOf(p.url);
    const invalid=p.jsonLd.filter(j=>j.__parseError).length;
    I('Schema',invalid?'critical':p.jsonLd.length?'pass':'warning',path,'JSON-LD',p.jsonLd.length?`${p.jsonLd.length} block(s)${invalid?' (invalid)':''}`:'No JSON-LD found',
      'Structured data enables rich results and helps entities appear in Search.','Add JSON-LD structured data.',4);
    if(p.microdata.length)I('Schema','info',path,'Microdata',p.microdata.length+' itemscope(s)','Microdata is an older structured-data format.','Prefer JSON-LD where possible.',1);
    if(p.rdfa.length)I('Schema','info',path,'RDFa',p.rdfa.length+' block(s)','RDFa is a structured-data format.','Prefer JSON-LD where possible.',1);
    if(p.schemaTypes.length)I('Schema','pass',path,'Schema types detected',[...new Set(p.schemaTypes)].join(', '),'Recognised schema types can qualify for rich results.','Validate with Rich Results Test.',2);
    // Missing schema suggestions
    const suggested=[];
    if(p===home)suggested.push('Organization','WebSite','WebPage');
    if(/article|post|blog/i.test(p.url+p.title))suggested.push('Article','BreadcrumbList');
    if(/faq|questions/i.test(p.url+p.bodyText.slice(0,500)))suggested.push('FAQPage');
    if(/product|price|buy/i.test(p.url+p.bodyText.slice(0,500)))suggested.push('Product');
    if(p.hreflangs.length)suggested.push('(translated pages)');
    const missing=suggested.filter(s=>!p.schemaTypes.some(t=>new RegExp(s,'i').test(t)));
    if(missing.length)I('Schema','info',path,'Suggested schema',missing.join(', '),'Adding relevant schema can enable rich results.','Implement the suggested schema types and validate them.',1);
  });

  /* ----- Internal linking ----- */
  // Build link graph from crawled pages
  const nodeByUrl=new Map(pages.map(p=>[p.url.replace(/\/$/,''),p]));
  const inLinks=new Map(), outLinks=new Map();
  pages.forEach(p=>{inLinks.set(p.url,new Set());outLinks.set(p.url,new Set())});
  pages.forEach(p=>p.links.forEach(l=>{
    if(!l.internal)return;
    const target=pages.find(q=>q.url.replace(/\/$/,'')===l.href.replace(/\/$/,''));
    if(target&&target.url!==p.url){inLinks.get(target.url)?.add(p.url);outLinks.get(p.url)?.add(target.url)}
  }));
  // click depth BFS
  const depth=new Map([[home.url,0]]); const q=[home.url];
  while(q.length){const u=q.shift();const d=depth.get(u);const p=nodeByUrl.get(u.replace(/\/$/,''));if(!p)continue;
    p.links.filter(l=>l.internal).forEach(l=>{const t=l.href.replace(/\/$/,'');if(!depth.has(t)){depth.set(t,d+1);q.push(t)}})}
  pages.forEach(p=>{
    const path=pathOf(p.url), inl=p.links.filter(l=>l.internal).length, ext=p.links.filter(l=>!l.internal).length;
    I('Internal linking',inl>=3?'pass':'warning',path,'Internal link count',`${inl} internal, ${ext} external`,
      'Internal links spread authority and help crawlers discover pages.','Link to relevant pages contextually.',3);
    if(inl===0)I('Internal linking','critical',path,'No internal links','Page links to no other internal page','Orphaned content is hard to find and rank.','Add contextual internal links.',4);
    if(p.links.length>150)I('Internal linking','warning',path,'Excessive links',`${p.links.length} links`,
      'Too many links dilute equity and look spammy.','Keep links useful and below ~150.',2);
    const empties=p.links.filter(l=>l.empty&&l.internal).length;
    if(empties)I('Internal linking','warning',path,'Empty anchor text',`${empties} empty anchors`,
      'Anchor text gives context about the target.','Use descriptive anchor text.',2);
    const redirTargets=headers.filter(h=>h.redirected).map(h=>h.url.replace(/\/$/,''));
    const redirecting=p.links.filter(l=>l.internal&&redirTargets.includes(l.href.replace(/\/$/,''))).length;
    if(redirecting)I('Internal linking','warning',path,'Internal redirect links',`${redirecting} link(s) point to a redirecting URL`,
      'Links to redirects add extra hops and waste crawl budget.','Update links to the final destination URL.',2);
    I('Internal linking',depth.has(p.url)?'pass':'warning',path,'Click depth',depth.has(p.url)?`${depth.get(p.url)} clicks from home`:'Not reached from home',
      'Pages deeper than 3 clicks get less authority and crawl attention.','Flatten architecture and link important pages higher.',2);
  });
  // orphan pages: present in sitemap but not linked by any crawled page
  const linkedUrls=new Set(); pages.forEach(p=>p.links.filter(l=>l.internal).forEach(l=>linkedUrls.add(l.href.replace(/\/$/,''))));
  const orphans=sitemapUrls.filter(u=>!linkedUrls.has(u.replace(/\/$/,''))&&!pages.some(p=>p.url.replace(/\/$/,'')===u.replace(/\/$/,''))).slice(0,10);
  orphans.forEach(u=>I('Internal linking','warning',pathOf(u),'Orphan page','In sitemap but not linked from crawled pages',
    'Orphan pages receive little authority and are hard to discover.','Link to it from relevant pages or remove it from the sitemap.',3));
  // authority proxy (in-link count)
  const lowAuth=pages.map(p=>({p,n:inLinks.get(p.url)?.size||0})).filter(x=>x.n>0&&x.n<2).slice(0,8);
  lowAuth.forEach(({p,n})=>I('Internal linking','info',pathOf(p.url),'Internal authority',`${n} incoming internal link(s)`,
    'Pages with few internal links get less authority.','Add links from high-authority pages to important targets.',1));
  // anchor distribution (home)
  if(home){
    const anchors=home.links.filter(l=>l.internal&&!l.empty).map(l=>l.text.toLowerCase());
    const top={};anchors.forEach(a=>top[a]=(top[a]||0)+1);
    const repeated=Object.entries(top).filter(([,n])=>n>3).slice(0,5);
    I('Internal linking','info','Site','Anchor distribution',repeated.length?repeated.map(([a,n])=>`"${trim(a,25)}" ×${n}`).join('; '):'Varied anchors',
      'Diverse, descriptive anchors improve relevance.','Vary anchor text naturally.',1);
  }

  /* ----- International ----- */
  pages.forEach(p=>{
    if(!p.hreflangs.length)return;
    const path=pathOf(p.url);
    I('International','pass',path,'Hreflang detected',`${p.hreflangs.length} alternate(s)`,
      'Hreflang tells engines which language/region version to show.','Keep hreflang annotations bidirectional and valid.',2);
    const invalid=p.hreflangs.filter(h=>!/^([a-z]{2,3}(-[A-Za-z0-9]+)?|x-default)$/.test(h.lang));
    if(invalid.length)I('International','warning',path,'Invalid hreflang codes',invalid.map(h=>h.lang).join(', '),
      'Malformed hreflang values are ignored.','Use codes like en, en-US, es-MX or x-default.',3);
    const noReturn=0; // bidirectional needs cross-page crawl; mark info
    I('International','info',path,'Hreflang validation','Check return tags across variants',
      'Hreflang must be reciprocal: page A lists B and B lists A.','Verify bidirectional annotations.',1);
  });
  if(home){
    I('International',home.lang?'pass':'warning','Site','HTML language',home.lang||'Missing',
      'The lang attribute helps engines and screen readers identify language.','Set <html lang="…"> accurately.',2);
    if(home.canonical&&home.hreflangs.length){
      const self=home.hreflangs.find(h=>h.lang.toLowerCase().startsWith(home.lang.toLowerCase().slice(0,2)));
      if(self&&self.href.replace(/\/$/,'')!==home.canonical.replace(/\/$/,''))I('International','warning','Site','Canonical/hreflang conflict',`Canonical differs from ${self.lang} self-reference`,
        'Conflicting canonical and hreflang can misdirect engines.','Align the canonical with the matching hreflang self URL.',3);
    }
  }

  /* ----- Security ----- */
  if(startUrl.protocol==='https:'){
    const mixed=pages.flatMap(p=>{
      const list=[]; const check=(u)=>{if(u&&/^http:\/\//i.test(u))list.push(u)};
      p.images.forEach(i=>check(i.src)); p.scripts.forEach(s=>check(s.src)); p.stylesheets.forEach(check);
      return list.map(u=>({path:pathOf(p.url),u}));
    }).slice(0,10);
    I('Security',mixed.length?'critical':'pass','Site','Mixed content',mixed.length?`${mixed.length} insecure resource(s)`:'No mixed content',
      'Mixed content breaks the padlock and browsers may block insecure assets.','Serve all resources over HTTPS.',4);
    const checks=[
      ['HSTS','strict-transport-security','Forces HTTPS and prevents downgrade attacks.','Add a Strict-Transport-Security header.'],
      ['CSP','content-security-policy','Mitigates XSS and data-injection attacks.','Add a restrictive Content-Security-Policy.'],
      ['X-Frame-Options','x-frame-options','Prevents clickjacking.','Set X-Frame-Options to DENY or SAMEORIGIN.'],
      ['X-Content-Type-Options','x-content-type-options','Prevents MIME-sniffing.','Set X-Content-Type-Options: nosniff.'],
      ['Referrer-Policy','referrer-policy','Controls referrer leakage.','Add a Referrer-Policy header.'],
      ['Permissions-Policy','permissions-policy','Restricts powerful browser features.','Add a Permissions-Policy header.']
    ];
    checks.forEach(([name,key,why,fix])=>{
      const present=!!fh[key];
      I('Security',present?'pass':(firstInfo?.via==='direct'?'warning':'info'),'Site',name,present?'Set':(firstInfo?.via==='direct'?'Missing':'Not visible via proxy'),why,fix,present?1:3);
    });
  }

  /* ----- AI Search ----- */
  ['GPTBot','ClaudeBot','PerplexityBot','Google-Extended'].forEach(bot=>{
    const blocked=robots.agentBlocked(bot.toLowerCase());
    const mentioned=robots.botMentioned(bot.toLowerCase());
    I('AI Search',blocked?'warning':'pass','Site',bot+' access',blocked?'Blocked in robots.txt':mentioned?'Mentioned':'Allowed / not blocked',
      'AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended) drive AI-search visibility.','Block only if you intentionally want to opt out.',2);
  });
  if(home){
    I('AI Search',home.wordCount>=300&&home.headings.length>=2?'pass':'warning','Site','AI-readable content',`${home.wordCount} words, ${home.headings.length} headings`,
      'Clear, well-structured text is more likely to be parsed and cited by AI systems.','Provide clear headings, definitions and direct answers.',2);
    const ents=entities(home.bodyText.slice(0,5000));
    I('AI Search',ents.length?'pass':'info','Site','Entity identification',ents.length?ents.slice(0,6).join(', '):'No clear entities',
      'Named entities anchor content to knowledge-graph concepts.','Name people, organisations, places and products explicitly.',1);
    I('AI Search',home.schemaTypes.length?'pass':'info','Site','Entity/schema consistency',home.schemaTypes.length?home.schemaTypes.join(', '):'No schema',
      'Schema aligns on-page entities with machine-readable data.','Use schema matching the page’s primary entity.',1);
  }

  /* ----- Architecture ----- */
  const maxDepth=Math.max(0,...depth.values());
  I('Architecture',pages.length>1?'pass':'warning','Site','Crawl depth',`${pages.length} pages, max click depth ${maxDepth}`,
    'Shallow sites are crawled and understood more efficiently.','Keep important pages within 3 clicks of the homepage.',3);
  const deep=[...depth.entries()].filter(([,d])=>d>3).slice(0,8);
  deep.forEach(([u,d])=>I('Architecture','warning',pathOf(u),'Deep page',`${d} clicks from home`,
    'Deep pages get crawled less and carry less authority.','Link them higher or flatten the hierarchy.',2));
  I('Architecture',maxDepth<=3&&pages.length>1?'pass':'warning','Site','Architecture',maxDepth<=3?'Flat structure':'Deep structure',
    'A flat architecture distributes authority better than a deep one.','Reduce nesting and cross-link related sections.',2);
  const isolated=pages.filter(p=>(inLinks.get(p.url)?.size||0)===0&&p!==home);
  isolated.slice(0,8).forEach(p=>I('Architecture','warning',pathOf(p.url),'Isolated page','No incoming internal links found in crawl','Isolated pages are effectively orphaned within the crawl.','Add links from related content.',2));

  /* ----------------------------- scoring ----------------------------- */
  const scored=issues.filter(x=>x.severity!=='info'&&x.weight>0);
  const max=scored.reduce((n,x)=>n+x.weight,0)*100||1;
  const got=scored.reduce((n,x)=>n+x.weight*sevScore(x.severity),0);
  const score=Math.round(got/max*100);
  const cats=['Technical','On-page','Content','Images','Performance','Mobile','Schema','Internal linking','External links','International','Security','AI Search','Architecture'];
  const scores={};
  cats.forEach(g=>{
    const list=issues.filter(x=>x.group===g&&x.severity!=='info'&&x.weight>0);
    if(list.length){const m=list.reduce((n,x)=>n+x.weight,0)*100;scores[g]=Math.round(list.reduce((n,x)=>n+x.weight*sevScore(x.severity),0)/m)}
  });
  const priorities=issues.filter(x=>x.severity!=='pass'&&x.severity!=='info').sort((a,b)=>{
    const order={critical:0,warning:1}; return (order[a.severity]-order[b.severity])||(b.weight-a.weight);
  }).slice(0,40);
  const counts={critical:0,warning:0,pass:0,info:0};
  issues.forEach(x=>counts[x.severity]++);

  const internalCount=pages.reduce((n,p)=>n+p.links.filter(l=>l.internal).length,0);
  const externalCount=pages.reduce((n,p)=>n+p.links.filter(l=>!l.internal).length,0);
  const brokenLinks=0; // link probes (best effort)
  // probe a few links for broken detection
  const linkProbeTargets=[...new Set(pages.flatMap(p=>p.links.map(l=>l.href)).filter(u=>u))].slice(0,15);
  const linkResults=await poolMap(linkProbeTargets,4,(u)=>probeStatus(u,signal));
  const brokenList=[];
  linkResults.forEach((r,i)=>{if(r&&r.status&&r.status>=400)brokenList.push(linkProbeTargets[i]);});
  brokenList.slice(0,10).forEach(u=>{const p=pages.find(p=>p.links.some(l=>l.href===u));I(p?'Internal linking':'External links','warning',p?pathOf(p.url):'Site',(p?'Broken internal link':'Broken external link'),trim(u,70),'Broken links waste crawl budget and hurt UX.','Fix or remove the link.',3)});

  // build groups for UI
  const groups={};
  issues.forEach(x=>{const st=statusOf(x.severity);(groups[x.group]=groups[x.group]||[]).push({status:st,title:`${x.check} · ${x.page}`,detail:x.value,why:x.why,fix:x.fix,impact:x.weight})});

  const noFollowExt=pages.reduce((n,p)=>n+p.links.filter(l=>!l.internal&&l.isNoFollow).length,0);
  const sponsored=pages.reduce((n,p)=>n+p.links.filter(l=>l.isSponsored).length,0);
  const ugc=pages.reduce((n,p)=>n+p.links.filter(l=>l.isUgc).length,0);
  const externalLinks=pages.flatMap(p=>p.links.filter(l=>!l.internal));
  const extDomains=new Set(externalLinks.map(l=>{try{return normHost(new URL(l.href).hostname)}catch{return ''}}).filter(Boolean));
  I('External links','pass','Site','External link count',`${externalLinks.length} links to ${extDomains.size} domain(s)`,
    'A reasonable number of relevant outbound links adds credibility.','Link to authoritative, relevant sources.',1);
  if(noFollowExt)I('External links','info','Site','Nofollow external links',`${noFollowExt} nofollow`,
    'Nofollow tells engines not to pass equity to the target.','Use nofollow for untrusted or paid links.',1);
  if(sponsored)I('External links','info','Site','Sponsored links',`${sponsored} sponsored`,
    'Sponsored links must be marked with rel="sponsored".','Use rel="sponsored" for paid placements.',1);
  if(ugc)I('External links','info','Site','UGC links',`${ugc} UGC`,
    'UGC links identify user-generated content links.','Use rel="ugc" on links in comments/forum posts.',1);
  const blankNoNoopener=externalLinks.filter(l=>l.target==='_blank'&&!/noopener|noreferrer/.test(l.rel)).length;
  if(blankNoNoopener)I('External links','warning','Site','Target="_blank" without noopener',`${blankNoNoopener} link(s)`,
    'Links opening new tabs without rel="noopener" are a tab-nabbing security risk.','Add rel="noopener" (or noreferrer).',2);
  if(externalLinks.length>80)I('External links','warning','Site','Excessive external links',`${externalLinks.length}`,
    'Too many outbound links can look spammy and dilute focus.','Link out selectively.',2);

  return {
    url:start,score,grade:grade(score),
    summary:`${pages.length} page(s) crawled · ${counts.critical} critical · ${counts.warning} warnings · ${counts.pass} passed`,
    source:`Browser crawl${firstInfo?` · via ${firstInfo.via}`:''}`,
    stats:{pages:pages.length,critical:counts.critical,warnings:counts.warning,passed:counts.pass,info:counts.info},
    counts,scores,groups,priorities,
    crawl:headers.map(h=>({path:pathOf(h.url),status:h.status||'?',via:h.via,title:(pages.find(p=>p.url===h.url)?.title)||'',ms:h.ms})),
    insights:[
      {label:'Pages crawled',value:String(pages.length)},
      {label:'Internal links',value:String(internalCount)},
      {label:'External links',value:String(externalCount)},
      {label:'Images',value:String(allImages.length)},
      {label:'Sitemap URLs',value:String(sitemapUrls.length)},
      {label:'Top keyword',value:home?.keywords[0]?`${home.keywords[0][0]} (${home.keywords[0][1]})`:'—'},
      {label:'Schema types',value:home?.schemaTypes.length?home.schemaTypes.slice(0,3).join(', '):'none'},
      {label:'Readability',value:home?flesch(home.bodyText)+'/100':'—'},
      {label:'Nofollow/sponsored/UGC',value:`${noFollowExt}/${sponsored}/${ugc}`},
      {label:'HTML size (start)',value:home?Math.round(home.htmlSize/1024)+' KB':'—'}
    ],
    techHeaders:headers[0]||null,
    pagespeedUrl:'https://pagespeed.web.dev/analysis?url='+encodeURIComponent(start),
    securityUrl:'https://securityheaders.com/?q='+encodeURIComponent(start)+'&followRedirects=on',
    richResultsUrl:'https://search.google.com/test/rich-results?url='+encodeURIComponent(start),
    generatedAt:new Date().toISOString()
  };
}

/* ----------------------------- rendering ----------------------------- */
function flatten(r){return Object.entries(r.groups).flatMap(([cat,items])=>items.map(x=>({cat,...x})))}
function countsOf(items){return {pass:items.filter(x=>x.status==='pass').length,warn:items.filter(x=>x.status==='warn').length,fail:items.filter(x=>x.status==='fail').length,info:items.filter(x=>x.status==='info').length}}
function checksHtml(items){
  return items.map(c=>`<div class="check ${c.status}" data-status="${c.status}">
    <span class="material-icons check-icon">${iconFor(c.status)}</span>
    <div><b>${esc(c.title)}</b><p>${esc(c.detail)}</p>
    ${c.why?`<small class="why"><span>Why it matters</span>${esc(c.why)}</small>`:''}
    ${c.fix?`<small class="fix"><span>How to fix</span>${esc(c.fix)}</small>`:''}</div></div>`).join('');
}
function render(r){
  lastReport=r; saveHistory(r);
  const all=flatten(r), counts=countsOf(all);
  const top=r.priorities.slice(0,10).map(p=>`<div class="priority ${statusOf(p.severity)}" data-status="${statusOf(p.severity)}">
    <b>${esc(p.check)} · ${esc(p.page)}</b><span>${esc(p.fix||p.value)}</span></div>`).join('')
    ||'<div class="priority pass"><b>No urgent fixes</b><span>Measured checks look clean.</span></div>';
  const scoreBars=Object.entries(r.scores).map(([k,v])=>`<div class="score-mini"><span>${esc(k)}</span><b>${v}</b><i><em style="width:${v}%"></em></i></div>`).join('');
  const groups=Object.entries(r.groups).map(([k,v],i)=>{
    const bad=v.filter(x=>x.status==='fail'||x.status==='warn').length;
    return `<details class="audit-fold" ${i<5||bad?'open':''}><summary><span>${esc(k)}</span><b>${bad}</b></summary>${checksHtml(v)}</details>`;
  }).join('');
  const insights=r.insights.map(x=>`<div class="insight-card"><span>${esc(x.label)}</span><b>${esc(x.value)}</b></div>`).join('');
  const crawl=`<div class="audit-panel wide"><h3>Crawled URLs</h3><table class="mini-table"><tr><th>URL</th><th>Status</th><th>Source</th><th>Time</th><th>Title</th></tr>${
    r.crawl.map(p=>`<tr><td>${esc(p.path)}</td><td><span class="status-pill s-${String(p.status).startsWith('2')?'ok':String(p.status).startsWith('3')?'redir':String(p.status).startsWith('4')||String(p.status).startsWith('5')?'err':'unk'}">${esc(p.status)}</span></td><td>${esc(p.via||'')}</td><td>${p.ms?p.ms+' ms':'—'}</td><td>${esc(p.title)}</td></tr>`).join('')}</table></div>`;
  const links=`<div class="ext-links">
    <a class="btn btn-small btn-secondary" target="_blank" rel="noopener" href="${r.pagespeedUrl}"><span class="material-icons">speed</span>PageSpeed Insights</a>
    <a class="btn btn-small btn-secondary" target="_blank" rel="noopener" href="${r.securityUrl}"><span class="material-icons">security</span>Security headers</a>
    <a class="btn btn-small btn-secondary" target="_blank" rel="noopener" href="${r.richResultsUrl}"><span class="material-icons">schema</span>Rich Results test</a>
  </div>`;
  out.innerHTML=`<div class="report-actions">
    <button class="btn btn-small" id="rerun-audit"><span class="material-icons">refresh</span>Re-run</button>
    <button class="btn btn-small btn-secondary" id="download-csv"><span class="material-icons">download</span>CSV</button>
    <button class="btn btn-small btn-secondary" id="print-report"><span class="material-icons">picture_as_pdf</span>PDF / Print</button>
    <button class="btn btn-small btn-secondary" id="share-report"><span class="material-icons">share</span>Share link</button>
    <button class="btn btn-small btn-secondary" id="copy-summary"><span class="material-icons">content_copy</span>Copy</button>
    <button class="btn btn-small btn-secondary" id="compare-btn"><span class="material-icons">history</span>Compare previous</button>
  </div>
  <div id="compare-banner"></div>
  <div class="score-card fresh">
    <div class="score-ring" style="--score:${r.score}"><b>${r.score}</b></div>
    <div class="score-summary"><h2>${esc(r.grade)}</h2><p>${esc(r.summary)}</p>
      <div class="source-chip">${esc(r.source)}</div>
      <div class="audit-stats">
        <div class="audit-stat s-critical"><strong>${r.stats.critical}</strong>critical</div>
        <div class="audit-stat s-warning"><strong>${r.stats.warnings}</strong>warnings</div>
        <div class="audit-stat s-pass"><strong>${r.stats.passed}</strong>passed</div>
        <div class="audit-stat s-info"><strong>${r.stats.info}</strong>info</div>
      </div></div></div>
  ${links}
  <div class="insight-row">${insights}</div>
  <div class="score-breakdown">${scoreBars}</div>
  <div class="filter-row">
    <button data-filter="all" class="active">All</button>
    <button data-filter="fail">Critical</button>
    <button data-filter="warn">Warnings</button>
    <button data-filter="pass">Passed</button>
    <button data-filter="info">Info</button>
  </div>
  <div class="audit-grid refined">
    <div class="audit-panel top-panel"><h3>Priority fixes</h3><div class="priority-list">${top}</div></div>
    <div class="audit-panel fold-panel"><h3>Audit checks</h3>${groups}</div>
    ${crawl}
  </div>`;
  out.querySelector('#rerun-audit').onclick=()=>form.requestSubmit();
  out.querySelector('#print-report').onclick=()=>window.print();
  out.querySelector('#copy-summary').onclick=()=>navigator.clipboard?.writeText(`${r.grade} (${r.score}/100) — ${r.url}\n${r.summary}`);
  out.querySelector('#download-csv').onclick=downloadCSV;
  out.querySelector('#share-report').onclick=shareReport;
  out.querySelector('#compare-btn').onclick=showCompare;
  out.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{out.querySelectorAll('[data-filter]').forEach(x=>x.classList.remove('active'));b.classList.add('active');setFilter(b.dataset.filter)});
  out.scrollIntoView({behavior:'smooth',block:'start'});
}
function setFilter(t){out.querySelectorAll('[data-status]').forEach(el=>{el.style.display=(t==='all'||el.dataset.status===t)?'':'none'})}

/* ----------------------------- export / share / history ----------------------------- */
function downloadCSV(){
  if(!lastReport)return;
  const rows=[['Category','Status','Check','Value','Why it matters','How to fix']];
  flatten(lastReport).forEach(x=>rows.push([x.cat,x.status,x.title,x.detail,x.why||'',x.fix||'']));
  const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='seo-audit.csv';a.click();URL.revokeObjectURL(a.href);
}
async function shareReport(){
  if(!lastReport)return;
  try{
    // Share a compact, render-safe copy (no heavy per-page payloads) to keep
    // the URL within browser length limits.
    const shareable={
      url:lastReport.url,score:lastReport.score,grade:lastReport.grade,
      summary:lastReport.summary,source:lastReport.source,stats:lastReport.stats,
      counts:lastReport.counts,scores:lastReport.scores,groups:lastReport.groups,
      priorities:lastReport.priorities,crawl:lastReport.crawl,insights:lastReport.insights,
      techHeaders:null,pagespeedUrl:lastReport.pagespeedUrl,
      securityUrl:lastReport.securityUrl,richResultsUrl:lastReport.richResultsUrl,
      generatedAt:lastReport.generatedAt,shared:true
    };
    const json=JSON.stringify(shareable);
    const cs=new CompressionStream('gzip');const w=cs.writable.getWriter();w.write(new TextEncoder().encode(json));w.close();
    const buf=await new Response(cs.readable).arrayBuffer();
    let bin='';const bytes=new Uint8Array(buf);for(let i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);
    const hash='share/'+btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const url=location.origin+location.pathname+'#'+hash;
    await navigator.clipboard?.writeText(url);
    toast('Shareable link copied to clipboard');
    history.replaceState(null,'','#'+hash);
  }catch(e){toast('Could not create share link')}
}
function saveHistory(r){
  try{
    const key='huvanti-audits';const h=JSON.parse(localStorage.getItem(key)||'[]');
    h.unshift({url:r.url,score:r.score,grade:r.grade,summary:r.summary,date:r.generatedAt,report:r});
    localStorage.setItem(key,JSON.stringify(h.slice(0,8)));
  }catch{}
}
function showCompare(){
  let h=[];try{h=JSON.parse(localStorage.getItem('huvanti-audits')||'[]')}catch{}
  const cur=lastReport;
  const banner=out.querySelector('#compare-banner');
  if(h.length<2){banner.innerHTML=`<div class="compare-note">No previous audits stored yet. Run another audit later to compare — no account required.</div>`;return}
  const items=h.map((x,i)=>`<label class="compare-opt"><input type="radio" name="cmp" value="${i}" ${i!==0?'':'checked'}> <span>${esc(x.url)} — <b>${x.score}</b> (${new Date(x.date).toLocaleDateString()})</span></label>`).join('');
  banner.innerHTML=`<div class="compare-box"><b>Compare with a previous audit</b><div class="compare-list">${items}</div><div class="compare-diff" id="compare-diff"></div></div>`;
  const renderDiff=()=>{
    const i=Number(banner.querySelector('input[name=cmp]:checked').value);
    const prev=h[i].report; if(!prev)return;
    const cats=[...new Set([...Object.keys(cur.scores),...Object.keys(prev.scores)])];
    const rows=cats.map(c=>{const a=cur.scores[c]??0,b=prev.scores[c]??0;const d=a-b;return `<tr><td>${esc(c)}</td><td>${b}</td><td>${a}</td><td class="${d>=0?'up':'down'}">${d>=0?'+':''}${d}</td></tr>`}).join('');
    banner.querySelector('#compare-diff').innerHTML=`<table class="mini-table"><tr><th>Category</th><th>Previous</th><th>Now</th><th>Change</th></tr>${rows}</table>`;
  };
  banner.querySelectorAll('input[name=cmp]').forEach(el=>el.onchange=renderDiff);
  renderDiff();
}
function toast(msg){
  const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);
  setTimeout(()=>t.remove(),2600);
}

/* ----------------------------- loading / form ----------------------------- */
function loading(msg){
  out.innerHTML=`<div class="audit-loading pulse"><span class="material-icons">travel_explore</span><h3>Running audit…</h3><p id="audit-progress">${esc(msg)}</p><button class="btn btn-secondary" id="cancel-audit">Cancel</button></div>`;
  out.querySelector('#cancel-audit').onclick=()=>{if(currentCtrl)currentCtrl.abort()};
}
function progress(msg){const el=out.querySelector('#audit-progress');if(el)el.textContent=msg}
form.addEventListener('submit',async e=>{
  e.preventDefault();
  const url=input.value.trim(); if(!url)return;
  currentCtrl=new AbortController();
  try{loading('Starting crawl'); const r=await audit(url,progress,currentCtrl.signal); location.hash=''; render(r);}
  catch(err){if(err.name==='AbortError'){out.innerHTML=`<div class="audit-error"><h3>Audit cancelled</h3><p>The audit was stopped.</p><button class="btn" onclick="document.getElementById('audit-form').requestSubmit()">Retry</button></div>`}
    else out.innerHTML=`<div class="audit-error"><h3>Audit failed</h3><p>${esc(err.message)}</p><p class="muted">The site may block public readers, or the entered URL could not be reached. Try the exact https:// address.</p></div>`}
  finally{currentCtrl=null}
});

/* Auto-run from URL hash (shared report) or ?url= */
(async function init(){
  if(location.hash.startsWith('#share/')){
    try{
      const b64=location.hash.slice(7).replace(/-/g,'+').replace(/_/g,'/');
      const bin=atob(b64);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
      const ds=new DecompressionStream('gzip');const w=ds.writable.getWriter();w.write(bytes);w.close();
      const r=JSON.parse(await new Response(ds.readable).text());
      lastReport=r; render(r); return;
    }catch{/* fall through */}
  }
  const q=new URLSearchParams(location.search).get('url');
  if(q){input.value=q; form.requestSubmit();}
})();
})();
