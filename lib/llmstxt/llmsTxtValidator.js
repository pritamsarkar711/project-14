'use strict';

/*
 * LLMs.txt Generator — generated-file validation.
 * Checks markdown structure, heading structure, URL syntax, duplicates,
 * empty sections, invalid characters, link format and unsupported structure.
 * Deterministic; reports pass/warn/fail per check.
 */

function validHttpUrl(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return false;
    if (x.username || x.password) return false;
    return !!x.hostname;
  } catch { return false; }
}

function validateLlmsTxt(text) {
  const checks = [];
  const errors = [];
  const warnings = [];
  const lines = String(text || '').split(/\r?\n/);
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  const first = nonEmpty[0] || '';

  // 1. H1 title (required).
  const h1s = nonEmpty.filter(l => /^#\s+/.test(l));
  if (h1s.length === 0) { checks.push({ name: 'H1 title', status: 'fail', message: 'Missing the required # title.' }); errors.push('Missing H1 title.'); }
  else if (h1s.length > 1) { checks.push({ name: 'H1 title', status: 'fail', message: 'Multiple # headings found; only one H1 is allowed.' }); errors.push('Multiple H1 headings.'); }
  else if (!/^#\s+\S/.test(first)) { checks.push({ name: 'H1 title', status: 'fail', message: 'The # title must be the first content line.' }); errors.push('H1 is not the first line.'); }
  else checks.push({ name: 'H1 title', status: 'pass', message: 'Single H1 title present.' });

  // 2. Blockquote summary.
  const blockquote = nonEmpty.slice(0, 5).find(l => /^>\s/.test(l));
  if (blockquote) checks.push({ name: 'Summary', status: 'pass', message: 'Blockquote summary present.' });
  else { checks.push({ name: 'Summary', status: 'warn', message: 'No blockquote summary (optional per spec).' }); warnings.push('No blockquote summary.'); }

  // 3. Heading structure — only H1/H2.
  const badHeadings = nonEmpty.filter(l => /^#{3,}\s/.test(l));
  if (badHeadings.length) { checks.push({ name: 'Heading structure', status: 'fail', message: badHeadings.length + ' heading(s) deeper than H2 found.' }); errors.push('Unsupported heading level (H3+).'); }
  else checks.push({ name: 'Heading structure', status: 'pass', message: 'Only H1/H2 headings used.' });

  // 4. Sections: collect H2 sections and their list items.
  const sections = [];
  let cur = null;
  for (const l of nonEmpty) {
    if (/^##\s+/.test(l)) { cur = { title: l.replace(/^##\s+/, '').trim(), items: [] }; sections.push(cur); }
    else if (/^-\s+/.test(l) && cur) cur.items.push(l);
  }
  const h2Titles = sections.map(s => s.title);
  const dupH2 = h2Titles.filter((t, i) => h2Titles.indexOf(t) !== i);
  if (dupH2.length) { checks.push({ name: 'Section names', status: 'fail', message: 'Duplicate H2 section: ' + dupH2[0] }); errors.push('Duplicate H2 section.'); }
  else checks.push({ name: 'Section names', status: 'pass', message: 'No duplicate section headings.' });

  // 5. Empty sections.
  const emptySecs = sections.filter(s => s.items.length === 0).map(s => s.title);
  if (emptySecs.length) { checks.push({ name: 'Empty sections', status: 'fail', message: 'Empty section(s): ' + emptySecs.join(', ') }); errors.push('Empty sections.'); }
  else checks.push({ name: 'Empty sections', status: 'pass', message: 'No empty sections.' });

  // 6. Links: format, URL validity, duplicates.
  const urls = [];
  const linkRe = /\[([^\]]*)\]\(([^)\s]+)\)/g;
  let badLink = 0;
  for (const s of sections) {
    for (const item of s.items) {
      const m = item.match(/^-\s*\[([^\]]*)\]\(([^)\s]+)\)/);
      if (!m) { badLink++; continue; }
      const name = m[1]; const url = m[2].replace(/^<|>$/g, '');
      urls.push({ name, url });
      if (!validHttpUrl(url)) { badLink++; errors.push('Invalid URL: ' + url); }
      if (!name.trim()) { badLink++; errors.push('Empty link title.'); }
    }
  }
  if (badLink) checks.push({ name: 'Link format', status: 'fail', message: badLink + ' malformed link(s).' });
  else checks.push({ name: 'Link format', status: 'pass', message: 'All links use the [name](url) format.' });

  const seen = new Map();
  const dupUrls = [];
  for (const { url } of urls) { const k = url.replace(/\/+$/, ''); if (seen.has(k)) dupUrls.push(url); else seen.set(k, 1); }
  if (dupUrls.length) { checks.push({ name: 'Duplicate URLs', status: 'fail', message: dupUrls.length + ' duplicate URL(s).' }); errors.push('Duplicate URLs.'); }
  else checks.push({ name: 'Duplicate URLs', status: 'pass', message: 'No duplicate URLs.' });

  // 7. Invalid characters.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) { checks.push({ name: 'Characters', status: 'fail', message: 'Invalid control characters present.' }); errors.push('Invalid control characters.'); }
  else checks.push({ name: 'Characters', status: 'pass', message: 'No invalid characters.' });

  // 8. File size sanity.
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > 250 * 1024) { checks.push({ name: 'File size', status: 'warn', message: 'File is large (' + Math.round(bytes / 1024) + ' KB); consider trimming.' }); warnings.push('File is large.'); }
  else checks.push({ name: 'File size', status: 'pass', message: 'File size is reasonable (' + Math.round(bytes / 1024) + ' KB).' });

  const fails = checks.filter(c => c.status === 'fail').length;
  return {
    valid: fails === 0,
    checks,
    errors,
    warnings,
    stats: { sections: sections.length, links: urls.length, bytes, h1: h1s.length, duplicates: dupUrls.length }
  };
}

module.exports = { validateLlmsTxt, validHttpUrl };
