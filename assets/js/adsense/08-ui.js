/* huvanti AdSense checker — UI, progress, report rendering, export. */
(function (global) {
'use strict';
var A = global.Adsense = global.Adsense || {};
var U = A.util;
var form=document.getElementById('adsense-form');
if(!form)return;
var urlInput=document.getElementById('adsense-url');
var limitSel=document.getElementById('adsense-limit');
var out=document.getElementById('adsense-results');
var lastReport=null;

function el(tag,cls,html){var e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e;}
function sevIcon(s){return s==='passed'?'check_circle':s==='critical'?'error':s==='high'?'cancel':s==='medium'?'warning':s==='info'?'info':'info';}
function stageState(stage,current){var order=['init','robots','sitemap','crawler','parse','analyze','score','done'];var a=order.indexOf(stage),b=order.indexOf(current);if(a<0||b<0)return a<=b?'done':'wait';return a<b?'done':a===b?'active':'wait';}
var STAGES=[['robots','Website accessible & robots.txt analyzed'],['sitemap','Sitemap analyzed'],['crawler','Pages discovered & crawled'],['parse','HTML parsed'],['analyze','Content, trust, policy, UX & technical checks'],['score','Readiness score calculated']];

function progressUI(state){
  var pct;
  if(state.stage==='crawler'&&state.crawled) pct=20+Math.round(state.crawled/(state.limit||50)*60);
  else pct=({init:5,robots:12,sitemap:20,crawler:25,parse:82,analyze:90,score:96,done:100})[state.stage]||30;
  var items=STAGES.map(function(s){var st=stageState(s[0],state.stage);var icon=st==='done'?'check_circle':st==='active'?'autorenew':'hourglass_empty';return '<li class="pi-'+st+'"><span class="material-icons '+(st==='active'?'pi-active':st==='done'?'pi-done':'pi-wait')+'">'+icon+'</span>'+s[1]+'</li>';}).join('');
  out.innerHTML='<div class="paper paper-padded adsense-progress"><h3>Checking website…</h3><div class="progress-bar"><i style="width:'+pct+'%"></i></div><ul class="progress-list">'+items+'</ul><p class="muted" id="adsense-progress-msg">'+U.esc(state.message||'Working…')+'</p><button class="btn btn-secondary" id="adsense-cancel">Cancel</button></div>';
  var msg=document.getElementById('adsense-progress-msg');
  out._setMsg=function(m){if(msg)msg.textContent=m;};
  document.getElementById('adsense-cancel').onclick=function(){if(A._ctrl)A._ctrl.abort();};
}
function setMsg(m){if(out._setMsg)out._setMsg(m);}

function errorUI(err){
  var msg=err.message||String(err),code=err.code||'error';
  var friendly={
    invalid_url:'Please enter a valid public website URL (e.g. https://example.com).',
    unreachable:'The website could not be reached. It may be offline, blocking public readers, or behind a bot challenge.',
    ssl:'A secure HTTPS connection could not be established. Check the SSL certificate.',
    timeout:'The website took too long to respond. It may be slow or rate-limiting.',
    challenge:'The site appears to be protected by a Cloudflare/bot challenge and cannot be read automatically.',
    too_large:'A page response was too large to analyse.',
    cancelled:'The audit was cancelled.',
    empty:'No readable HTML pages were found. The site may be JavaScript-only or empty.',
    fetch_failed:'The website could not be read by any available public reader.'
  }[code]||'The audit could not be completed.';
  out.innerHTML='<div class="paper paper-padded adsense-error"><span class="material-icons">error_outline</span><h3>'+(code==='cancelled'?'Audit cancelled':'Could not complete the audit')+'</h3><p>'+U.esc(friendly)+'</p>'+(code!=='cancelled'?'<p class="muted">Technical detail: '+U.esc(msg)+'</p>':'')+'<button class="btn" id="adsense-retry">Try again</button></div>';
  var b=document.getElementById('adsense-retry');if(b)b.onclick=function(){form.requestSubmit();};
}

function verdictBlock(r){
  var s=r.score;
  var summary=s.caps.length?s.caps.join(' '):('Based on '+r.findings.length+' measurable checks across '+r.pages.length+' page(s).');
  return '<div class="score-card adsense-scorecard"><div class="score-ring" style="--score:'+s.total+';--ad:'+ringColor(s.total)+';background:conic-gradient('+ringColor(s.total)+' calc(var(--score)*1%),var(--chip-bg) 0)"><b style="color:'+ringColor(s.total)+'">'+s.total+'</b></div><div class="score-summary"><div class="verdict '+s.verdictClass+'"><span class="material-icons">'+(s.total>=80?'verified':s.total>=40?'trending_up':'gpp_bad')+'</span>'+s.verdict+'</div><h2>Website Readiness Score</h2><p>'+U.esc(summary)+'</p><div class="source-chip">Deterministic rule-based analysis · Google makes the final AdSense approval decision.</div><div class="ad-summary-grid"><div class="ad-stat"><span>Pages crawled</span><b>'+r.arch.pages+'</b></div><div class="ad-stat"><span>Issues</span><b>'+r.findings.filter(function(f){return f.status!=='passed';}).length+'</b></div><div class="ad-stat"><span>Passed</span><b>'+r.findings.filter(function(f){return f.status==='passed';}).length+'</b></div><div class="ad-stat"><span>Policy signals</span><b>'+r.findings.filter(function(f){return f.category==='policy'&&f.status!=='passed';}).length+'</b></div></div></div></div>';
}
function ringColor(n){return n>=80?'#2e7d32':n>=65?'#ed6c02':n>=40?'#ef6c00':'#d32f2f';}

function categoryBreakdown(r){
  return '<div class="cat-breakdown"><h3>Score breakdown — click a category to see exactly how it was calculated</h3>'+
    r.score.categories.map(function(c,idx){
      var neg=c.lines.filter(function(l){return l.delta<0;});
      var pos=c.lines.filter(function(l){return l.delta===0&&l.status==='passed';});
      var rows=c.lines.map(function(l){
        var d=l.delta;
        var cls=l.status==='info'?'neutral':(d<0?'neg':'pos');
        return '<div class="calc-line '+cls+'"><span>'+sevPill(l.status)+' '+U.esc(l.name)+(l.page!=='Site'?' · '+U.esc(String(l.page).slice(0,40)):'')+'</span><b>'+(d<0?('-'+Math.abs(Math.round(d*10)/10)):(l.status==='info'?'—':'+0'))+' / '+l.weight+'</b></div>';
      }).join('');
      return '<details class="cat-row" '+(idx<3?'open':'')+'><summary><span class="cat-gauge" style="--s:'+c.pct+';--ad:'+ringColor(c.pct)+'"><b>'+c.score+'</b></span><span class="cat-meta">'+c.label+' <small>'+c.score+'/'+c.max+' points · '+c.pct+'% · '+neg.length+' issue'+(neg.length===1?'':'s')+'</small></span><span class="material-icons cat-arrow">expand_more</span></summary><div class="cat-body"><div class="calc-line total"><span>Category weight</span><b>'+c.max+'</b></div>'+rows+'<div class="calc-line total"><span>Final '+c.label+' score</span><b>'+c.score+'/'+c.max+'</b></div>'+(c.capNote?'<div class="calc-note"><span class="material-icons">info</span>'+c.capNote+'</div>':'')+'</div></details>';
    }).join('')+'</div>';
}
function sevPill(s){return '<span class="badge '+s+'">'+s+'</span>';}

function issueExplorer(r){
  var filters=[['all','All'],['critical','Critical'],['high','High'],['medium','Medium'],['low','Low'],['info','Info'],['passed','Passed'],['content','Content'],['trust','Trust'],['policy','Policy'],['ux','UX'],['tech','Technical'],['perf','Performance']];
  var tabs='<div class="tabs" id="issue-tabs">'+filters.map(function(f,i){return '<button data-f="'+f[0]+'" class="'+(i===0?'active':'')+'">'+f[1]+'</button>';}).join('')+'</div>';
  var search='<input type="search" id="issue-search" class="text-input" placeholder="Search issues…" aria-label="Search issues">';
  return '<div class="audit-panel wide"><h3>Issue explorer</h3>'+tabs+search+'<div id="issue-list">'+renderIssues(r.findings,'all','')+'</div></div>';
}
function renderIssues(findings,f,q){
  q=(q||'').toLowerCase();
  var list=findings.filter(function(x){
    if(f!=='all'){
      if(['critical','high','medium','low','info','passed'].indexOf(f)>=0){if(x.status!==f)return false;}
      else if(x.category!==f)return false;
    }
    if(q){var hay=(x.name+' '+x.evidence+' '+x.fix+' '+x.page).toLowerCase();if(hay.indexOf(q)<0)return false;}
    return true;
  });
  if(!list.length)return '<p class="muted">No issues match this filter.</p>';
  // priority sort: critical, high, medium, low, info, passed
  var order={critical:0,high:1,medium:2,low:3,info:4,passed:5};
  list.sort(function(a,b){return (order[a.status]-order[b.status])||(b.confidence-a.confidence);});
  return list.slice(0,300).map(function(x){
    return '<div class="issue sev-'+x.status+'" data-status="'+x.status+'" data-cat="'+x.category+'"><span class="material-icons issue-icon">'+sevIcon(x.status)+'</span><div><h6>'+U.esc(x.name)+'</h6><div class="issue-meta"><b>'+U.esc(x.page)+'</b> · '+sevPill(x.status)+' · <span class="conf">confidence '+x.confidence+'%</span></div><p>'+U.esc(x.evidence)+'</p>'+(x.why?'<small class="why"><span>Why it matters</span> '+U.esc(x.why)+'</small>':'')+(x.fix?'<small class="fix"><span>Recommended action</span> '+U.esc(x.fix)+'</small>':'')+'</div></div>';
  }).join('');
}

function pageTable(r){
  var rows=r.allPages.map(function(p){
    var pa=p.parse,pt=r.ctx.pageType.get(p)||(p.error?'error':'other');
    var issues=r.findings.filter(function(f){return f.page===U.pathOf(p.url);}).length;
    var st=p.error?'err':p.status>=400?'err':p.status>=300?'redir':p.status===0?'unk':'ok';
    return '<tr data-url="'+U.esc(p.url)+'"><td class="pt-url" title="'+U.esc(p.url)+'">'+U.esc(U.pathOf(p.url))+'</td><td><span class="status-pill s-'+st+'">'+(p.error?'ERR':(p.status||'?'))+'</span></td><td>'+(pa?pa.wordCount:'—')+'</td><td>'+(pa?pa.titleLen?'<span class="badge low">'+pa.titleLen+'</span>':'<span class="badge high">missing</span>':'—')+'</td><td>'+(pa?(pa.h1.length===1?'<span class="badge passed">1</span>':'<span class="badge '+(pa.h1.length===0?'high':'low')+'">'+pa.h1.length+'</span>'):'—')+'</td><td>'+(pa?pa.internalLinks:'—')+'</td><td>'+issues+'</td><td><span class="badge low">'+U.esc(pt)+'</span></td></tr>';
  }).join('');
  return '<div class="audit-panel wide"><h3>Page-level report</h3><div class="page-table-wrap"><table class="page-table" id="page-table"><thead><tr><th data-k="path">URL</th><th data-k="status">Status</th><th data-k="words">Words</th><th data-k="title">Title</th><th data-k="h1">H1</th><th data-k="links">Int. links</th><th data-k="issues">Issues</th><th data-k="type">Type</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
}

function priorityFixes(r){
  var fix=r.findings.filter(function(f){return f.status==='critical'||f.status==='high'||f.status==='medium';})
    .sort(function(a,b){var o={critical:0,high:1,medium:2};return (o[a.status]-o[b.status])||(b.confidence-a.confidence);}).slice(0,12);
  if(!fix.length)return '<div class="priority passed"><b>No critical or high-priority issues detected</b><span>The measurable readiness signals look strong. Continue adding original content and keep trust pages current.</span></div>';
  return fix.map(function(f){
    var label={critical:'Critical — fix before applying',high:'High — strongly recommended',medium:'Medium — improvement recommended'}[f.status];
    return '<div class="priority '+f.status+'" data-status="'+f.status+'"><b>'+U.esc(f.name)+' · '+U.esc(f.page)+'</b><span>'+U.esc(label)+': '+U.esc(f.fix||f.evidence)+'</span></div>';
  }).join('');
}

function essentials(r){
  var e=r.ctx.essential;
  if(!e.length)return '';
  return '<div class="audit-panel"><h3>Essential pages detected</h3><div class="ad-trust-list">'+e.map(function(x){return '<div class="ad-trust-card"><span class="material-icons">verified</span><div><b>'+U.esc(x.label)+'</b><small>'+U.esc(U.pathOf(x.url))+' · '+x.confidence+'% confidence'+(x.linkedFromNav?' · linked in nav':'')+'</small></div></div>';}).join('')+'</div></div>';
}

function exportCSV(r){
  var rows=[['Category','Check','Severity','Page','Evidence','Confidence','Why it matters','How to fix']];
  r.findings.forEach(function(f){rows.push([f.category,f.name,f.status,f.page,f.evidence,f.confidence+'%',f.why||'',f.fix||'']);});
  var csv=rows.map(function(row){return row.map(function(v){return '"'+String(v).replace(/"/g,'""')+'"';}).join(',');}).join('\n');
  var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='adsense-eligibility.csv';a.click();URL.revokeObjectURL(a.href);
}
function copySummary(r){
  var s='AdSense Readiness Score: '+r.score.total+'/100 — '+r.score.verdict+'\n'+r.url+'\n';
  r.score.categories.forEach(function(c){s+='- '+c.label+': '+c.score+'/'+c.max+'\n';});
  navigator.clipboard&&navigator.clipboard.writeText(s);
  toast('Summary copied');
}
function printReport(){window.print();}
function toast(msg){var t=el('div','toast',msg);document.body.appendChild(t);setTimeout(function(){t.remove();},2600);}

function render(r){
  lastReport=r;
  var actions='<div class="report-actions"><button class="btn btn-small" id="rerun"><span class="material-icons">refresh</span>Re-run</button><button class="btn btn-small btn-secondary" id="csv"><span class="material-icons">download</span>CSV</button><button class="btn btn-small btn-secondary" id="print"><span class="material-icons">picture_as_pdf</span>PDF / Print</button><button class="btn btn-small btn-secondary" id="copy"><span class="material-icons">content_copy</span>Copy summary</button></div>';
  var priority='<div class="audit-panel top-panel"><h3>Priority fixes</h3><div class="priority-list">'+priorityFixes(r)+'</div></div>';
  out.innerHTML=actions+verdictBlock(r)+essentials(r)+categoryBreakdown(r)+'<div class="audit-grid refined">'+priority+'<div class="audit-panel fold-panel"><h3>Summary</h3><div class="insight-row">'+[
    ['Website type',r.ctx.siteType],['Crawl depth (avg/max)',r.arch.avgDepth+' / '+r.arch.maxDepth],['Sitemap URLs',r.arch.sitemapUrls],['Zero-internal-link pages',r.arch.zeroInternal],['Crawl errors',r.arch.errors],['Crawl limit reached',r.arch.reachedLimit?'yes':'no']
  ].map(function(x){return '<div class="insight-card"><span>'+U.esc(x[0])+'</span><b>'+U.esc(String(x[1]))+'</b></div>';}).join('')+'</div></div></div>'+issueExplorer(r)+pageTable(r)+'<p class="adsense-footnote">This is an automated assessment of publicly observable signals, not a guarantee of AdSense approval. Review the <a href="https://support.google.com/adsense/answer/9724" target="_blank" rel="noopener">Google AdSense eligibility requirements</a> before applying.</p>';
  document.getElementById('rerun').onclick=function(){form.requestSubmit();};
  document.getElementById('csv').onclick=function(){exportCSV(r);};
  document.getElementById('print').onclick=printReport;
  document.getElementById('copy').onclick=function(){copySummary(r);};
  var tabs=document.getElementById('issue-tabs'),search=document.getElementById('issue-search'),list=document.getElementById('issue-list');
  tabs.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;Array.prototype.forEach.call(tabs.querySelectorAll('button'),function(x){x.classList.remove('active');});b.classList.add('active');list.innerHTML=renderIssues(r.findings,b.dataset.f,search.value);});
  search.addEventListener('input',function(){var active=tabs.querySelector('button.active');list.innerHTML=renderIssues(r.findings,active.dataset.f,search.value);});
  // sortable page table
  var table=document.getElementById('page-table'),tbody=table.querySelector('tbody'),sortKey='path',sortDir=1;
  table.querySelectorAll('th').forEach(function(th){th.onclick=function(){var k=th.dataset.k;if(k===sortKey)sortDir=-sortDir;else{sortKey=k;sortDir=1;}sortTable(tbody,k,sortDir);};});
  out.scrollIntoView({behavior:'smooth',block:'start'});
}
function sortTable(tbody,key,dir){
  var idx={path:0,status:1,words:2,title:3,h1:4,links:5,issues:6,type:7}[key]||0;
  var rows=Array.prototype.slice.call(tbody.querySelectorAll('tr'));
  rows.sort(function(a,b){
    var av=cellText(a,idx),bv=cellText(b,idx);
    var an=parseInt(av,10),bn=parseInt(bv,10);
    if(!isNaN(an)&&!isNaN(bn)&&String(an)===av.trim()&&String(bn)===bv.trim())return dir*(an-bn);
    return dir*String(av).localeCompare(String(bv));
  });
  rows.forEach(function(r){tbody.appendChild(r);});
}
function cellText(tr,idx){var td=tr.querySelectorAll('td')[idx];return td?td.textContent.trim():'';}

form.addEventListener('submit',function(e){
  e.preventDefault();
  var url=urlInput.value.trim();if(!url)return;
  A._ctrl=new AbortController();
  progressUI({stage:'init',message:'Starting…'});
  A.runAudit(url,{limit:parseInt(limitSel.value,10)||50,signal:A._ctrl.signal,onProgress:function(s){progressUI(s);}})
    .then(render,errorUI)
    .then(function(){A._ctrl=null;});
});

// auto-run from ?url=
var qs=new URLSearchParams(location.search).get('url');
if(qs){urlInput.value=qs;form.requestSubmit();}
})(typeof window!=='undefined'?window:this);
