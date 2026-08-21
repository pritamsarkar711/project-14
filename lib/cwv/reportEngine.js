'use strict';

/*
 * Core Web Vitals & INP Auditor — report assembler.
 *
 * Produces the final UI-ready report with the required sections:
 * score, Core Web Vitals summary, INP, LCP, CLS, FCP, TTFB, network
 * waterfall, JavaScript, CSS, images, fonts, third parties, caching,
 * rendering, priority issues, recommendations, technical details.
 *
 * Lab and field data are structurally separated — never merged.
 */

const TH = require('./thresholds');

function fmtMs(v) { return v == null ? null : (Math.round(v * 10) / 10); }
function fmtCls(v) { return v == null ? null : (Math.round(v * 10000) / 10000); }
function fmtBytes(b) {
  if (b == null) return null;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB';
  return Math.round(b / (1024 * 1024) * 10) / 10 + ' MB';
}

function vitalsRow(key, label, value, unit, classification, advisory, extra) {
  const row = {
    key, label, advisory: !!advisory,
    value: value,
    display: value == null ? null : (unit === '' ? String(value) : value + ' ' + unit),
    status: classification ? classification.status : 'unavailable',
    statusLabel: classification ? classification.label : 'Not Available',
    source: 'lab'
  };
  if (extra) Object.assign(row, extra);
  return row;
}

function assemble(bundle, R, engineVersion) {
  const meta = R.meta;
  const vitals = R.vitals;

  const summary = [
    vitalsRow('lcp', 'LCP', R.lcp.value, 'ms', R.lcp.classification, false,
      R.lcp.status !== 'measured' ? { reason: R.lcp.reason || 'Unable to Measure' } : null),
    vitalsRow('inp', 'INP', R.inp.value, 'ms', R.inp.classification, false,
      R.inp.status !== 'measured' ? { reason: R.inp.reason || 'Unable to Measure' } : { labNote: 'Lab value from synthetic interactions' }),
    vitalsRow('cls', 'CLS', R.cls.value, '', R.cls.classification, false,
      R.cls.status !== 'measured' ? { reason: R.cls.reason || 'Unable to Measure' } : null),
    vitalsRow('fcp', 'FCP', R.fcp.value, 'ms', R.fcp.classification, true,
      R.fcp.status !== 'measured' ? { reason: R.fcp.reason || 'Unable to Measure' } : null),
    vitalsRow('ttfb', 'TTFB', R.ttfb.value, 'ms', R.ttfb.classification, true,
      R.ttfb.status !== 'measured' ? { reason: R.ttfb.reason || 'Unable to Measure' } : { measurementSource: R.ttfb.source }),
    vitalsRow('tbt', 'TBT', R.longTasks.tbt, 'ms', TH.classify(R.longTasks.tbt, TH.advisory.tbt), true,
      R.longTasks.total === 0 && R.longTasks.tbt === 0 ? { advisoryNote: 'No long tasks observed' } : null),
    vitalsRow('si', 'Speed Index', null, 'ms', null, true, { reason: 'Not measurable without video/screenshot capture (no DevTools protocol in this environment).' })
  ];

  const report = {
    engine: { name: 'huvanti Core Web Vitals & INP Auditor', version: engineVersion, thresholdsVersion: TH.version, thresholdsSources: TH.sources },
    generatedAt: new Date().toISOString(),
    scope: { pages: 1, label: 'One page (single URL audit)' },
    meta: {
      requestedUrl: meta.requestedUrl || null,
      finalUrl: meta.finalUrl || null,
      redirects: Array.isArray(meta.redirects) ? meta.redirects : [],
      transport: meta.transport || null,
      relay: meta.relay || null,
      profile: bundle.profile || null,
      htmlStatus: meta.htmlStatus != null ? meta.htmlStatus : null,
      htmlBytes: meta.htmlBytes != null ? meta.htmlBytes : null,
      htmlTruncated: !!meta.htmlTruncated,
      challenge: !!meta.challenge,
      challengeGuard: meta.challengeGuard || null,
      userAgent: meta.userAgent || null,
      protocolDoc: meta.protocolDoc || null,
      startedAt: meta.startedAt || null,
      completedAt: meta.completedAt || null,
      notes: Array.isArray(meta.notes) ? meta.notes : [],
      warnings: Array.isArray(bundle.warnings) ? bundle.warnings.slice(0, 10) : []
    },
    field: {
      status: 'unavailable',
      label: 'Field data unavailable for this URL.',
      reason: 'Legitimate public field data (Chrome UX Report) requires a CrUX API key or BigQuery access, which this tool does not use. No field metrics were fetched, estimated or fabricated.'
    },
    lab: {
      label: 'Lab Data',
      note: 'Measured in a real browser session run by the auditor. Values include the auditor\u2019s own proxy hop where the proxy transport was used — see Technical Details.',
      profile: bundle.profile || null,
      score: R.score,
      vitals: summary,
      inp: R.inp,
      lcp: R.lcp,
      cls: R.cls,
      fcp: R.fcp,
      ttfb: R.ttfb,
      longTasks: R.longTasks,
      waterfall: R.waterfall,
      resources: R.resources,
      dependency: R.dependency,
      javascript: R.js,
      css: R.css,
      images: R.images,
      fonts: R.fonts,
      cache: R.cache,
      thirdParties: R.thirdParties,
      dom: R.dom,
      rendering: R.rendering,
      hints: R.dependency.hints,
      hardening: bundle.hardening || null,
      interactives: bundle.interactives || null
    },
    issues: R.recommendations.issues,
    issueCounts: { critical: R.recommendations.critical, high: R.recommendations.high, medium: R.recommendations.medium, low: R.recommendations.low },
    recommendationsNote: R.recommendations.note,
    technical: {
      measurement: {
        browser: meta.userAgent || 'Unknown browser',
        transport: meta.transport === 'server-proxy'
          ? 'Server-side proxied fetch (subresources loaded through the auditor origin, full Resource Timing + response headers).'
          : 'Browser-direct load (subresources fetched cross-origin by your browser; timing/sizes hidden by the timing-allow-origin policy are marked unavailable).',
        proxyHop: meta.transport === 'server-proxy' ? 'Render timings are measured from the auditor\u2019s proxy origin and include one extra network hop to the auditor server. Phase values are therefore approximate.' : null,
        cpuThrottle: 'Not applied — CPU throttling requires DevTools protocol access, which a browser-sandbox measurement does not have. Results differ from a device-lab run.',
        networkThrottle: bundle.profile && bundle.profile.network && bundle.profile.network.label
          ? (meta.transport === 'server-proxy' ? 'Network throttling applied by the auditor proxy: ' + bundle.profile.network.label + '. The throttle shapes proxied responses only.' : 'Network throttling could not be applied in browser-direct mode — run unthrottled.')
          : 'No network throttling.',
        viewport: bundle.profile && bundle.profile.viewport ? bundle.profile.viewport.w + '×' + bundle.profile.viewport.h : null,
        cluLabel: 'Lab values approximate real-user conditions but are not field data. INP from synthetic interactions reflects responsiveness problems, not real-user interaction patterns.'
      },
      limitations: [
        'Lab test — not field data. Synthetic INP is not real-user INP.',
        'Speed Index not measured (no screenshot/video capture).',
        'Unused-JS percentages not measured (no coverage data).',
        'Forced synchronous layout not observable from page JS (needs DevTools tracing).',
        'Sub-frame (iframe) layout shifts inside the page are not aggregated.',
        'Sites behind bot challenges may fail or degrade under proxied measurement.',
        'In the proxied transport, relative-path API calls made by scripts resolve to the auditor origin and may fail — page behaviour can differ from a direct visit.'
      ],
      privacy: 'The URL is treated as untrusted: private/loopback/metadata targets are refused, DNS is pinned per request, redirects are re-validated, and responses are size-capped. Proxied pages run in a sandboxed iframe with isolated storage and no service-worker or cookie access. Scan sessions live in server memory with a short TTL — nothing is stored server-side.',
      reproducibility: 'The score and all derived values are deterministic functions of the measurement bundle; re-running produces the same score for the same bundle. Network conditions vary between runs, so live measurements differ.'
    }
  };
  return report;
}

module.exports = { assemble, fmtMs, fmtCls, fmtBytes };
