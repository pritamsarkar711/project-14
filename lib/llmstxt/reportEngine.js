'use strict';

/*
 * LLMs.txt Generator — report/summary engine.
 * Aggregates crawl stats + coverage/exclusion breakdown for the UI.
 */

const REASON_LABELS = {
  'Duplicate': 'Duplicate',
  'Noindex': 'Noindex',
  'Utility': 'Utility page',
  'Broken': 'Broken',
  'Tracking': 'Tracking URL',
  'Low relevance': 'Low relevance',
  'Non-canonical': 'Non-canonical',
  'Robots': 'Robots.txt restriction',
  'Unsupported': 'Unsupported content type',
  'Login/Cart/Account': 'Login, cart or account page',
  'Category page (disabled)': 'Category page (disabled)',
  'Author page (disabled)': 'Author page (disabled)',
  'PDF (disabled)': 'PDF (disabled)',
  'Pagination': 'Pagination page',
  'Redirect': 'Redirect',
  'Unable to verify': 'Unable to verify',
  'User excluded': 'User excluded',
  'Other': 'Other'
};

function groupReasons(pages) {
  const counts = new Map();
  for (const p of pages) {
    if (p.included) continue;
    const key = p.excludeReason || p.reason || 'Other';
    const label = REASON_LABELS[key] || REASON_LABELS.Other;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

function summarize(pages, discovered, started, options = {}) {
  const included = pages.filter(p => p.included);
  const excluded = pages.filter(p => !p.included);
  const c = k => pages.filter(p => p.reason && String(p.reason).includes(k)).length;
  const stats = {
    pagesDiscovered: discovered,
    pagesCrawled: pages.length,
    pagesIncluded: included.length,
    pagesExcluded: excluded.length,
    inFile: pages.filter(p => p.inFile).length,
    broken: c('404') + c('410') + c('5xx') + c('DNS'),
    redirects: c('Redirect'),
    noindex: c('noindex'),
    canonicalized: c('Canonical'),
    duplicates: c('Duplicate'),
    blocked: c('robots'),
    unableToVerify: c('Unable to verify'),
    tracking: c('Tracking'),
    utility: c('Utility'),
    generationTimeMs: Date.now() - started
  };
  return stats;
}

module.exports = { summarize, groupReasons, REASON_LABELS };
