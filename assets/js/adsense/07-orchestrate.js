/* huvanti AdSense checker — orchestration: crawl, parse, analyze (page + site), score. */
(function (global) {
'use strict';
var A = global.Adsense = global.Adsense || {};
var U = A.util;

A.runAudit=function(rawUrl,opt){
  opt=opt||{};var onProgress=opt.onProgress||function(){},signal=opt.signal;
  var limit=opt.limit||50;
  onProgress({stage:'init',message:'Validating URL…'});
  if(!U.isPublicUrl(rawUrl))return Promise.reject({code:'invalid_url',message:'Please enter a valid public http(s) website URL.'});
  onProgress({stage:'crawler',message:'Opening website…'});
  var crawler=new A.Crawler(rawUrl,{limit:limit,concurrency:4,signal:signal,onProgress:onProgress});
  return crawler.run().then(function(scan){
    onProgress({stage:'parse',message:'Parsing pages…'});
    scan.pages.forEach(function(p){if(!p.error&&!p.skipped){try{A.parsePage(p);}catch(e){p.error='Parse error: '+e.message;}}});
    var parsed=scan.pages.filter(function(p){return p.parse&&!p.error;});
    if(!parsed.length){
      var err=(scan.errors[0]&&scan.errors[0].message)||'No readable HTML pages were found.';
      var code=(scan.errors[0]&&scan.errors[0].code)||'empty';
      return Promise.reject({code:code,message:err,pages:scan.pages.length});
    }
    onProgress({stage:'analyze',message:'Analyzing content, trust, policy, UX & technical signals…'});
    var boilerplateVocab=A.buildBoilerplateVocab(parsed);
    var essential=A.detectEssential(parsed);
    var essentialKeyByUrl=new Map();
    essential.forEach(function(e){essentialKeyByUrl.set(e.url,e.key);});
    var pageType=new Map();
    parsed.forEach(function(p){pageType.set(p.url,A.classifyPage(p,essentialKeyByUrl));});
    var urlStatus=new Map();
    var redirectedUrls=new Set();
    scan.pages.forEach(function(p){if(p.url){urlStatus.set(p.url,p.status||0);if(p.redirected)redirectedUrls.add(p.url);}});
    var ctx={
      start:scan.start,origin:scan.origin,robots:scan.robots,sitemapUrls:scan.sitemapUrls,
      boiler:boilerplateVocab,essential:essential,essentialKeyByUrl:essentialKeyByUrl,pageType:pageType,
      urlStatus:urlStatus,redirectedUrls:redirectedUrls,siteType:A.detectSiteType(parsed)
    };
    var findings=[];
    findings=findings.concat(A.analyzeContent(parsed,ctx));
    findings=findings.concat(A.analyzeTrust(parsed,ctx));
    findings=findings.concat(A.analyzePolicy(parsed));
    findings=findings.concat(A.analyzeUX(parsed,ctx));
    findings=findings.concat(A.analyzeTech(parsed,ctx));
    findings=findings.concat(A.analyzePerf(parsed));
    onProgress({stage:'analyze',message:'Cross-page analysis: duplicates, architecture, orphan pages & patterns…'});
    var site=A.analyzeSite(parsed,ctx);
    findings=findings.concat(site.findings);
    onProgress({stage:'score',message:'Calculating readiness score…'});
    var score=A.scoreAll(findings,{inventory:site.inventory});
    var depths=site.graph?[...site.graph.depth.values()]:[];
    var arch={pages:scan.pages.length,parsed:parsed.length,errors:scan.errors.length,
      maxDepth:depths.length?Math.max.apply(null,depths):0,
      avgDepth:depths.length?U.round(depths.reduce(function(a,b){return a+b;},0)/depths.length,1):0,
      zeroInternal:parsed.filter(function(p){return p.parse.internalLinks===0;}).length,
      sitemapUrls:scan.sitemapUrls.length,reachedLimit:scan.reachedLimit,
      inventory:site.inventory};
    onProgress({stage:'done',message:'Done.'});
    return {url:scan.start,scan:scan,pages:parsed,allPages:scan.pages,findings:findings,score:score,ctx:ctx,arch:arch,inventory:site.inventory,graph:site.graph,generatedAt:new Date().toISOString()};
  });
};
})(typeof window!=='undefined'?window:this);
