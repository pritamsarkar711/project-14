'use strict';

/*
 * Core Web Vitals & INP Auditor — font audit.
 * Font files/format/sizes, preload usage, font-display behaviour and
 * cross-origin font requests. FOIT/FOUT risks are reported from the
 * font-display rules actually observed — not assumed.
 */

const FONT_EXT = /\.(woff2?|ttf|otf|eot)([?#]|$)/i;

function analyzeFonts(fonts, cssFiles, resources, linkHints, docHost) {
  const list = Array.isArray(fonts) ? fonts : [];
  const css = Array.isArray(cssFiles) ? cssFiles : [];
  const res = Array.isArray(resources) ? resources : [];

  const faceRules = [];
  css.forEach(c => (c.fontFaces || []).forEach(f => faceRules.push(f)));

  const fontResources = res.filter(r => r && FONT_EXT.test(String(r.name || '')));
  let totalBytes = 0, measurable = 0;
  fontResources.forEach(r => { if (r.transferSize || r.encodedBodySize) { totalBytes += (r.transferSize || r.encodedBodySize); measurable++; } });

  const preloaded = (Array.isArray(linkHints && linkHints.preload) ? linkHints.preload : [])
    .filter(p => p && /font/i.test(p.as || '') || FONT_EXT.test(p.href || ''));
  const preloadedUrls = new Set(preloaded.map(p => p.href));

  const host = String(docHost || '');
  const crossOrigin = fontResources.filter(r => {
    try { return host && new URL(r.name).hostname !== new URL(host).hostname; } catch (e) { return false; }
  });

  const displayBlock = faceRules.filter(f => f.display === 'block');
  const displaySwap = faceRules.filter(f => f.display === 'swap');
  const noDisplay = faceRules.filter(f => !f.display);

  const familyWeights = new Map();
  faceRules.forEach(f => {
    if (!f.family) return;
    const w = familyWeights.get(f.family) || [];
    if (w.indexOf(f.weight) < 0) w.push(f.weight);
    familyWeights.set(f.family, w);
  });
  const manyWeights = [];
  for (const [fam, ws] of familyWeights) if (ws.length >= 4) manyWeights.push({ family: fam, weights: ws.length });

  const out = {
    fontFileCount: fontResources.length,
    totalBytes: measurable ? totalBytes : null,
    bytesMeasurable: measurable > 0,
    formats: fontResources.map(r => (String(r.name).match(/\.([a-z0-9]+)([?#]|$)/i) || [])[1] || null).filter(Boolean),
    families: Array.from(new Set(list.map(f => f.family).filter(Boolean))).slice(0, 30),
    loadedCount: list.filter(f => f.status === 'loaded').length,
    preloadedUrls: Array.from(preloadedUrls),
    crossOrigin: crossOrigin.map(r => r.name).slice(0, 12),
    fontDisplay: {
      block: displayBlock.length,
      swap: displaySwap.length,
      unspecified: noDisplay.length,
      details: faceRules.slice(0, 20).map(f => ({ family: f.family, display: f.display || 'unspecified', weight: f.weight, srcs: f.srcs.slice(0, 2) }))
    },
    manyWeights: manyWeights.slice(0, 8),
    issues: []
  };

  if (displayBlock.length && out.totalBytes && out.totalBytes > 150 * 1024) {
    out.issues.push({
      id: 'font-foit', severity: 'medium', title: 'FOIT risk: font-display: block with heavy fonts',
      detail: displayBlock.length + ' @font-face rule(s) use font-display: block while ' + Math.round(out.totalBytes / 1024) + ' KB of font data is loaded — text can stay invisible (FOIT) until fonts arrive.',
      evidence: 'font-display: block on ' + displayBlock.slice(0, 4).map(f => f.family || '(unnamed)').join(', ') + '; ' + Math.round(out.totalBytes / 1024) + ' KB of font files.'
    });
  }
  if (noDisplay.length) {
    out.issues.push({
      id: 'font-no-display', severity: 'low', title: 'font-display not specified',
      detail: noDisplay.length + ' @font-face rule(s) leave font-display unspecified; browsers use a short block period, which can cause layout shift when fallback text swaps.',
      evidence: 'No font-display on ' + noDisplay.slice(0, 4).map(f => f.family || '(unnamed)').join(', ') + '.'
    });
  }
  if (manyWeights.length) {
    out.issues.push({
      id: 'font-weights', severity: 'low', title: 'Many weights loaded per family',
      detail: manyWeights.length + ' family/families load ≥ 4 distinct weights. Each weight is a separate download — consider whether all are used.',
      evidence: manyWeights.map(m => m.family + ' (' + m.weights + ' weights)').join(', ')
    });
  }
  return out;
}

module.exports = { analyzeFonts };
