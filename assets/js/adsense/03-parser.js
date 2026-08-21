/* huvanti AdSense checker — HTML/DOM parser. */
(function (global) {
'use strict';
var A = global.Adsense = global.Adsense || {};
var U = A.util;

function metaAll(doc){
  var m={};
  doc.querySelectorAll('meta').forEach(function(el){
    var k=(el.getAttribute('name')||el.getAttribute('property')||el.getAttribute('http-equiv')||'').toLowerCase();
    if(k) m[k]=(m[k]?m[k]+', ':'')+(el.getAttribute('content')||'');
  });
  return m;
}
function bodyTextOf(doc){
  var clone=doc.cloneNode(true);
  clone.querySelectorAll('script,style,noscript,svg,template,iframe,nav,footer,header,aside,form,button,.nav,.menu,.footer,.header,.sidebar,.breadcrumb,.comments,#comments,.comment,.related,.posts-navigation,.widget,.ad,.ads,.advertisement,[role="navigation"],[role="banner"],[role="contentinfo"]').forEach(function(el){el.remove();});
  var main=clone.querySelector('main,[role="main"],article,.post,.entry-content,.article-content,.content');
  var root=main||clone.body||clone;
  return (root.textContent||'').replace(/\s+/g,' ').trim();
}
function visibleTextOf(doc){
  var clone=doc.cloneNode(true);
  clone.querySelectorAll('script,style,noscript,svg,template,iframe').forEach(function(el){el.remove();});
  return (clone.body?clone.body.textContent:clone.textContent||'').replace(/\s+/g,' ').trim();
}
var AD_PATTERNS=[
  ['Google AdSense',/pagead2\.googlesyndication\.com|adsbygoogle|data-ad-client|adsbygoogle\.js/i],
  ['Google Ad Manager',/googletagservices\.com|gpt\.js|doubleclick\.net/i],
  ['Media.net',/contextual\.media\.net|medianet/i],
  ['Amazon Ads',/amazon-adsystem\.com/i],
  ['Ezoic',/ezoic\.net/i],
  ['Monumetric',/monumetric\.com/i],
  ['Raptive/AdThrive',/raptive\.com|adthrive\.com/i],
  ['Mediavine',/mediavine\.com/i],
  ['BuySellAds',/buysellads\.com/i],
  ['PropellerAds',/propellerads\.com/i]
];
function detectAdNetworks(html){
  var out=[];
  AD_PATTERNS.forEach(function(p){if(p[1].test(html))out.push(p[0]);});
  return out;
}

A.parsePage=function(result){
  if(result.error||result.skipped) return result;
  var doc=new DOMParser().parseFromString(result.html,'text/html');
  function qs(s,r){return (r||doc).querySelector(s);}
  function qsa(s,r){return Array.prototype.slice.call((r||doc).querySelectorAll(s));}
  var meta=metaAll(doc);
  function mc(k){return meta[k.toLowerCase()]||'';}
  var base=result.finalUrl||result.url;
  var title=(qs('title')&&qs('title').textContent||'').trim();
  var desc=mc('description');
  var canonicalEl=qs('link[rel="canonical"]');
  var canonical=canonicalEl?canonicalEl.getAttribute('href')||'':'';
  var robotsMeta=mc('robots');
  var xRobots=result.headers['x-robots-tag']||'';
  var viewport=mc('viewport');
  var langEl=qs('html');
  var lang=langEl?langEl.getAttribute('lang')||'':'';
  var charset=doc.characterSet||(qs('meta[charset]')?qs('meta[charset]').getAttribute('charset'):'')||'';
  var generator=mc('generator');
  var headings=qsa('h1,h2,h3,h4,h5,h6').map(function(h){return {tag:h.tagName,text:(h.textContent||'').trim().slice(0,160)};});
  var h1=headings.filter(function(h){return h.tag==='H1';}).map(function(h){return h.text;});
  var h2=headings.filter(function(h){return h.tag==='H2';}).map(function(h){return h.text;});
  var h3=headings.filter(function(h){return h.tag==='H3';}).map(function(h){return h.text;});
  var mainText=bodyTextOf(doc), visibleText=visibleTextOf(doc);
  var w=U.words(mainText), allWords=U.words(visibleText), sents=U.sentences(mainText);
  var paragraphs=qsa('article p, main p, .post p, .entry-content p, .content p, body p').map(function(p){return (p.textContent||'').trim();}).filter(function(t){return t.length>0;});
  var images=qsa('img').map(function(img){
    var src=U.normalizeUrl(img.getAttribute('src')||img.getAttribute('data-src')||img.getAttribute('data-lazy-src')||'',base);
    var fmt='';try{fmt=(new URL(src,base).pathname.split('.').pop()||'').toLowerCase().split('?')[0];}catch(e){}
    return {src:src,alt:img.hasAttribute('alt')?img.getAttribute('alt'):null,width:img.getAttribute('width'),height:img.getAttribute('height'),loading:(img.getAttribute('loading')||'').toLowerCase(),srcset:img.getAttribute('srcset')||'',inPicture:!!img.closest('picture'),format:fmt};
  }).filter(function(i){return i.src;});
  var links=qsa('a[href]').map(function(a){
    var raw=a.getAttribute('href')||'';var href=U.normalizeUrl(raw,base);var text=(a.textContent||'').trim().slice(0,120);var rel=(a.getAttribute('rel')||'').toLowerCase();
    var internal=false;try{internal=!!href&&U.sameSite(href,base);}catch(e){}
    return {href:href,text:text,rel:rel,target:a.getAttribute('target')||'',internal:internal,external:!!href&&!internal&&/^https?:/.test(href),empty:!text||text.length<2,isAnchor:raw.charAt(0)==='#',isMail:/^(mailto|tel):/i.test(raw),isJs:/^javascript:/i.test(raw),nofollow:/nofollow/.test(rel),sponsored:/sponsored/.test(rel),ugc:/ugc/.test(rel)};
  }).filter(function(l){return l.href&&!l.isAnchor&&!l.isMail&&!l.isJs;});
  var scripts=qsa('script[src]').map(function(s){return U.normalizeUrl(s.getAttribute('src'),base);}).filter(Boolean);
  var externalScripts=scripts.filter(function(s){try{return !U.sameSite(s,base);}catch(e){return false;}});
  var inlineScripts=qsa('script:not([src])').length;
  var stylesheets=qsa('link[rel~="stylesheet"]').map(function(l){return U.normalizeUrl(l.getAttribute('href'),base);}).filter(Boolean);
  var headStylesheets=qsa('head link[rel~="stylesheet"]').length;
  var inlineStyles=qsa('style').length;
  var blockingHeadScripts=qsa('head script[src]').filter(function(s){return !s.hasAttribute('async')&&!s.hasAttribute('defer');}).length;
  var mediaQueries=(result.html.match(/@media[^{]*/g)||[]).length;
  var jsonLd=[],invalidLd=[];
  qsa('script[type="application/ld+json"]').forEach(function(s){try{var j=JSON.parse(s.textContent);(Array.isArray(j)?j:[j]).forEach(function(x){if(x)jsonLd.push(x);});}catch(e){invalidLd.push(e.message);}});
  var schemaTypes=[];
  jsonLd.forEach(function(j){if(j&&typeof j==='object'){var t=j['@type'];if(Array.isArray(t))t.forEach(function(x){schemaTypes.push(x);});else if(t)schemaTypes.push(t);}});
  var seen={};schemaTypes=schemaTypes.filter(function(t){if(seen[t])return false;seen[t]=true;return true;});
  var microdata=qsa('[itemscope]').map(function(e){return e.getAttribute('itemtype')||'';}).filter(Boolean);
  var rdfa=qsa('[typeof]').map(function(e){return e.getAttribute('typeof')||'';}).filter(Boolean);
  var authorCandidates=[mc('author'),mc('article:author'),(qs('[rel="author"]')||{}).textContent,(qs('.author,.byline,.post-author,.entry-author')||{}).textContent].filter(Boolean);
  var author=(authorCandidates[0]||'').trim();
  var published=mc('article:published_time')||mc('date')||'';
  var modified=mc('article:modified_time')||mc('og:updated_time')||'';
  if(!published)jsonLd.forEach(function(j){if(j.datePublished)published=String(j.datePublished);});
  if(!modified)jsonLd.forEach(function(j){if(j.dateModified)modified=String(j.dateModified);});
  var hasNav=!!qs('nav,[role="navigation"],.menu,#menu,.main-nav');
  var hasFooter=!!qs('footer,[role="contentinfo"],#footer,.footer');
  var popups=qsa('[class*="popup" i],[id*="popup" i],[class*="modal" i],[id*="modal" i],[class*="overlay" i],[id*="overlay" i]').length;
  var fixedFull=qsa('div,section').filter(function(el){var st=el.getAttribute('style')||'';return /position\s*:\s*fixed/.test(st)&&/(width|inset|left|right)\s*:\s*0/.test(st);}).length;
  var autoplay=qsa('video[autoplay],audio[autoplay],iframe[src*="autoplay"]').length;
  var hreflangs=qsa('link[rel="alternate"][hreflang]').map(function(l){return {lang:l.getAttribute('hreflang'),href:U.normalizeUrl(l.getAttribute('href'),base)};}).filter(function(x){return x.href;});
  var isHttps=/^https:/.test(base);
  var mixedResources=qsa('img[src],script[src],link[href],iframe[src],source[src],video[src],audio[src]').map(function(e){return e.getAttribute('src')||e.getAttribute('href')||'';}).filter(function(u){return isHttps&&/^http:\/\//i.test(u);});
  var emptyLinks=qsa('a[href]').filter(function(a){var t=(a.textContent||'').trim();var aria=(a.getAttribute('aria-label')||a.getAttribute('title')||'').trim();return !t&&!aria&&!a.querySelector('img')&&!/^(#|mailto:|tel:|javascript:)/i.test(a.getAttribute('href')||'');}).length;
  var emptyButtons=qsa('button,input[type=submit],input[type=button],a[role=button]').filter(function(b){return ((b.textContent||b.getAttribute('value')||'').trim()+ (b.getAttribute('aria-label')||'')).length===0;}).length;
  var metaRefresh=qsa('meta[http-equiv="refresh" i]').length;
  var navLinks=qsa('nav a,[role="navigation"] a').length;
  var footerLinks=qsa('footer a,[role="contentinfo"] a').length;
  // nested DOM depth ( capped traversal )
  var maxDepth=0;(function(){var body=doc.body;if(!body)return;var stack=[{n:body,d:0}];while(stack.length){var x=stack.pop();if(x.d>maxDepth)maxDepth=x.d;if(x.d>25)continue;var ch=x.n.children;for(var i=0;i<ch.length;i++)stack.push({n:ch[i],d:x.d+1});}})();
  var contactText=visibleText.slice(0,3000);
  var emailMatch=contactText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  var phoneMatch=contactText.match(/(?:\+?\d[\d\-() .]{7,}\d)/);
  var loremIpsum=/\blorem ipsum\b|\bplaceholder text\b|\bdolor sit amet\b/i.test(mainText);
  // duplicate declared schema @type across blocks
  var schemaTypeCount={};jsonLd.forEach(function(j){if(j&&typeof j==='object'){var t=j['@type'];(Array.isArray(t)?t:[t]).forEach(function(x){if(x)schemaTypeCount[x]=(schemaTypeCount[x]||0)+1;});}});
  var conflictingSchema=Object.keys(schemaTypeCount).filter(function(k){return schemaTypeCount[k]>1&&['Organization','WebSite','Person','LocalBusiness','Product'].indexOf(k)>=0;});
  var externalLinks=links.filter(function(l){return l.external;});
  var adNetworks=detectAdNetworks(result.html);
  var adScripts=scripts.filter(function(s){return /pagead|googlesyndication|doubleclick|adsystem|adservice|media\.net|ezoic|monumetric|raptive|adthrive|mediavine|buysellads|propellerads/i.test(s);}).length;
  var adIframes=qsa('iframe').filter(function(f){var src=(f.getAttribute('src')||'');return /pagead|googlesyndication|doubleclick|adsystem|adservice|amazon-adsystem|media\.net\/|adservice\.google|\/ads\/|adsr\.org|adn\.com/i.test(src);}).length;
  var adSlots=qsa('ins.adsbygoogle,[data-ad-client],[data-ad-slot],[id^="div-gpt-ad"],[id^="ad-"],[id^="google_ads_"],[class*=" adsbygoogle"],[class^="adslot"],[class*=" adslot"],[class*=" ad-slot"],[class*=" ad_container"],[class*="advertisement"]').length;
  result.parse={
    title:title,titleLen:title.length,desc:desc,descLen:desc.length,canonical:canonical,robotsMeta:robotsMeta,xRobots:xRobots,
    viewport:viewport,lang:lang,charset:charset,generator:generator,
    headings:headings,h1:h1,h2:h2,h3:h3,headingsCount:headings.length,
    mainText:mainText,visibleText:visibleText,wordCount:w.length,allWordCount:allWords.length,
    sentenceCount:sents.length,paragraphCount:paragraphs.length,paragraphs:paragraphs.slice(0,40),listCount:qsa('ul,ol').length,
    textRatio:result.html?Math.round(visibleText.length/result.html.length*100):0,
    avgSentenceLength:sents.length?Math.round(w.length/sents.length):0,
    avgParagraphWords:paragraphs.length?Math.round(w.length/paragraphs.length):w.length,
    keywords:U.keywordFreq(mainText,30),
    images:images,imageCount:images.length,links:links,internalLinks:links.filter(function(l){return l.internal;}).length,externalLinks:links.filter(function(l){return l.external;}).length,
    scripts:scripts,externalScripts:externalScripts,inlineScripts:inlineScripts,stylesheets:stylesheets,headStylesheets:headStylesheets,inlineStyles:inlineStyles,blockingHeadScripts:blockingHeadScripts,mediaQueries:mediaQueries,
    jsonLd:jsonLd,invalidLd:invalidLd,schemaTypes:schemaTypes,microdata:microdata,rdfa:rdfa,
    author:author,published:published,modified:modified,
    hasNav:hasNav,hasFooter:hasFooter,popups:popups,fixedFull:fixedFull,autoplay:autoplay,
    adNetworks:adNetworks,adScripts:adScripts,adIframes:adIframes,adSlots:adSlots,
    hreflangs:hreflangs,mixedResources:mixedResources,emptyLinks:emptyLinks,emptyButtons:emptyButtons,
    metaRefresh:metaRefresh,navLinks:navLinks,footerLinks:footerLinks,domDepth:maxDepth,
    contactEmail:emailMatch?emailMatch[0]:'',contactPhone:phoneMatch?phoneMatch[0].trim():'',
    loremIpsum:loremIpsum,schemaTypeCount:schemaTypeCount,conflictingSchema:conflictingSchema,
    externalLinksCount:externalLinks.length,externalLinksList:externalLinks,
    noindex:/noindex/i.test(robotsMeta+' '+xRobots),nofollow:/nofollow/i.test(robotsMeta+' '+xRobots)
  };
  return result;
};
A.buildBoilerplateVocab=function(pages){
  var parsed=pages.filter(function(p){return p.parse&&!p.error;});
  if(parsed.length<2) return new Set();
  var docCounts=new Map();
  parsed.forEach(function(p){
    var seen=new Set();
    p.parse.visibleText.toLowerCase().split(/[^a-z0-9']+/).forEach(function(w){
      if(w.length>=3&&!seen.has(w)){seen.add(w);docCounts.set(w,(docCounts.get(w)||0)+1);}
    });
  });
  var thr=Math.ceil(parsed.length*0.6);
  var s=new Set();
  docCounts.forEach(function(n,w){if(n>=thr)s.add(w);});
  return s;
};
})(typeof window!=='undefined'?window:this);
