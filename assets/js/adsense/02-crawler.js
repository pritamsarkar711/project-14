/* huvanti AdSense checker, deterministic client-side crawler. */
(function (global) {
'use strict';
var A = global.Adsense = global.Adsense || {};
var U = A.util;

var MAX_BYTES = 6*1024*1024, TIMEOUT_MS = 12000;

function headersToObj(h){
  var o={}; if(!h) return o;
  if(h.forEach){ h.forEach(function(v,k){o[k.toLowerCase()]=v;}); }
  else { for(var i=0;i<h.length;i++) o[h[i][0].toLowerCase()]=h[i][1]; }
  return o;
}
function makeError(code,msg,cause){var e=new Error(msg);e.code=code;e.cause=cause;return e;}
function categorize(err,url){
  var m=String((err&&err.message)||err||'').toLowerCase();
  if(m.indexOf('failed to fetch')>=0||m.indexOf('networkerror')>=0||m.indexOf('load failed')>=0)
    return makeError('unreachable','Could not reach '+url+'. The site may be offline, blocking public readers, or behind a challenge page.',err);
  if(m.indexOf('ssl')>=0||m.indexOf('certificate')>=0) return makeError('ssl','SSL/TLS connection failed. Check the certificate and HTTPS setup.',err);
  if(m.indexOf('aborted')>=0||m.indexOf('timeout')>=0) return makeError('timeout','The request timed out. The server may be slow or rate-limiting.',err);
  if(m.indexOf('cloudflare')>=0||m.indexOf('just a moment')>=0||m.indexOf('cf-')>=0) return makeError('challenge','The site appears to be behind a Cloudflare/bot challenge and cannot be read automatically.',err);
  return makeError('fetch_failed','Could not read '+url+'.',err);
}

function fetchOnce(rawUrl, signal){
  var ctrl=new AbortController();
  var to=setTimeout(function(){ctrl.abort();},TIMEOUT_MS);
  if(signal) signal.addEventListener('abort',function(){ctrl.abort();},{once:true});
  // 1 direct
  return fetch(rawUrl,{redirect:'follow',signal:ctrl.signal,headers:{'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'}}).then(function(res){
    return res.arrayBuffer().then(function(buf){
      clearTimeout(to);
      if(buf.byteLength>MAX_BYTES) throw makeError('too_large','Response is too large to analyse.');
      var text=new TextDecoder('utf-8',{fatal:false}).decode(buf);
      return {url:rawUrl,finalUrl:res.url,status:res.status,ok:res.ok,redirected:res.redirected,headers:headersToObj(res.headers),text:text,via:'direct',ms:0,bytes:buf.byteLength,t0:performance.now()};
    });
  }).then(function(r){r.ms=Math.round(performance.now()-r.t0);delete r.t0;return r;}).catch(function(e){
    if(e&&e.code){clearTimeout(to);throw e;}
    if(signal&&signal.aborted){clearTimeout(to);throw e;}
    // 2 allorigins
    return fetch('https://api.allorigins.win/get?url='+encodeURIComponent(rawUrl),{signal:ctrl.signal}).then(function(res){return res.json();}).then(function(j){
      var text=j.contents||'';var h={};
      if(j.status){if(j.status.content_type)h['content-type']=j.status.content_type;if(j.status.content_length)h['content-length']=String(j.status.content_length);if(j.status.http_code)h[':http']=String(j.status.http_code);}
      clearTimeout(to);
      return {url:rawUrl,finalUrl:(j.status&&j.status.url)||rawUrl,status:(j.status&&j.status.http_code)||200,ok:((j.status&&j.status.http_code)||200)<400,redirected:false,headers:h,text:text,via:'allorigins',ms:null,bytes:text.length};
    }).catch(function(){
      if(signal&&signal.aborted){clearTimeout(to);throw new DOMException('aborted','AbortError');}
      // 3 corsproxy
      return fetch('https://corsproxy.io/?url='+encodeURIComponent(rawUrl),{signal:ctrl.signal}).then(function(res){return res.text().then(function(text){
        clearTimeout(to);
        return {url:rawUrl,finalUrl:rawUrl,status:res.ok?200:res.status,ok:res.ok,redirected:false,headers:headersToObj(res.headers),text:text,via:'corsproxy',ms:null,bytes:text.length};
      });}).catch(function(){
        if(signal&&signal.aborted){clearTimeout(to);throw new DOMException('aborted','AbortError');}
        // 4 codetabs
        return fetch('https://api.codetabs.com/v1/proxy/?quest='+encodeURIComponent(rawUrl),{signal:ctrl.signal}).then(function(res){return res.text().then(function(text){
          clearTimeout(to);
          if(/^[A-Za-z ]+Error/i.test(text.slice(0,100))) throw new Error(text.slice(0,100));
          return {url:rawUrl,finalUrl:rawUrl,status:res.ok?200:res.status,ok:res.ok,redirected:false,headers:{},text:text,via:'codetabs',ms:null,bytes:text.length};
        });}).catch(function(e){clearTimeout(to);throw categorize(e,rawUrl);});
      });
    });
  });
}
A.fetchText=function(url,opt){
  opt=opt||{};var signal=opt.signal,retries=opt.retries==null?1:opt.retries,last;
  function attempt(n){return fetchOnce(url,signal).catch(function(e){last=e;if(signal&&signal.aborted)throw e;if(['unreachable','ssl','challenge','invalid_url','too_large'].indexOf(e.code)>=0)throw e;if(n<retries)return new Promise(function(r){setTimeout(r,300*(n+1));}).then(function(){return attempt(n+1);});throw last;});}
  return attempt(0);
};

A.parseRobots=function(txt){
  var sitemaps=[],groups=[],cur=null;
  txt.split(/\r?\n/).forEach(function(line){
    var m;
    if((m=line.match(/^Sitemap:\s*(\S+)/i))){sitemaps.push(m[1].trim());return;}
    if((m=line.match(/^User-agent:\s*(.+)/i))){cur={agent:m[1].trim().toLowerCase(),disallow:[],allow:[]};groups.push(cur);return;}
    if(cur&&(m=line.match(/^Disallow:\s*(.*)/i))){cur.disallow.push(m[1].trim());return;}
    if(cur&&(m=line.match(/^Allow:\s*(.*)/i))){cur.allow.push(m[1].trim());return;}
  });
  return {txt:txt,sitemaps:sitemaps,groups:groups,blocksAll:groups.some(function(g){return g.agent==='*'&&g.disallow.some(function(d){return d==='/';});})};
};
function getRobots(origin,signal){return A.fetchText(origin+'/robots.txt',{signal:signal,retries:0}).then(function(r){return r.text||'';}).catch(function(){return '';});}
function readSitemap(loc,origin,signal,depth){
  depth=depth||0;if(depth>2)return Promise.resolve({urls:[],nested:[]});
  return A.fetchText(loc,{signal:signal,retries:0}).then(function(info){
    var txt=info.text||'';
    var urls=[],nested=[];var m;
    var re=/<loc>([^<]+)<\/loc>/gi;
    while((m=re.exec(txt))){var u=m[1].trim();if(U.sameSite(u,origin)&&!U.isAsset(u))urls.push(u);else if(/sitemap/i.test(u))nested.push(u);}
    return {urls:urls,nested:nested};
  }).catch(function(){return {urls:[],nested:[]};});
}

var PRIORITY=[[/about|who-we-are|our-story|company|team/i,100],[/contact|get-in-touch|reach/i,99],[/privacy/i,98],[/terms|conditions/i,97],[/disclaimer/i,96],[/cookie/i,95],[/editorial/i,94],[/blog|article|post|news|guide|tutorial|review/i,60],[/product|shop|pricing|plan/i,55],[/category|collection|topics/i,40],[/\/$/,80]];
function priorityOf(url){for(var i=0;i<PRIORITY.length;i++)if(PRIORITY[i][0].test(url))return PRIORITY[i][1];return 10;}

A.Crawler=function(startUrl,opt){
  opt=opt||{};
  if(!U.isPublicUrl(startUrl)) throw makeError('invalid_url','Please enter a valid public http(s) website URL.');
  this.start=U.normalizeUrl(startUrl);
  if(!this.start) throw makeError('invalid_url','Please enter a valid website URL.');
  this.origin=U.originOf(this.start);
  this.limit=U.clamp(parseInt(opt.limit,10)||50,1,250);
  this.concurrency=U.clamp(opt.concurrency||4,1,6);
  this.signal=opt.signal;this.onProgress=opt.onProgress||function(){};
  this.visited=new Set();this.queue=[];this.results=[];this.errors=[];
  this.robots=null;this.sitemapUrls=[];
};
A.Crawler.prototype.enqueue=function(url,depth){
  var n=U.normalizeUrl(url,this.origin);if(!n||!U.sameSite(n,this.origin)||U.isAsset(n)||this.visited.has(n))return;
  if(this.queue.some(function(q){return q.url===n;}))return;
  this.queue.push({url:n,priority:priorityOf(n),depth:depth});
};
A.Crawler.prototype.run=function(){
  var self=this;
  self.onProgress({stage:'robots',message:'Reading robots.txt…'});
  return getRobots(self.origin,self.signal).then(function(robotsTxt){
    self.robots=A.parseRobots(robotsTxt);
    self.onProgress({stage:'sitemap',message:'Discovering sitemap URLs…'});
    function seqSm(arr,i){
      if(i>=arr.length||(self.signal&&self.signal.aborted))return Promise.resolve();
      return readSitemap(arr[i],self.origin,self.signal).then(function(r){
        self.sitemapUrls.push.apply(self.sitemapUrls,r.urls);
        return r.nested.slice(0,2).reduce(function(p,n){return p.then(function(){return readSitemap(n,self.origin,self.signal,2).then(function(rr){self.sitemapUrls.push.apply(self.sitemapUrls,rr.urls);});});},Promise.resolve());
      }).then(function(){return seqSm(arr,i+1);});
    }
    return seqSm(self.robots.sitemaps.slice(0,5),0);
  }).then(function(){
    var seen={};self.sitemapUrls=self.sitemapUrls.filter(function(u){if(seen[u])return false;seen[u]=true;return !U.isAsset(u);});
    self.enqueue(self.start,0);self.sitemapUrls.forEach(function(u){self.enqueue(u,1);});
    function loop(){
      if(self.visited.size>=self.limit)return Promise.resolve();
      if(self.signal&&self.signal.aborted)throw makeError('cancelled','Audit cancelled.');
      self.queue.sort(function(a,b){return b.priority-a.priority||a.depth-b.depth;});
      var batch=[];
      while(batch.length<self.concurrency&&self.queue.length&&self.visited.size+batch.length<self.limit){
        var it=self.queue.shift();if(self.visited.has(it.url))continue;
        self.visited.add(it.url);batch.push(it);
      }
      if(!batch.length)return Promise.resolve();
      return Promise.all(batch.map(function(it){return self.crawlOne(it);})).then(function(){
        self.onProgress({stage:'crawler',message:'Crawled '+self.visited.size+' / '+self.limit+' pages…',crawled:self.visited.size,limit:self.limit});
        return loop();
      });
    }
    return loop();
  }).then(function(){
    return {start:self.start,origin:self.origin,limit:self.limit,robots:self.robots,sitemapUrls:self.sitemapUrls,pages:self.results,errors:self.errors,reachedLimit:self.queue.length>0||self.visited.size>=self.limit};
  });
};
A.Crawler.prototype.crawlOne=function(item){
  var self=this;
  return A.fetchText(item.url,{signal:self.signal,retries:1}).then(function(info){
    var ctype=info.headers['content-type']||'';
    if(ctype&&!U.isHtmlCtype(ctype)){self.results.push({url:item.url,status:info.status,finalUrl:info.finalUrl,depth:item.depth,skipped:true,reason:'non-html',via:info.via,ms:info.ms,headers:info.headers});return;}
    self.results.push({url:item.url,finalUrl:info.finalUrl||item.url,status:info.status,depth:item.depth,redirected:info.redirected,via:info.via,ms:info.ms,bytes:info.bytes,headers:info.headers,html:info.text,parse:null});
  }).catch(function(e){
    self.errors.push({url:item.url,code:e.code||'error',message:e.message});
    self.results.push({url:item.url,status:0,depth:item.depth,error:e.message,errorCode:e.code});
  });
};
})(typeof window!=='undefined'?window:this);
