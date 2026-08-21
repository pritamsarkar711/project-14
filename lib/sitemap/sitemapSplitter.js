'use strict';
const { generateUrlset, generateIndex } = require('./sitemapGenerator');
const MAX_URLS=50000, MAX_BYTES=45*1024*1024;
function splitSitemaps(pages, opts={}) { const chunks=[]; let cur=[]; for(const p of pages){ cur.push(p); if(cur.length>=Math.min(opts.maxPerFile||MAX_URLS,MAX_URLS)){ chunks.push(cur); cur=[]; } } if(cur.length) chunks.push(cur); const files=chunks.map((chunk,i)=>({name:chunks.length>1?`sitemap-${i+1}.xml`:'sitemap.xml', xml:generateUrlset(chunk,opts), count:chunk.length})); for(const f of files) if(Buffer.byteLength(f.xml,'utf8')>MAX_BYTES) f.warning='File approaches sitemap size limits.'; const indexXml=files.length>1?generateIndex(files, opts.origin || (pages[0]&&pages[0].url) || 'https://example.com/'):null; return { files, indexXml, indexName:indexXml?'sitemap-index.xml':null }; }
module.exports={splitSitemaps,MAX_URLS,MAX_BYTES};
