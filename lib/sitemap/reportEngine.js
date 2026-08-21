'use strict';
function summarize(pages, discovered, started){ const c=k=>pages.filter(p=>p.reason&&p.reason.includes(k)).length; return { urlsDiscovered:discovered, urlsCrawled:pages.length, urlsIncluded:pages.filter(p=>p.included).length, urlsExcluded:pages.filter(p=>!p.included).length, notFound:c('404'), redirects:c('Redirect'), noindex:c('noindex'), canonicalized:c('Canonical'), blocked:c('robots.txt'), duplicates:c('Duplicate'), external:0, generationTimeMs:Date.now()-started }; }
module.exports={summarize};
