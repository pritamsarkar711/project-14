'use strict';
function analyzeIndexability(page, options={}) {
  const h=page.headers||{}; const ct=String(h['content-type']||'').toLowerCase(); const xr=String(h['x-robots-tag']||'').toLowerCase();
  if (page.blocked) return { indexable:false, reason:'Excluded: robots.txt restriction' };
  if (page.status >= 300 && page.status < 400) return { indexable:false, reason:'Excluded: Redirect' };
  if (page.status === 404) return { indexable:false, reason:'Excluded: HTTP 404' };
  if (page.status === 410) return { indexable:false, reason:'Excluded: HTTP 410' };
  if (page.status >= 500) return { indexable:false, reason:'Excluded: HTTP 5xx' };
  if (page.status !== 200) return { indexable:false, reason:'Excluded: HTTP '+page.status };
  if (!ct.includes('text/html') && !ct.includes('application/xhtml')) return { indexable:false, reason:'Excluded: Unsupported content type' };
  if (!options.includeNoindex && (page.noindex || /noindex/.test(xr))) return { indexable:false, reason:'Excluded: noindex' };
  return { indexable:true, reason:'Included: 200 OK indexable canonical HTML page' };
}
module.exports={analyzeIndexability};
