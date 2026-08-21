'use strict';

/**
 * Export Manager
 * CSV and JSON export
 */

function toCsvRow(fields) {
  return fields.map(f => {
    const s = String(f == null ? '' : f);
    if (s.includes('"') || s.includes(',') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }).join(',');
}

function generateCsv(issues) {
  const headers = ['Source URL', 'Destination URL', 'Anchor text', 'HTTP status', 'Final URL', 'Classification', 'Error', 'Link type', 'Crawl depth', 'Occurrences', 'Is Internal', 'Redirect Count', 'Redirect Chain'];
  const rows = [toCsvRow(headers)];
  for (const issue of issues) {
    const r = issue.result || {};
    const cls = issue.classification || {};
    const chain = (r.redirects || []).map(h => `${h.status}:${h.from}->${h.to}`).join(' | ');
    rows.push(toCsvRow([
      issue.source || '',
      issue.destination || issue.url || '',
      issue.anchorText || '',
      r.status || '',
      r.finalUrl || '',
      cls.classification || '',
      cls.reason || r.error || '',
      issue.linkType || '',
      issue.depth != null ? issue.depth : '',
      issue.occurrences || 1,
      issue.isInternal ? 'internal' : 'external',
      (r.redirects || []).length,
      chain
    ]));
  }
  return rows.join('\n');
}

function generateJson(report) {
  return JSON.stringify(report, null, 2);
}

function getConfirmedBrokenUrls(issues) {
  return issues.filter(i => i.classification && i.classification.classification === 'Confirmed Broken').map(i => i.destination || i.url);
}

module.exports = { generateCsv, generateJson, getConfirmedBrokenUrls, toCsvRow };
