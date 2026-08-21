'use strict';

/*
 * Core Web Vitals & INP Auditor — bundle analysis orchestration.
 *
 * The measurement bundle is produced by the visitor's browser (either
 * through the server proxy or the browser-direct fallback) and POSTed to
 * /api/cwv-analyze. This module validates it (it is untrusted input),
 * runs the deterministic analysis pipeline and returns the report.
 *
 * Pipeline:
 *   validation → CLS session windows → INP breakdown → LCP element &
 *   phases → FCP → TTFB → long tasks → waterfall → dependency tree →
 *   JS/CSS/image/font/cache/third-party/DOM/rendering audits →
 *   evidence-based recommendations → transparent score → report.
 */

const TH = require('./thresholds');
const { analyzeCls } = require('./clsAnalyzer');
const { analyzeInp } = require('./inpAnalyzer');
const { analyzeLcp } = require('./lcpAnalyzer');
const { analyzeFcp } = require('./fcpAnalyzer');
const { analyzeTtfb } = require('./ttfbAnalyzer');
const { analyzeLongTasks } = require('./longTaskAnalyzer');
const { buildWaterfall } = require('./waterfallBuilder');
const { analyzeResources } = require('./resourceAnalyzer');
const { buildDependencyTree } = require('./dependencyAnalyzer');
const { analyzeJavaScript } = require('./javascriptAnalyzer');
const { analyzeCss } = require('./cssAnalyzer');
const { analyzeImages } = require('./imageAnalyzer');
const { analyzeFonts } = require('./fontAnalyzer');
const { analyzeCache } = require('./cacheAnalyzer');
const { analyzeThirdParties } = require('./thirdPartyAnalyzer');
const { analyzeDom } = require('./domAnalyzer');
const { analyzeRendering } = require('./renderingAnalyzer');
const { buildRecommendations } = require('./recommendationEngine');
const { calculateScore } = require('./scoreCalculator');
const { assemble } = require('./reportEngine');

const ENGINE_VERSION = '1.0.0';
const MAX_STRING = 2000;

function cleanStr(v, n) {
  if (typeof v !== 'string') return null;
  return v.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, n || MAX_STRING).trim() || null;
}
function cleanNum(v) {
  return (typeof v === 'number' && isFinite(v)) ? v : null;
}

function validateBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') throw err('invalid_bundle', 'The measurement bundle is missing.');
  if (!bundle.meta || typeof bundle.meta !== 'object') throw err('invalid_bundle', 'The measurement bundle has no metadata.');
  const meta = bundle.meta;
  if (!meta.requestedUrl && !meta.finalUrl) throw err('invalid_bundle', 'The measurement bundle has no URL.');
  // transport whitelist
  if (meta.transport && meta.transport !== 'server-proxy' && meta.transport !== 'browser-direct') {
    throw err('invalid_bundle', 'Unknown transport mode.');
  }
  if (!bundle.vitals || typeof bundle.vitals !== 'object') throw err('invalid_bundle', 'The measurement bundle has no vitals.');
  // arrays must be arrays (attacker-controlled)
  const arrayKeys = ['resources', 'images', 'fonts', 'cssFiles', 'jsFiles', 'internalLinks', 'longTasks', 'loafs'];
  for (const k of arrayKeys) {
    if (bundle[k] != null && !Array.isArray(bundle[k])) throw err('invalid_bundle', 'Bundle field "' + k + '" must be an array.');
  }
  return true;
}

function err(code, message) { const e = new Error(message); e.code = code; return e; }

function analyzeBundle(bundle, opt) {
  opt = opt || {};
  validateBundle(bundle);
  const meta = bundle.meta || {};
  const vitals = bundle.vitals || {};
  const docHost = (function () {
    try { return new URL(meta.finalUrl || meta.requestedUrl).hostname; } catch (e) { return ''; }
  })();

  /* ---- analyzers ---- */
  const cls = analyzeCls(vitals);
  const inp = analyzeInp(vitals, bundle.longTasks, bundle.jsFiles);
  const lcp = analyzeLcp(vitals, bundle.resources, bundle.images, bundle.docPhases, bundle.nav, bundle.linkHints);
  const fcp = analyzeFcp(vitals, bundle.docPhases, bundle.cssFiles, bundle.jsFiles, bundle.fonts, bundle.nav);
  const ttfb = analyzeTtfb(bundle.docPhases, bundle.docHeaders, bundle.nav, meta.transport);
  const longTasks = analyzeLongTasks(bundle.longTasks, vitals.inp && vitals.inp.interactions);
  const waterfall = buildWaterfall(bundle.resources, bundle.resourceMeta);
  const resources = analyzeResources(waterfall, bundle.resourceMeta, bundle.docHeaders, meta.protocolDoc);
  const dependency = buildDependencyTree(meta, bundle.cssFiles, bundle.jsFiles, bundle.resources, bundle.linkHints);
  const js = analyzeJavaScript(bundle.jsFiles, bundle.resources, longTasks.groups, docHost);
  const css = analyzeCss(bundle.cssFiles, bundle.resources, bundle.inlineCssBytes);
  const images = analyzeImages(bundle.images);
  const fonts = analyzeFonts(bundle.fonts, bundle.cssFiles, bundle.resources, bundle.linkHints, docHost);
  const cache = analyzeCache(bundle.resourceMeta, bundle.docHeaders);
  const thirdParties = analyzeThirdParties(bundle.resources, bundle.longTasks, docHost, bundle.jsFiles);
  const dom = analyzeDom(bundle.dom);
  const rendering = analyzeRendering(bundle.loafs, longTasks, cls, bundle.dom);

  const recommendations = buildRecommendations({
    lcp, inp, cls, fcp, ttfb, css, js, images, fonts, cache, thirdParties, dom, rendering,
    resources, longTasks, waterfall, doc: meta, hints: bundle.linkHints || {}
  });

  const score = calculateScore({ lcp, inp, cls, fcp, ttfb, longTasks, waterfall, cache, resources, dom });

  const report = assemble(bundle, {
    meta, vitals, cls, inp, lcp, fcp, ttfb, longTasks, waterfall, resources,
    dependency, js, css, images, fonts, cache, thirdParties, dom, rendering,
    recommendations, score,
    thresholds: TH
  }, ENGINE_VERSION);

  return report;
}

module.exports = { analyzeBundle, validateBundle, ENGINE_VERSION };
