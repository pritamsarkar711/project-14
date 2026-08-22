/* huvanti AdSense checker, deterministic utilities. */
(function (global) {
'use strict';
var A = global.Adsense = global.Adsense || {};
A.util = A.util || {};
var U = A.util;
U.clamp = function(n,a,b){return Math.max(a,Math.min(b,n));};
U.round = function(n,d){d=d||0;var p=Math.pow(10,d);return Math.round(n*p)/p;};
U.esc = function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];});};

var TRACKING = new Set(['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid','msclkid','mc_cid','mc_eid','ref','ref_src','_ga','_gl','spm','yclid','wickedid']);
U.normalizeUrl = function(raw, base){
  try{
    var u = new URL(raw, base);
    u.hash = '';
    u.searchParams.forEach(function(v,k){ if(TRACKING.has(k.toLowerCase())) u.searchParams.delete(k); });
    if((u.protocol==='https:'&&u.port==='443')||(u.protocol==='http:'&&u.port==='80')) u.port='';
    var s=u.toString();
    if(u.pathname.length>1 && u.pathname.endsWith('/')) s=s.replace(/\/$/,'');
    return s;
  }catch(e){return null;}
};
U.hostOf=function(u){try{return new URL(u).hostname;}catch(e){return '';}};
U.normHost=function(h){return String(h).toLowerCase().replace(/^www\./,'');};
U.sameSite=function(a,b){try{return U.normHost(new URL(a).hostname)===U.normHost(new URL(b).hostname);}catch(e){return false;}};
U.pathOf=function(u){try{return new URL(u).pathname||'/';}catch(e){return u;}};
U.originOf=function(u){try{return new URL(u).origin;}catch(e){return '';}};
U.isAsset=function(u){return /\.(jpe?g|png|webp|gif|svg|avif|ico|bmp|css|js|mjs|json|xml|pdf|zip|woff2?|ttf|eot|mp4|webm|mp3|exe|dmg|apk)(\?|#|$)/i.test(u);};
U.isHtmlCtype=function(ct){return /html|xml|text\/plain/i.test(ct||'')||!ct;};
var INVALID=/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|:1|fc00|fd00|metadata\.google\.internal|169\.254\.169\.254)/i;
U.isPublicUrl=function(raw){
  try{var u=new URL(raw);
    if(!/^https?:$/.test(u.protocol)) return false;
    if(INVALID.test(u.hostname)) return false;
    if(/\.(local|internal|lan)$/i.test(u.hostname)) return false;
    return true;
  }catch(e){return false;}
};
U.words=function(text){return (String(text||'').match(/[\w']+/g)||[]).filter(function(w){return /[A-Za-z0-9]/.test(w);});};
U.sentences=function(text){var s=String(text||'').match(/[^.!?]+[.!?]+/g)||[];return s.length?s:(text&&text.trim()?[text]:[]);};
U.syllables=function(word){
  word=String(word).toLowerCase().replace(/[^a-z]/g,'');
  if(!word) return 0;
  if(word.length<=3) return 1;
  word=word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/,'').replace(/^y/,'');
  var m=word.match(/[aeiouy]{1,2}/g);
  return Math.max(1,m?m.length:1);
};
U.fleschReadingEase=function(text){
  var w=U.words(text),s=Math.max(1,U.sentences(text).length);
  if(w.length<5) return null;
  var sy=w.reduce(function(n,x){return n+U.syllables(x);},0);
  return U.clamp(206.835-1.015*(w.length/s)-84.6*(sy/w.length),0,100);
};
U.fleschKincaidGrade=function(text){
  var w=U.words(text),s=Math.max(1,U.sentences(text).length);
  if(w.length<5) return null;
  var sy=w.reduce(function(n,x){return n+U.syllables(x);},0);
  return U.round(0.39*(w.length/s)+11.8*(sy/w.length)-15.59,1);
};
U.gunningFog=function(text){
  var w=U.words(text),s=Math.max(1,U.sentences(text).length);
  if(w.length<5) return null;
  var complex=w.filter(function(x){return U.syllables(x)>=3&&!/(ed|es|ing)$/.test(x.toLowerCase());}).length;
  return U.round(0.4*((w.length/s)+(complex/w.length)*100),1);
};
U.automatedReadabilityIndex=function(text){
  var w=U.words(text),s=Math.max(1,U.sentences(text).length);
  if(w.length<5) return null;
  var chars=String(text).replace(/\s+/g,'').length;
  return U.round(4.71*(chars/w.length)+0.5*(w.length/s)-21.43,1);
};
var STOP = new Set('a,about,after,all,also,an,and,any,are,as,at,be,because,been,before,being,between,both,but,by,can,come,could,did,do,does,doing,down,during,each,few,for,from,further,get,got,has,had,he,her,here,hers,herself,him,himself,his,how,i,if,in,into,is,it,its,itself,just,like,make,made,may,me,might,more,most,my,myself,no,nor,not,now,of,off,on,once,one,only,or,other,our,ours,ourselves,out,over,own,same,she,should,so,some,such,t,than,that,the,their,theirs,them,themselves,then,there,these,they,this,those,through,to,too,under,until,up,very,was,we,well,were,what,when,where,which,while,who,whom,why,will,with,would,you,your,yours,yourself,yourselves,page,home,post,content,image,https,http,www,com,org,net,blog,article,read,using,use,used,new,also,may,many,even'.split(','));
U.STOP=STOP;
U.keywordFreq=function(text,n){
  n=n||30;var f={};
  U.words(text).forEach(function(w){w=w.toLowerCase();if(w.length>=4&&!STOP.has(w))f[w]=(f[w]||0)+1;});
  return Object.keys(f).map(function(k){return [k,f[k]];}).sort(function(a,b){return b[1]-a[1];}).slice(0,n);
};
U.repeatedPhrases=function(text,opt){
  opt=opt||{};var ng=opt.ngram||3,min=opt.minCount||3,top=opt.top||20;
  var toks=U.words(text).map(function(w){return w.toLowerCase();}).filter(function(w){return w.length>2&&!STOP.has(w);});
  var counts=new Map();
  for(var i=0;i+ng<=toks.length;i++){var g=toks.slice(i,i+ng).join(' ');counts.set(g,(counts.get(g)||0)+1);}
  var arr=[];counts.forEach(function(c,g){if(c>=min)arr.push({phrase:g,count:c});});
  return arr.sort(function(a,b){return b.count-a.count;}).slice(0,top);
};
U.tokenSet=function(text,minLen){
  minLen=minLen||4;var s=new Set();
  U.words(text).forEach(function(w){w=w.toLowerCase();if(w.length>=minLen&&!STOP.has(w))s.add(w);});
  return s;
};
U.shingles=function(text,k){
  k=k||5;var ws=U.words(text).map(function(w){return w.toLowerCase();}).filter(function(w){return w.length>2&&!STOP.has(w);});
  var s=new Set();
  for(var i=0;i+k<=ws.length;i++) s.add(ws.slice(i,i+k).join(' '));
  return s;
};
U.jaccard=function(a,b){if(!a.size||!b.size)return 0;var inter=0;a.forEach(function(x){if(b.has(x))inter++;});return inter/(a.size+b.size-inter);};
U.cosineMap=function(a,b){
  var dot=0,na=0,nb=0;var keys=new Set(Object.keys(a).concat(Object.keys(b)));
  keys.forEach(function(k){var x=a[k]||0,y=b[k]||0;dot+=x*y;na+=x*x;nb+=y*y;});
  return (!na||!nb)?0:dot/(Math.sqrt(na)*Math.sqrt(nb));
};
U.simHash=function(text){
  var v=new Array(64).fill(0);
  U.words(text).forEach(function(w){
    w=w.toLowerCase();var h=0n;
    for(var i=0;i<w.length;i++) h=((h<<5n)-h+BigInt(w.charCodeAt(i)))&0xffffffffffffffffn;
    for(i=0;i<64;i++) v[i]+=((h>>BigInt(i))&1n)?1:-1;
  });
  var out=0n;for(var i=0;i<64;i++) if(v[i]>0) out|=(1n<<BigInt(i));
  return out;
};
U.hamming64=function(a,b){var x=a^b,n=0;while(x){n+=Number(x&1n);x>>=1n;}return n;};
U.uniqueAfter=function(text,vocab){
  var s=new Set();
  U.words(text).forEach(function(w){w=w.toLowerCase();if(w.length>=4&&!STOP.has(w)&&!(vocab&&vocab.has(w)))s.add(w);});
  return s;
};
U.boilerplateRatio=function(visible,vocab){
  var pw=U.words(visible).length;if(!pw)return 0;var c=0;
  U.words(visible).forEach(function(w){if(vocab&&vocab.has(w.toLowerCase()))c++;});
  return U.clamp(c/pw,0,1);
};
})(typeof window!=='undefined'?window:this);
