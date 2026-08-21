/* huvanti AdSense checker — page types, essential pages, policy scanner, rule registry. */
(function (global) {
'use strict';
var A = global.Adsense = global.Adsense || {};
var U = A.util;

/* ---------- Page-type + site-type classification ---------- */
A.ESSENTIAL=[
  {key:'about',label:'About',patterns:[/about|who[- ]we[- ]are|our[- ]story|company|team/i]},
  {key:'contact',label:'Contact',patterns:[/contact|get[- ]in[- ]touch|reach[- ]us/i]},
  {key:'privacy',label:'Privacy Policy',patterns:[/privacy/i]},
  {key:'terms',label:'Terms',patterns:[/terms|conditions|tos/i]},
  {key:'disclaimer',label:'Disclaimer',patterns:[/disclaimer/i]},
  {key:'cookie',label:'Cookie Policy',patterns:[/cookie/i]},
  {key:'editorial',label:'Editorial Policy',patterns:[/editorial|reviews?[- ]policy|how we rate/i]}
];
A.classifyPage=function(p, essentialKeyByUrl){
  var path=U.pathOf(p.url);
  if(!p.parse) return 'other';
  var ek = (essentialKeyByUrl && essentialKeyByUrl.get) ? essentialKeyByUrl.get(p.url) : null;
  if(ek) return {about:'about',contact:'contact',privacy:'privacy',terms:'terms',disclaimer:'disclaimer',cookie:'privacy',editorial:'about'}[ek]||'other';
  var t=p.parse.title+' '+(p.parse.h1||[]).join(' ')+' '+path;
  if(/\/(login|signin|sign-in|log-in|register|signup|account|auth)/i.test(path)) return 'login';
  if(/[?&]s=|\/search|\/find/i.test(path)) return 'search';
  if(/\/(author|user|profile|members)\//i.test(path)||(p.parse.schemaTypes||[]).indexOf('Person')>=0) return 'author';
  if(path==='/'||path==='') return 'homepage';
  if(/\/(blog|news|article|post|story)\//i.test(path)||(p.parse.schemaTypes||[]).indexOf('Article')>=0||/\b(article|blog post)\b/i.test(t)) return 'article';
  if(/\/(blog|news|articles|posts)\/?$/i.test(path)) return 'blog';
  if(/\/(product|item|shop|buy|pricing|plan)/i.test(path)||(p.parse.schemaTypes||[]).indexOf('Product')>=0) return 'product';
  if(/\/(category|collection|tag|topics|t\/)/i.test(path)) return 'category';
  if(/\/(tool|calculator|converter|generator|checker|app)/i.test(path)) return 'tool';
  if(/\/(directory|listings?|sites)\//i.test(path)) return 'directory';
  if(p.parse.wordCount>=300&&p.parse.headingsCount>=3) return 'content';
  return 'other';
};
A.CONTENT_TYPES={content:1,article:1,blog:1};
A.UTILITY_TYPES={about:1,contact:1,privacy:1,terms:1,disclaimer:1,login:1,search:1,author:1,homepage:1,tool:1,category:1,product:1,directory:1};

A.detectSiteType=function(pages){
  var text=pages.filter(function(p){return p.parse;}).map(function(p){return p.parse.title+' '+(p.parse.h1||[]).join(' ')+' '+U.pathOf(p.url);}).join(' ').toLowerCase();
  var s={blog:0,news:0,business:0,saas:0,tools:0,directory:0,ecommerce:0,portfolio:0,forum:0,educational:0,documentation:0,personal:0};
  if(/blog|article|post|comment|author/.test(text))s.blog+=3;
  if(/news|breaking|today|daily/.test(text))s.news+=3;
  if(/product|cart|checkout|shop|price|add to cart|woocommerce|shopify/.test(text))s.ecommerce+=4;
  if(/pricing|signup|sign up|free trial|saas|platform|software|app/.test(text))s.saas+=3;
  if(/calculator|converter|generator|tool|checker/.test(text))s.tools+=4;
  if(/directory|listing|submit site|categories/.test(text))s.directory+=3;
  if(/portfolio|work|project|client|designer|developer/.test(text))s.portfolio+=2;
  if(/forum|thread|replies|member/.test(text))s.forum+=3;
  if(/course|tutorial|learn|lesson|university|school|academy/.test(text))s.educational+=3;
  if(/docs|documentation|api|reference|guide|getting started/.test(text))s.documentation+=3;
  if(/about me|my work|resume|cv|hi, i'?m|i blog about/.test(text))s.personal+=2;
  if(/services|solutions|clients|enterprise|business|ltd|inc|llc/.test(text))s.business+=2;
  var best=['business',0];
  Object.keys(s).forEach(function(k){if(s[k]>best[1])best=[k,s[k]];});
  return best[1]>0?best[0]:'business';
};

/* ---------- Essential page detection with confidence ---------- */
A.detectEssential=function(pages){
  var anchors=[];
  pages.forEach(function(p){(p.parse&&p.parse.links||[]).forEach(function(l){anchors.push({text:l.text,href:l.href,from:p.url});});});
  var linkedFromHome={},inlinkCount={};
  pages.forEach(function(p){(p.parse&&p.parse.links||[]).forEach(function(l){
    if(l.internal){inlinkCount[l.href]=(inlinkCount[l.href]||0)+1;if(pages[0]&&p.url===pages[0].url)linkedFromHome[l.href]=true;}
  });});
  var found=[];
  A.ESSENTIAL.forEach(function(def){
    var best=null;
    pages.forEach(function(p){
      if(!p.parse)return;
      var path=U.pathOf(p.url),strong=[path,p.parse.title,(p.parse.h1||[]).join(' ')].join(' ').toLowerCase();
      var weak=(p.parse.visibleText||'').slice(0,1500).toLowerCase();
      var score=0;
      def.patterns.forEach(function(pat){if(pat.test(strong))score+=3;else if(pat.test(weak))score+=1;});
      anchors.filter(function(a){return a.href===p.url;}).forEach(function(a){def.patterns.forEach(function(pat){if(pat.test((a.text||'').toLowerCase()))score+=3;});});
      if(score>=3){var conf=U.clamp(0.4+score*0.12,0.4,0.99);if(!best||conf>best.confidence)best={page:p,url:p.url,confidence:Math.round(conf*100),score:score};}
    });
    if(best){
      var linked=linkedFromHome[best.url]||(inlinkCount[best.url]||0)>=Math.max(2,Math.round(pages.length*0.4));
      found.push(Object.assign({},def,best,{linkedFromNav:linked}));
    }
  });
  return found;
};

/* ---------- Policy-risk scanner (tiered, context-aware) ---------- */
var POLICY=[
  {cat:'adult',label:'Adult / sexual content',severity:'high',patterns:[/\b(porn|xxx|sex|nude|naked|onlyfans|escort|webcam|hentai|nsfw)\b/i],threshold:3,confidence:.9,related:['nude','video','cam','chat','adult']},
  {cat:'drugs',label:'Illegal drugs',severity:'high',patterns:[/\b(buy (cocaine|heroin|meth) online|cocaine for sale|heroin for sale|methamphetamine|lsd for sale|darknet drugs)\b/i],threshold:2,confidence:.85,related:['vendor','ship','darknet','market']},
  {cat:'gambling',label:'Gambling',severity:'medium',patterns:[/\b(online casino|sports betting|poker for (real )?money|slot (games? )?real money|no deposit bonus|bet now|gambling)\b/i],threshold:2,confidence:.7,related:['betting','casino','wager','odds','bonus']},
  {cat:'weapons',label:'Weapons',severity:'medium',patterns:[/\b(buy (guns?|firearms?|ammo) online|silencer for sale|ghost gun|switchblade for sale)\b/i],threshold:2,confidence:.75,related:['firearm','ammunition','weapon','gun']},
  {cat:'violence',label:'Violence / harm',severity:'high',patterns:[/\b(how to make a bomb|build explosives|murder for hire|hitman service|beheading|terror(ist)? attack)\b/i],threshold:2,confidence:.9,related:['attack','kill','bomb','explosive']},
  {cat:'hate',label:'Hate / extremism',severity:'high',patterns:[/\b(white power|racial supremacy|neo[- ]nazi|holocaust denial|ethnic cleansing|kill all (jews|muslims|blacks))\b/i],threshold:2,confidence:.9,related:['supremacy','racist','hate','extremist']},
  {cat:'piracy',label:'Piracy / copyright',severity:'medium',patterns:[/\b(free (movie|film|music|software|game) downloads?|torrent|crack(ed)? software|keygen|warez|pirate bay|full version free download)\b/i],threshold:3,confidence:.75,related:['crack','torrent','download','pirate']},
  {cat:'malware',label:'Malware / phishing',severity:'critical',patterns:[/\b(keylogger download|rat download|phishing kit|exploit kit|stealer log|ransomware builder|free .apk hack)\b/i],threshold:2,confidence:.9,related:['malware','exploit','stealer','phishing']},
  {cat:'scam',label:'Scam / fraud',severity:'medium',patterns:[/\b(get rich quick|guaranteed income|work from home earn \$\d|free money|wire transfer request|western union payment|nigerian prince|claim your prize)\b/i],threshold:2,confidence:.7,related:['prize','money','transfer','wire','guaranteed']},
  {cat:'deceptive',label:'Deceptive downloads / navigation',severity:'medium',patterns:[/\b(download now( button)?|click here to (continue|download)|fake (play|download) button|your (flash|java) is out of date)\b/i],threshold:2,confidence:.65,related:['download','click','button','continue']}
];
A.scanPolicy=function(pages){
  var findings=[];
  pages.forEach(function(p){
    if(!p.parse)return;
    var url=U.pathOf(p.url);
    var title=(p.parse.title||'').toLowerCase();
    var h1=(p.parse.h1||[]).join(' ').toLowerCase();
    var head=title+' '+h1;
    var body=(p.parse.mainText||'').slice(0,12000).toLowerCase();
    var anchors=(p.parse.links||[]).map(function(l){return (l.text||'').toLowerCase();}).join(' ');
    POLICY.forEach(function(rule){
      var hits=0,ctx=[],headHits=0;
      rule.patterns.forEach(function(re){
        var rb=body.match(new RegExp(re.source,'gi')); if(rb){hits+=rb.length;var idx=body.search(re);if(idx>=0)ctx.push(body.slice(Math.max(0,idx-45),idx+90).replace(/\s+/g,' ').trim());}
        var rh=head.match(new RegExp(re.source,'gi')); if(rh){headHits+=rh.length;hits+=rh.length*2;}
        var ra=anchors.match(new RegExp(re.source,'gi')); if(ra)hits+=ra.length;
      });
      var related=(rule.related||[]).reduce(function(n,w){return n+(new RegExp('\\b'+w+'\\b','i').test(body+' '+head)?1:0);},0);
      var threshold=rule.threshold;
      if(rule.related&&related>=1&&hits>=Math.max(2,rule.threshold-1)) threshold=rule.threshold-1;
      if(hits<threshold&&!(headHits>=1&&hits>=2)) return;
      var conf=rule.confidence;
      if(headHits>0)conf+=0.08;
      if(hits>=rule.threshold*3)conf+=0.07;
      if(related>0)conf+=0.03;
      if(rule.related&&related===0&&hits<rule.threshold*2)conf-=0.15;
      conf=U.clamp(conf,0.25,0.99);
      var tier=conf>=0.8?'High-confidence signal':conf>=0.55?'Medium-confidence signal':'Low-confidence signal';
      findings.push({cat:rule.cat,label:rule.label,severity:rule.severity,confidence:Math.round(conf*100),tier:tier,page:url,evidence:hits+' weighted signal(s)'+(headHits?' (incl. title/H1)':'')+(related?' with related terms':''),context:ctx.slice(0,3)});
    });
  });
  return findings;
};

/* ---------- Rule registry ---------- */
A.RULES={};
A.rule=function(r){A.RULES[r.id]=r;return r;};
[
 ['CONTENT_THIN','content','Thin content','high',5],
 ['CONTENT_EMPTY','content','Empty / placeholder page','high',7],
 ['CONTENT_DUPLICATE','content','Duplicate / near-duplicate content','high',6],
 ['CONTENT_BOILERPLATE','content','Excessive template/boilerplate text','medium',3],
 ['CONTENT_KEYWORD_STUFF','content','Keyword stuffing','medium',4],
 ['CONTENT_REPEATED','content','Repeated phrase','low',2],
 ['CONTENT_REPEATED_BLOCK','content','Repeated paragraphs/sentences','low',2],
 ['CONTENT_READABILITY','content','Readability','low',2],
 ['CONTENT_HEADINGS','content','Heading structure','medium',2],
 ['CONTENT_GOOD_VOLUME','content','Substantial original content','passed',5],
 ['CONTENT_WEAK_RATIO','content','Low unique-content ratio across site','high',12],
 ['CONTENT_DUP_RATIO','content','Widespread duplicate/near-duplicate content','high',12],
 ['CONTENT_SIMILAR_META','content','Duplicate titles or meta descriptions','medium',5],
 ['CONTENT_PLACEHOLDER','content','Placeholder / lorem ipsum content','high',6],
 ['CONTENT_CANNIBAL','content','Keyword/topic cannibalization','medium',5],
 ['CONTENT_USEFUL_RATIO','content','Share of useful content pages','medium',10],

 ['TRUST_ABOUT','trust','About page','medium',4],
 ['TRUST_CONTACT','trust','Contact page','high',5],
 ['TRUST_PRIVACY','trust','Privacy policy','high',5],
 ['TRUST_TERMS','trust','Terms / conditions','medium',3],
 ['TRUST_DISCLAIMER','trust','Disclaimer / cookie policy','low',2],
 ['TRUST_AUTHOR','trust','Author / byline information','low',2],
 ['TRUST_ORG','trust','Organisation identity','low',2],
 ['TRUST_LINKED','trust','Trust pages linked from navigation','medium',2],
 ['TRUST_PLACEHOLDER','trust','Placeholder/thin trust page','medium',4],
 ['TRUST_CONTACT_INFO','trust','Contact information','medium',4],
 ['TRUST_BROKEN_TRUST_LINK','trust','Broken link to trust page','high',4],
 ['TRUST_PURPOSE','trust','Site purpose clarity','low',2],

 ['POLICY_FINDING','policy','Potential policy-risk signal','high',10],

 ['UX_VIEWPORT','ux','Mobile viewport','high',3],
 ['UX_RESPONSIVE','ux','Responsive design','medium',2],
 ['UX_NAV','ux','Site navigation','high',3],
 ['UX_FOOTER','ux','Footer','low',1],
 ['UX_POPUP','ux','Intrusive popup / overlay','medium',2],
 ['UX_AUTOPLAY','ux','Autoplaying media','low',1],
 ['UX_AD_DENSITY','ux','Ad density','high',4],
 ['UX_BROKEN_LINK','ux','Broken link','high',3],
 ['UX_EMPTY_LINK','ux','Empty link','medium',2],
 ['UX_EMPTY_BUTTON','ux','Empty button','low',1],
 ['UX_DEEP_PAGE','ux','Difficult-to-reach (deep) page','low',2],
 ['ARCH_ORPHAN','ux','Orphan candidate','high',6],
 ['ARCH_DEAD_END','ux','Dead-end page (no internal links)','medium',3],
 ['ARCH_SINGLE_PATH','ux','Single incoming path','low',1],
 ['ARCH_REDIRECT_LINK','ux','Redirecting internal link','low',2],
 ['ARCH_ANCHOR','ux','Repetitive / empty anchor text','low',2],
 ['ARCH_OVERLINKED','ux','Excessive links on a page','low',1],

 ['TECH_HTTPS','tech','HTTPS','high',4],
 ['TECH_STATUS','tech','HTTP status / errors','high',4],
 ['TECH_REDIRECT','tech','Redirect chain','low',1],
 ['TECH_CANONICAL','tech','Canonical tag','medium',2],
 ['TECH_NOINDEX','tech','Noindex / blocked','critical',7],
 ['TECH_ROBOTS','tech','robots.txt','low',1],
 ['TECH_SITEMAP','tech','XML sitemap','low',1],
 ['TECH_TITLE','tech','Title tag','medium',2],
 ['TECH_DESC','tech','Meta description','low',2],
 ['TECH_H1','tech','H1 tag','medium',2],
 ['TECH_URL','tech','URL structure','low',1],
 ['TECH_MIXED','tech','Mixed content','high',4],
 ['TECH_BROKEN_IMG','tech','Broken image','low',1],
 ['TECH_DUP_TITLE','tech','Duplicate title tags','medium',4],
 ['TECH_DUP_DESC','tech','Duplicate meta descriptions','low',3],
 ['TECH_HREFLANG','tech','Hreflang conflict','low',2],
 ['TECH_SCHEMA_INVALID','tech','Invalid structured data','medium',3],
 ['TECH_SCHEMA_CONFLICT','tech','Conflicting structured data','low',2],
 ['TECH_METAREFRESH','tech','Meta refresh redirect','low',1],
 ['TECH_EXTERNAL','tech','Broken external link','medium',3],

 ['PERF_TTFB','perf','Server response time','medium',3],
 ['PERF_SIZE','perf','Page weight','low',2],
 ['PERF_RENDER_BLOCK','perf','Render-blocking resources','medium',2],
 ['PERF_COMPRESS','perf','Compression','low',1],
 ['PERF_CACHE','perf','Cache headers','low',1],
 ['PERF_THIRD_PARTY','perf','Third-party requests','low',1]
].forEach(function(r){A.rule({id:r[0],category:r[1],name:r[2],severity:r[3],weight:r[4]});});

A.finding=function(id,page,status,evidence,why,fix,confidence,extra){
  var r=A.RULES[id];
  var f={id:id,category:r.category,name:r.name,severity:r.severity,status:status,page:page,evidence:evidence,why:why,fix:fix,confidence:Math.round((confidence==null?1:confidence)*100)};
  if(extra)Object.keys(extra).forEach(function(k){f[k]=extra[k];});
  return f;
};
})(typeof window!=='undefined'?window:this);
