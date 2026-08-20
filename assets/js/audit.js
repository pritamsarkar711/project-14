(function(){
const form=document.getElementById('audit-form'); if(!form) return;
const input=document.getElementById('audit-url'), out=document.getElementById('audit-results');
let lastReport=null;
const esc=s=>String(s??'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
const rurl=url=>'https://r.jina.ai/http://r.jina.ai/http://'+url;
const icon=s=>s==='pass'?'check':s==='fail'?'close':s==='warn'?'priority_high':'info';
const stop=new Set('the,and,for,with,that,this,from,you,your,are,was,were,have,has,not,but,all,can,our,more,home,post,posts,page,content,https,image,august,july,category'.split(','));
function abs(raw,base){try{return new URL(raw,base).href.split('#')[0]}catch{return ''}}
async function read(url){const res=await fetch(rurl(url),{cache:'no-store'}); if(!res.ok) throw new Error('Fetch failed'); return await res.text()}
function parse(md,base){
 const source=(md.match(/^URL Source:\s*(.+)$/m)||[])[1]||base;
 const title=(md.match(/^Title:\s*(.+)$/m)||[])[1]||'';
 const body=(md.split('Markdown Content:')[1]||md).trim();
 const h1=[...body.matchAll(/^#\s+(.+)$/gm)].map(x=>x[1].replace(/\*+/g,'').trim()).filter(Boolean);
 const h2=[...body.matchAll(/^##\s+(.+)$/gm)].map(x=>x[1].replace(/\*+/g,'').trim()).filter(Boolean);
 const h3=[...body.matchAll(/^###\s+(.+)$/gm)].map(x=>x[1].replace(/\*+/g,'').trim()).filter(Boolean);
 const images=[...body.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)].map(x=>({alt:x[1].trim(),url:abs(x[2],source)||x[2]}));
 const links=[...body.matchAll(/(?<!!)\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g)].map(x=>({text:x[1].replace(/\*+/g,'').trim(),url:abs(x[2],source)})).filter(x=>x.url);
 const text=body.replace(/https?:\/\/\S+/g,' ').replace(/[#*_`>\-\[\]()]/g,' ');
 const words=(text.match(/\b[\w’'-]+\b/g)||[]); const sentences=(text.match(/[.!?]+\s/g)||[]).length||1;
 const freq={}; words.map(w=>w.toLowerCase()).filter(w=>w.length>3&&!stop.has(w)).forEach(w=>freq[w]=(freq[w]||0)+1);
 return {url:source,title,body,h1,h2,h3,images,links,words:words.length,sentences,keywords:Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,10)};
}
function same(a,b){try{return new URL(a).hostname.replace(/^www\./,'')===new URL(b).hostname.replace(/^www\./,'')}catch{return false}}
function add(arr,group,severity,page,check,value,fix,weight=1){arr.push({group,severity,page,check,value,fix,weight})}
function sevScore(s){return s==='critical'?0:s==='warning'?55:s==='info'?100:100}
function grade(score){return score>=90?'Excellent':score>=75?'Strong':score>=60?'Needs work':'Poor'}
function pagePath(u){try{return new URL(u).pathname||'/'}catch{return u}}
function readability(p){const avg=p.words/Math.max(1,p.sentences); return Math.max(0,Math.min(100,Math.round(100-(avg-16)*3)))}
async function getRobots(origin){try{return await read(origin+'/robots.txt')}catch{return ''}}
function sitemapUrlsFromRobots(txt){return [...txt.matchAll(/Sitemap:\s*(https?:\/\/\S+)/gi)].map(m=>m[1].trim())}
function urlsFromText(txt,origin){return [...new Set([...txt.matchAll(/https?:\/\/[^\s<>)"']+/g)].map(m=>m[0].replace(/[,.;]+$/,'')))].filter(u=>same(u,origin)&&!/\.(jpg|jpeg|png|webp|gif|svg|css|js|pdf)(\?|$)/i.test(u))}
async function collectUrls(start,limit,progress){const u=new URL(start), origin=u.origin; const robots=await getRobots(origin); let candidates=[]; const sitemaps=sitemapUrlsFromRobots(robots); progress('Reading sitemap…'); for(const sm of sitemaps.slice(0,3)){try{const txt=await read(sm); const nested=urlsFromText(txt,origin).filter(x=>/sitemap/i.test(x)); candidates.push(...urlsFromText(txt,origin)); for(const n of nested.slice(0,2)){try{candidates.push(...urlsFromText(await read(n),origin))}catch{}}}catch{}}
 candidates=[start,...candidates].filter((v,i,a)=>a.indexOf(v)===i); return {robots,sitemaps,urls:candidates.slice(0,limit)} }
async function audit(raw,progress){let start=raw.trim(); if(!/^https?:\/\//i.test(start)) start='https://'+start; const startUrl=new URL(start); const limit=Math.min(Number(document.getElementById('crawl-limit')?.value||6),12); progress('Discovering URLs…'); const discovered=await collectUrls(start,limit,progress); let urls=discovered.urls.length?discovered.urls:[start]; const pages=[];
 for(let i=0;i<urls.length;i++){progress(`Crawling ${i+1}/${urls.length}: ${pagePath(urls[i])}`); try{pages.push(parse(await read(urls[i]),urls[i]))}catch(e){pages.push({url:urls[i],error:e.message,title:'',h1:[],h2:[],h3:[],images:[],links:[],words:0,sentences:1,keywords:[]})}}
 const issues=[], origin=startUrl.origin, home=pages[0];
 // Site-level checks
 add(issues,'Technical',startUrl.protocol==='https:'?'pass':'critical','Site','HTTPS',startUrl.protocol==='https:'?'HTTPS':'HTTP','Use HTTPS and redirect HTTP to HTTPS.',5);
 add(issues,'Technical',discovered.robots?'pass':'warning','Site','robots.txt',discovered.robots?'Found':'Missing','Publish robots.txt with sitemap reference.',4);
 add(issues,'Technical',/Disallow:\s*\/\s*$/im.test(discovered.robots)?'critical':'pass','Site','Robots block',/Disallow:\s*\/\s*$/im.test(discovered.robots)?'Blocks /':'No global block','Do not block the whole site.',5);
 add(issues,'Technical',discovered.sitemaps.length?'pass':'warning','Site','XML sitemap',discovered.sitemaps[0]||'Not found','Add sitemap to robots.txt.',4);
 ['GPTBot','ClaudeBot','PerplexityBot','Google-Extended'].forEach(bot=>add(issues,'AI Search',new RegExp('User-agent:\\s*'+bot+'[\\s\\S]{0,220}Disallow:\\s*/','i').test(discovered.robots)?'warning':'pass','Site',bot,new RegExp(bot,'i').test(discovered.robots)?'Mentioned':'Allowed / not blocked','Block only if intentional.',1));
 // Per page checks
 const titleMap={}, h1Map={};
 pages.forEach(p=>{ if(p.error){add(issues,'Crawl','critical',pagePath(p.url),'Page fetch',p.error,'Make page publicly crawlable.',5); return;} const path=pagePath(p.url); titleMap[p.title]=(titleMap[p.title]||0)+1; (p.h1||[]).forEach(h=>h1Map[h]=(h1Map[h]||0)+1);
  add(issues,'On-page',p.title?(p.title.length>=30&&p.title.length<=65?'pass':'warning'):'critical',path,'Title',p.title?`${p.title.length} chars`:'Missing','Use a unique 30–65 character title.',5);
  add(issues,'On-page',p.h1.length===1?'pass':p.h1.length?'warning':'critical',path,'H1',`${p.h1.length}`,'Use one clear H1.',5);
  add(issues,'On-page',p.h2.length>=1?'pass':'warning',path,'H2 headings',`${p.h2.length}`,'Add H2 sections for scannability.',2);
  add(issues,'Content',p.words>=500?'pass':p.words>=250?'warning':'critical',path,'Word count',`${p.words}`,'Improve thin pages with useful content.',4);
  add(issues,'Content',readability(p)>=50?'pass':'warning',path,'Readability',`${readability(p)}/100`,'Use shorter sentences and simpler structure.',2);
  const int=p.links.filter(l=>same(l.url,origin)), ext=p.links.filter(l=>!same(l.url,origin));
  add(issues,'Links',int.length>=3?'pass':'warning',path,'Internal links',`${int.length}`,'Add contextual links to related pages.',3);
  add(issues,'Links',int.filter(l=>!l.text||l.text.length<2).length?'warning':'pass',path,'Weak anchors',`${int.filter(l=>!l.text||l.text.length<2).length}`,'Use descriptive anchor text.',2);
  add(issues,'Links',ext.length<=40?'pass':'warning',path,'External links',`${ext.length}`,'Keep outbound links relevant.',1);
  const altOk=p.images.filter(i=>i.alt).length; add(issues,'Images',p.images.length?altOk/p.images.length>=.8?'pass':'warning':'info',path,'Image alt',`${altOk}/${p.images.length}`,'Add alt text to meaningful images.',3);
  add(issues,'Images',p.images.filter(i=>/\.webp(\?|$)/i.test(i.url)).length||!p.images.length?'pass':'warning',path,'Modern images',`${p.images.filter(i=>/\.webp(\?|$)/i.test(i.url)).length}/${p.images.length}`,'Use WebP/AVIF for large images.',2);
 });
 Object.entries(titleMap).forEach(([t,n])=>{if(t&&n>1)add(issues,'On-page','warning','Site','Duplicate title',`${n} pages: ${t}`,'Write unique page titles.',4)});
 Object.entries(h1Map).forEach(([h,n])=>{if(h&&n>2)add(issues,'Content','warning','Site','Repeated H1',`${n} pages: ${h}`,'Use page-specific H1 text.',2)});
 // Architecture
 const allInternal=[...new Set(pages.flatMap(p=>(p.links||[]).filter(l=>same(l.url,origin)).map(l=>l.url)))];
 add(issues,'Architecture',pages.length>1?'pass':'warning','Site','Crawl depth',`${pages.length} pages crawled`,'Increase crawl limit for deeper audit.',3);
 add(issues,'Architecture',allInternal.length>=pages.length?'pass':'warning','Site','URL discovery',`${allInternal.length} internal URLs found`,'Add crawlable links to important pages.',3);
 // Not measured as info, not score penalties
 add(issues,'Performance','info','Site','Core Web Vitals','Requires lab/field API','Use PageSpeed Insights for LCP, INP, CLS.',0);
 add(issues,'Security','info','Site','Security headers','Requires direct header access','Check HSTS, CSP, X-Frame-Options and Referrer-Policy.',0);
 add(issues,'Schema','info','Site','Schema validation','Requires raw HTML','Validate JSON-LD with Rich Results Test.',0);
 const scored=issues.filter(x=>x.severity!=='info'&&x.weight>0); const max=scored.reduce((n,x)=>n+x.weight,0)*100||1; const got=scored.reduce((n,x)=>n+x.weight*sevScore(x.severity),0); const score=Math.round(got/max*100);
 const groups={}; issues.forEach(x=>{const status=x.severity==='critical'?'fail':x.severity==='warning'?'warn':x.severity==='pass'?'pass':'info'; (groups[x.group]||(groups[x.group]=[])).push({status,title:`${x.check} · ${x.page}`,detail:x.value,fix:x.fix,impact:x.weight})});
 const priorities=issues.filter(x=>['critical','warning'].includes(x.severity)).sort((a,b)=>b.weight-a.weight).slice(0,30).map(x=>({status:x.severity==='critical'?'fail':'warn',title:`${x.check} · ${x.page}`,detail:x.value,fix:x.fix,impact:x.weight}));
 const scoreBy={}; ['Technical','On-page','Content','Images','Links','Architecture','AI Search'].forEach(g=>{const list=issues.filter(x=>x.group===g&&x.severity!=='info'&&x.weight>0); if(list.length){const m=list.reduce((n,x)=>n+x.weight,0)*100; scoreBy[g]=Math.round(list.reduce((n,x)=>n+x.weight*sevScore(x.severity),0)/m*100)}});
 return {url:start,source:'live browser crawl + sitemap + robots',score,grade:grade(score),summary:`${pages.length} pages crawled, ${priorities.length} prioritized fixes, ${issues.filter(x=>x.severity==='pass').length} checks passed.`,stats:{pages:pages.length,issues:priorities.length,ttfb:'n/a',htmlKb:'n/a'},groups,priorities,crawl:pages.map(p=>({path:pagePath(p.url),status:p.error?'error':'read',title:p.title||'Missing'})),scores:scoreBy,insights:[{label:'Pages crawled',value:String(pages.length)},{label:'Internal URLs',value:String(allInternal.length)},{label:'Top keywords',value:(home.keywords||[]).slice(0,5).map(([w,n])=>`${w} ${n}`).join(', ')||'none'},{label:'Sitemap',value:discovered.sitemaps.length?'found':'missing'}]};
}
function buildScores(groups){const out={}; Object.entries(groups).forEach(([g,items])=>{const s=items.filter(i=>i.status!=='info'); if(!s.length)return; out[g]=Math.round(s.reduce((n,i)=>n+(i.status==='pass'?100:i.status==='warn'?55:0),0)/s.length)}); return out}
function flatten(r){return Object.entries(r.groups).flatMap(([cat,items])=>items.map(x=>({cat,...x})))}
function statusCounts(items){return {pass:items.filter(x=>x.status==='pass').length,warn:items.filter(x=>x.status==='warn').length,fail:items.filter(x=>x.status==='fail').length,info:items.filter(x=>x.status==='info').length}}
function checks(items){return items.map(c=>`<div class="check ${c.status}" data-status="${c.status}"><span class="material-icons check-icon">${icon(c.status)}</span><div><b>${esc(c.title)}</b><p>${esc(c.detail)}</p>${c.fix?`<small>${esc(c.fix)}</small>`:''}</div></div>`).join('')}
function render(r){lastReport=r; const all=flatten(r), counts=statusCounts(all), scores=r.scores||buildScores(r.groups); const top=r.priorities.slice(0,8).map(p=>`<div class="priority ${p.status}" data-status="${p.status}"><b>${esc(p.title)}</b><span>${esc(p.fix||p.detail)}</span></div>`).join('')||'<div class="priority"><b>No urgent fixes</b><span>Measured checks look clean.</span></div>'; const scoreBars=Object.entries(scores).map(([k,v])=>`<div class="score-mini"><span>${esc(k)}</span><b>${v}</b><i><em style="width:${v}%"></em></i></div>`).join(''); const groups=Object.entries(r.groups).map(([k,v],i)=>`<details class="audit-fold" ${i<4?'open':''}><summary><span>${esc(k)}</span><b>${v.filter(x=>x.status==='fail'||x.status==='warn').length}</b></summary>${checks(v)}</details>`).join(''); const insights=r.insights?`<div class="insight-row">${r.insights.map(x=>`<div class="insight-card"><span>${esc(x.label)}</span><b>${esc(x.value)}</b></div>`).join('')}</div>`:''; const crawl=`<div class="audit-panel wide"><h3>Crawled URLs</h3><table class="mini-table"><tr><th>URL</th><th>Status</th><th>Title</th></tr>${r.crawl.map(p=>`<tr><td>${esc(p.path)}</td><td>${p.status}</td><td>${esc(p.title)}</td></tr>`).join('')}</table></div>`; out.innerHTML=`<div class="report-actions"><button class="btn btn-small" id="rerun-audit">Re-run</button><button class="btn btn-small btn-secondary" id="download-csv">CSV</button><button class="btn btn-small btn-secondary" id="print-report">PDF/Print</button><button class="btn btn-small btn-secondary" id="copy-summary">Copy</button></div><div class="score-card fresh"><div class="score-ring" style="--score:${r.score}"><b>${r.score}</b></div><div class="score-summary"><h2>${esc(r.grade)}</h2><p>${esc(r.summary)}</p><div class="source-chip">${esc(r.source)}</div><div class="audit-stats"><div class="audit-stat"><strong>${counts.fail}</strong>critical</div><div class="audit-stat"><strong>${counts.warn}</strong>warnings</div><div class="audit-stat"><strong>${counts.pass}</strong>passed</div><div class="audit-stat"><strong>${counts.info}</strong>info</div></div></div></div>${insights}<div class="score-breakdown">${scoreBars}</div><div class="filter-row"><button data-filter="all" class="active">All</button><button data-filter="fail">Critical</button><button data-filter="warn">Warnings</button><button data-filter="pass">Passed</button><button data-filter="info">Info</button></div><div class="audit-grid refined"><div class="audit-panel top-panel"><h3>Priority fixes</h3><div class="priority-list">${top}</div></div><div class="audit-panel fold-panel"><h3>Audit checks</h3>${groups}</div>${crawl}</div>`; out.querySelector('#rerun-audit').onclick=()=>form.requestSubmit(); out.querySelector('#print-report').onclick=()=>window.print(); out.querySelector('#copy-summary').onclick=()=>navigator.clipboard?.writeText(`${r.grade} ${r.score}: ${r.summary}`); out.querySelector('#download-csv').onclick=downloadCSV; out.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{out.querySelectorAll('[data-filter]').forEach(x=>x.classList.remove('active'));b.classList.add('active');filter(b.dataset.filter)}); out.scrollIntoView({behavior:'smooth',block:'start'});}
function filter(t){out.querySelectorAll('[data-status]').forEach(el=>el.style.display=(t==='all'||el.dataset.status===t)?'':'none')}
function downloadCSV(){if(!lastReport)return; const rows=[['Category','Status','Check','Value','Fix']]; flatten(lastReport).forEach(x=>rows.push([x.cat,x.status,x.title,x.detail,x.fix||''])); const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n'); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='seo-audit.csv'; a.click(); URL.revokeObjectURL(a.href)}
function loading(msg){out.innerHTML=`<div class="audit-loading pulse"><h3>Scanning…</h3><p>${esc(msg)}</p></div>`}
form.addEventListener('submit',async e=>{e.preventDefault(); const url=input.value.trim(); if(!url)return; try{loading('Starting crawl'); render(await audit(url,loading));}catch(err){out.innerHTML=`<div class="audit-error"><h3>Audit failed</h3><p>${esc(err.message)}</p></div>`}});
})();
