'use strict';

/*
 * LLMs.txt Generator, orchestrator.
 * `generate` runs the full crawl pipeline; `finalize` regenerates the file from
 * the user's edited page list (manual include/exclude, custom titles,
 * descriptions, categories, order, added URLs) without re-crawling.
 */

const { crawlSite } = require('./crawler');
const { selectPages, renderSections } = require('./llmsTxtGenerator');
const { validateLlmsTxt } = require('./llmsTxtValidator');
const { scoreQuality } = require('./qualityScorer');
const { normalizeUrl, hostOf } = require('./urlNormalizer');
const { assertPublicUrl, resolvePublic } = require('../wptheme/ssrf');

const PRIORITY_SCORE = { High: 85, Medium: 58, Low: 30 };

function prepareSiteFromUrl(raw) {
  const n = normalizeUrl(raw);
  if (!n) throw Object.assign(new Error('Please enter a valid website URL.'), { code: 'invalid_url' });
  assertPublicUrl(n.toString());
  return { root: n.toString(), host: hostOf(n.toString()) };
}

async function generate(raw, options = {}) {
  return crawlSite(raw, options);
}

/* Rebuild the markdown from an edited page list. Deterministic; no re-crawl. */
async function finalize(body = {}) {
  const site = prepareSiteFromUrl(body.url);
  const pages = (body.pages || []).slice(0, 5000).map(p => ({
    url: p.url,
    canonical: p.canonical || p.url,
    title: p.title || '',
    description: p.description || '',
    userTitle: p.userTitle || null,
    userDescription: p.userDescription != null ? p.userDescription : null,
    category: p.category || 'Other',
    kind: p.kind || 'normal',
    included: p.included !== false,
    external: !!p.external,
    isPdf: !!p.isPdf,
    order: p.order != null ? p.order : null,
    score: PRIORITY_SCORE[p.priority] != null ? PRIORITY_SCORE[p.priority] : 55
  }));

  const included = pages.filter(p => p.included);
  const options = {
    includeDocs: body.options ? body.options.includeDocs !== false : true,
    includeBlog: body.options ? body.options.includeBlog !== false : true,
    includeCategories: !!(body.options && body.options.includeCategories),
    includeAuthors: !!(body.options && body.options.includeAuthors),
    includePdfs: body.options ? body.options.includePdfs !== false : true,
    maxBlogUrls: (body.options && body.options.maxBlogUrls) || 25,
    maxProducts: (body.options && body.options.maxProducts) || 50
  };

  const { sections } = selectPages(included, site, options);
  // Re-mark inFile/section for the report.
  for (const p of included) { p.section = Object.keys(sections).find(name => (sections[name] || []).includes(p)) || null; p.inFile = !!p.section; }

  const description = (body.websiteDescription) || (body.site && body.site.description) || '';
  const siteName = (body.websiteName) || (body.site && (body.site.name || body.site.title)) || site.host;
  const llmsTxt = renderSections(sections, { name: siteName, title: siteName, host: site.host, description });

  const validation = validateLlmsTxt(llmsTxt);
  const all = included.concat(pages.filter(p => !p.included));
  const quality = scoreQuality({ included, validation, stats: { pagesDiscovered: pages.length }, site });
  const stats = {
    pagesDiscovered: pages.length,
    pagesCrawled: pages.length,
    pagesIncluded: included.length,
    pagesExcluded: pages.length - included.length,
    inFile: included.filter(p => p.inFile).length,
    broken: pages.filter(p => !p.included && /broken|404|410|5xx|DNS/i.test(p.reason || '')).length,
    duplicates: pages.filter(p => !p.included && /duplicate/i.test(p.reason || '')).length,
    generationTimeMs: 0
  };

  return { llmsTxt, validation, quality, stats, sections: Object.keys(sections), site: { name: siteName, description, host: site.host } };
}

module.exports = { generate, finalize, prepareSiteFromUrl };
