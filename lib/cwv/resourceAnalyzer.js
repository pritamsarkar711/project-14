'use strict';

/*
 * Core Web Vitals & INP Auditor — resource analyzer.
 * Aggregates the measured network activity: request counts, transfer size,
 * largest resources, statuses, compression coverage and protocol mix.
 * Everything is computed from the recorded evidence; nothing is estimated.
 */

function analyzeResources(waterfall, resourceMeta, docHeaders, docProtocol) {
  const out = {
    requestCount: 0,
    transferBytes: null,
    bytesMeasurable: false,
    largest: [],
    statuses: {},
    compression: { status: 'unavailable', compressedText: 0, textResources: 0, note: null },
    protocol: { doc: docProtocol || null, observed: [], note: null },
    byType: {}
  };
  if (!waterfall) return out;
  out.requestCount = waterfall.requestCount;
  out.byType = waterfall.byType || {};
  out.transferBytes = waterfall.bytesMeasurable ? waterfall.totalBytes : null;
  out.bytesMeasurable = waterfall.bytesMeasurable;

  out.largest = waterfall.rows
    .filter(r => r.transferSize)
    .sort((a, b) => b.transferSize - a.transferSize)
    .slice(0, 8)
    .map(r => ({ url: r.url, type: r.type, bytes: r.transferSize }));

  const items = resourceMeta && Array.isArray(resourceMeta.items) ? resourceMeta.items : [];
  items.forEach(m => {
    if (m.status) out.statuses[m.status] = (out.statuses[m.status] || 0) + 1;
  });
  if (resourceMeta && resourceMeta.mode === 'server-proxy') {
    const textTypes = ['stylesheet', 'script', 'document'];
    const textItems = items.filter(m => {
      const ct = String(m.contentType || '').toLowerCase();
      const url = String(m.url || '');
      return /html|css|javascript|json|xml|svg|text\//.test(ct) || /\.(css|js|mjs|html?|json|xml|svg|txt)([?#]|$)/i.test(url);
    });
    if (textItems.length) {
      out.compression.status = 'measured';
      textItems.forEach(m => {
        out.compression.textResources++;
        const enc = String(m.headers && m.headers['content-encoding'] || '').toLowerCase();
        if (enc && enc !== 'identity') out.compression.compressedText++;
      });
      const uncompressed = textItems.filter(m => {
        const enc = String(m.headers && m.headers['content-encoding'] || '').toLowerCase();
        return (!enc || enc === 'identity') && (m.bytes == null || m.bytes > 10 * 1024);
      });
      if (uncompressed.length) {
        out.compression.uncompressed = uncompressed.slice(0, 8).map(m => ({ url: m.url, bytes: m.bytes }));
        out.compression.note = out.compression.uncompressed.length + ' text resource(s) ≥ 10 KB served without gzip/Brotli compression.';
      }
    } else {
      out.compression.note = 'No text resources were recorded with observable headers.';
    }
  } else {
    out.compression.note = 'Compression headers not observable in this transport mode (response headers not recorded).';
  }

  const protos = new Set();
  waterfall.rows.forEach(r => { if (r.protocol) protos.add(r.protocol); });
  if (docProtocol) protos.add(docProtocol);
  out.protocol.observed = Array.from(protos);
  out.protocol.note = out.protocol.observed.length
    ? 'Protocols observed on actual connections during this test (HTTP/1.1 is reported as an observation, not automatically a fault).'
    : 'Protocol not observable in this transport mode.';
  return out;
}

module.exports = { analyzeResources };
