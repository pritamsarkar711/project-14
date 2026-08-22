'use strict';

/*
 * Core Web Vitals & INP Auditor, rendering analysis.
 * Uses the evidence the browser actually exposes: long animation frames
 * (LoAF, when supported), layout shifts (instability evidence), long
 * tasks (main-thread congestion) and observed dynamic DOM changes.
 *
 * Forced synchronous layout cannot be observed from page JavaScript —
 * that requires DevTools tracing. The report states this instead of
 * inventing reflow counts.
 */

function analyzeRendering(loafs, longTaskAnalysis, clsAnalysis, dom) {
  const out = {
    longAnimationFrames: { status: 'unavailable', note: null, frames: [], total: 0 },
    forcedReflow: {
      status: 'not-observable',
      note: 'Forced synchronous layout / layout thrashing cannot be observed from page JavaScript in this environment, it requires DevTools tracing. No reflow counts are estimated.'
    },
    mainThread: { longTaskCount: 0, totalMs: 0 },
    instability: { value: null, shifts: 0 },
    issues: []
  };
  if (longTaskAnalysis) {
    out.mainThread.longTaskCount = longTaskAnalysis.total || 0;
    out.mainThread.totalMs = longTaskAnalysis.totalDuration || 0;
  }
  if (clsAnalysis && clsAnalysis.status === 'measured') {
    out.instability.value = clsAnalysis.value;
    out.instability.shifts = clsAnalysis.shifts ? clsAnalysis.shifts.length : 0;
  }
  const frames = Array.isArray(loafs) ? loafs : [];
  if (frames.length) {
    out.longAnimationFrames.status = 'measured';
    out.longAnimationFrames.total = frames.length;
    out.longAnimationFrames.frames = frames.slice(0, 8).map(f => ({
      duration: f.duration,
      startTime: f.startTime,
      renderStart: f.renderStart,
      styleAndLayout: f.styleAndLayoutStart != null && f.renderStart != null ? f.renderStart - f.styleAndLayoutStart : null,
      scripts: (f.scripts || []).slice(0, 6)
    }));
    const worst = frames.reduce((m, f) => (f.duration > (m ? m.duration : 0) ? f : m), null);
    if (worst && worst.duration > 200) {
      out.issues.push({
        id: 'loaf', severity: 'medium',
        title: 'Long animation frame: ' + Math.round(worst.duration) + ' ms',
        detail: 'A rendering loop took ' + Math.round(worst.duration) + ' ms from update to paint, dropped frames and delayed responses to input arriving in that window.',
        evidence: 'LoAF ' + Math.round(worst.duration) + ' ms' + (worst.scripts && worst.scripts.length ? ' with scripts: ' + worst.scripts.map(s => s.name || '(inline)').slice(0, 3).join(', ') : '') + '.',
        impact: 'INP / interaction smoothness'
      });
    }
  } else {
    out.longAnimationFrames.note = 'The browser did not report long animation frames (LoAF), either none occurred or this browser does not support the LoAF API.';
  }
  if (out.mainThread.longTaskCount > 5) {
    out.issues.push({
      id: 'mainthread-busy', severity: 'medium',
      title: 'Busy main thread (' + out.mainThread.longTaskCount + ' long tasks, ' + Math.round(out.mainThread.totalMs) + ' ms total)',
      detail: 'Frequent long tasks congest the main thread, input arriving during these tasks waits for the task to finish (input delay).',
      evidence: out.mainThread.longTaskCount + ' long tasks totaling ' + Math.round(out.mainThread.totalMs) + ' ms.',
      impact: 'INP / responsiveness'
    });
  }
  return out;
}

module.exports = { analyzeRendering };
