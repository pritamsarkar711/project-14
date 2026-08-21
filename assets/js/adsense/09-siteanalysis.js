/* huvanti AdSense checker — site-wide / cross-page forensic analysis. */
(function (global) {
'use strict';
var A = global.Adsense = global.Adsense || {};
var U = A.util, F = A.finding;

function norm(u){ try{ return u.replace(/\/$/,''); }catch(e){ return u; } }
function contentTypes(ptype){ return ptype==='content'||ptype==='article'||ptype==='blog'; }

// Build the internal link graph and click-depth map.
function buildGraph(pages, ctx){
  var idx=new Map();
  pages.forEach(function(p){ if(p.parse) idx.set(norm(p.url),p); });
  var inLinks=new Map(), outLinks=new Map();
  pages.forEach(function(p){
    inLinks.set(norm(p.url),new Set()); outLinks.set(norm(p.url),new Set());
  });
  pages.forEach(function(p){
    if(!p.parse)return;
    var src=norm(p.url);
    p.parse.links.forEach(function(l){
      if(!l.internal)return;
      var key=norm(l.href);
      if(outLinks.has(src)) outLinks.get(src).add(key);
      if(inLinks.has(key)) inLinks.get(key).add(src);
    });
  });
  // click depth from the first (home) page
  var depth=new Map(), home=pages[0]?norm(pages[0].url):null, q=[];
  if(home){ depth.set(home,0); q.push(home); }
  while(q.length){
    var cur=q.shift(), d=depth.get(cur);
    var outs=outLinks.get(cur); if(!outs)continue;
    outs.forEach(function(t){
      if(!depth.has(t)&&idx.has(t)){ depth.set(t,d+1); q.push(t); }
    });
  }
  return {idx:idx,inLinks:inLinks,outLinks:outLinks,depth:depth,home:home};
}

// Cluster duplicate pairs into groups of near-duplicate pages.
function dupClusters(pairs){
  var parent={};
  function find(x){ parent[x]=parent[x]||x; if(parent[x]!==x)parent[x]=find(parent[x]); return parent[x]; }
  function union(a,b){var ra=find(a),rb=find(b);if(ra!==rb)parent[ra]=rb;}
  pairs.forEach(function(d){union(d.a.url,d.b.url);});
  var all=new Set();
  pairs.forEach(function(d){all.add(d.a.url);all.add(d.b.url);});
  var groups={};
  all.forEach(function(u){var r=find(u);(groups[r]=groups[r]||[]);if(groups[r].indexOf(u)<0)groups[r].push(u);});
  return Object.keys(groups).map(function(k){return groups[k];}).filter(function(g){return g.length>1;});
}

A.analyzeSite=function(pages, ctx){
  var findings=[], graph=buildGraph(pages,ctx);
  var parsed=pages.filter(function(p){return p.parse&&!p.error;});
  var contentPages=parsed.filter(function(p){return !!(A.CONTENT_TYPES[ctx.pageType.get(p.url)]);});

  /* ---------- Content inventory (weighted usefulness) ---------- */
  var thin=[], useful=[], empty=[], usefulness=0;
  var uniqByUrl={};
  contentPages.forEach(function(p){
    var pa=p.parse;
    var uniq=[...U.uniqueAfter(pa.mainText,ctx.boilerplate)];
    uniqByUrl[p.url]=uniq.length;
    if(pa.wordCount<15||uniq.length<8){ empty.push(p); usefulness+=0; }
    else if(uniq.length<45){ thin.push(p); usefulness+=0.15; }
    else if(uniq.length<75){ thin.push(p); usefulness+=0.5; if(uniq.length>=55)useful.push(p); }
    else { useful.push(p); usefulness+=1; }
  });
  var total=contentPages.length||parsed.length||1;
  var thinPct=Math.round((thin.length+empty.length)/total*100);
  var usefulPct=Math.round(usefulness/total*100);

  // duplicate pairs (content/article pages only) computed per-page; reuse by recomputing
  // Compare content articles plus any short/non-utility pages (placeholder farms)
  var dupTargets=contentPages.slice();
  parsed.forEach(function(p){ if(dupTargets.indexOf(p)>=0)return; var t=ctx.pageType.get(p.url); if(t&&A.UTILITY_TYPES[t])return; if(p.parse&&p.parse.wordCount<120) dupTargets.push(p); });
  var pairs=[];
  var sh=dupTargets.map(function(p){return {p:p,sh:U.shingles(p.parse.mainText.slice(0,6000)),hash:U.simHash(p.parse.mainText.slice(0,6000))};});
  for(var i=0;i<sh.length;i++)for(var j=i+1;j<sh.length;j++){
    var sim=U.jaccard(sh[i].sh,sh[j].sh), ham=U.hamming64(sh[i].hash,sh[j].hash);
    if(sim>=0.9||(sim>=0.75&&ham<=6)) pairs.push({a:sh[i].p,b:sh[j].p,sim:sim});
  }
  var clusters=dupClusters(pairs);
  var dupUrls={}; pairs.forEach(function(d){dupUrls[d.a.url]=1;dupUrls[d.b.url]=1;});
  var dupCount=Object.keys(dupUrls).length;
  var dupPct=Math.round(dupCount/(dupTargets.length||total)*100);

  if(contentPages.length>=2){
    if(usefulPct>=70) findings.push(F('CONTENT_USEFUL_RATIO','Site','passed',useful.length+' of '+contentPages.length+' content pages ('+usefulPct+'%) contain substantial unique content.','A high share of genuinely useful pages is the strongest readiness signal.','Maintain this depth across new content.',0.9));
    else if(usefulPct<35) findings.push(F('CONTENT_USEFUL_RATIO','Site','high','Only ~'+usefulPct+'% of content provides substantial unique content ('+useful.length+' of '+contentPages.length+' pages).','AdSense reviewers assess the site as a whole; a low share of useful pages undermines readiness regardless of a few strong pages.','Expand thin pages, consolidate low-value pages, or remove them.',0.85,{affected:useful.length+'/'+contentPages.length}));
    else if(usefulPct<65) findings.push(F('CONTENT_USEFUL_RATIO','Site','medium',useful.length+' of '+contentPages.length+' content pages ('+usefulPct+'%) are substantial; the rest are thin or short.','A majority of the site should provide real value.','Raise the useful-content ratio above 65%.',0.7,{affected:useful.length+'/'+contentPages.length}));

    if(thinPct>=60) findings.push(F('CONTENT_WEAK_RATIO','Site','high',(thin.length+empty.length)+' of '+contentPages.length+' content pages ('+thinPct+'%) are thin or empty.','Widespread thin content is a primary "low value content" reason and heavily affects the score.','Add original detail to most pages before applying.',0.9,{affected:thinPct+'%'}));
    else if(thinPct>=35) findings.push(F('CONTENT_WEAK_RATIO','Site','medium',thinPct+'% of content pages are thin ('+(thin.length+empty.length)+' of '+contentPages.length+').','A meaningful share of pages lack depth.','Improve the thinnest third of content.',0.7,{affected:thinPct+'%'}));
    else if(thin.length&&thinPct>=15) findings.push(F('CONTENT_WEAK_RATIO','Site','low',thin.length+' thin content page(s) out of '+contentPages.length+' ('+thinPct+'%).','Isolated thin pages have limited impact.','Expand them as time permits.',0.6,{affected:thin.length}));

    if(dupPct>=40) findings.push(F('CONTENT_DUP_RATIO','Site','high',dupCount+' pages ('+dupPct+'%) are near-duplicates of another page, across '+clusters.length+' cluster(s).','Widely duplicated content looks templated or scraped.','Consolidate or rewrite duplicates and use canonicals.',0.85,{affected:dupCount}));
    else if(dupCount) findings.push(F('CONTENT_DUP_RATIO','Site','low',dupCount+' page(s) resemble another page.','A small amount of duplication is usually acceptable.','Differentiate or canonicalise them.',0.6,{affected:dupCount}));
  }

  // Repeated paragraphs/sentences within a page (site rollup)
  var repeatPages=0, repeatExamples=[];
  contentPages.forEach(function(p){
    var sents=U.sentences(p.parse.mainText).map(function(x){return x.trim().toLowerCase();}).filter(function(x){return x.length>30;});
    var counts={}; var worst=null;
    sents.forEach(function(s){counts[s]=(counts[s]||0)+1;if(!worst||counts[s]>worst.n)worst={s:s,n:counts[s]};});
    if(worst&&worst.n>=5){repeatPages++;if(repeatExamples.length<3)repeatExamples.push(U.pathOf(p.url)+' ('+worst.n+'×)');}
  });
  if(repeatPages) findings.push(F('CONTENT_REPEATED_BLOCK','Site',repeatPages>2?'medium':'low',repeatPages+' page(s) repeat the same sentence 5+ times. Examples: '+repeatExamples.join('; ')+'.','Repeated blocks suggest auto-generated or padded content.','Remove or rewrite repeated passages.',0.7,{affected:repeatPages}));

  // Placeholder / lorem ipsum
  var lorem=parsed.filter(function(p){return p.parse.loremIpsum;});
  if(lorem.length) findings.push(F('CONTENT_PLACEHOLDER','Site','high',lorem.length+' page(s) contain placeholder text (e.g. "lorem ipsum").','Placeholder content signals an unfinished site.','Replace all placeholder copy before applying.',0.95,{affected:lorem.length}));

  // Duplicate titles / meta descriptions across content pages
  var titleGroups={}, descGroups={};
  contentPages.forEach(function(p){
    var t=(p.parse.title||'').trim().toLowerCase();
    var d=(p.parse.desc||'').trim().toLowerCase();
    if(t){(titleGroups[t]=titleGroups[t]||[]).push(p.url);}
    if(d){(descGroups[d]=descGroups[d]||[]).push(p.url);}
  });
  var dupTitleGroups=Object.keys(titleGroups).filter(function(k){return titleGroups[k].length>1;});
  var dupDescGroups=Object.keys(descGroups).filter(function(k){return descGroups[k].length>1;});
  if(dupTitleGroups.length) findings.push(F('TECH_DUP_TITLE','Site','medium',dupTitleGroups.length+' title(s) are reused across pages. Example: "'+(dupTitleGroups[0]||'').slice(0,60)+'" on '+titleGroups[dupTitleGroups[0]].length+' pages.','Duplicate titles split relevance and confuse SERPs.','Write a unique title for every page.',0.8,{affected:dupTitleGroups.length}));
  if(dupDescGroups.length>=3) findings.push(F('TECH_DUP_DESC','Site','low',dupDescGroups.length+' meta descriptions are reused.','Unique descriptions improve targeting and CTR.','Write unique 120–160 char descriptions.',0.6,{affected:dupDescGroups.length}));

  // Keyword/topic cannibalization: same top keyword on 2+ substantial pages
  var kwPages={};
  contentPages.forEach(function(p){
    if(p.parse.keywords[0]){var k=p.parse.keywords[0][0];(kwPages[k]=kwPages[k]||[]).push(p.url);}
  });
  var cann=Object.keys(kwPages).filter(function(k){return kwPages[k].length>=2;}).slice(0,5);
  if(cann.length) findings.push(F('CONTENT_CANNIBAL','Site','medium','Multiple pages target the same primary term: '+cann.map(function(k){return '"'+k+'" ('+kwPages[k].length+')';}).join('; ')+'.','Pages targeting the same topic compete against each other.','Consolidate or clearly differentiate intent.',0.7,{affected:cann.length}));

  /* ---------- Trust deep audit ---------- */
  // placeholder trust pages
  ctx.essential.forEach(function(e){
    var p=e.page&&e.page.parse;
    if(p&&p.wordCount<40&&['privacy','terms','disclaimer','editorial','about'].indexOf(e.key)>=0){
      findings.push(F('TRUST_PLACEHOLDER',U.pathOf(e.url),'medium',e.label+' page contains only '+p.wordCount+' words.','A policy/about page that is too short looks like a placeholder.','Add substantive, accurate information.',0.8,{confidence:e.confidence}));
    }
  });
  // broken links to trust pages
  ctx.essential.forEach(function(e){
    if((ctx.urlStatus.get(e.url)||0)>=400) findings.push(F('TRUST_BROKEN_TRUST_LINK',U.pathOf(e.url),'high',e.label+' URL returns HTTP '+ctx.urlStatus.get(e.url)+'.','A linked trust page that errors undermines credibility.','Fix the page or the link.',0.9));
  });
  // contact info present anywhere
  var hasEmail=parsed.some(function(p){return p.parse.contactEmail;});
  var hasPhone=parsed.some(function(p){return p.parse.contactPhone;});
  if(!hasEmail&&!hasPhone) findings.push(F('TRUST_CONTACT_INFO','Site','medium','No email address or phone number found in crawled page text.','Visible contact details are a basic trust signal.','Add a working email and/or phone on the contact page.',0.75));
  else findings.push(F('TRUST_CONTACT_INFO','Site','passed',hasEmail?('Email found'+(hasPhone?' and phone found':'')):'Phone found','Contact details are visible on the site.','Keep contact information current.',0.8));
  // site purpose clarity on home
  var home=pages[0]&&pages[0].parse;
  if(home&&home.wordCount<120&&!ctx.essential.some(function(e){return e.key==='about';})) findings.push(F('TRUST_PURPOSE','Site','low','Homepage has only '+home.wordCount+' words and no About page was detected.','Visitors and reviewers should quickly understand the site purpose.','Add a clear introduction and an About page.',0.6));

  /* ---------- Technical cross-page ---------- */
  parsed.forEach(function(p){
    var pa=p.parse, path=U.pathOf(p.url);
    if(pa.mixedResources&&pa.mixedResources.length) findings.push(F('TECH_MIXED',path,'high',pa.mixedResources.length+' resource(s) loaded over HTTP on an HTTPS page.','Mixed content breaks security and browsers block insecure assets.','Serve all resources over HTTPS.',0.9,{affected:pa.mixedResources.length,sample:pa.mixedResources.slice(0,3)}));
    if(pa.invalidLd&&pa.invalidLd.length) findings.push(F('TECH_SCHEMA_INVALID',path,'medium',pa.invalidLd.length+' invalid JSON-LD block(s).','Broken structured data is ignored and can hide entities.','Fix the JSON syntax.',0.9));
    if(pa.conflictingSchema&&pa.conflictingSchema.length) findings.push(F('TECH_SCHEMA_CONFLICT',path,'low','Duplicate top-level schema entities: '+pa.conflictingSchema.join(', ')+'.','Conflicting entities can confuse rich results.','Keep one primary entity per type.',0.6));
    if(pa.metaRefresh) findings.push(F('TECH_METAREFRESH',path,'low','Meta refresh redirect detected.','Meta refreshes are poor UX and discouraged.','Use a 301/302 server redirect instead.',0.7));
    if(pa.hreflangs&&pa.hreflangs.length){
      var hasXDefault=pa.hreflangs.some(function(h){return h.lang==='x-default';});
      var hasSelf=pa.hreflangs.some(function(h){return h.lang.toLowerCase()===(pa.lang||'').toLowerCase().slice(0,2);});
      if(!hasXDefault||!hasSelf) findings.push(F('TECH_HREFLANG',path,'low','Hreflang annotations missing '+(hasXDefault?'':'x-default ')+(hasSelf?'':'self-reference')+'.','Incomplete hreflang can misdirect regional users.','Add x-default and self-referencing annotations.',0.55));
    }
  });

  /* ---------- UX / architecture (link graph) ---------- */
  parsed.forEach(function(p){
    var pa=p.parse, path=U.pathOf(p.url);
    if(pa.emptyLinks) findings.push(F('UX_EMPTY_LINK',path,'medium',pa.emptyLinks+' link(s) with no text or accessible name.','Empty links are unusable for screen readers and look broken.','Add link text or an aria-label.',0.8,{affected:pa.emptyLinks}));
    if(pa.emptyButtons) findings.push(F('UX_EMPTY_BUTTON',path,'low',pa.emptyButtons+' button(s) with no label.','Unlabeled buttons hurt accessibility.','Add visible text or aria-label.',0.7,{affected:pa.emptyButtons}));
    if(pa.links&&pa.links.length>250) findings.push(F('ARCH_OVERLINKED',path,'low',pa.links.length+' links on one page.','Excessive links dilute authority and look spammy.','Reduce to useful navigation/content links.',0.6));
    // anchor problems on internal links
    var empties=pa.links.filter(function(l){return l.internal&&l.empty;});
    var anchors={}; pa.links.forEach(function(l){if(l.internal&&l.text){anchors[l.text]=(anchors[l.text]||0)+1;}});
    var repAnchor=Object.keys(anchors).filter(function(a){return anchors[a]>=5;});
    if(empties.length>=3) findings.push(F('ARCH_ANCHOR',path,'low',empties.length+' internal links have empty anchor text.','Descriptive anchors help crawlers and users.','Add descriptive anchor text.',0.65));
    else if(repAnchor.length) findings.push(F('ARCH_ANCHOR',path,'low','Repeated anchor text "'+repAnchor[0]+'" used '+anchors[repAnchor[0]]+' times.','Over-identical anchors can look manipulative.','Vary anchor text naturally.',0.55));
  });

  // graph-level
  parsed.forEach(function(p){
    var path=U.pathOf(p.url);
    var ins=graph.inLinks.get(norm(p.url)), outs=graph.outLinks.get(norm(p.url));
    var inCount=ins?ins.size:0, outCount=outs?outs.size:0;
    if(norm(p.url)!==norm(graph.home)&&inCount===0){
      // orphan: only credible if not reached AND (in sitemap or several pages crawled)
      var inSitemap=ctx.sitemapUrls.indexOf(p.url)>=0;
      if(inSitemap||parsed.length>5) findings.push(F('ARCH_ORPHAN',path,'high','No internal links point to this page'+(inSitemap?' (listed in sitemap)':'')+'.','Orphan pages receive little authority and are hard to discover.','Link to it from relevant content or remove it.',0.8));
    } else if(inCount===1) findings.push(F('ARCH_SINGLE_PATH',path,'low','Only one internal link points to this page.','Pages reached by a single path are weakly supported.','Add contextual internal links.',0.55));
    if(outCount===0&&ctx.pageType.get(p.url)!=='product') findings.push(F('ARCH_DEAD_END',path,'medium','Page has no internal links to other pages.','Dead-end pages trap crawlers and users.','Add links to related content.',0.7));
    var d=graph.depth.get(norm(p.url));
    if(d!=null&&d>3) findings.push(F('UX_DEEP_PAGE',path,'low','Page is '+d+' clicks from the homepage.','Deep pages get less authority and crawl attention.','Flatten the architecture or link higher.',0.6));
  });

  // redirecting internal links (from parser links to redirectedUrls)
  var redirectLinks=0;
  parsed.forEach(function(p){(p.parse.links||[]).forEach(function(l){if(l.internal&&ctx.redirectedUrls&&ctx.redirectedUrls.has(l.href))redirectLinks++;});});
  if(redirectLinks) findings.push(F('ARCH_REDIRECT_LINK','Site','low',redirectLinks+' internal link(s) point to a URL that redirects.','Redirects add crawl hops and latency.','Update links to the final URL.',0.6,{affected:redirectLinks}));

  var inventory={
    total:parsed.length, contentPages:contentPages.length, thin:thin.length, empty:empty.length,
    useful:useful.length, duplicatePages:dupCount, duplicateClusters:clusters.length,
    usefulPct:usefulPct, thinPct:thinPct, dupPct:dupPct,
    avgDepth: graph.depth.size? U.round([...graph.depth.values()].reduce(function(a,b){return a+b;},0)/graph.depth.size,1):0,
    maxDepth: graph.depth.size? Math.max.apply(null,[...graph.depth.values()]):0,
    orphans: findings.filter(function(f){return f.id==='ARCH_ORPHAN';}).length
  };
  return {findings:findings, inventory:inventory, graph:graph};
};
})(typeof window!=='undefined'?window:this);
