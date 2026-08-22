'use strict';

/*
 * LLMs.txt Generator, indexability analysis.
 * Determines whether a fetched page can be a candidate for llms.txt.
 *
 * Outcomes:
 *  - included  : 200 OK, indexable, HTML (or optional PDF)
 *  - excluded  : clear reason (404, 410, 5xx, redirect, noindex, wrong type, robots)
 *  - unverifiable : 401/403/429/bot protection, reported honestly, user decides
 */

function analyzeIndexability(page, options = {}) {
  const h = page.headers || {};
  const ct = String(h['content-type'] || page.contentType || '').toLowerCase();
  const xr = String(h['x-robots-tag'] || '').toLowerCase();

  if (page.blocked) return { indexable: false, status: 'excluded', reason: 'robots.txt restriction' };
  if (page.status >= 300 && page.status < 400) return { indexable: false, status: 'excluded', reason: 'Redirect' };
  if (page.status === 404) return { indexable: false, status: 'excluded', reason: 'HTTP 404' };
  if (page.status === 410) return { indexable: false, status: 'excluded', reason: 'HTTP 410' };
  if (page.status >= 500) return { indexable: false, status: 'excluded', reason: 'HTTP ' + page.status };
  if (page.status === 401 || page.status === 403 || page.status === 429) {
    const protectedMsg = page.challenge && page.challenge.detected ? 'Bot protection or access restriction' : 'HTTP ' + page.status;
    return { indexable: false, status: 'unverifiable', reason: protectedMsg };
  }
  if (page.status !== 200 && page.status !== 0) return { indexable: false, status: 'excluded', reason: 'HTTP ' + page.status };

  const isHtml = ct.includes('text/html') || ct.includes('application/xhtml');
  const isPdf = ct.includes('application/pdf') || /\.pdf([?#]|$)/i.test(String(page.url || '').split('?')[0]);
  if (!isHtml && !(options.includePdfs && isPdf)) {
    return { indexable: false, status: 'excluded', reason: 'Unsupported content type' };
  }

  if (!options.includeNoindex && (page.noindex || /noindex/.test(xr))) {
    return { indexable: false, status: 'excluded', reason: 'noindex' };
  }

  return { indexable: true, status: 'included', reason: '200 OK indexable page' };
}

module.exports = { analyzeIndexability };
