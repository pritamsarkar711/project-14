'use strict';

/*
 * Core Web Vitals & INP Auditor, resource waterfall builder.
 *
 * Builds a sortable waterfall from real Resource Timing entries:
 * start time, duration, transfer size, resource type, status (from the
 * recorded headers where available), initiator and observed protocol.
 * Entries whose timing was hidden cross-origin are flagged (timingOK=false)
 * instead of being padded with invented numbers.
 */

const FONT_EXT = /\.(woff2?|ttf|otf|eot)([?#]|$)/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)([?#]|$)/i;

function typeOf(r) {
  const t = String(r.initiatorType || '').toLowerCase();
  const name = String(r.name || '');
  if (t === 'css') return FONT_EXT.test(name) ? 'font' : 'stylesheet';
  if (t === 'link') return 'stylesheet';
  if (t === 'script') return 'script';
  if (t === 'img' || t === 'image') return 'image';
  if (t === 'font') return 'font';
  if (t === 'xmlhttprequest' || t === 'fetch' || t === 'beacon') return 'fetch';
  if (t === 'video' || t === 'audio') return 'media';
  if (t === 'navigation' || t === 'iframe') return 'document';
  if (t === 'other') return IMAGE_EXT.test(name) ? 'image' : 'other';
  return t || 'other';
}

function buildWaterfall(resources, resourceMeta) {
  const rows = (Array.isArray(resources) ? resources : []).map((r, i) => {
    const name = String(r.name || '');
    const type = typeOf(r);
    const meta = resourceMeta && Array.isArray(resourceMeta.items)
      ? resourceMeta.items.find(m => m && m.url === name)
      : null;
    return {
      index: i,
      url: name,
      type,
      startTime: typeof r.startTime === 'number' ? Math.round(r.startTime * 10) / 10 : null,
      duration: (r.timingAvailable && typeof r.duration === 'number') ? Math.round(r.duration * 10) / 10 : null,
      transferSize: r.transferSize || r.encodedBodySize || null,
      decodedSize: r.decodedBodySize || null,
      protocol: r.protocol || (meta && meta.protocol) || null,
      status: meta ? meta.status : null,
      timingOK: !!r.timingAvailable,
      redirectCount: r.redirectCount || 0
    };
  });

  const byType = {};
  let totalBytes = 0, measurableBytes = 0;
  rows.forEach(r => {
    byType[r.type] = (byType[r.type] || 0) + 1;
    if (r.transferSize) { totalBytes += r.transferSize; measurableBytes += r.transferSize; }
  });

  return {
    rows,
    requestCount: rows.length,
    byType,
    totalBytes,
    bytesMeasurable: measurableBytes > 0,
    note: 'Sizes and durations are real Resource Timing values; entries hidden by cross-origin timing policy are marked "timing not exposed" rather than estimated.',
    sortable: ['startTime', 'duration', 'transferSize', 'type', 'url']
  };
}

module.exports = { buildWaterfall, typeOf };
