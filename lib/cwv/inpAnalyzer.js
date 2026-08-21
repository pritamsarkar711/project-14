'use strict';

/*
 * Core Web Vitals & INP Auditor — INP analyzer.
 *
 * The lab INP is derived from the synthetic interactions the measurement
 * script actually ran (each with a measured input-delay / processing /
 * presentation breakdown). It is explicitly a LAB value: it can surface
 * responsiveness problems, but it is not real-user field data — the UI
 * states this and never presents the value as field INP.
 *
 * Root-cause analysis correlates measured long tasks with each
 * interaction and only uses "likely contributor" language for indirect
 * evidence.
 */

const TH = require('./thresholds');

function fmt(n, d) { return typeof n === 'number' && isFinite(n) ? Math.round(n * Math.pow(10, d || 0)) / Math.pow(10, d || 0) : null; }

function analyzeInp(vitals, longTasks, jsFiles, profileLabel) {
  const raw = (vitals && vitals.inp) || {};
  const out = {
    status: raw.status === 'measured' ? 'measured' : 'unavailable',
    value: raw.status === 'measured' && typeof raw.value === 'number' ? fmt(raw.value) : null,
    reason: raw.reason || null,
    classification: null,
    interactions: [],
    rootCauses: [],
    limitations: [
      'Lab measurement: synthetic interactions dispatched by the auditor, not real-user field data.',
      'Synthetic input delay is ~0 ms by construction (no event queue). Field INP additionally includes real input delay.',
      'Only safe, non-destructive interactions were tested (menus, tabs, accordions, search controls, modal triggers).'
    ],
    note: null
  };

  const tasks = Array.isArray(longTasks) ? longTasks : [];
  if (out.status !== 'measured') return out;
  out.classification = TH.classify(out.value, TH.cwv.inp);

  const list = Array.isArray(raw.interactions) ? raw.interactions : [];
  const analyzed = list.map((ix, i) => {
    const latency = typeof ix.latency === 'number' ? ix.latency
      : (typeof ix.processing === 'number' && typeof ix.presentation === 'number' ? ix.processing + ix.presentation + (typeof ix.inputDelay === 'number' ? ix.inputDelay : 0) : null);
    const a = {
      id: ix.id != null ? ix.id : i,
      type: ix.type || 'click',
      target: ix.target || null,
      latency: fmt(latency),
      inputDelay: typeof ix.inputDelay === 'number' ? fmt(ix.inputDelay) : (ix.inputDelay === 0 ? 0 : null),
      processing: typeof ix.processing === 'number' ? fmt(ix.processing) : null,
      presentation: typeof ix.presentation === 'number' ? fmt(ix.presentation) : null,
      startTime: typeof ix.startTime === 'number' ? fmt(ix.startTime) : null,
      responded: !!ix.responded,
      note: ix.note || (ix.responded ? null : 'No observable response to this interaction.'),
      measuredVia: ix.measuredVia || 'synthetic-instrumentation'
    };
    // Correlate long tasks that overlap the interaction window.
    const from = a.startTime != null ? a.startTime : null;
    const until = from != null && a.latency != null ? from + a.latency : from;
    a.overlappingLongTasks = from == null ? [] : tasks
      .filter(t => typeof t.startTime === 'number' && typeof t.duration === 'number' &&
        t.startTime + t.duration >= from && t.startTime <= (until != null ? until : from + 500))
      .slice(0, 5)
      .map(t => ({ startTime: fmt(t.startTime), duration: fmt(t.duration), source: t.url || (t.attribution && t.attribution[0] && t.attribution[0].name) || null }));
    return a;
  });
  out.interactions = analyzed;

  const responded = analyzed.filter(a => a.responded && a.latency != null);
  if (responded.length) {
    const max = responded.reduce((m, a) => (a.latency > m.latency ? a : m), responded[0]);
    out.worst = { id: max.id, target: max.target, latency: max.latency };
  }

  // Root-cause analysis — evidence-driven, "likely contributor" wording.
  const worst = responded.slice().sort((a, b) => b.latency - a.latency)[0];
  if (worst && out.classification && out.classification.status !== 'good') {
    const cause = {
      interaction: worst,
      findings: [],
      headline: null
    };
    if (worst.overlappingLongTasks && worst.overlappingLongTasks.length) {
      const t = worst.overlappingLongTasks[0];
      cause.findings.push({
        kind: 'long-task',
        label: 'Long main-thread task during the interaction',
        evidence: 'A ' + t.duration + ' ms task (' + (t.source || 'unattributed script') + ') overlapped the ' + worst.latency + ' ms interaction window.',
        wording: 'Likely contributor',
        confidence: 'likely'
      });
      cause.headline = (t.source || 'An unattributed long task') + ' (' + t.duration + ' ms) overlapped the slowest interaction — a likely contributor to the lab INP.';
    }
    if (worst.processing != null && worst.latency != null && worst.processing >= worst.latency * 0.7) {
      cause.findings.push({
        kind: 'processing',
        label: 'Processing dominates the interaction',
        evidence: 'Processing (' + worst.processing + ' ms) is ' + Math.round(worst.processing / Math.max(1, worst.latency) * 100) + '% of the ' + worst.latency + ' ms latency — handler work (or work queued behind it) is the bottleneck.',
        wording: 'Measured breakdown',
        confidence: 'measured'
      });
    }
    if (worst.presentation != null && worst.latency != null && worst.presentation >= worst.latency * 0.5) {
      cause.findings.push({
        kind: 'presentation',
        label: 'Presentation delay dominates',
        evidence: 'Presentation delay (' + worst.presentation + ' ms) is ' + Math.round(worst.presentation / Math.max(1, worst.latency) * 100) + '% of the latency — the browser needed that long to render the next frame after the handler finished.',
        wording: 'Measured breakdown',
        confidence: 'measured'
      });
    }
    // Main-thread congestion evidence.
    const totalTasks = tasks.filter(t => t.startTime >= (worst.startTime != null ? worst.startTime - 2000 : 0) && t.startTime <= (worst.startTime != null ? worst.startTime + worst.latency + 2000 : Infinity));
    if (totalTasks.length >= 2) {
      cause.findings.push({
        kind: 'congestion',
        label: 'Main-thread congestion around the interaction',
        evidence: totalTasks.length + ' long task(s) ran within 2 s of the interaction (' + totalTasks.map(t => t.duration + ' ms').join(', ') + ').',
        wording: 'Likely contributor',
        confidence: 'likely'
      });
    }
    if (jsFiles && jsFiles.length && worst.processing != null && worst.processing >= 100) {
      const big = jsFiles.filter(f => f && (f.bytes == null || f.bytes >= 200 * 1024));
      if (big.length) {
        cause.findings.push({
          kind: 'js-size',
          label: 'Large JavaScript files present',
          evidence: big.length + ' script(s) of ≥ 200 KB (' + big.slice(0, 3).map(f => f.url || f.name).join(', ') + '). Large bundles increase parse/compile time on the main thread.',
          wording: 'Likely contributor',
          confidence: 'likely'
        });
      }
    }
    if (cause.findings.length) out.rootCauses.push(cause);
  }

  if (responded.length === 0) {
    out.note = 'No interaction produced a measurable response — lab INP cannot be estimated reliably for this page.';
    if (out.value == null) { out.status = 'unavailable'; out.reason = 'No measurable interaction response.'; out.classification = null; }
  }
  return out;
}

module.exports = { analyzeInp };
