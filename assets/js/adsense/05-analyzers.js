/* huvanti AdSense checker — per-category analyzers (deterministic). */
(function (global) {
'use strict';
var A = global.Adsense = global.Adsense || {};
var U = A.util, F = A.finding;

A.analyzeContent=function(pages,ctx){
  var out=[];var vocab=ctx.boilerplate;
  var contentPages=pages.filter(function(p){return p.parse&&(A.CONTENT_TYPES[ctx.pageType.get(p.url)]);});
  var targets=contentPages.length?contentPages:pages.filter(function(p){return p.parse;});
  // Duplicate, cannibalization and metadata comparisons are handled site-wide in analyzeSite.
  targets.forEach(function(p){
    var path=U.pathOf(p.url),pa=p.parse;if(!pa)return;
    var ptype=ctx.pageType.get(p);
    var uniq=[...U.uniqueAfter(pa.mainText,vocab)];
    var bp=U.boilerplateRatio(pa.visibleText,vocab);
    var topPhrase=U.repeatedPhrases(pa.mainText,{ngram:4,minCount:4,top:3});
    // repeated identical sentences within this page
    var sents=U.sentences(pa.mainText).map(function(x){return x.trim().toLowerCase();}).filter(function(x){return x.length>30;});
    var sentCounts={};var worstSent=null;sents.forEach(function(x){sentCounts[x]=(sentCounts[x]||0)+1;if(!worstSent||sentCounts[x]>worstSent.n)worstSent={s:x,n:sentCounts[x]};});
    if(worstSent&&worstSent.n>=6){out.push(F('CONTENT_REPEATED_BLOCK',path,'low','A sentence repeats '+worstSent.n+' times: "'+worstSent.s.slice(0,120)+'"','Highly repeated sentences look padded or auto-generated.','Rewrite to vary the wording.',0.65));}
    // Essential/utility pages (contact, privacy, terms, etc.) are naturally short and must not be flagged as thin.
    if(ptype==='essential'||ptype==='tool'||ptype==='category'||ptype==='product'){
      if(pa.wordCount>=20)out.push(F('CONTENT_GOOD_VOLUME',path,'passed',pa.wordCount+' words on a '+(ptype==='essential'?'trust/legal':ptype)+' page.','Short pages are normal for this page type and are not penalised.','Keep the information clear and complete.',0.8));
      return;
    }
    if(pa.wordCount<15||uniq.length<8){out.push(F('CONTENT_EMPTY',path,'high',pa.wordCount+' words, '+uniq.length+' unique words after template removal.','Pages with no real content give reviewers nothing to evaluate.','Add original, useful content before applying.',0.9));return;}
    var uniqRatio=pa.wordCount?uniq.length/pa.wordCount:0;
    if(uniq.length<45||(uniq.length<75&&uniqRatio<0.25)){
      out.push(F('CONTENT_THIN',path,'high',pa.wordCount+' total words, only '+uniq.length+' unique body-text words after removing shared template text'+(uniqRatio<0.25?' (repetition ratio '+(uniqRatio*100).toFixed(0)+'%)':'')+'.','Very little unique/original vocabulary is a common "low value content" rejection reason.','Add genuinely original information: detail, examples, data and structure rather than repeating the same phrases.',0.88));
    } else if(uniq.length<200&&pa.wordCount<400){
      if(uniq.length<75){out.push(F('CONTENT_THIN',path,'medium',uniq.length+' unique words across '+pa.wordCount+' total words.','Content is present but could be deeper.','Expand with useful detail, examples or FAQs.',0.7));}
    } else if(uniqRatio<0.15&&pa.wordCount>300){
      out.push(F('CONTENT_KEYWORD_STUFF',path,'medium','Only '+uniq.length+' unique words across '+pa.wordCount+' total words (vocabulary ratio '+(uniqRatio*100).toFixed(0)+'%).','Highly repetitive text reads as auto-generated or stuffed.','Vary wording, use synonyms and add original detail.',0.8));
      out.push(F('CONTENT_GOOD_VOLUME',path,'low',pa.wordCount+' words but repetitive.','Volume is present but originality is weak.','Diversify the vocabulary.',0.6));
    } else if(uniq.length>=120){
      out.push(F('CONTENT_GOOD_VOLUME',path,'passed',uniq.length+' unique words, '+pa.paragraphCount+' paragraphs.','Substantial original content is a strong readiness signal.','Keep content updated and accurate.',0.9));
    } else {
      out.push(F('CONTENT_GOOD_VOLUME',path,'low',uniq.length+' unique words.','Content exists but is short.','Add depth where relevant.',0.6));
    }
    if(bp>0.5){out.push(F('CONTENT_BOILERPLATE',path,'medium','~'+Math.round(bp*100)+'% of text appears shared across pages (nav/footer/sidebar).','Pages dominated by template text offer little unique value.','Reduce repeating blocks or move them out of main content.',0.75));}
    var ev=null;
    if(pa.keywords.length){
      var k=pa.keywords[0],density=k[1]/Math.max(1,pa.wordCount);
      var repH=(pa.h1.concat(pa.h2)).filter(function(h){return new RegExp('\\b'+k[0].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i').test(h);}).length;
      if((k[1]>=12&&density>0.04)||(topPhrase[0]&&topPhrase[0].count>=8)||(repH>=3&&k[1]>=8)){
        ev='"'+k[0]+'" appears '+k[1]+'x ('+(density*100).toFixed(1)+'% of words)'+(topPhrase[0]?'; phrase "'+topPhrase[0].phrase+'" appears '+topPhrase[0].count+'x':'');
      }
    }
    if(ev){out.push(F('CONTENT_KEYWORD_STUFF',path,'medium',ev,'Unnatural repetition is a poor-quality signal and can appear manipulative.','Use terms naturally; replace repetitions with synonyms.',0.8));}
    (topPhrase.filter(function(x){return x.count>=4;}).slice(0,2)).forEach(function(tp){out.push(F('CONTENT_REPEATED',path,'low','Phrase "'+tp.phrase+'" appears '+tp.count+'x','Repeated blocks can read as auto-generated.','Vary phrasing or reduce repeats.',0.6));});
    if(pa.headingsCount===0){out.push(F('CONTENT_HEADINGS',path,'medium','No headings found.','Headings make content scannable.','Add descriptive H2/H3 sections.',0.8));}
    else if(pa.h1.length!==1){out.push(F('CONTENT_HEADINGS',path,'low',pa.h1.length+' H1 tag(s)','Use a single clear H1.','Keep exactly one H1 per page.',0.7));}
    var fre=U.fleschReadingEase(pa.mainText);
    if(fre!==null&&fre<40){out.push(F('CONTENT_READABILITY',path,'low','Flesch '+Math.round(fre)+'/100 (FK grade '+U.fleschKincaidGrade(pa.mainText)+', Fog '+U.gunningFog(pa.mainText)+', ARI '+U.automatedReadabilityIndex(pa.mainText)+')','Readability is a quality signal, not an official requirement.','Shorten sentences and simplify dense passages.',0.6));}
  });
  return out;
};

A.analyzeTrust=function(pages,ctx){
  var out=[];var have={};ctx.essential.forEach(function(e){have[e.key]=e;});
  var need=[['about','TRUST_ABOUT'],['contact','TRUST_CONTACT'],['privacy','TRUST_PRIVACY'],['terms','TRUST_TERMS'],['disclaimer','TRUST_DISCLAIMER']];
  need.forEach(function(n){
    var ek=n[0],fid=n[1],e=have[ek];
    if(e){
      out.push(F(fid,U.pathOf(e.url),'passed','Detected · confidence '+e.confidence+'% · '+(e.linkedFromNav?'linked from navigation':'not clearly linked from nav'),'A clear '+e.label+' page signals transparency.','Keep it accurate, current and easy to find.',e.confidence/100));
      if(!e.linkedFromNav)out.push(F('TRUST_LINKED',U.pathOf(e.url),'medium',e.label+' exists but was not found in main navigation/footer.','Trust pages should be one click away.','Link it from the footer or menu.',0.7));
    } else {
      var r=A.RULES[fid];
      out.push(F(fid,'Site',r.severity==='high'?'high':'medium','No '+r.name.toLowerCase()+' detected.','A clear '+r.name.toLowerCase()+' is a basic trust signal reviewers look for.','Add a real, substantive '+r.name.toLowerCase()+' page and link it site-wide.',0.9));
    }
  });
  if(!have.cookie){out.push(F('TRUST_DISCLAIMER','Site','low','No cookie policy detected.','A cookie policy is expected when using cookies/ads.','Add a cookie notice/policy before running ads.',0.5));}
  var articles=pages.filter(function(p){return A.CONTENT_TYPES[ctx.pageType.get(p.url)];});
  if(articles.length){
    var withA=articles.filter(function(p){return (p.parse&&p.parse.author||'').length>=2;});
    if(withA.length<Math.ceil(articles.length*0.5))out.push(F('TRUST_AUTHOR','Site','low',withA.length+'/'+articles.length+' articles show a clear author byline.','Bylines and bios build E-E-A-T.','Add real author names with short bios.',0.7));
    else out.push(F('TRUST_AUTHOR','Site','passed',withA.length+'/'+articles.length+' articles have bylines.','Visible authorship supports transparency.','Link bylines to author pages.',0.85));
  }
  var hasOrg=pages.some(function(p){return p.parse&&((p.parse.schemaTypes||[]).indexOf('Organization')>=0||/[@]|\+?\d[\d \-()]{7,}/.test((p.parse.mainText||'').slice(0,1500)));});
  out.push(F('TRUST_ORG','Site',hasOrg?'passed':'low',hasOrg?'Organisation contact/identity detected.':'No clear organisation identity or contact details detected.','Visible identity and contact details increase trust.','Add a legal name, email and/or phone on the contact page.',hasOrg?0.85:0.6));
  return out;
};

A.analyzePolicy=function(pages){
  return A.scanPolicy(pages).map(function(f){
    return F('POLICY_FINDING',f.page,f.severity==='critical'?'critical':f.severity,f.label+': '+f.evidence+'. Context: "'+(f.context[0]||'').slice(0,140)+'"','This is a transparent rule-based screen of public content — it is NOT an official Google policy determination.','Review flagged content against Google Publisher Policies and remove/restrict as appropriate.',f.confidence/100,{policyCat:f.cat});
  });
};

A.analyzeUX=function(pages,ctx){
  var out=[];
  pages.forEach(function(p){
    if(!p.parse)return;
    var path=U.pathOf(p.url),pa=p.parse;
    out.push(F('UX_VIEWPORT',path,/width=device-width/i.test(pa.viewport)?'passed':(/user-scalable=no/.test(pa.viewport)?'medium':'high'),pa.viewport||'No viewport meta tag.','A mobile viewport is required for a usable mobile experience.','Add <meta name="viewport" content="width=device-width, initial-scale=1">.',0.95));
    out.push(F('UX_RESPONSIVE',path,pa.mediaQueries>0?'passed':'low',pa.mediaQueries?pa.mediaQueries+' responsive media queries found.':'No @media rules detected.','Responsive layout serves mobile visitors.','Use responsive CSS.',0.7));
    out.push(F('UX_NAV',path,pa.hasNav?'passed':'high',pa.hasNav?'Navigation detected.':'No <nav> or navigation landmark found.','Navigation is essential for a usable site.','Add an accessible main navigation.',0.9));
    out.push(F('UX_FOOTER',path,pa.hasFooter?'passed':'low',pa.hasFooter?'Footer detected.':'No footer landmark found.','A footer carries trust links.','Add a footer with policy links.',0.7));
    if(pa.popups>0||pa.fixedFull>0)out.push(F('UX_POPUP',path,'medium',pa.popups+' popup/modal element(s), '+pa.fixedFull+' fixed full-screen container(s).','Intrusive interstitials hurt UX and are a policy risk.','Remove full-screen popups blocking content.',0.6));
    if(pa.autoplay>0)out.push(F('UX_AUTOPLAY',path,'low',pa.autoplay+' autoplaying media element(s).','Autoplay media annoys users and increases bounce.','Require a user gesture before playing media.',0.7));
    var adCount=pa.adScripts+pa.adIframes+pa.adSlots;
    if(adCount>0){
      var ratio=pa.wordCount?adCount/(pa.wordCount/300):99;
      if(pa.wordCount<200&&adCount>=2)out.push(F('UX_AD_DENSITY',path,'high','~'+adCount+' ad slot(s) on a '+pa.wordCount+'-word page.','Ads must not exceed content; ad-heavy thin pages violate policies.','Add more content and reduce above-the-fold ads.',0.8));
      else if(ratio>2)out.push(F('UX_AD_DENSITY',path,'medium','~'+adCount+' ad signals per 300 words.','High ad-to-content ratio creates a poor experience.','Balance ads with original content.',0.7));
      else out.push(F('UX_AD_DENSITY',path,'passed',adCount+' ad signal(s), '+pa.wordCount+' words.','Ad density looks proportional.','Ensure ads do not mimic navigation/content.',0.8));
    }
    (pa.links||[]).filter(function(l){return l.internal&&(ctx.urlStatus.get(l.href)||0)>=400;}).slice(0,10).forEach(function(l){
      out.push(F('UX_BROKEN_LINK',path,'high','Link to '+U.pathOf(l.href)+' returns '+ctx.urlStatus.get(l.href)+'.','Broken links hurt UX and crawl quality.','Fix or remove the link.',0.9));
    });
    // internal links that point to a redirecting URL
    (pa.links||[]).filter(function(l){return l.internal&&ctx.redirectedUrls&&ctx.redirectedUrls.has(l.href);}).slice(0,10).forEach(function(l){
      out.push(F('TECH_REDIRECT',path,'low','Internal link to '+U.pathOf(l.href)+' resolves through a redirect.','Redirects add unnecessary latency and crawl hops.','Update the link to point directly to the final URL.',0.7));
    });
  });
  return out;
};

A.analyzeTech=function(pages,ctx){
  var out=[];var start=ctx.start;
  out.push(F('TECH_HTTPS','Site',/^https:/.test(start)?'passed':'high',/^https:/.test(start)?'Site served over HTTPS.':'Site entered over HTTP.','HTTPS is required for trust and many ad features.','Install an SSL certificate and redirect to HTTPS.',0.99));
  if(ctx.robots.blocksAll)out.push(F('TECH_NOINDEX','Site','critical','robots.txt uses "Disallow: /".','Blocking all crawlers means the site cannot be indexed or reviewed.','Remove the global disallow before applying.',0.99));
  out.push(F('TECH_ROBOTS','Site',ctx.robots.txt.length?'passed':'low',ctx.robots.txt.length?'robots.txt found.':'No robots.txt found.','robots.txt is recommended.','Add a robots.txt referencing your sitemap.',0.8));
  out.push(F('TECH_SITEMAP','Site',ctx.sitemapUrls.length?'passed':'low',ctx.sitemapUrls.length?ctx.sitemapUrls.length+' sitemap URL(s) discovered.':'No XML sitemap referenced.','A sitemap helps discovery.','Add an XML sitemap and reference it in robots.txt.',0.8));
  pages.forEach(function(p){
    var path=U.pathOf(p.url);
    if(p.error){out.push(F('TECH_STATUS',path,'high','Could not read page: '+p.error+'.','Unreachable pages cannot be reviewed.','Fix server/connectivity issues.',0.7));return;}
    if(p.status>=500)out.push(F('TECH_STATUS',path,'high','HTTP '+p.status+' server error.','Server errors block review.','Fix the server error.',0.95));
    else if(p.status>=400)out.push(F('TECH_STATUS',path,'high','HTTP '+p.status+' not found.','Broken pages hurt readiness.','Restore or 301-redirect the URL.',0.95));
    else if(p.redirected)out.push(F('TECH_REDIRECT',path,'low','Page redirects to '+U.pathOf(p.finalUrl)+'.','Redirects add latency.','Link directly to the final URL.',0.7));
    else if(p.via==='direct')out.push(F('TECH_STATUS',path,'passed','HTTP '+(p.status||200)+'.','200 response for a crawlable page.','',1));
    else out.push(F('TECH_STATUS',path,'info','Readable via '+p.via+' (exact HTTP status not exposed by the reader).','The content was readable; verify the exact status code directly.','Check the live status in Search Console or a header checker.',0.5));
    var pa=p.parse;if(!pa)return;
    if(pa.noindex)out.push(F('TECH_NOINDEX',path,'critical','Page carries noindex (meta robots or X-Robots-Tag).','Noindexed pages cannot be indexed or monetised.','Remove noindex on pages that should appear.',0.95));
    out.push(F('TECH_CANONICAL',path,pa.canonical?'passed':'low',pa.canonical?('Canonical: '+pa.canonical.slice(0,80)):'No canonical tag.','Canonical prevents duplicate-content issues.','Add a self-referencing canonical.',pa.canonical?0.8:0.7));
    out.push(F('TECH_TITLE',path,!pa.title?'high':((pa.titleLen<20||pa.titleLen>65)?'low':'passed'),pa.title?(pa.titleLen+' chars: '+pa.title.slice(0,70)):'Missing <title>.','Titles are a fundamental quality signal.','Write a unique 30–60 character title.',pa.title?0.9:0.9));
    out.push(F('TECH_DESC',path,!pa.desc?'low':((pa.descLen<80||pa.descLen>170)?'low':'passed'),pa.desc?(pa.descLen+' chars'):'No meta description.','Descriptions improve snippets/CTR.','Write a unique 120–160 char description.',pa.desc?0.7:0.7));
    out.push(F('TECH_H1',path,pa.h1.length===1?'passed':(pa.h1.length===0?'high':'low'),pa.h1.length+' H1 tag(s).','One clear H1 establishes topic.','Use exactly one descriptive H1.',0.9));
    if(p.url.length>90)out.push(F('TECH_URL',path,'low','URL is '+p.url.length+' characters.','Long URLs are harder to share.','Keep URLs short and descriptive.',0.7));
  });
  return out;
};

A.analyzePerf=function(pages){
  var out=[];
  var direct=pages.filter(function(p){return !p.error&&p.via==='direct'&&p.ms;});
  direct.forEach(function(p){
    var path=U.pathOf(p.url);
    out.push(F('PERF_TTFB',path,p.ms<600?'passed':(p.ms<1500?'medium':'high'),p.ms+' ms response time.','Slow time-to-first-byte delays every other metric.','Optimise hosting, database and caching.',0.8));
  });
  if(!direct.length)out.push(F('PERF_TTFB','Site','info','TTFB not measurable through the available CORS reader.','Direct header access is needed to measure server response time.','Check TTFB with PageSpeed Insights.',0.5));
  pages.forEach(function(p){
    if(!p.parse)return;
    var path=U.pathOf(p.url),pa=p.parse,kb=p.bytes?Math.round(p.bytes/1024):0;
    if(kb>500)out.push(F('PERF_SIZE',path,'medium',kb+' KB HTML document.','A large HTML document slows parsing.','Reduce inline markup and lazy-load below-the-fold content.',0.7));
    else if(kb)out.push(F('PERF_SIZE',path,'passed',kb+' KB HTML.','Reasonable HTML size.','',0.7));
    if(pa.blockingHeadScripts>0)out.push(F('PERF_RENDER_BLOCK',path,'medium',pa.blockingHeadScripts+' render-blocking script(s) in <head>.','Blocking scripts delay rendering.','Use defer/async or move scripts to the end of body.',0.8));
    else if(pa.headStylesheets<=3)out.push(F('PERF_RENDER_BLOCK',path,'passed','No blocking head scripts.','Render path is not blocked by head scripts.','',0.7));
    if(p.via==='direct'){
      var enc=(p.headers&&p.headers['content-encoding'])||'';
      out.push(F('PERF_COMPRESS',path,/gzip|br|deflate/i.test(enc)?'passed':'low',enc?('Content-encoding: '+enc):'No compression detected.','Gzip/Brotli shrinks HTML/CSS/JS.','Enable Brotli or gzip.',enc?0.8:0.6));
      var cc=(p.headers&&p.headers['cache-control'])||'';
      out.push(F('PERF_CACHE',path,cc?'passed':'low',cc||'No cache-control header seen.','Cache headers let browsers reuse assets.','Set Cache-Control for static assets.',cc?0.7:0.6));
    } else {
      out.push(F('PERF_COMPRESS',path,'info','Compression header not visible through the CORS reader.','Response headers are needed to verify gzip/Brotli.','Check compression in PageSpeed Insights.',0.4));
      out.push(F('PERF_CACHE',path,'info','Cache-control header not visible through the CORS reader.','Response headers are needed to verify caching.','Check caching in PageSpeed Insights.',0.4));
    }
    if(pa.externalScripts.length>8)out.push(F('PERF_THIRD_PARTY',path,'low',pa.externalScripts.length+' external script hosts.','Third-party scripts can slow the page.','Audit and defer non-essential third parties.',0.6));
  });
  return out;
};
})(typeof window!=='undefined'?window:this);
