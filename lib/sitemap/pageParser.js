'use strict';
const { normalizeUrl } = require('./urlNormalizer');
function attrAll(html, tag, attr){ const out=[]; const re=new RegExp(`<${tag}\\b[^>]*?\\s${attr}=[\"']([^\"']+)[\"'][^>]*>`, 'gi'); let m; while((m=re.exec(html))) out.push(m[1]); return out; }
function parseSrcset(v){ return String(v||'').split(',').map(s=>s.trim().split(/\s+/)[0]).filter(Boolean); }
function parsePage(html, base) {
  html=String(html||''); const links=[]; const images=[];
  attrAll(html,'a','href').forEach(h=>{ const n=normalizeUrl(h,base); if(n) links.push(n); });
  attrAll(html,'link','href').forEach(h=>{ const n=normalizeUrl(h,base); if(n) links.push(n); });
  let canonical=null; const can=html.match(/<link\b(?=[^>]*rel=["'][^"']*canonical[^"']*["'])(?=[^>]*href=["']([^"']+)["'])[^>]*>/i); if(can) canonical=normalizeUrl(can[1],base);
  const robotsMeta=[]; let mm; const mre=/<meta\b(?=[^>]*(?:name|property)=["']robots["'])(?=[^>]*content=["']([^"']+)["'])[^>]*>/gi; while((mm=mre.exec(html))) robotsMeta.push(mm[1].toLowerCase());
  attrAll(html,'img','src').forEach(src=>{ const n=normalizeUrl(src,base); if(n) images.push(n); });
  attrAll(html,'img','srcset').flatMap(parseSrcset).forEach(src=>{ const n=normalizeUrl(src,base); if(n) images.push(n); });
  attrAll(html,'source','srcset').flatMap(parseSrcset).forEach(src=>{ const n=normalizeUrl(src,base); if(n) images.push(n); });
  const og=html.match(/<meta\b(?=[^>]*property=["']og:image["'])(?=[^>]*content=["']([^"']+)["'])[^>]*>/i); if(og){ const n=normalizeUrl(og[1],base); if(n) images.push(n); }
  const wp=/\/wp-content\/|\/wp-includes\/|wp-json|<meta[^>]+generator[^>]+WordPress/i.test(html);
  const jsHeavy=html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').trim().length < 250 && /<script/i.test(html);
  return { links:[...new Set(links)], canonical, noindex: robotsMeta.some(v=>/noindex/.test(v)), images:[...new Set(images)].filter(isLikelyImage), wordpress:wp, jsHeavy };
}
function isLikelyImage(u){ try{ const x=new URL(u); if(/^data:/.test(u)) return false; return /\.(png|jpe?g|webp|avif|gif)(\?|$)/i.test(x.pathname+x.search) && !/(pixel|tracking|sprite|icon|logo\.svg)/i.test(x.pathname); }catch{return false;} }
module.exports={parsePage};
