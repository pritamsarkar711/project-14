'use strict';

/*
 * Core Web Vitals & INP Auditor: CSS audit.
 * Total CSS, stylesheet count, large/blocking stylesheets, @imports
 * (which serialize CSS delivery), duplicate stylesheets and inline CSS.
 */

function analyzeCss(cssFiles, resources, inlineCssBytes) {
  const files = (Array.isArray(cssFiles) ? cssFiles : []).map(c => ({
    url: c.url || c.name || '(stylesheet)',
    bytes: c.bytes != null ? c.bytes : null,
    bytesKnown: c.bytes != null,
    blocking: !!c.blocking,
    inline: !!c.inline,
    media: c.media || null,
    imports: Array.isArray(c.imports) ? c.imports : [],
    fontFaces: Array.isArray(c.fontFaces) ? c.fontFaces : []
  }));

  let total = 0, measurableCount = 0, blockingCount = 0;
  const allImports = [];
  files.forEach(c => {
    if (c.bytesKnown) { total += c.bytes; measurableCount++; }
    if (c.blocking) blockingCount++;
    c.imports.forEach(im => allImports.push({ url: im.url, from: c.url }));
  });

  const byUrl = new Map();
  files.forEach(c => {
    const arr = byUrl.get(c.url) || [];
    arr.push(c);
    byUrl.set(c.url, arr);
  });
  const duplicates = [];
  for (const [url, arr] of byUrl) if (arr.length > 1) duplicates.push({ url, count: arr.length });

  const out = {
    stylesheetCount: files.length,
    totalBytes: measurableCount ? total : null,
    bytesMeasurable: measurableCount > 0,
    largest: files.slice().sort((a, b) => (b.bytes || 0) - (a.bytes || 0)).slice(0, 8),
    blockingCount,
    blocking: files.filter(c => c.blocking).slice(0, 10),
    imports: allImports.slice(0, 20),
    importCount: allImports.length,
    duplicates,
    inlineCssBytes: typeof inlineCssBytes === 'number' ? inlineCssBytes : null,
    note: allImports.length ? 'CSS @import chains serialize stylesheet delivery: the importing stylesheet must be fetched and parsed before the imported one is requested.' : null
  };
  return out;
}

module.exports = { analyzeCss };
