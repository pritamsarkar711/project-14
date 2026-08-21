'use strict';
const { canonicalKey } = require('./urlNormalizer');
function dedupePages(pages){ const seen=new Map(); for(const p of pages){ const k=canonicalKey(p.canonical||p.url); if(seen.has(k)){ p.duplicateOf=seen.get(k).url; p.included=false; p.reason='Excluded: Duplicate URL'; } else seen.set(k,p); } return pages; }
module.exports={dedupePages};
