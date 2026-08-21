/* Core Web Vitals & INP Auditor — report rendering.
 * Renders the server-produced report with the site's existing design
 * system classes only (score-card, audit-panel, ad-stat, mini-table,
 * audit-fold, issue, badge, page-table…). No new fonts or color scheme. */
(function () {
  'use strict';
  var CWV = window.CwvUi = window.CwvUi || {};
  CWV.Report = {};

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; });
  }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function statusPill(status, label) {
    var cls = status === 'good' ? 's-ok' : status === 'poor' ? 's-err' : status === 'needs-improvement' ? 's-warn' : 's-unk';
    return '<span class="status-pill ' + cls + '">' + esc(label == null ? (status || 'Unknown') : label) + '</span>';
  }
  function num(v, d) { return v == null || !isFinite(v) ? 'Not Available' : (d != null ? v.toFixed(d) : String(v)); }
  function bytes(b) {
    if (b == null) return 'Not Available';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return Math.round(b / 1024) + ' KB';
    return (Math.round(b / 1048576 * 10) / 10) + ' MB';
  }
  function sevBadge(s) {
    var label = s === 'critical' ? 'Critical' : s === 'high' ? 'High' : s === 'medium' ? 'Medium' : 'Low';
    return '<span class="badge ' + s + '">' + label + '</span>';
  }
  function panel(title, icon, bodyHtml, extraCls) {
    return '<section class="audit-panel cwv-panel ' + (extraCls || '') + '"><h3>' + (icon ? '<span class="material-icons" aria-hidden="true">' + esc(icon) + '</span>' : '') + esc(title) + '</h3>' + bodyHtml + '</section>';
  }
  function fold(title, countHtml, bodyHtml, open) {
    return '<details class="audit-fold cwv-fold"' + (open ? ' open' : '') + '><summary><span>' + esc(title) + '</span>' + (countHtml ? '<b>' + countHtml + '</b>' : '') + '</summary>' + bodyHtml + '</details>';
  }
  function kv(label, value, cls) {
    return '<div class="calc-line ' + (cls || '') + '"><span>' + esc(label) + '</span><b>' + value + '</b></div>';
  }
  function mono(v) { return '<code class="cwv-mono">' + esc(v) + '</code>'; }

  function fmtMs(v) { return v == null ? 'Not Available' : Math.round(v) + ' ms'; }
  function fmtCls(v) { return v == null ? 'Not Available' : (Math.round(v * 10000) / 10000); }

  /* ================= score ================= */
  function scoreSection(report) {
    var s = report.lab.score;
    if (!s) return '';
    var ringColor = s.value == null ? '#607d8b' : (s.value >= 90 ? '#2e7d32' : s.value >= 50 ? '#ed6c02' : '#d32f2f');
    var html = '<div class="score-card cwv-scorecard"><div class="score-ring" style="--score:' + (s.value == null ? 0 : s.value) + ';background:conic-gradient(' + ringColor + ' calc(var(--score)*1%),var(--chip-bg) 0)"><b>' + (s.value == null ? '—' : s.value) + '</b></div><div class="score-summary"><h2>' + esc(s.label) + '</h2>';
    if (s.grade) html += '<p>' + statusPill(s.value >= 90 ? 'good' : s.value >= 50 ? 'needs-improvement' : 'poor', s.grade) + '</p>';
    html += '<p class="source-chip">' + esc(s.disclaimer) + '</p></div></div>';
    html += panel('Score breakdown (transparent)', 'functions',
      '<p class="muted">Weighted components from measured values. Components without data are excluded and shown below — the score is renormalised over measured components only.</p>' +
      '<div class="mini-table-wrap"><table class="mini-table cwv-scoretable"><thead><tr><th>Component</th><th>Weight</th><th>Value / note</th><th>Score</th></tr></thead><tbody>' +
      s.breakdown.map(function (p) {
        return '<tr><td>' + esc(p.label) + (p.advisory ? ' <small class="muted">(advisory)</small>' : '') + '</td><td>' + p.weight + '%</td><td class="cwv-note-cell">' + esc(p.note || p.detail || '') + '</td><td>' + (p.score == null ? '<span class="muted">excluded</span>' : '<b>' + p.score + '</b>') + '</td></tr>';
      }).join('') + '</tbody></table></div>');
    return html;
  }

  /* ================= CWV summary ================= */
  function vitalsSection(report) {
    var rows = report.lab.vitals || [];
    var html = '<div class="cwv-lab-chip"><span class="source-chip">Lab Data</span></div>';
    html += '<div class="mini-table-wrap"><table class="mini-table cwv-vitals"><thead><tr><th>Metric</th><th style="text-align:right">Value</th><th>Status</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var note = r.reason ? '<br><small class="muted">' + esc(r.reason) + '</small>' : (r.labNote ? '<br><small class="muted">' + esc(r.labNote) + '</small>' : '');
      html += '<tr><td><b>' + esc(r.label) + '</b>' + (r.advisory ? ' <small class="muted">advisory target</small>' : '') + '</td><td style="text-align:right">' + (r.display == null ? '<span class="muted">Not Available</span>' : esc(r.display)) + '</td><td>' + statusPill(r.status, r.statusLabel) + note + '</td></tr>';
    });
    html += '</tbody></table></div>';
    html += '<p class="muted">LCP / INP / CLS use the current official Core Web Vitals thresholds (reviewed ' + esc(report.engine.thresholdsVersion) + '). FCP, TTFB, TBT and Speed Index are advisory targets, not official Core Web Vitals.</p>';
    return panel('Core Web Vitals Summary', 'monitor_heart', html, 'cwv-wide');
  }

  function fieldSection(report) {
    var f = report.field;
    var html = '<div class="cwv-field-box"><span class="material-icons" aria-hidden="true">cloud_off</span><div><b>' + esc(f.label) + '</b><p>' + esc(f.reason) + '</p></div></div>';
    html += '<p class="muted">Lab values are never mixed with field data. Synthetic interaction testing is not identical to real-user field data: a lab test can identify responsiveness problems, but field INP reflects actual users and real interaction patterns.</p>';
    return panel('Field Data', 'people', html, 'cwv-wide');
  }

  /* ================= INP ================= */
  function inpSection(report) {
    var inp = report.lab.inp;
    if (!inp) return '';
    var html = '';
    if (inp.status === 'measured' && inp.value != null) {
      html += '<div class="cwv-inp-head"><div class="cwv-bignum">' + statusPill(inp.classification.status, 'INP: ' + inp.value + ' ms') + '</div></div>';
    } else {
      html += '<div class="cwv-na-box"><span class="material-icons" aria-hidden="true">touch_app</span><b>Not Available</b><p>' + esc(inp.reason || 'Unable to measure INP.') + '</p></div>';
    }
    html += '<p class="muted">Lab INP (synthetic interactions in this session). Never a substitute for field INP.</p>';
    if (inp.interactions && inp.interactions.length) {
      html += '<div class="mini-table-wrap"><table class="mini-table cwv-inp-table"><thead><tr><th>Interaction</th><th>Target</th><th>Latency</th><th>Input</th><th>Processing</th><th>Presentation</th><th>Response</th></tr></thead><tbody>' +
        inp.interactions.map(function (ix) {
          var t = ix.target || {};
          var targetDesc = (t.selector || t.tag || 'element');
          var targetText = t.text ? '<br><small class="muted">' + esc(t.text) + '</small>' : '';
          return '<tr><td>' + esc(ix.type || 'click') + '<br><small class="muted">' + esc(ix.measuredVia || '') + '</small></td><td class="cwv-target-cell">' + esc(targetDesc) + targetText + '</td><td><b>' + fmtMs(ix.latency) + '</b></td><td>' + fmtMs(ix.inputDelay) + '</td><td>' + fmtMs(ix.processing) + '</td><td>' + fmtMs(ix.presentation) + '</td><td>' + (ix.responded ? '<span class="status-pill s-ok">responded</span>' : '<span class="status-pill s-unk">no response</span>') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    if (inp.rootCauses && inp.rootCauses.length) {
      html += '<h6 class="cwv-subhead">Root-cause analysis</h6>';
      inp.rootCauses.forEach(function (c) {
        html += '<div class="cwv-cause"><b>' + esc(c.headline || 'Root cause findings') + '</b>' +
          (c.findings || []).map(function (f) {
            return '<div class="cwv-finding"><span class="badge ' + (f.confidence === 'measured' ? 'passed' : 'info') + '">' + esc(f.wording || f.confidence) + '</span><div><b>' + esc(f.label) + '</b><p class="muted">' + esc(f.evidence) + '</p></div></div>';
          }).join('') + '</div>';
      });
    }
    html += '<p class="muted">' + (inp.limitations || []).map(function (l) { return esc(l); }).join('<br>') + '</p>';
    return panel('INP Analysis — interaction-level detail', 'touch_app', html, 'cwv-wide');
  }

  /* ================= LCP ================= */
  function lcpSection(report) {
    var lcp = report.lab.lcp;
    if (!lcp) return '';
    var html = '';
    if (lcp.status !== 'measured') {
      html += '<div class="cwv-na-box"><span class="material-icons" aria-hidden="true">image</span><b>Not Available</b><p>' + esc(lcp.reason || 'Unable to measure LCP.') + '</p></div>';
    } else {
      html += '<p class="cwv-bignum-line">LCP: <b>' + esc(String(lcp.value)) + ' ms</b> ' + statusPill(lcp.classification.status, lcp.classification.label) + '</p>';
      if (lcp.element) {
        html += '<h6 class="cwv-subhead">LCP Element</h6>';
        html += '<div class="cwv-code">' + esc((lcp.element.tag || '?') + ' ' + (lcp.element.selector || '')) + '</div>';
        if (lcp.element.url) html += kv('LCP Resource', mono(lcp.element.url));
        if (lcp.element.size != null) html += kv('Element size', lcp.element.size + ' px² (rendered)');
        if (lcp.resource) html += kv('Resource size', lcp.resource.sizeBytes ? bytes(lcp.resource.sizeBytes) : 'Not Available');
        if (lcp.element.text) html += kv('Content', '"' + esc(lcp.element.text) + '"');
      }
      if (lcp.phases) {
        html += '<h6 class="cwv-subhead">LCP phase breakdown</h6>';
        var phases = [
          ['TTFB', lcp.phases.ttfb],
          ['Resource load delay', lcp.phases.loadDelay],
          ['Resource load duration', lcp.phases.loadDuration],
          ['Element render delay', lcp.phases.renderDelay]
        ];
        html += '<div class="cwv-bars">' + phases.map(function (p) {
          if (p[1] == null) return '';
          return '<div class="cwv-bar-row"><span>' + esc(p[0]) + '</span><div class="cwv-bar-track"><i style="width:' + Math.min(100, p[1] / Math.max(1, lcp.value) * 100) + '%"></i></div><b>' + fmtMs(p[1]) + '</b></div>';
        }).join('') + '</div>';
        if (lcp.bottleneck) html += '<div class="calc-note"><span class="material-icons" aria-hidden="true">info</span>Likely bottleneck: <b>' + esc(lcp.bottleneck.phase) + '</b> (' + fmtMs(lcp.bottleneck.value) + ').</div>';
        (lcp.phases.note || []).forEach(function (n) { html += '<p class="muted">' + esc(n) + '</p>'; });
      }
      if (lcp.imageAudit) {
        var ia = lcp.imageAudit;
        html += '<h6 class="cwv-subhead">LCP image attributes</h6>';
        html += '<div class="cwv-chips">' +
          '<span class="chip">format: ' + esc(lcp.resource && lcp.resource.format || 'n/a') + '</span>' +
          '<span class="chip">loading: ' + esc(ia.loading || 'eager (default)') + '</span>' +
          '<span class="chip">fetchpriority: ' + esc(ia.fetchpriority || 'auto') + '</span>' +
          '<span class="chip">decoding: ' + esc(ia.decoding || 'auto') + '</span>' +
          '<span class="chip">srcset: ' + (ia.hasSrcset ? 'yes' : 'no') + '</span>' +
          '<span class="chip">sizes: ' + (ia.hasSizes ? 'yes' : 'no') + '</span>' +
          '<span class="chip">width/height: ' + (ia.hasDimensions ? 'yes' : 'no') + '</span>' +
          '<span class="chip">rendered: ' + (ia.renderedW || '?') + '×' + (ia.renderedH || '?') + '</span>' +
          '<span class="chip">intrinsic: ' + (ia.naturalW || '?') + '×' + (ia.naturalH || '?') + '</span>' +
          '</div>';
      }
      (lcp.issues || []).forEach(function (i) {
        html += '<div class="cwv-inline-issue"><b>' + sevBadge(i.severity) + ' ' + esc(i.title) + '</b><p>' + esc(i.detail) + '</p><small class="cwv-evidence">' + esc(i.evidence) + '</small></div>';
      });
      if (lcp.candidates && lcp.candidates.length > 1) {
        html += fold('LCP candidates during load (' + lcp.candidates.length + ')', '', '<div class="mini-table-wrap"><table class="mini-table"><thead><tr><th>Time</th><th>Size</th><th>Element</th></tr></thead><tbody>' +
          lcp.candidates.map(function (c) { return '<tr><td>' + fmtMs(c.startTime) + '</td><td>' + (c.size || '?') + '</td><td>' + esc((c.tag || '?') + ' ' + (c.url || '')) + '</td></tr>'; }).join('') + '</tbody></table></div>');
      }
    }
    return panel('LCP Analysis', 'image', html, 'cwv-wide');
  }

  /* ================= CLS ================= */
  function clsSection(report) {
    var cls = report.lab.cls;
    if (!cls) return '';
    var html = '';
    if (cls.status !== 'measured') {
      html += '<div class="cwv-na-box"><span class="material-icons" aria-hidden="true">swap_vert</span><b>Not Available</b><p>' + esc(cls.reason || 'Unable to measure CLS.') + '</p></div>';
    } else {
      html += '<p class="cwv-bignum-line">Final CLS: <b>' + fmtCls(cls.value) + '</b> ' + statusPill(cls.classification.status, cls.classification.label) + '</p>';
      html += '<p class="muted">Calculation model: ' + esc(cls.model) + ' ' + (cls.note ? esc(cls.note) : '') + '</p>';
      if (cls.windows && cls.windows.length) {
        html += fold('Session windows (' + cls.windows.length + ')', '', '<div class="mini-table-wrap"><table class="mini-table"><thead><tr><th>Start</th><th>End</th><th>Shifts</th><th>Window score</th></tr></thead><tbody>' +
          cls.windows.map(function (w) { return '<tr><td>' + fmtMs(w.startTime) + '</td><td>' + fmtMs(w.endTime) + '</td><td>' + w.shiftCount + '</td><td><b>' + w.value + '</b></td></tr>'; }).join('') + '</tbody></table></div>');
      }
      if (cls.largestWindow && cls.largestWindow.shifts && cls.largestWindow.shifts.length) {
        html += '<h6 class="cwv-subhead">Largest shift cluster (' + fmtCls(cls.largestWindow.value) + ')</h6>';
        cls.largestWindow.shifts.forEach(function (s, i) {
          var src = (s.sources || [])[0];
          html += '<div class="cwv-shift"><b>Shift ' + (i + 1) + ' — score ' + fmtCls(s.value) + ' at ' + fmtMs(s.startTime) + '</b>';
          if (src && src.selector) {
            html += '<div class="cwv-evidence">Element: ' + esc(src.selector) + '</div>';
            if (src.prevRect && src.curRect) {
              html += '<div class="cwv-evidence">Previous position: ' + esc(JSON.stringify(src.prevRect)) + ' → New position: ' + esc(JSON.stringify(src.curRect)) + '</div>';
            }
          }
          html += '<p class="muted">Likely cause: ' + esc(shiftCause(src)) + '</p></div>';
        });
      }
      if (cls.excludedShifts && cls.excludedShifts.length) {
        html += fold('Excluded shifts (' + cls.excludedShifts.length + ')', '', '<div class="mini-table-wrap"><table class="mini-table"><thead><tr><th>Score</th><th>Reason</th></tr></thead><tbody>' +
          cls.excludedShifts.map(function (s) { return '<tr><td>' + fmtCls(s.value) + '</td><td>' + esc(s.reason) + '</td></tr>'; }).join('') + '</tbody></table></div>');
      }
    }
    return panel('CLS Auditor', 'swap_vert', html, 'cwv-wide');
  }
  function shiftCause(src) {
    if (!src) return 'Unattributed shift.';
    if (src.tag === 'img') return 'Image without reserved space (missing width/height) — layout moves when it loads.';
    return 'Content inserted or resized after first render (dynamic content, fonts, banners). Reserve space for the element.';
  }

  /* ================= FCP / TTFB ================= */
  function fcpSection(report) {
    var fcp = report.lab.fcp;
    if (!fcp) return '';
    var html = '<p class="cwv-bignum-line">FCP: <b>' + (fcp.value != null ? fcp.value + ' ms' : 'Not Available') + '</b> ' + (fcp.classification ? statusPill(fcp.classification.status, fcp.classification.label) : statusPill('unavailable', 'Not Available')) + '</p>';
    html += '<p class="muted">' + esc(fcp.note || '') + '</p>';
    if (fcp.causes && fcp.causes.length) {
      html += '<h6 class="cwv-subhead">Potential causes of slow FCP</h6>';
      html += fcp.causes.map(function (c) {
        return '<div class="cwv-cause"><b>' + esc(c.label) + '</b><p class="muted">' + esc(c.evidence) + '</p></div>';
      }).join('');
    }
    return panel('FCP — First Contentful Paint', 'visibility', html);
  }

  function ttfbSection(report) {
    var ttfb = report.lab.ttfb;
    if (!ttfb) return '';
    var html = '<p class="cwv-bignum-line">TTFB: <b>' + (ttfb.value != null ? ttfb.value + ' ms' : 'Not Available') + '</b> ' + (ttfb.classification ? statusPill(ttfb.classification.status, ttfb.classification.label) : statusPill('unavailable', 'Not Available')) + '</p>';
    html += '<p class="muted">' + esc(ttfb.note || '') + ' Source: ' + esc(ttfb.source || 'unknown') + '.</p>';
    if (ttfb.phases) {
      html += '<div class="cwv-ttfb-grid">' +
        kv('DNS', ttfb.phases.dns + ' ms' + (ttfb.phases.dnsCached ? ' (cached)' : '')) +
        kv('Connection', ttfb.phases.connect + ' ms') +
        kv('TLS', ttfb.phases.tls + ' ms') +
        kv('Server response', ttfb.phases.server + ' ms') +
        kv('TTFB (total)', ttfb.phases.ttfb + ' ms', 'total') +
        '</div>';
    }
    (ttfb.notes || []).forEach(function (n) { html += '<p class="muted">' + esc(n) + '</p>'; });
    html += '<p class="muted">TTFB alone does not prove a specific backend problem — a slow server-response phase indicates likely server-side latency worth profiling.</p>';
    return panel('TTFB Analysis', 'swap_vert', html);
  }

  /* ================= long tasks ================= */
  function longTasksSection(report) {
    var lt = report.lab.longTasks;
    if (!lt) return '';
    var html = '';
    if (!lt.total) {
      html += '<div class="dc-na-box"><span class="material-icons" aria-hidden="true">check_circle</span><b>No long tasks observed</b><p>No main-thread task exceeded ' + lt.thresholdMs + ' ms during the measurement window.</p></div>';
    } else {
      html += '<div class="ad-summary-grid cwv-overview-grid">' +
        '<div class="ad-stat"><span>Long tasks</span><b>' + lt.total + '</b></div>' +
        '<div class="ad-stat"><span>Total time</span><b>' + fmtMs(lt.totalDuration) + '</b></div>' +
        '<div class="ad-stat"><span>TBT</span><b>' + fmtMs(lt.tbt) + '</b></div>' +
        '<div class="ad-stat"><span>Threshold</span><b>&gt; ' + lt.thresholdMs + ' ms</b></div></div>';
      if (lt.worst && lt.worst.length) {
        html += '<h6 class="cwv-subhead">Longest tasks</h6><div class="mini-table-wrap"><table class="mini-table cwv-inp-table"><thead><tr><th>Duration</th><th>Start</th><th>Source</th><th>Potential impact</th></tr></thead><tbody>' +
          lt.worst.map(function (t) {
            var impacts = [];
            if (lt.potentialInpImpact && lt.potentialInpImpact.some(function (p) { return p.startTime === t.startTime && p.duration === t.duration; })) impacts.push('INP');
            return '<tr><td><b>' + fmtMs(t.duration) + '</b></td><td>' + fmtMs(t.startTime) + '</td><td class="cwv-target-cell">' + mono(t.source || 'unattributed') + '</td><td>' + (impacts.length ? impacts.join(', ') : '<span class="muted">none identified</span>') + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      }
      if (lt.groups && lt.groups.length > 1) {
        html += fold('Repeated tasks grouped by source (' + lt.groups.length + ')', '', '<div class="mini-table-wrap"><table class="mini-table"><thead><tr><th>Source</th><th>Occurrences</th><th>Total</th><th>Longest</th></tr></thead><tbody>' +
          lt.groups.map(function (g) {
            return '<tr><td class="cwv-target-cell">' + mono(g.source) + '</td><td>' + g.occurrences + '</td><td>' + fmtMs(g.totalDuration) + '</td><td>' + fmtMs(g.maxDuration) + '</td></tr>';
          }).join('') + '</tbody></table></div>');
      }
      if (lt.potentialInpImpact && lt.potentialInpImpact.length) {
        html += '<div class="calc-note"><span class="material-icons" aria-hidden="true">info</span>' + lt.potentialInpImpact.length + ' long task(s) overlapped tested interactions — a potential INP impact (correlation, not proven cause).</div>';
      }
    }
    return panel('Long Task Detection', 'hourglass_top', html);
  }

  /* ================= network efficiency (compression + protocol) ================= */
  function networkSection(report) {
    var r = report.lab.resources;
    if (!r) return '';
    var html = '';
    html += '<h6 class="cwv-subhead">Observed protocols</h6><div class="cwv-chips">' +
      (r.protocol.observed.length
        ? r.protocol.observed.map(function (p) { return '<span class="chip">' + esc(p) + '</span>'; }).join('')
        : '<span class="chip">not observable in this transport mode</span>') + '</div>';
    html += '<p class="muted">' + esc(r.protocol.note) + '</p>';
    html += '<h6 class="cwv-subhead">Compression</h6>';
    if (r.compression.status === 'measured') {
      var total = r.compression.textResources || 0;
      var comp = r.compression.compressedText || 0;
      html += '<p>' + comp + ' of ' + total + ' text resource(s) served compressed' + (total ? ' (' + Math.round(comp / total * 100) + '%)' : '') + '.</p>';
      if (r.compression.uncompressed && r.compression.uncompressed.length) {
        html += '<div class="mini-table-wrap"><table class="mini-table"><thead><tr><th>Uncompressed text resource</th><th>Size</th></tr></thead><tbody>' +
          r.compression.uncompressed.map(function (u) { return '<tr><td class="cwv-target-cell">' + mono(u.url) + '</td><td>' + (u.bytes != null ? bytes(u.bytes) : '—') + '</td></tr>'; }).join('') + '</tbody></table></div>';
      }
    } else {
      html += '<p class="muted">' + esc(r.compression.note) + '</p>';
    }
    html += '<p class="muted">HTTP/1.1 is reported as an observation, not automatically a fault — it matters most with many small requests and no connection reuse.</p>';
    return panel('Network Efficiency — Protocol &amp; Compression', 'settings_ethernet', html);
  }

  /* ================= waterfall ================= */
  function waterfallSection(report) {
    var wf = report.lab.waterfall;
    if (!wf) return '';
    var typeColors = { document: '#1976d2', stylesheet: '#7b1fa2', script: '#e65100', image: '#2e7d32', font: '#00838f', fetch: '#c2185b', media: '#455a64', other: '#607d8b' };
    var maxEnd = 0;
    wf.rows.forEach(function (r) { if (r.startTime != null) maxEnd = Math.max(maxEnd, r.startTime + (r.duration || 0)); });
    var html = '';
    html += '<div class="cwv-wf-toolbar">' +
      '<input id="cwv-wf-search" class="text-input cwv-wf-search" placeholder="Filter resources…" aria-label="Filter resources">' +
      '<div class="tabs cwv-wf-types" role="tablist">' +
      ['All', 'Document', 'CSS', 'JS', 'Image', 'Font', 'Fetch', 'Other'].map(function (t, i) {
        return '<button type="button" class="' + (i === 0 ? 'active' : '') + '" data-type="' + esc(t.toLowerCase()) + '">' + esc(t) + '</button>';
      }).join('') + '</div></div>';
    html += '<p class="muted">' + wf.requestCount + ' requests' + (wf.bytesMeasurable ? ', ' + bytes(wf.totalBytes) + ' transfer' : ' (transfer sizes not fully exposed)') + '. ' + esc(wf.note) + '</p>';
    html += '<div class="cwv-waterfall">' + wf.rows.map(function (r) {
      var left = maxEnd ? (r.startTime / maxEnd * 100) : 0;
      var width = (r.duration && maxEnd) ? Math.max(0.6, r.duration / maxEnd * 100) : 0.6;
      var color = typeColors[r.type] || '#607d8b';
      return '<div class="cwv-wf-row" data-name="' + esc(String(r.url).toLowerCase()) + '" data-type="' + esc(r.type) + '">' +
        '<div class="cwv-wf-label" title="' + esc(r.url) + '"><span class="cwv-wf-dot" style="background:' + color + '"></span>' + esc(shortUrl(r.url)) + '</div>' +
        '<div class="cwv-wf-track">' + (r.startTime == null ? '<span class="muted">timing not exposed</span>' : '<i style="left:' + left + '%;width:' + width + '%;background:' + color + '"></i>') + '</div>' +
        '<div class="cwv-wf-meta">' + (r.duration != null ? fmtMs(r.duration) : '—') + ' · ' + (r.transferSize != null ? bytes(r.transferSize) : '?') + (r.protocol ? ' · ' + esc(r.protocol) : '') + '</div>' +
        '</div>';
    }).join('') + '</div>';
    return panel('Network Waterfall', 'waterfall_chart', html, 'cwv-wide');
  }
  function shortUrl(u) {
    try {
      var p = new URL(u);
      var path = p.pathname;
      if (path.length > 46) path = '…' + path.slice(-44);
      return p.hostname.replace(/^www\./, '') + path;
    } catch (e) { return String(u).slice(0, 80); }
  }

  /* ================= dependency tree ================= */
  function depSection(report) {
    var dep = report.lab.dependency;
    if (!dep) return '';
    function nodeHtml(n, depth) {
      var pad = depth * 16;
      var icon = { document: 'description', stylesheet: 'palette', script: 'code', font: 'text_fields', image: 'image', fetch: 'swap_vert', runtime: 'data_object' }[n.kind] || 'link';
      var label = n.url ? shortUrl(n.url) : esc(n.label);
      var html = '<div class="cwv-tree-node" style="padding-left:' + pad + 'px"><span class="material-icons" aria-hidden="true">' + icon + '</span><span class="cwv-tree-label" title="' + esc(n.url || '') + '">' + esc(label) + ' <small class="muted">' + esc(n.kind || '') + '</small></span></div>';
      if (n.note) html += '<div class="muted" style="padding-left:' + (pad + 26) + 'px">' + esc(n.note) + '</div>';
      (n.children || []).forEach(function (c) { html += nodeHtml(c, depth + 1); });
      return html;
    }
    var html = '<div class="cwv-tree">' + nodeHtml(dep.root, 0) + '</div>';
    if (dep.longestChain) {
      html += '<div class="calc-note"><span class="material-icons" aria-hidden="true">info</span>Longest dependency chain: <b>' + dep.longestChain.length + '</b> hops — ' + esc(dep.longestChain.path.map(shortUrl).join(' → ')) + '</div>';
    }
    if (dep.hints) {
      var hints = [];
      if (dep.hints.preload && dep.hints.preload.length) hints.push(dep.hints.preload.length + ' preload(s)');
      if (dep.hints.preconnect && dep.hints.preconnect.length) hints.push(dep.hints.preconnect.length + ' preconnect(s)');
      if (dep.hints.dnsPrefetch && dep.hints.dnsPrefetch.length) hints.push(dep.hints.dnsPrefetch.length + ' dns-prefetch');
      if (dep.hints.modulepreload && dep.hints.modulepreload.length) hints.push(dep.hints.modulepreload.length + ' modulepreload');
      html += '<div class="cwv-chips"><span class="chip">Resource hints: ' + (hints.length ? hints.join(' · ') : 'none detected') + '</span></div>';
    }
    html += '<p class="muted">' + esc(dep.limitation) + '</p>';
    return panel('Network Dependency Tree &amp; Resource Hints', 'account_tree', html, 'cwv-wide');
  }

  /* ================= JS / CSS ================= */
  function jsSection(report) {
    var js = report.lab.javascript;
    if (!js) return '';
    var html = '<div class="ad-summary-grid cwv-overview-grid">' +
      '<div class="ad-stat"><span>JS files</span><b>' + js.fileCount + '</b></div>' +
      '<div class="ad-stat"><span>Total JS</span><b>' + (js.totalBytes != null ? bytes(js.totalBytes) : 'Not Available') + '</b></div>' +
      '<div class="ad-stat"><span>Parser-blocking</span><b>' + js.blockingCount + '</b></div>' +
      '<div class="ad-stat"><span>3rd-party JS</span><b>' + js.thirdPartyCount + '</b></div></div>';
    if (js.largest && js.largest.length) {
      html += '<h6 class="cwv-subhead">Largest scripts</h6><div class="mini-table-wrap"><table class="mini-table"><thead><tr><th>Script</th><th>Size</th><th>Blocking</th></tr></thead><tbody>' +
        js.largest.map(function (f) { return '<tr><td class="cwv-target-cell">' + mono(f.url) + '</td><td>' + (f.bytesKnown ? bytes(f.bytes) : 'Not Available') + '</td><td>' + (f.blocking ? '<span class="status-pill s-warn">parser-blocking</span>' : 'no') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }
    if (js.blocking && js.blocking.length) html += '<p class="muted">' + js.blockingCount + ' parser-blocking script(s). Blocking scripts delay HTML parsing and first paint.</p>';
    if (js.duplicates && js.duplicates.length) {
      html += '<h6 class="cwv-subhead">Duplicate libraries</h6><div class="mini-table-wrap"><table class="mini-table"><tbody>' +
        js.duplicates.map(function (d) { return '<tr><td>' + esc(d.library) + '</td><td class="cwv-target-cell">' + d.urls.map(function (u) { return mono(u); }).join('<br>') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }
    if (js.mainThread && js.mainThread.longTaskGroups && js.mainThread.longTaskGroups.length) {
      html += '<h6 class="cwv-subhead">Main-thread execution (long tasks by script)</h6><div class="mini-table-wrap"><table class="mini-table"><thead><tr><th>Script</th><th>Occurrences</th><th>Total</th><th>Longest</th></tr></thead><tbody>' +
        js.mainThread.longTaskGroups.map(function (g) { return '<tr><td class="cwv-target-cell">' + mono(g.source) + '</td><td>' + g.occurrences + '</td><td>' + fmtMs(g.totalDuration) + '</td><td>' + fmtMs(g.maxDuration) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }
    html += '<p class="muted">' + esc(js.coverage.note) + '</p>';
    return panel('JavaScript Audit', 'code', html);
  }

  function cssSection(report) {
    var css = report.lab.css;
    if (!css) return '';
    var html = '<div class="ad-summary-grid cwv-overview-grid">' +
      '<div class="ad-stat"><span>Stylesheets</span><b>' + css.stylesheetCount + '</b></div>' +
      '<div class="ad-stat"><span>Total CSS</span><b>' + (css.totalBytes != null ? bytes(css.totalBytes) : 'Not Available') + '</b></div>' +
      '<div class="ad-stat"><span>Render-blocking</span><b>' + css.blockingCount + '</b></div>' +
      '<div class="ad-stat"><span>@import</span><b>' + css.importCount + '</b></div>' +
      '<div class="ad-stat"><span>Inline CSS</span><b>' + (css.inlineCssBytes != null ? bytes(css.inlineCssBytes) : 'Not Available') + '</b></div></div>';
    if (css.largest && css.largest.length) {
      html += '<h6 class="cwv-subhead">Largest stylesheets</h6><div class="mini-table-wrap"><table class="mini-table"><thead><tr><th>Stylesheet</th><th>Size</th></tr></thead><tbody>' +
        css.largest.map(function (c) { return '<tr><td class="cwv-target-cell">' + mono(c.url) + '</td><td>' + (c.bytesKnown ? bytes(c.bytes) : 'Not Available') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }
    if (css.imports && css.imports.length) {
      html += '<h6 class="cwv-subhead">CSS @imports</h6><div class="mini-table-wrap"><table class="mini-table"><tbody>' +
        css.imports.map(function (i) { return '<tr><td class="cwv-target-cell">' + mono(i.from) + '</td><td>→ ' + mono(i.url) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }
    if (css.note) html += '<p class="muted">' + esc(css.note) + '</p>';
    return panel('CSS Audit', 'palette', html);
  }

  /* ================= images / fonts ================= */
  function imagesSection(report) {
    var im = report.lab.images;
    if (!im) return '';
    var html = '<div class="ad-summary-grid cwv-overview-grid">' +
      '<div class="ad-stat"><span>Images</span><b>' + im.count + '</b></div>' +
      '<div class="ad-stat"><span>Total bytes</span><b>' + (im.totalBytes != null ? bytes(im.totalBytes) : 'Not Available') + '</b></div>' +
      '<div class="ad-stat"><span>Missing dimensions</span><b>' + im.missingDimensions.length + '</b></div>' +
      '<div class="ad-stat"><span>Lazy above fold</span><b>' + im.lazyAboveFold.length + '</b></div>' +
      '<div class="ad-stat"><span>Oversized</span><b>' + im.oversized.length + '</b></div>' +
      '<div class="ad-stat"><span>Legacy large</span><b>' + im.legacyLarge.length + '</b></div></div>';
    if (im.issues && im.issues.length) {
      html += '<h6 class="cwv-subhead">Image findings (evidence-based)</h6>';
      im.issues.forEach(function (i) {
        html += '<div class="cwv-inline-issue"><b>' + sevBadge(i.severity) + ' ' + esc(i.title) + '</b><p>' + esc(i.detail) + '</p><small class="cwv-evidence">' + esc(i.evidence) + (i.savings ? ' — ' + esc(i.savings.label) : '') + '</small></div>';
      });
    } else {
      html += '<p class="muted">No image findings in the measured set.</p>';
    }
    if (im.note) html += '<p class="muted">' + esc(im.note) + '</p>';
    return panel('Image Audit', 'image', html);
  }

  function fontsSection(report) {
    var f = report.lab.fonts;
    if (!f) return '';
    var html = '<div class="ad-summary-grid cwv-overview-grid">' +
      '<div class="ad-stat"><span>Font files</span><b>' + f.fontFileCount + '</b></div>' +
      '<div class="ad-stat"><span>Total bytes</span><b>' + (f.totalBytes != null ? bytes(f.totalBytes) : 'Not Available') + '</b></div>' +
      '<div class="ad-stat"><span>Families</span><b>' + f.families.length + '</b></div>' +
      '<div class="ad-stat"><span>font-display: swap</span><b>' + f.fontDisplay.swap + '</b></div>' +
      '<div class="ad-stat"><span>font-display: block</span><b>' + f.fontDisplay.block + '</b></div>' +
      '<div class="ad-stat"><span>Unspecified</span><b>' + f.fontDisplay.unspecified + '</b></div></div>';
    if (f.fontDisplay.details && f.fontDisplay.details.length) {
      html += '<h6 class="cwv-subhead">@font-face rules</h6><div class="mini-table-wrap"><table class="mini-table"><thead><tr><th>Family</th><th>Weight</th><th>font-display</th><th>Source</th></tr></thead><tbody>' +
        f.fontDisplay.details.map(function (d) { return '<tr><td>' + esc(d.family) + '</td><td>' + esc(d.weight) + '</td><td>' + (d.display ? esc(d.display) : '<span class="muted">unspecified</span>') + '</td><td class="cwv-target-cell">' + (d.srcs || []).map(function (u) { return mono(u); }).join('<br>') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }
    if (f.preloadedUrls.length) html += kv('Preloaded fonts', f.preloadedUrls.map(mono).join('<br>'));
    if (f.crossOrigin.length) html += kv('Cross-origin fonts', f.crossOrigin.map(mono).join('<br>'));
    (f.issues || []).forEach(function (i) {
      html += '<div class="cwv-inline-issue"><b>' + sevBadge(i.severity) + ' ' + esc(i.title) + '</b><p>' + esc(i.detail) + '</p><small class="cwv-evidence">' + esc(i.evidence) + '</small></div>';
    });
    return panel('Font Audit', 'text_fields', html);
  }

  /* ================= third parties / cache / rendering / DOM ================= */
  function thirdPartiesSection(report) {
    var tp = report.lab.thirdParties;
    if (!tp) return '';
    var html = '';
    if (!tp.parties.length) {
      html += '<p class="muted">No third-party hosts were observed in the captured requests.</p>';
    } else {
      html += '<div class="mini-table-wrap"><table class="mini-table"><thead><tr><th>Domain</th><th>Category</th><th>Requests</th><th>Bytes</th><th>Main-thread (long tasks)</th></tr></thead><tbody>' +
        tp.parties.map(function (p) {
          return '<tr><td class="cwv-target-cell">' + mono(p.domain) + '</td><td>' + esc(p.category) + (p.categoryHeuristic ? ' <small class="muted">heuristic</small>' : '') + '</td><td>' + p.requests + '</td><td>' + (p.bytes != null ? bytes(p.bytes) : 'Not Available') + '</td><td>' + (p.mainThreadMs != null ? '<b>' + fmtMs(p.mainThreadMs) + '</b>' : '<span class="muted">none observed</span>') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      html += '<p class="muted">' + esc(tp.note) + '</p>';
    }
    return panel('Third-Party Script Audit', 'public', html);
  }

  function cacheSection(report) {
    var c = report.lab.cache;
    if (!c) return '';
    var html = '';
    if (c.status !== 'measured') {
      html += '<div class="cwv-na-box"><span class="material-icons" aria-hidden="true">cached</span><b>Headers not observable</b><p>' + esc(c.reason || '') + '</p></div>';
    } else {
      html += '<div class="ad-summary-grid cwv-overview-grid">' +
        '<div class="ad-stat"><span>Static assets observed</span><b>' + c.static.total + '</b></div>' +
        '<div class="ad-stat"><span>With cache TTL</span><b>' + c.static.cacheable + '</b></div>' +
        '<div class="ad-stat"><span>Long-lived (≥ 7 d)</span><b>' + c.static.longLived + '</b></div>' +
        '<div class="ad-stat"><span>No cache headers</span><b>' + c.static.noCacheHeaders.length + '</b></div></div>';
      if (c.static.noCacheHeaders.length) {
        html += '<h6 class="cwv-subhead">Static assets without caching headers</h6><div class="mini-table-wrap"><table class="mini-table"><tbody>' +
          c.static.noCacheHeaders.map(function (i) { return '<tr><td class="cwv-target-cell">' + mono(i.url) + '</td><td>' + esc(i.header) + '</td></tr>'; }).join('') + '</tbody></table></div>';
      }
      html += '<h6 class="cwv-subhead">HTML document caching</h6><p class="muted">' + esc(c.html.note || '') + '</p>';
    }
    (c.notes || []).forEach(function (n) { html += '<p class="muted">' + esc(n) + '</p>'; });
    return panel('Caching Audit', 'cached', html);
  }

  function renderingSection(report) {
    var r = report.lab.rendering;
    if (!r) return '';
    var html = '<div class="ad-summary-grid cwv-overview-grid">' +
      '<div class="ad-stat"><span>Long tasks</span><b>' + r.mainThread.longTaskCount + '</b></div>' +
      '<div class="ad-stat"><span>Long-task time</span><b>' + fmtMs(r.mainThread.totalMs) + '</b></div>' +
      '<div class="ad-stat"><span>Long animation frames</span><b>' + (r.longAnimationFrames.status === 'measured' ? r.longAnimationFrames.total : 'n/a') + '</b></div>' +
      '<div class="ad-stat"><span>CLS</span><b>' + (r.instability.value != null ? fmtCls(r.instability.value) : 'n/a') + '</b></div></div>';
    if (r.longAnimationFrames.frames && r.longAnimationFrames.frames.length) {
      html += '<h6 class="cwv-subhead">Long animation frames</h6><div class="mini-table-wrap"><table class="mini-table"><thead><tr><th>Duration</th><th>Scripts</th></tr></thead><tbody>' +
        r.longAnimationFrames.frames.map(function (f) {
          return '<tr><td><b>' + fmtMs(f.duration) + '</b></td><td class="cwv-target-cell">' + (f.scripts || []).map(function (s) { return esc(s.name || '(inline)') + (s.duration ? ' (' + fmtMs(s.duration) + ')' : ''); }).join('<br>') || '<span class="muted">—</span>' + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    html += '<div class="calc-note"><span class="material-icons" aria-hidden="true">info</span>' + esc(r.forcedReflow.note) + '</div>';
    (r.issues || []).forEach(function (i) {
      html += '<div class="cwv-inline-issue"><b>' + sevBadge(i.severity) + ' ' + esc(i.title) + '</b><p>' + esc(i.detail) + '</p><small class="cwv-evidence">' + esc(i.evidence) + '</small></div>';
    });
    return panel('Rendering Analysis', 'animation', html);
  }

  function domSection(report) {
    var d = report.lab.dom;
    if (!d) return '';
    var html = '<div class="ad-summary-grid cwv-overview-grid">' +
      '<div class="ad-stat"><span>DOM nodes</span><b>' + (d.nodeCount != null ? d.nodeCount.toLocaleString('en-US') : 'Not Available') + '</b></div>' +
      '<div class="ad-stat"><span>Max depth</span><b>' + (d.maxDepth != null ? d.maxDepth : 'Not Available') + '</b></div>' +
      '<div class="ad-stat"><span>Body HTML</span><b>' + (d.bodyBytes != null ? bytes(d.bodyBytes) : 'Not Available') + '</b></div>' +
      '<div class="ad-stat"><span>Dynamic adds</span><b>' + (d.dynamicAdded != null ? d.dynamicAdded : 'Not Available') + '</b></div>' +
      '<div class="ad-stat"><span>iframes</span><b>' + (d.iframes != null ? d.iframes : 'Not Available') + '</b></div></div>';
    if (d.largestSubtrees && d.largestSubtrees.length) {
      html += '<h6 class="cwv-subhead">Largest subtrees</h6><div class="mini-table-wrap"><table class="mini-table"><tbody>' +
        d.largestSubtrees.map(function (s) { return '<tr><td class="cwv-target-cell">' + mono(s.selector || '(root)') + '</td><td>' + s.count + ' child nodes</td></tr>'; }).join('') + '</tbody></table></div>';
    }
    html += '<p class="muted">' + esc(d.note || '') + '</p>';
    return panel('DOM Analysis', 'account_tree', html);
  }

  /* ================= priority issues ================= */
  function issuesSection(report) {
    var issues = report.issues || [];
    var groups = { critical: [], high: [], medium: [], low: [] };
    issues.forEach(function (i) { (groups[i.severity] || groups.low).push(i); });
    var html = '<div class="ad-summary-grid cwv-overview-grid">' +
      '<div class="ad-stat s-critical"><span>Critical</span><b>' + (report.issueCounts.critical || 0) + '</b></div>' +
      '<div class="ad-stat s-warning"><span>High</span><b>' + (report.issueCounts.high || 0) + '</b></div>' +
      '<div class="ad-stat s-warning"><span>Medium</span><b>' + (report.issueCounts.medium || 0) + '</b></div>' +
      '<div class="ad-stat s-info"><span>Low</span><b>' + (report.issueCounts.low || 0) + '</b></div></div>';
    ['critical', 'high', 'medium', 'low'].forEach(function (sev) {
      var list = groups[sev];
      if (!list.length) return;
      html += '<h6 class="cwv-subhead">' + sevBadge(sev) + ' ' + esc(sev.charAt(0).toUpperCase() + sev.slice(1)) + ' issues (' + list.length + ')</h6>';
      html += list.map(function (i) {
        return '<div class="issue sev-' + i.severity + '"><div class="issue-icon material-icons" aria-hidden="true">' + (i.severity === 'critical' ? 'error' : i.severity === 'high' ? 'warning' : i.severity === 'medium' ? 'report_problem' : 'info') + '</div><div><h6>' + esc(i.title) + '</h6>' +
          '<p>' + esc(i.problem) + '</p>' +
          '<div class="issue-meta"><b>' + esc(i.impact || 'Performance') + '</b>' + (i.affectedResource ? ' · ' + mono(i.affectedResource) : '') + (i.wording === 'likely' ? ' · <span class="conf">likely contributor</span>' : '') + '</div>' +
          (i.evidence && i.evidence.length ? '<div class="evidence">' + i.evidence.map(function (e) { return esc(e); }).join('\n') + '</div>' : '') +
          '<span class="fix"><span>Recommended fix</span>' + esc(i.fix || 'See the related section.') + (i.savings ? '<br><small>' + esc(i.savings.label || 'Potentially reducible') + '</small>' : '') + '</span>' +
          '</div></div>';
      }).join('');
    });
    if (!issues.length) html += '<div class="dc-na-box"><span class="material-icons" aria-hidden="true">check_circle</span><b>No prioritized issues found in the measured data.</b></div>';
    html += '<p class="muted">' + esc(report.recommendationsNote || '') + '</p>';
    return panel('Priority Issues', 'priority_high', html, 'cwv-wide');
  }

  /* ================= technical ================= */
  function technicalSection(report) {
    var t = report.technical;
    var m = report.meta;
    var html = '';
    html += kv('Engine', esc(report.engine.name) + ' v' + esc(report.engine.version) + ' · thresholds reviewed ' + esc(report.engine.thresholdsVersion));
    html += kv('Audited URL', mono(m.requestedUrl || '')) + (m.finalUrl && m.finalUrl !== m.requestedUrl ? kv('Final URL (after redirects)', mono(m.finalUrl)) : '');
    (m.redirects || []).forEach(function (r) { html += kv('Redirect', r.from + ' → ' + r.to + ' (' + r.status + ')'); });
    html += kv('Scope', esc(report.scope.label));
    html += kv('Transport', esc(t.measurement.transport));
    html += kv('Network throttle', esc(t.measurement.networkThrottle));
    html += kv('CPU throttle', esc(t.measurement.cpuThrottle));
    html += kv('Viewport', t.measurement.viewport ? esc(t.measurement.viewport) : 'Not applied');
    html += kv('Document protocol', m.protocolDoc ? esc(m.protocolDoc) : 'Not observed');
    html += kv('Document status', m.htmlStatus != null ? m.htmlStatus : 'n/a');
    html += kv('HTML size', m.htmlBytes != null ? bytes(m.htmlBytes) + (m.htmlTruncated ? ' (truncated at cap)' : '') : 'n/a');
    html += kv('Browser', esc(t.measurement.browser));
    if (t.measurement.proxyHop) html += '<p class="muted">' + esc(t.measurement.proxyHop) + '</p>';
    html += '<h6 class="cwv-subhead">Measurement limitations</h6><ul class="cwv-limits">' + t.limitations.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>';
    html += '<h6 class="cwv-subhead">Privacy &amp; safety</h6><p class="muted">' + esc(t.privacy) + '</p>';
    html += '<h6 class="cwv-subhead">Reproducibility</h6><p class="muted">' + esc(t.reproducibility) + '</p>';
    html += '<h6 class="cwv-subhead">Score</h6><p class="muted">' + esc(report.lab.score.disclaimer) + '</p>';
    return panel('Technical Details', 'settings', html, 'cwv-wide');
  }

  /* ================= assembly ================= */
  CWV.Report.render = function (container, report) {
    var html = '';
    html += '<div class="cwv-report-head">' +
      '<div class="cwv-head-row"><h2 class="cwv-report-title">' + esc(report.meta && report.meta.finalUrl ? shortUrl(report.meta.finalUrl) : '') + '</h2></div>' +
      '<div class="cwv-meta-row">' +
      '<span class="chip">' + esc(report.scope.label) + '</span>' +
      '<span class="chip">' + esc(report.lab.profile && report.lab.profile.label || 'Profile') + '</span>' +
      '<span class="chip">' + esc(report.lab.label) + '</span>' +
      '<span class="chip">' + esc(report.engine.thresholdsVersion + ' thresholds') + '</span>' +
      '</div></div>';
    html += scoreSection(report);
    html += vitalsSection(report);
    html += fieldSection(report);
    html += inpSection(report);
    html += lcpSection(report);
    html += clsSection(report);
    html += '<div class="cwv-two-col">' + fcpSection(report) + ttfbSection(report) + '</div>';
    html += longTasksSection(report);
    html += waterfallSection(report);
    html += networkSection(report);
    html += depSection(report);
    html += '<div class="cwv-two-col">' + jsSection(report) + cssSection(report) + '</div>';
    html += '<div class="cwv-two-col">' + imagesSection(report) + fontsSection(report) + '</div>';
    html += '<div class="cwv-two-col">' + thirdPartiesSection(report) + cacheSection(report) + '</div>';
    html += '<div class="cwv-two-col">' + renderingSection(report) + domSection(report) + '</div>';
    html += issuesSection(report);
    html += technicalSection(report);
    container.innerHTML = html;
    CWV.Report.bind(container, report);
  };

  CWV.Report.bind = function (container, report) {
    // Waterfall search + type filter.
    var search = container.querySelector('#cwv-wf-search');
    var typeBtns = container.querySelectorAll('.cwv-wf-types button');
    var rows = container.querySelectorAll('.cwv-wf-row');
    function applyWf() {
      var q = search ? search.value.toLowerCase() : '';
      var type = 'all';
      typeBtns.forEach(function (b) { if (b.classList.contains('active')) type = b.getAttribute('data-type'); });
      rows.forEach(function (r) {
        var name = r.getAttribute('data-name') || '';
        var rt = r.getAttribute('data-type') || '';
        var okType = type === 'all' || (type === 'css' ? rt === 'stylesheet' : type === 'js' ? rt === 'script' : type === rt);
        r.style.display = (!q || name.indexOf(q) >= 0) && okType ? '' : 'none';
      });
    }
    if (search) search.addEventListener('input', applyWf);
    typeBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        typeBtns.forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        applyWf();
      });
    });
  };

  CWV.Report.esc = esc;
  CWV.Report.shortUrl = shortUrl;
  CWV.Report.bytes = bytes;
  CWV.Report.fmtMs = fmtMs;
  CWV.Report.fmtCls = fmtCls;
})();
