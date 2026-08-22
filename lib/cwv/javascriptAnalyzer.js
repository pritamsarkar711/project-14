'use strict';

/*
 * Core Web Vitals & INP Auditor: JavaScript audit.
 * Total bytes, file count, largest files, parser-blocking scripts,
 * duplicate libraries and main-thread execution (from long tasks).
 * Unused-JS percentages are NEVER estimated, coverage is not measured
 * in this environment and the report says so explicitly.
 */

function analyzeJavaScript(jsFiles, resources, longTaskGroups, docHost) {
  const files = (Array.isArray(jsFiles) ? jsFiles : []).map(f => ({
    url: f.url || f.name || '(script)',
    bytes: f.bytes != null ? f.bytes : null,
    bytesKnown: f.bytes != null,
    blocking: !!f.blocking,
    async: !!f.async,
    defer: !!f.defer,
    module: !!f.module,
    inHead: !!f.inHead
  }));

  let total = 0, measurableCount = 0, blockingCount = 0;
  files.forEach(f => {
    if (f.bytesKnown) { total += f.bytes; measurableCount++; }
    if (f.blocking) blockingCount++;
  });

  // Duplicate library detection: same script basename (or same versioned
  // library name) loaded more than once from the page.
  const byKey = new Map();
  files.forEach(f => {
    const m = String(f.url).match(/([^/?#]+?)(?:[-_.]v?\d+(?:\.\d+)*(?:[-_.]min)?)?\.js([?#]|$)/i);
    const key = m ? m[1].toLowerCase() : String(f.url);
    const arr = byKey.get(key) || [];
    arr.push(f.url);
    byKey.set(key, arr);
  });
  const duplicates = [];
  for (const [key, urls] of byKey) {
    const unique = Array.from(new Set(urls));
    if (unique.length > 1) duplicates.push({ library: key, urls: unique });
  }

  const host = String(docHost || '');
  const thirdParty = files.filter(f => {
    try { return host && !String(f.url).includes(new URL(host).hostname); } catch (e) { return false; }
  });

  const out = {
    fileCount: files.length,
    totalBytes: measurableCount ? total : null,
    bytesMeasurable: measurableCount > 0,
    largest: files.slice().sort((a, b) => (b.bytes || 0) - (a.bytes || 0)).slice(0, 8),
    blockingCount,
    blocking: files.filter(f => f.blocking).slice(0, 10),
    duplicates,
    thirdPartyCount: thirdParty.length,
    mainThread: {
      longTaskGroups: (Array.isArray(longTaskGroups) ? longTaskGroups : []).filter(g => g && /\.js([?#]|$)/i.test(g.source)).slice(0, 8),
      note: 'Main-thread execution from observed long tasks; JS not covered by long-task observation still runs on the main thread but is not quantified here.'
    },
    coverage: {
      status: 'not-measured',
      note: 'Unused-JS coverage was not measured (no browser coverage API in this environment). No unused-code percentages are reported or estimated.'
    }
  };
  return out;
}

module.exports = { analyzeJavaScript };
