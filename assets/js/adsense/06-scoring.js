/* huvanti AdSense checker — transparent, evidence-driven weighted scoring. */
(function (global) {
'use strict';
var A = global.Adsense = global.Adsense || {};

var CATEGORIES=[
  {key:'content',label:'Content Quality',weight:25},
  {key:'trust',label:'Trust & Transparency',weight:20},
  {key:'policy',label:'Policy Risk Signals',weight:20},
  {key:'ux',label:'User Experience',weight:15},
  {key:'tech',label:'Technical Quality',weight:10},
  {key:'perf',label:'Performance & Mobile',weight:10}
];
A.CATEGORIES=CATEGORIES;

function statusImpact(status){
  if(status==='passed')return 1;
  if(status==='low')return 0.85;
  if(status==='medium')return 0.55;
  if(status==='high')return 0.2;
  if(status==='critical')return 0;
  if(status==='info')return 0.75; // not measurable through proxy — neutral
  return 1;
}

// Per-category calculation. Combines:
//  - high-weight SITE-level ratio findings (dominant signal)
//  - per-page findings (aggregated so single issues have limited impact)
A.scoreCategory=function(catKey, findings, inventory){
  var def=CATEGORIES.filter(function(c){return c.key===catKey;})[0];
  var all=findings.filter(function(f){return f.category===catKey;});
  var items=all.filter(function(f){return f.status!=='info';});
  var w=function(f){return (A.RULES[f.id]?A.RULES[f.id].weight:3);};

  // Site-level ratio findings drive the bulk of the score for content/ux/policy.
  var siteRatioIds={CONTENT_WEAK_RATIO:1,CONTENT_DUP_RATIO:1,CONTENT_USEFUL_RATIO:1,
    CONTENT_PLACEHOLDER:1,CONTENT_SIMILAR_META:1,CONTENT_CANNIBAL:1,
    ARCH_ORPHAN:1,POLICY_FINDING:1,TECH_NOINDEX:1,TECH_MIXED:1,TRUST_CONTACT_INFO:1,TRUST_PLACEHOLDER:1};
  var ratioFindings=items.filter(function(f){return siteRatioIds[f.id]&&(f.page==='Site'||f.affected);});
  var ratioMax=ratioFindings.reduce(function(n,f){return n+w(f);},0);
  var ratioEarned=ratioFindings.reduce(function(n,f){
    var impact=statusImpact(f.status), conf=(f.confidence==null?100:f.confidence)/100;
    return n+w(f)*impact*conf;
  },0);
  var ratioPct=ratioMax?ratioEarned/ratioMax:null;

  // Per-page findings: count positive vs negative weighted items so one bad page
  // on a large site cannot dominate, but widespread issues do.
  var measurable=items.filter(function(f){return f.status!=='info'&&!siteRatioIds[f.id];});
  var neg=measurable.filter(function(f){return f.status!=='passed';});
  var pos=measurable.filter(function(f){return f.status==='passed';});
  var negW=neg.reduce(function(n,f){var impact=1-statusImpact(f.status),conf=(f.confidence==null?100:f.confidence)/100;return n+w(f)*impact*conf;},0);
  var posW=pos.reduce(function(n,f){return n+w(f);},0);
  var denom=posW+negW;
  // If nothing measurable exists (e.g. headers hidden by CORS), do not penalise —
  // the score is driven by the ratio/site-level findings only.
  var pagePct=denom?posW/denom:null;

  // Combine: ratio findings (70%) and per-page findings (30%).
  // If only per-page findings exist, a clean category with passed checks scores high
  // but is capped at 0.85 because absence of issues isn't proof of quality.
  var pct;
  if(ratioPct!=null&&pagePct!=null) pct=0.7*ratioPct+0.3*pagePct;
  else if(ratioPct!=null) pct=ratioPct;
  else if(pagePct!=null) pct=0.4+0.6*pagePct; // range 0.4 (all problems) .. 1.0 (all pass)
  else pct=0.65; // no measurable findings -> neutral baseline

  // Inventory-aware adjustments (content only)
  var capNote=null;
  if(catKey==='content'&&inventory){
    // If the crawl found very little genuine content, do not award full marks.
    if(inventory.contentPages===0){ pct=Math.min(pct,0.25); capNote='No article/content pages were found in the crawl.'; }
    else if(inventory.contentPages<3){ pct=Math.min(pct,0.55); capNote='Only '+inventory.contentPages+' content page(s) were found; a site needs several substantial pages.'; }
    else {
      if(inventory.usefulPct<35&&inventory.contentPages>=3){ pct=Math.min(pct,0.45); capNote='Only ~'+inventory.usefulPct+'% of content is substantial ('+inventory.useful+'/'+inventory.contentPages+').'; }
      else if(inventory.thinPct>=60){ pct=Math.min(pct,0.5); capNote=inventory.thinPct+'% of content pages are thin.'; }
      else if(inventory.dupPct>=40){ pct=Math.min(pct,0.55); capNote=inventory.dupPct+'% of pages are near-duplicates.'; }
    }
  }
  if(catKey==='content'&&inventory){
    if(inventory.contentPages>=3){
      if(inventory.usefulPct<20) pct=Math.min(pct,0.4), capNote='Only '+inventory.usefulPct+'% of content pages are substantial.';
      else if(inventory.thinPct>=50) pct=Math.min(pct,0.5), capNote=inventory.thinPct+'% of content pages are thin/empty.';
      else if(inventory.dupPct>=40) pct=Math.min(pct,0.5), capNote=inventory.dupPct+'% of pages are near-duplicates.';
    }
  }
  pct=A.util.clamp(pct,0,1);
  var score=Math.round(pct*def.weight);

  var lines=items.map(function(f){
    var ww=w(f),impact=statusImpact(f.status),conf=(f.confidence==null?100:f.confidence)/100;
    var delta=ww*(impact-1)*conf;
    return {id:f.id,name:f.name,status:f.status,weight:ww,delta:delta,confidence:f.confidence,evidence:f.evidence,fix:f.fix,why:f.why,page:f.page,severity:f.severity,affected:f.affected,tier:f.tier};
  });
  return {key:catKey,label:def.label,weight:def.weight,score:score,max:def.weight,pct:Math.round(pct*100),lines:lines,count:items.length,capNote:capNote,inventory:inventory};
};

A.scoreAll=function(findings,opts){
  opts=opts||{};
  var inventory=opts.inventory||null;
  var cats=CATEGORIES.map(function(c){return A.scoreCategory(c.key,findings,inventory);});
  var total=cats.reduce(function(n,c){return n+c.score;},0);
  var maxTotal=cats.reduce(function(n,c){return n+c.max;},0);
  var caps=[];
  var criticalPolicy=findings.some(function(f){return f.category==='policy'&&f.status==='critical';});
  var highPolicy=findings.filter(function(f){return f.category==='policy'&&f.status==='high';}).length;
  var noindexAll=findings.some(function(f){return f.id==='TECH_NOINDEX'&&f.page==='Site';});
  var httpsFail=findings.some(function(f){return f.id==='TECH_HTTPS'&&f.status!=='passed';});
  if(criticalPolicy){total=Math.min(total,20);caps.push('Critical policy-risk signal detected — score capped at 20 pending manual review.');}
  if(noindexAll){total=Math.min(total,10);caps.push('robots.txt blocks the entire site — score capped at 10.');}
  if(highPolicy>=3&&!criticalPolicy){total=Math.min(total,40);caps.push('Multiple high-severity policy-risk signals — score capped at 40.');}
  if(httpsFail){total=Math.min(total,Math.max(total-12,25));caps.push('Site is not served over HTTPS — 12-point penalty.');}
  if(inventory&&inventory.contentPages>=3){
    if(inventory.usefulPct<20){total=Math.min(total,40);caps.push('Fewer than 20% of content pages are useful — site appears thin overall.');}
    else if(inventory.thinPct>=60){total=Math.min(total,50);caps.push('Most content pages are thin — site needs more depth before applying.');}
  }
  total=A.util.clamp(Math.round(total),0,maxTotal);
  var verdict='Likely Ready',cls='ready';
  if(total<40){verdict='Not Ready';cls='notready';}
  else if(total<65){verdict='Needs Improvement';cls='improve';}
  else if(total<80){verdict='Almost Ready';cls='improve';}
  return {total:total,max:maxTotal,categories:cats,caps:caps,verdict:verdict,verdictClass:cls};
};

A.severityOf=function(f){
  if(f.status==='passed')return 'passed';
  if(f.status==='critical')return 'critical';
  if(f.status==='high')return 'high';
  if(f.status==='medium')return 'medium';
  if(f.status==='low')return 'low';
  if(f.status==='info')return 'info';
  return 'low';
};
})(typeof window!=='undefined'?window:this);
