'use strict';
const { canonicalKey, isInternal } = require('./urlNormalizer');
function canonicalDecision(page, rootUrl, includeSubdomains) {
  if (!page.canonical) return { canonical: page.url, canonicalized:false };
  if (!isInternal(page.canonical, rootUrl, includeSubdomains)) return { canonical: page.canonical, canonicalized:true, reason:'Excluded: Canonical points to external URL' };
  if (canonicalKey(page.canonical) !== canonicalKey(page.url)) return { canonical: page.canonical, canonicalized:true, reason:'Excluded: Canonical points to another URL' };
  return { canonical: page.canonical, canonicalized:false };
}
module.exports={canonicalDecision};
