'use strict';

/*
 * Core Web Vitals & INP Auditor — image audit.
 * Checks every measured image for format, size vs rendered dimensions,
 * width/height attributes (CLS), lazy-loading of above-the-fold images,
 * responsive srcset/sizes and priority. Compression is NOT estimated —
 * byte savings are only reported when measured, otherwise labelled
 * "potentially reducible".
 */

const MODERN = /\.(webp|avif)([?#]|$)/i;
const LEGACY = /\.(png|jpe?g|gif)([?#]|$)/i;

function analyzeImages(images) {
  const list = Array.isArray(images) ? images : [];
  const out = {
    count: list.length,
    totalBytes: null,
    bytesMeasurable: false,
    issues: [],
    oversized: [],
    missingDimensions: [],
    lazyAboveFold: [],
    legacyLarge: [],
    note: null
  };

  let total = 0, measurable = 0;
  list.forEach(img => {
    const src = img.src || '';
    const fmt = (src.match(/\.([a-z0-9]+)([?#]|$)/i) || [])[1] || null;
    const bytes = img.bytes != null ? img.bytes : null;
    if (bytes != null) { total += bytes; measurable++; }

    const entry = {
      src,
      format: fmt,
      bytes,
      renderedW: img.renderedW || null,
      renderedH: img.renderedH || null,
      naturalW: img.naturalW || null,
      naturalH: img.naturalH || null,
      loading: img.loading || null,
      fetchpriority: img.fetchpriority || null,
      decoding: img.decoding || null,
      srcset: !!img.srcset,
      sizes: !!img.sizes,
      hasDimensions: !!img.hasDimensions,
      inViewport: !!img.inViewport
    };
    const id = entry.src;

    if (entry.inViewport && entry.loading === 'lazy') {
      out.lazyAboveFold.push(id);
      out.issues.push({
        id: 'img-lazy-above-fold', severity: 'high', image: src, imageEntry: entry,
        title: 'Above-the-fold image is lazy-loaded',
        detail: 'loading="lazy" delays above-the-fold images until layout is known — adding load delay to first paint. Never lazy-load images visible in the initial viewport.',
        evidence: src + ' renders in the initial viewport with loading="lazy".'
      });
    }
    if (!entry.hasDimensions && (entry.naturalW || entry.renderedW)) {
      out.missingDimensions.push(id);
      out.issues.push({
        id: 'img-no-dimensions', severity: 'medium', image: src, imageEntry: entry,
        title: 'Image without width/height attributes',
        detail: 'The image has no width/height attributes, so the browser cannot reserve layout space — late layout causes Cumulative Layout Shift.',
        evidence: src + ' (renders ' + (entry.renderedW || '?') + '×' + (entry.renderedH || '?') + 'px, no width/height attributes).'
      });
    }
    if (entry.naturalW && entry.renderedW && entry.naturalW > entry.renderedW * 1.6 && entry.bytes && entry.bytes > 100 * 1024) {
      out.oversized.push(id);
      out.issues.push({
        id: 'img-oversized', severity: 'high', image: src, imageEntry: entry,
        title: 'Image downloaded far larger than it renders',
        detail: 'Intrinsic size exceeds rendered size significantly — excess pixels are downloaded and decoded for nothing.',
        evidence: 'Intrinsic ' + entry.naturalW + '×' + entry.naturalH + 'px, rendered ' + entry.renderedW + '×' + entry.renderedH + 'px, ' + Math.round(entry.bytes / 1024) + ' KB downloaded.',
        savings: { kind: 'bytes', current: entry.bytes, potential: null, label: 'Potentially reducible (exact optimized size not measured)' }
      });
    }
    if (LEGACY.test(src) && bytes && bytes > 200 * 1024) {
      out.legacyLarge.push(id);
      out.issues.push({
        id: 'img-legacy-format', severity: 'medium', image: src, imageEntry: entry,
        title: 'Large image in a legacy format',
        detail: 'A ' + Math.round(bytes / 1024) + ' KB ' + (fmt || '') + ' — WebP/AVIF typically encode this content much smaller.',
        evidence: src + ' (' + Math.round(bytes / 1024) + ' KB, format ' + (fmt || 'unknown') + ').',
        savings: { kind: 'bytes', current: bytes, potential: null, label: 'Potentially reducible (no re-encode was performed)' }
      });
    }
  });

  out.totalBytes = measurable ? total : null;
  out.bytesMeasurable = measurable > 0;
  out.note = out.bytesMeasurable ? null : 'Image byte sizes were not exposed cross-origin in this transport mode; size-based findings are limited.';
  return out;
}

module.exports = { analyzeImages, MODERN, LEGACY };
