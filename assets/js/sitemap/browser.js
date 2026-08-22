/* Browser fallback for XML Sitemap Generator: direct CORS fetch -> public relays.
 * Used only when server-side egress/TLS is unavailable. Deterministic, no AI/API keys.
 */
(function(global){'use strict';
var B = global.SitemapBrowserRunner = {};
var RETRY=[401,403,429,500,502,503,504], MAX_FETCHES=80, fetches=0;
var PRIVATE=/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|\[?:1\]?|fc00:|fd[0-9a-f]{2}:|fe80:|metadata\.google\.internal)/i;
function err(code,msg){var e=new Error(msg);e.code=code;return e;}
function esc(s){return String(s).replace(/[&<>'"]/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&apos;','"':'&quot;'}[m];});}
function input(raw){var s=String(raw||'').trim().replace(/\s+/g,''); if(!s)throw err('invalid_url','Please enter a website URL.'); if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(s))s='https://'+s; var u; try{u=new URL(s);}catch(e){throw err('invalid_url','Please enter a valid public URL.');} if(!/^https?:$/.test(u.protocol))throw err('invalid_url','Only HTTP and HTTPS URLs are supported.'); if(u.username||u.password)throw err('invalid_url','URLs with credentials are not allowed.'); if(PRIVATE.test(u.hostname)||/\.(local|internal|lan|home|localhost)$/i.test(u.hostname))throw err('ssrf','Private or local addresses cannot be scanned.'); u.hash=''; return u;}
function norm(raw,base){try{var u=new URL(raw,base); if(!/^https?:$/.test(u.protocol))return null; u.hash=''; u.hostname=u.hostname.toLowerCase(); if((u.protocol==='https:'&&u.port==='443')||(u.protocol==='http:'&&u.port==='80'))u.port=''; return u.toString();}catch(e){return null;}}
function hostKey(h){return String(h||'').toLowerCase().replace(/^www\./,'');}
function internal(url,root,subs){try{var a=new URL(url).hostname.toLowerCase(), b=new URL(root).hostname.toLowerCase(); return hostKey(a)===hostKey(b) || (!!subs && a.endsWith('.'+hostKey(b)));}catch(e){return false;}}
function key(url){var u=new URL(url); u.hash=''; u.hostname=hostKey(u.hostname); return u.toString().replace(/\/$/,'');}
function timeout(ms,signal){var c=new AbortController(), t=setTimeout(function(){c.abort();},ms||10000); if(signal)signal.addEventListener('abort',function(){c.abort();},{once:true}); return {signal:c.signal, done:function(){clearTimeout(t);}};}
function direct(url,opt){var t=timeout(10000,opt.signal); return fetch(url,{redirect:'follow',signal:t.signal,headers:{accept:opt.accept||'text/html,application/xml,text/xml,*/*;q=0.5'}}).then(function(r){return r.text().then(function(tx){t.done();return {status:r.status,text:tx,finalUrl:r.url||url,headers:{'content-type':r.headers.get('content-type')||''},via:'direct'};});}).catch(function(e){t.done();throw e;});}
function allorigins(url,opt){var t=timeout(12000,opt.signal); return fetch('https://api.allorigins.win/get?url='+encodeURIComponent(url),{signal:t.signal}).then(function(r){return r.json();}).then(function(j){t.done();return {status:(j.status&&j.status.http_code)||200,text:j.contents||'',finalUrl:(j.status&&j.status.url)||url,headers:{'content-type':(j.status&&j.status.content_type)||''},via:'allorigins'};}).catch(function(e){t.done();throw e;});}
function corsproxy(url,opt){var t=timeout(12000,opt.signal); return fetch('https://corsproxy.io/?url='+encodeURIComponent(url),{signal:t.signal}).then(function(r){return r.text().then(function(tx){t.done();return {status:r.status,text:tx,finalUrl:url,headers:{},via:'corsproxy'};});}).catch(function(e){t.done();throw e;});}
function codetabs(url,opt){var t=timeout(12000,opt.signal); return fetch('https://api.codetabs.com/v1/proxy/?quest='+encodeURIComponent(url),{signal:t.signal}).then(function(r){return r.text().then(function(tx){t.done();return {status:r.status,text:tx,finalUrl:url,headers:{},via:'codetabs'};});}).catch(function(e){t.done();throw e;});}
function jina(url,opt){var t=timeout(16000,opt.signal); return fetch('https://r.jina.ai/'+url,{signal:t.signal,headers:{'X-Return-Format':'markdown'}}).then(function(r){return r.text().then(function(tx){t.done();return {status:r.status,text:tx,finalUrl:url,headers:{'content-type':'text/markdown'},via:'jina'};});}).catch(function(e){t.done();throw e;});}
var transports=[direct,allorigins,corsproxy,codetabs,jina];
function challenge(text){return /just a moment|attention required|cf-browser-verification|challenge-platform|cdn-cgi\/challenge|checking your browser|enable javascript and cookies/i.test(String(text||'').slice(0,5000));}
function usable(r,opt){ if(!r)return false; if(r.text&&r.text.length>(opt.cap||800000))r.text=r.text.slice(0,opt.cap||800000); if(challenge(r.text))return false; if(RETRY.indexOf(r.status)>=0)return false; return true; }
function get(url,opt){opt=opt||{}; if(fetches++>MAX_FETCHES)return Promise.reject(err('budget','Browser fallback request budget reached.'));
  /* Direct first (fast, true status when CORS allows), then the public relays
     raced in parallel so one slow relay cannot stall the crawl. */
  function tryRelays(challenged){
    if(opt.signal&&opt.signal.aborted)return Promise.reject(err('cancelled','The crawl was cancelled.'));
    var sub=new AbortController(); if(opt.signal)opt.signal.addEventListener('abort',function(){sub.abort();},{once:true});
    var relays=transports.slice(1), winner=null, remaining=relays.length, SKIP={skip:true};
    return new Promise(function(resolve,reject){
      relays.forEach(function(t){
        Promise.resolve().then(function(){ return t(url,opt); }).then(function(r){
          if(winner)return;
          if(!usable(r,opt))throw SKIP;
          winner=r; sub.abort(); resolve(r);
        }).catch(function(){ remaining--; if(remaining===0&&!winner){ sub.abort(); reject(challenged?err('challenge','The site is behind bot protection.'):err('unreachable','Could not fetch the resource through the browser fallback relays.')); } });
      });
    });
  }
  return direct(url,opt).then(function(r){ if(usable(r,opt))return r; return tryRelays(challenge(r&&r.text)); },function(){ return tryRelays(false); });
}
function robotsParse(txt){var rules=[],sitemaps=[]; String(txt||'').split(/\r?\n/).forEach(function(raw){var line=raw.replace(/#.*/,'').trim(),m=line.match(/^([^:]+):\s*(.*)$/); if(!m)return; var k=m[1].toLowerCase(),v=m[2].trim(); if(k==='sitemap')sitemaps.push(v); if(k==='disallow'||k==='allow')rules.push({type:k,path:v});}); return {sitemaps:sitemaps,allowed:function(url){var p=new URL(url).pathname+new URL(url).search,b=null; rules.forEach(function(r){if(!r.path)return; var re=new RegExp('^'+r.path.split('*').map(function(x){return x.replace(/[.+?^${}()|[\]\\]/g,'\\$&');}).join('.*')); if(re.test(p)&&(!b||r.path.length>b.path.length))b=r;}); return !b||b.type==='allow';}};}
function parse(html,base){var raw=String(html||''), doc=new DOMParser().parseFromString(raw,'text/html'), links=[], imgs=[]; doc.querySelectorAll('a[href],link[href]').forEach(function(a){var u=norm(a.getAttribute('href'),base); if(u)links.push(u);}); var can=null, c=doc.querySelector('link[rel~="canonical"][href]'); if(c)can=norm(c.getAttribute('href'),base); var noindex=Array.prototype.some.call(doc.querySelectorAll('meta[name="robots"],meta[name="googlebot"]'),function(m){return /noindex/i.test(m.getAttribute('content')||'');}); doc.querySelectorAll('img[src],meta[property="og:image"][content]').forEach(function(el){var u=norm(el.getAttribute('src')||el.getAttribute('content'),base); if(u&&/\.(png|jpe?g|webp|avif|gif)(\?|$)/i.test(new URL(u).pathname+new URL(u).search))imgs.push(u);}); doc.querySelectorAll('img[srcset],source[srcset]').forEach(function(el){String(el.getAttribute('srcset')||'').split(',').forEach(function(part){var u=norm(part.trim().split(/\s+/)[0],base); if(u&&/\.(png|jpe?g|webp|avif|gif)(\?|$)/i.test(u))imgs.push(u);});}); var md; var mdRe=/\[[^\]]+\]\((https?:[^)\s]+|\/[^)\s]+)\)/g; while((md=mdRe.exec(raw))){var mu=norm(md[1],base); if(mu)links.push(mu);} raw.replace(/https?:\/\/[^\s)'"<>]+/g,function(u){var nu=norm(u,base); if(nu)links.push(nu);}); var text=doc.body?doc.body.textContent.trim():raw.replace(/[#*_`>\-]/g,' ').trim(); return {links:Array.from(new Set(links)),canonical:can,noindex:noindex,images:Array.from(new Set(imgs)).slice(0,50),jsHeavy:text.length<250&&doc.scripts.length>0};}
function locs(xml,base){return Array.from(String(xml||'').matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)).map(function(m){return norm(m[1].replace(/&amp;/g,'&').trim(),base);}).filter(Boolean);}
function xmlUrlset(pages,opt){var ns=opt.includeImages?' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"':''; return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'+ns+'>\n'+pages.map(function(p){var x='  <url>\n    <loc>'+esc(p.loc||p.url)+'</loc>\n'; if(opt.changefreq)x+='    <changefreq>'+esc(opt.changefreq)+'</changefreq>\n'; if(opt.includeImages)(p.images||[]).forEach(function(i){x+='    <image:image><image:loc>'+esc(i)+'</image:loc></image:image>\n';}); return x+'  </url>';}).join('\n')+'\n</urlset>\n';}
function validate(xml){var errors=[]; if(!/<urlset\b[^>]*sitemaps\.org\/schemas\/sitemap\/0\.9/.test(xml))errors.push('Missing urlset namespace.'); return {valid:!errors.length,errors:errors,locCount:(xml.match(/<loc>/g)||[]).length,bytes:xml.length};}
function discover(origin,robots,opt){var candidates=['/sitemap.xml','/sitemap_index.xml','/sitemap-index.xml'].map(function(p){return new URL(p,origin).toString();}).concat(robots.sitemaps||[]), out=[]; return candidates.reduce(function(pr,u){return pr.then(function(){return get(u,{accept:'application/xml,text/xml,*/*',cap:1200000,signal:opt.signal}).then(function(r){if(r.status===200&&/<(urlset|sitemapindex)\b/i.test(r.text))out.push({url:u,urls:locs(r.text,u),isIndex:/<sitemapindex\b/i.test(r.text)});},function(){});});},Promise.resolve()).then(function(){return out;});}
B.run = async function(body, onProgress) {
  fetches = 0;
  var started = Date.now();
  var opt = { signal: body.signal, includeImages: !!body.includeImages, changefreq: body.changefreq || '' };
  var root = input(body.url);
  var max = Math.min(Number(body.maxUrls) || 500, 1000);
  var depth = body.depth === 'unlimited' ? 5 : Math.min(Number(body.depth) || 3, 5);
  var subs = !!body.includeSubdomains;
  onProgress({ stage: 'connect', message: 'Browser fallback connected' });

  if (body.mode === 'analyze') {
    var sm = await get(root.toString(), { accept: 'application/xml,text/xml,*/*', cap: 1500000, signal: body.signal });
    var structure = /<(urlset|sitemapindex)\b/i.test(sm.text);
    var urls = locs(sm.text, root.toString()).slice(0, max);
    var rows = [], seen = {};
    var aIdx = { i: 0 };
    async function analyzeWorker() {
      while (aIdx.i < urls.length) {
      var ai = aIdx.i++;
      var au = urls[ai];
      onProgress({ stage: 'analyze', message: (ai + 1) + ' sitemap URLs checked', discovered: urls.length, crawled: ai + 1 });
      try {
        var ar = await get(au, { signal: body.signal, cap: 500000 });
        var ap = parse(ar.text, ar.finalUrl);
        var acan = ap.canonical || ar.finalUrl;
        var areason = 'Included: 200 OK indexable canonical HTML page', ainc = true, aix = true;
        if (!internal(au, root, true)) { areason = 'Excluded: External domain'; ainc = aix = false; }
        else if (seen[key(acan)]) { areason = 'Excluded: Duplicate URL'; ainc = aix = false; }
        else if (ar.status === 404) { areason = 'Excluded: HTTP 404'; ainc = aix = false; }
        else if (ar.status >= 500) { areason = 'Excluded: HTTP 5xx'; ainc = aix = false; }
        else if (ar.status >= 300) { areason = 'Excluded: Redirect'; ainc = aix = false; }
        else if (ap.noindex) { areason = 'Excluded: noindex'; ainc = aix = false; }
        else if (acan && key(acan) !== key(au)) { areason = 'Excluded: Canonical points to another URL'; ainc = aix = false; }
        seen[key(acan)] = true;
        rows.push({ url: au, status: ar.status, indexable: aix, canonical: acan, included: ainc, reason: areason });
      } catch (e) {
        rows.push({ url: au, status: 0, indexable: false, canonical: '', included: false, reason: e.message || 'Fetch failed' });
      }
      }
    }
    await Promise.all([analyzeWorker(), analyzeWorker(), analyzeWorker(), analyzeWorker()]);
    var broken = rows.filter(function(r){ return r.status === 404 || r.status >= 500; }).length;
    var redirects = rows.filter(function(r){ return r.status >= 300 && r.status < 400; }).length;
    var dups = rows.filter(function(r){ return /Duplicate/.test(r.reason); }).length;
    var non = rows.filter(function(r){ return !r.indexable; }).length;
    var score = Math.max(0, 100 - (structure ? 0 : 35) - Math.min(35, Math.round(broken / Math.max(1, rows.length) * 100)) - Math.min(15, Math.round(redirects / Math.max(1, rows.length) * 60)) - Math.min(15, Math.round(dups / Math.max(1, rows.length) * 60)) - Math.min(20, Math.round(non / Math.max(1, rows.length) * 30)));
    return { mode: 'analyze', input: root.toString(), sitemap: sm.finalUrl, xmlValid: structure, xmlErrors: structure ? [] : ['Invalid XML sitemap structure'], healthScore: score, urls: rows, stats: { urlCount: urls.length, checked: rows.length, broken: broken, redirects: redirects, duplicates: dups, nonIndexable: non, missingLastmod: (sm.text.match(/<url>/g) || []).length - (sm.text.match(/<lastmod>/g) || []).length, generationTimeMs: Date.now() - started } };
  }

  var home = await get(root.toString(), { signal: body.signal });
  var final = home.finalUrl;
  var origin = new URL(final).origin;
  var rr;
  try { rr = await get(new URL('/robots.txt', origin).toString(), { signal: body.signal, accept: 'text/plain,*/*', cap: 200000 }); }
  catch(e) { rr = { text: '' }; }
  var robots = robotsParse(rr.text);
  onProgress({ stage: 'robots', message: 'Robots.txt analyzed' });
  if (!robots.allowed(final)) throw err('robots', 'Crawling restricted by robots.txt');
  var sms = await discover(origin, robots, { signal: body.signal });
  onProgress({ stage: 'sitemaps', message: sms.length ? 'Existing Sitemap Detected' : 'Sitemap discovery completed', existingSitemaps: sms.map(function(s){ return s.url; }) });
  var q = [{ url: final, depth: 0 }], qs = {}, pages = [], discovered = 1;
  qs[key(final)] = 1;
  sms.forEach(function(s){ s.urls.slice(0, max).forEach(function(u){ if (internal(u, final, subs) && !qs[key(u)]) { qs[key(u)] = 1; q.push({ url: u, depth: 1 }); discovered++; } }); });
  async function crawlWorker() {
    while (q.length && pages.length < max) {
    var it = q.shift();
    if (!robots.allowed(it.url)) { pages.push({ url: it.url, status: 0, indexable: false, included: false, canonical: '', reason: 'Excluded: robots.txt restriction', depth: it.depth }); continue; }
    try {
      var r = await get(it.url, { signal: body.signal });
      var p = parse(r.text, r.finalUrl);
      var can = p.canonical || r.finalUrl;
      var reason = 'Included: 200 OK indexable canonical HTML page', inc = true, ix = true;
      if (r.status === 404) { reason = 'Excluded: HTTP 404'; inc = ix = false; }
      else if (r.status >= 500) { reason = 'Excluded: HTTP 5xx'; inc = ix = false; }
      else if (r.status >= 300) { reason = 'Excluded: Redirect'; inc = ix = false; }
      else if (p.noindex && !body.includeNoindex) { reason = 'Excluded: noindex'; inc = ix = false; }
      else if (can && key(can) !== key(r.finalUrl)) { reason = 'Excluded: Canonical points to another URL'; inc = ix = false; if (internal(can, final, subs) && !qs[key(can)]) { qs[key(can)] = 1; q.push({ url: can, depth: it.depth + 1 }); } }
      if (it.depth < depth) p.links.forEach(function(l){ if (q.length + pages.length >= max) return; if (!internal(l, final, subs) || !robots.allowed(l)) return; if (/\.(pdf|zip|mp4|mp3|woff2?|css|js)(\?|$)/i.test(new URL(l).pathname)) return; if (!qs[key(l)]) { qs[key(l)] = 1; q.push({ url: l, depth: it.depth + 1 }); discovered++; } });
      pages.push({ url: r.finalUrl, status: r.status, indexable: ix, canonical: can, included: inc, reason: reason, depth: it.depth, images: p.images, jsHeavy: p.jsHeavy });
      onProgress({ stage: 'crawl', message: pages.length + ' URLs analyzed (browser fallback)', discovered: discovered, crawled: pages.length });
    } catch (e) {
      pages.push({ url: it.url, status: 0, indexable: false, included: false, canonical: '', reason: e.message || 'Fetch failed', depth: it.depth });
    }
    }
  }
  /* Three concurrent workers keep relay latency from adding up page by page. */
  await Promise.all([crawlWorker(), crawlWorker(), crawlWorker()]);
  var seen2 = {}, included = [];
  pages.forEach(function(p){ var k = key(p.canonical || p.url); if (p.included && seen2[k]) { p.included = false; p.indexable = false; p.reason = 'Excluded: Duplicate URL'; } if (p.included) { seen2[k] = 1; included.push({ url: p.canonical || p.url, loc: p.canonical || p.url, images: p.images }); } });
  var xml = xmlUrlset(included, opt), val = validate(xml);
  var stats = { urlsDiscovered: discovered, urlsCrawled: pages.length, urlsIncluded: included.length, urlsExcluded: pages.filter(function(p){ return !p.included; }).length, notFound: pages.filter(function(p){ return /404/.test(p.reason); }).length, redirects: pages.filter(function(p){ return /Redirect/.test(p.reason); }).length, noindex: pages.filter(function(p){ return /noindex/.test(p.reason); }).length, canonicalized: pages.filter(function(p){ return /Canonical/.test(p.reason); }).length, blocked: pages.filter(function(p){ return /robots/.test(p.reason); }).length, duplicates: pages.filter(function(p){ return /Duplicate/.test(p.reason); }).length, external: 0, generationTimeMs: Date.now() - started, sitemapFiles: 1, sitemapIndex: 0 };
  return { mode: 'generate', input: root.toString(), finalUrl: final, browserFallback: true, existingSitemaps: sms.map(function(s){ return { url: s.url, count: s.urls.length, isIndex: s.isIndex }; }), robots: { exists: !!rr.text, url: new URL('/robots.txt', origin).toString() }, limitedCrawlability: pages.some(function(p){ return p.jsHeavy; }), urls: pages, files: [{ name: 'sitemap.xml', xml: xml, count: included.length }], indexXml: null, indexName: null, validations: [{ name: 'sitemap.xml', valid: val.valid, errors: val.errors, locCount: val.locCount, bytes: val.bytes }], stats: stats };
};
})(window);
