/* Broken Link Checker: UI (production-grade, inherits existing design system) */
(function () {
  'use strict';
  var form = document.getElementById('brokenlink-form');
  if (!form) return;
  var urlInput = document.getElementById('bl-url');
  var maxPagesSel = document.getElementById('bl-max-pages');
  var maxPagesCustom = document.getElementById('bl-max-pages-custom');
  var maxDepthSel = document.getElementById('bl-max-depth');
  var scanScopeSel = document.getElementById('bl-scan-scope');
  var checkExternalToggle = document.getElementById('bl-check-external');
  var checkImagesToggle = document.getElementById('bl-check-images');
  var checkDocsToggle = document.getElementById('bl-check-docs');
  var checkAnchorsToggle = document.getElementById('bl-check-anchors');
  var respectRobotsToggle = document.getElementById('bl-respect-robots');
  var out = document.getElementById('brokenlink-results');
  var lastReport = null;
  var abortCtrl = null;
  var currentFilter = 'all';
  var currentSearch = '';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>\"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function icon(n) { return '<span class="material-icons" aria-hidden="true">' + esc(n) + '</span>'; }

  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Copied'); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('Copied'); } catch {}
      document.body.removeChild(ta);
    }
  }

  function wrapUrl(u) {
    return '<span class="bl-url" title="' + esc(u) + '">' + esc(u) + '</span>';
  }

  function getMaxPages() {
    if (!maxPagesSel) return 500;
    var v = maxPagesSel.value;
    if (v === 'custom') {
      var c = parseInt(maxPagesCustom ? maxPagesCustom.value : 0, 10);
      if (!c || c < 1) return 500;
      return Math.min(Math.max(c, 1), 10000);
    }
    return parseInt(v, 10) || 500;
  }

  if (maxPagesSel) maxPagesSel.addEventListener('change', function () {
    if (!maxPagesCustom) return;
    if (maxPagesSel.value === 'custom') {
      maxPagesCustom.style.display = '';
      maxPagesCustom.focus();
    } else {
      maxPagesCustom.style.display = 'none';
    }
  });

  if (scanScopeSel && checkExternalToggle) scanScopeSel.addEventListener('change', function () {
    if (scanScopeSel.value === 'internal') {
      checkExternalToggle.checked = false;
    } else {
      checkExternalToggle.checked = true;
    }
  });

  var STEPS_ORDER = ['validate','url_validated','connect','connected','robots','robots_analyzed','sitemap','sitemap_discovered','crawl_start','crawl','crawl_done','normalize','deduplicated','checking','checking_done','canonical','report','done'];

    function progressUI(state) {
    var ICONS = {'url': 'link', 'robots': 'rule', 'sitemap': 'account_tree', 'discovered': 'radio_button_unchecked', 'scanned': 'radio_button_unchecked', 'links': 'radio_button_unchecked', 'unique': 'merge_type', 'checked': 'radio_button_unchecked', 'report': 'grading'};
    var stage = state.stage || 'init';
    var STEPS = [
      { key: 'url', label: 'URL validated' },
      { key: 'robots', label: 'robots.txt analyzed' },
      { key: 'sitemap', label: state.sitemaps ? 'Sitemap discovered (' + state.sitemaps + ')' : 'Sitemap discovered' },
      { key: 'discovered', label: state.discovered != null ? state.discovered + ' pages discovered' : 'Pages discovered' },
      { key: 'scanned', label: state.crawled != null ? state.crawled + ' pages scanned' : 'Pages scanned' },
      { key: 'links', label: state.links != null ? state.links + ' links discovered' : 'Links discovered' },
      { key: 'unique', label: state.unique != null ? state.unique + ' unique destinations' : 'Unique destinations' },
      { key: 'checked', label: state.checked != null && state.total != null ? state.checked + ' of ' + state.total + ' destinations checked' : 'Checking link destinations' },
      { key: 'report', label: 'Generating report' }
    ];
    var ORDER = ['init','validate','url_validated','connect','connected','robots','robots_analyzed','sitemap','sitemap_discovered','crawl_start','crawl','crawl_done','normalize','deduplicated','checking','checking_done','canonical','report','done'];
    var PROGRESS_KEYS = ['url','robots','sitemap','discovered','scanned','links','unique','checked','report'];
    var si = Math.max(0, ORDER.indexOf(stage));
    var states = {};
    STEPS.forEach(function (st, i) {
      var reached = ORDER.indexOf(['url_validated','robots_analyzed','sitemap_discovered','crawl_done','crawl_done','normalize','deduplicated','checking_done','report'][i]);
      if (stage === 'done') states[st.key] = 'done';
      else if (si > reached) states[st.key] = 'done';
      else if (si === reached) states[st.key] = 'active';
      else if ((st.key === 'discovered' || st.key === 'scanned') && (stage === 'crawl' || stage === 'crawl_start')) states[st.key] = 'active';
      else if (st.key === 'checked' && stage === 'checking') states[st.key] = 'active';
      else if (st.key === 'report' && stage === 'report') states[st.key] = 'active';
      else states[st.key] = 'wait';
    });
    var pct = 8;
    if (state.checked != null && state.total) pct = 15 + Math.round(state.checked / state.total * 78);
    else if (state.crawled != null && state.discovered) pct = 12 + Math.round(state.crawled / Math.max(1, state.discovered) * 45);
    var p = window.ScanProgress.reuse(out, {
      title: 'Scanning for broken links', target: (document.getElementById('bl-url') || {}).value || '', icon: 'search_off', steps: STEPS,
      note: state.message || 'Working\u2026',
      onCancel: function () { if (abortCtrl) abortCtrl.abort(); }
    });
    p.set(states, state.message || 'Working\u2026', pct);
  }

  function errorUI(err) {
    var msg = err.message || String(err);
    var code = err.code || 'error';
    var friendlyMap = {
      invalid_url: 'Please enter a valid public URL (e.g. https://example.com).',
      ssrf: 'That address cannot be scanned (private, localhost, or cloud metadata).',
      dns: 'DNS resolution failed, the domain does not exist or cannot be resolved.',
      tls: 'SSL/TLS handshake failed, the site has an invalid or expired certificate.',
      timeout: 'The website took too long to respond.',
      robots: 'Crawling blocked by robots.txt for the start URL.',
      busy: 'The checker is busy. Please try again shortly.',
      ratelimit: 'Too many scans from this network. Please wait a few minutes.',
      cancelled: 'The scan was cancelled.',
      fetch_failed: 'Could not connect to the website. It may be offline or blocking scanners.',
      unreachable: 'Server could not reach the website, trying browser fallback...',
      redirect_loop: 'Redirect loop detected.',
      too_large: 'A response was too large to analyze safely.'
    };
    var friendly = friendlyMap[code] || 'The scan could not be completed.';
    out.innerHTML = '<div class="paper paper-padded audit-error"><span class="material-icons">error_outline</span><h3>' + (code === 'cancelled' ? 'Scan cancelled' : 'Scan failed') + '</h3><p>' + esc(friendly) + '</p>' + (code !== 'cancelled' ? '<p class="muted">Technical: ' + esc(msg) + '</p>' : '') + '<button class="btn" id="bl-retry">Try again</button></div>';
    var b = document.getElementById('bl-retry');
    if (b) b.onclick = function () { form.requestSubmit(); };
  }

  function stat(label, val, sub) {
    return '<div class="audit-stat"><strong>' + esc(val) + '</strong><span>' + esc(label) + (sub ? '<br><small class="muted">' + esc(sub) + '</small>' : '') + '</span></div>';
  }

  function scoreColor(n) {
    if (n >= 90) return '#2e7d32';
    if (n >= 70) return '#689f38';
    if (n >= 50) return '#ed6c02';
    if (n >= 25) return '#d32f2f';
    return '#b71c1c';
  }

  function renderScore(report) {
    var s = report.score;
    var col = scoreColor(s.score);
    var breakdownHtml = (s.breakdown || []).map(function (b) {
      return '<div class="calc-line neg"><span>' + esc(b.factor) + ' (' + b.count + ')</span><b>-' + b.penalty + '</b></div><small class="muted">' + esc(b.detail) + '</small>';
    }).join('');
    if (!breakdownHtml) breakdownHtml = '<p class="muted">No penalties, no confirmed broken links detected.</p>';
    return '<div class="score-card"><div class="score-ring" style="--score:' + s.score + ';background:conic-gradient(' + col + ' calc(var(--score)*1%),var(--chip-bg) 0)"><b style="color:' + col + '">' + s.score + '</b></div><div class="score-summary"><h2>Broken Link Health Score: ' + s.score + '/100</h2><p class="muted">' + esc(s.grade) + ', ' + esc((s.explanation || '').split('.')[0] + '.') + '</p><details><summary>How this score was calculated</summary><div style="margin-top:10px">' + breakdownHtml + '<div class="calc-note">' + icon('info') + '<span>' + esc(s.explanation || '') + '</span></div></div></details></div></div>';
  }

  function renderSummary(report) {
    var st = report.stats;
    return '<div class="audit-stats">' +
      stat('Pages discovered', st.pagesDiscovered) +
      stat('Pages scanned', st.pagesScanned) +
      stat('Links discovered', st.linksDiscovered) +
      stat('Unique links', st.uniqueLinks) +
      stat('Internal links', st.totalInternal) +
      stat('External links', st.totalExternal) +
      stat('Confirmed broken', st.confirmedBroken, st.confirmedBrokenInternal + ' internal, ' + st.confirmedBrokenExternal + ' external') +
      stat('Redirects', st.redirects) +
      stat('Blocked', st.blocked) +
      stat('Timeouts', st.timeouts) +
      stat('DNS errors', st.dnsErrors) +
      stat('SSL errors', st.sslErrors) +
      stat('Anchor errors', st.brokenAnchors) +
      stat('Redirect loops', st.redirectLoops) +
      stat('Duplicates removed', st.duplicateRefs) +
      stat('Duration', Math.round(st.durationMs / 100) / 10 + 's') +
      '</div>';
  }

  function severityBadge(sev) {
    var cls = sev === 'critical' ? 'critical' : sev === 'high' ? 'high' : sev === 'medium' ? 'medium' : 'low';
    return '<span class="badge ' + cls + '">' + esc(sev) + '</span>';
  }

  function classificationPill(cls) {
    var cat = (cls.category || '').toLowerCase();
    var pillCls = 's-unk';
    if (cat === 'healthy') pillCls = 's-ok';
    else if (cat === 'broken' || cat === 'dns_error' || cat === 'server_error' || cat === 'ssl_error' || cat === 'broken_anchor') pillCls = 's-err';
    else if (cat === 'redirect') pillCls = 's-redir';
    return '<span class="status-pill ' + pillCls + '">' + esc(cls.classification || 'Unknown') + '</span>';
  }

  function filterIssues(issues, filter, search) {
    var q = (search || '').toLowerCase();
    return issues.filter(function (iss) {
      var cat = (iss.classification.category || '').toLowerCase();
      var cls = (iss.classification.classification || '').toLowerCase();
      var status = iss.status;
      var type = (iss.linkType || '').toLowerCase();
      var isInt = iss.isInternal;

      if (filter !== 'all') {
        if (filter === 'confirmed_broken' && cls !== 'confirmed broken') return false;
        if (filter === '404' && status !== 404) return false;
        if (filter === '410' && status !== 410) return false;
        if (filter === '5xx' && !(status >= 500 && status < 600)) return false;
        if (filter === 'dns' && cat !== 'dns_error') return false;
        if (filter === 'ssl' && cat !== 'ssl_error') return false;
        if (filter === 'redirect' && cat !== 'redirect') return false;
        if (filter === 'chain' && !(iss.redirectAnalysis && iss.redirectAnalysis.count > 1)) return false;
        if (filter === 'loop' && !(iss.redirectAnalysis && iss.redirectAnalysis.isLoop)) return false;
        if (filter === 'blocked' && !(cat === 'blocked' || cat === 'restricted' || cat === 'bot_protection' || cat === 'rate_limited' || cls.includes('blocked') || cls.includes('forbidden') || cls.includes('bot'))) return false;
        if (filter === 'timeout' && !(cat === 'timeout' || cat === 'temporary_failure')) return false;
        if (filter === 'anchor' && cat !== 'broken_anchor') return false;
        if (filter === 'internal' && !isInt) return false;
        if (filter === 'external' && isInt) return false;
        if (filter === 'image' && type !== 'image') return false;
        if (filter === 'file' && type !== 'file') return false;
      }

      if (q) {
        var hay = (iss.source + ' ' + iss.destination + ' ' + iss.anchorText + ' ' + status + ' ' + (iss.classification.reason || '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderTable(issues) {
    if (!issues.length) return '<div class="paper paper-padded"><p class="muted">No issues match this filter. All links appear healthy, or only working/redirects were found.</p></div>';

    var html = '<div class="audit-panel wide"><div class="page-table-wrap"><table class="mini-table bl-table"><thead><tr><th>Source Page</th><th>Destination</th><th>Status</th><th>Type</th><th>Anchor</th><th>Classification</th><th>Severity</th><th>Occurrences</th></tr></thead><tbody>';
    issues.slice(0, 500).forEach(function (iss, idx) {
      var res = iss.result || {};
      var cls = iss.classification || {};
      html += '<tr class="bl-row" data-idx="' + idx + '"><td class="url-cell">' + wrapUrl(iss.source) + '</td><td class="url-cell">' + wrapUrl(iss.destination) + '</td><td><span class="status-pill s-' + (res.status >= 200 && res.status < 300 ? 'ok' : res.status >= 300 && res.status < 400 ? 'redir' : res.status >= 400 ? 'err' : 'unk') + '">' + esc(res.status || ',') + '</span></td><td><span class="chip">' + esc(iss.linkType) + '</span> ' + (iss.isInternal ? '<span class="chip chip-primary">internal</span>' : '<span class="chip">external</span>') + '</td><td>' + esc((iss.anchorText || '').slice(0, 40)) + '</td><td>' + classificationPill(cls) + '<br><small class="muted">' + esc((cls.reason || '').slice(0, 80)) + '</small></td><td>' + severityBadge(iss.severity || 'low') + '</td><td>' + iss.occurrences + '</td></tr>';
      html += '<tr class="bl-detail" id="bl-detail-' + idx + '" style="display:none"><td colspan="8"><div class="bl-detail-box">';
      html += '<div class="calc-line"><span>Source</span><b>' + wrapUrl(iss.source) + '</b></div>';
      html += '<div class="calc-line"><span>Destination</span><b>' + wrapUrl(iss.destination) + '</b></div>';
      if (iss.originalWithFragment && iss.originalWithFragment !== iss.destination) {
        html += '<div class="calc-line"><span>Original (with fragment)</span><b>' + wrapUrl(iss.originalWithFragment) + '</b></div>';
      }
      html += '<div class="calc-line"><span>Final URL</span><b>' + wrapUrl(res.finalUrl || iss.destination) + '</b></div>';
      html += '<div class="calc-line"><span>Status</span><b>' + esc(res.status) + '</b></div>';
      html += '<div class="calc-line"><span>Classification</span><b>' + esc(cls.classification) + ', ' + esc(cls.reason || '') + '</b></div>';
      html += '<div class="calc-line"><span>Link type</span><b>' + esc(iss.linkType) + ' · ' + (iss.isInternal ? 'internal' : 'external') + '</b></div>';
      html += '<div class="calc-line"><span>Crawl depth</span><b>' + esc(iss.depth != null ? iss.depth : '0') + '</b></div>';
      html += '<div class="calc-line"><span>Occurrences</span><b>' + iss.occurrences + ', found on ' + iss.sources.length + ' pages</b></div>';
      if (iss.sources.length > 1) {
        html += '<details><summary>Show all ' + iss.sources.length + ' source pages</summary><div class="bl-sources">' + iss.sources.map(function (s) { return '<div>' + wrapUrl(s) + '</div>'; }).join('') + '</div></details>';
      }
      if (res.redirects && res.redirects.length) {
        html += '<details open><summary>Redirect chain (' + res.redirects.length + ')</summary><div class="bl-redirects">' + res.redirects.map(function (r) {
          return '<div class="dc-hop"><span class="dc-mono">' + esc(r.from) + '</span> → <span class="status-pill"> ' + r.status + ' </span> → <span class="dc-mono">' + esc(r.to) + '</span></div>';
        }).join('') + (res.finalUrl ? '<div class="dc-hop">Final: ' + wrapUrl(res.finalUrl) + '</div>' : '') + '</div></details>';
        if (iss.redirectAnalysis && iss.redirectAnalysis.issues.length) {
          html += '<div class="calc-note">' + icon('warning') + '<span>' + esc(iss.redirectAnalysis.issues.join(', ')) + '</span></div>';
        }
      }
      if (res.evidence || res.attempts) {
        var ev = res.evidence || res.attempts || [];
        html += '<details><summary>Evidence (' + ev.length + ' attempts)</summary><div class="bl-evidence">' + ev.map(function (e) {
          return '<div>Attempt: status ' + esc(e.status) + (e.error ? ' · ' + esc(e.error) : '') + (e.responseTime ? ' · ' + e.responseTime + 'ms' : '') + '</div>';
        }).join('') + '</div></details>';
      }
      if (res.botProtection && res.botProtection.detected) {
        html += '<div class="calc-note">' + icon('shield') + '<span>Bot protection detected: ' + esc(res.botProtection.provider) + ' (' + esc(res.botProtection.type) + ')</span></div>';
      }
      if (res.tls) {
        html += '<div class="calc-note">' + icon('lock') + '<span>TLS: ' + esc(res.tls.status) + ', ' + esc(res.tls.reason || '') + '</span></div>';
      }
      if (res.dns) {
        html += '<div class="calc-note">' + icon('dns') + '<span>DNS: ' + esc(res.dns.code) + ', ' + esc(res.dns.error || '') + '</span></div>';
      }
      if (iss.anchorIssue) {
        html += '<div class="calc-note">' + icon('anchor') + '<span>Anchor: ' + esc(iss.anchorIssue.reason) + '</span></div>';
      }
      html += '</div></td></tr>';
    });
    html += '</tbody></table></div></div>';

    html += '<div class="bl-cards">' + issues.slice(0, 200).map(function (iss, idx) {
      var res = iss.result || {};
      var cls = iss.classification || {};
      return '<div class="card bl-card" data-idx="' + idx + '"><div class="card-content"><div class="bl-card-head"><b>' + classificationPill(cls) + '</b> ' + severityBadge(iss.severity) + '</div><div class="calc-line"><span>Source</span><b class="bl-url">' + esc(iss.source) + '</b></div><div class="calc-line"><span>Destination</span><b class="bl-url">' + esc(iss.destination) + '</b></div><div class="calc-line"><span>Status</span><b>' + esc(res.status) + '</b></div><div class="calc-line"><span>Type</span><b>' + esc(iss.linkType) + ' · ' + (iss.isInternal ? 'internal' : 'external') + '</b></div><div class="calc-line"><span>Anchor</span><b>' + esc((iss.anchorText || '').slice(0, 60)) + '</b></div><div class="calc-line"><span>Occurrences</span><b>' + iss.occurrences + '</b></div><button class="row-detail bl-expand" data-idx="' + idx + '">Details</button></div></div>';
    }).join('') + '</div>';

    return html;
  }

  function renderDashboard(report) {
    var st = report.stats;
    var issues = report.issues || [];

    var confirmedBroken = issues.filter(function (i) { return i.classification.classification === 'Confirmed Broken'; });
    var redirects = issues.filter(function (i) { return i.classification.category === 'redirect'; });
    var redirectLoops = issues.filter(function (i) { return i.redirectAnalysis && i.redirectAnalysis.isLoop; });
    var blocked = issues.filter(function (i) { var c = i.classification.category; return c === 'blocked' || c === 'restricted' || c === 'bot_protection' || c === 'rate_limited'; });
    var timeouts = issues.filter(function (i) { return i.classification.category === 'timeout' || i.classification.category === 'temporary_failure'; });
    var dns = issues.filter(function (i) { return i.classification.category === 'dns_error'; });
    var ssl = issues.filter(function (i) { return i.classification.category === 'ssl_error'; });
    var anchors = issues.filter(function (i) { return i.classification.category === 'broken_anchor'; });

    var html = '<div class="report-actions">' +
      '<button class="btn" id="bl-rerun">' + icon('refresh') + ' Re-run</button>' +
      '<button class="btn" id="bl-export-csv">' + icon('download') + ' Download CSV</button>' +
      '<button class="btn" id="bl-export-json">' + icon('download') + ' Download JSON</button>' +
      '<button class="btn" id="bl-copy-broken">' + icon('content_copy') + ' Copy Confirmed Broken URLs</button>' +
      '<button class="btn" onclick="window.print()">' + icon('print') + ' Print</button>' +
      '</div>';

    html += renderScore(report);
    html += renderSummary(report);

    html += '<div class="audit-panel wide"><h3>Severity overview</h3><div class="audit-stats">' +
      stat('Critical', report.severity.critical || 0) +
      stat('High', report.severity.high || 0) +
      stat('Medium', report.severity.medium || 0) +
      stat('Low', report.severity.low || 0) +
      '</div></div>';

    html += '<div class="audit-grid"><div class="audit-panel"><h3>Scan Summary</h3>' +
      '<div class="calc-line"><span>Input URL</span><b>' + wrapUrl(report.inputUrl) + '</b></div>' +
      '<div class="calc-line"><span>Final URL</span><b>' + wrapUrl(report.finalUrl) + '</b></div>' +
      '<div class="calc-line"><span>Pages discovered</span><b>' + st.pagesDiscovered + '</b></div>' +
      '<div class="calc-line"><span>Pages scanned</span><b>' + st.pagesScanned + '</b></div>' +
      '<div class="calc-line"><span>Links discovered</span><b>' + st.linksDiscovered + '</b></div>' +
      '<div class="calc-line"><span>Unique destinations</span><b>' + st.uniqueLinks + '</b></div>' +
      '<div class="calc-line"><span>Internal</span><b>' + st.totalInternal + '</b></div>' +
      '<div class="calc-line"><span>External</span><b>' + st.totalExternal + '</b></div>' +
      '<div class="calc-line"><span>Duplicates removed</span><b>' + st.duplicateRefs + '</b></div>' +
      '<div class="calc-line"><span>Duration</span><b>' + (Math.round(st.durationMs / 100) / 10) + 's</b></div>' +
      (report.robots ? '<div class="calc-line"><span>robots.txt</span><b>' + (report.robots.exists ? 'Found' : 'Not found') + '</b></div>' : '') +
      (report.sitemaps ? '<div class="calc-line"><span>Sitemaps</span><b>' + report.sitemaps.count + ' found, ' + report.sitemaps.pageUrls + ' URLs</b></div>' : '') +
      (report.browserFallback ? '<div class="calc-note">' + icon('computer') + '<span>Browser fallback used, server could not reach site directly.</span></div>' : '') +
      '</div>';

    html += '<div class="audit-panel"><h3>Internal Link Health</h3>' +
      '<div class="calc-line"><span>Total internal</span><b>' + st.totalInternal + '</b></div>' +
      '<div class="calc-line"><span>Confirmed broken</span><b>' + st.confirmedBrokenInternal + '</b></div>' +
      '<div class="calc-line"><span>Working</span><b>' + (st.totalInternal - st.confirmedBrokenInternal) + '</b></div>' +
      '<div class="calc-line"><span>Health</span><b>' + Math.max(0, 100 - Math.round((st.confirmedBrokenInternal / Math.max(1, st.totalInternal)) * 100)) + '%</b></div>' +
      '<h3 style="margin-top:16px">External Link Health</h3>' +
      '<div class="calc-line"><span>Total external</span><b>' + st.totalExternal + '</b></div>' +
      '<div class="calc-line"><span>Confirmed broken</span><b>' + st.confirmedBrokenExternal + '</b></div>' +
      '<div class="calc-line"><span>Blocked / Unable to Verify</span><b>' + blocked.filter(function (i) { return !i.isInternal; }).length + '</b></div>' +
      '</div></div>';

    html += '<div class="audit-panel wide"><h3>Scan Complete</h3><p class="muted">Found ' + confirmedBroken.length + ' confirmed broken links, ' + redirects.length + ' redirects, ' + blocked.length + ' blocked/unable to verify.</p></div>';

    if (confirmedBroken.length) html += '<div class="audit-panel wide"><h3>Confirmed Broken Links (' + confirmedBroken.length + ')</h3><p class="muted">Most important, 404, 410, persistent 5xx, DNS failure, persistent connection failure after retries.</p></div>';
    if (redirectLoops.length) html += '<div class="audit-panel wide"><h3>Redirect Loops (' + redirectLoops.length + ')</h3><p class="muted">A → B → A detected, critical.</p></div>';
    if (redirects.length) html += '<div class="audit-panel wide"><h3>Redirect Issues (' + redirects.length + ')</h3><p class="muted">Single redirects, chains, cross-domain, HTTP→HTTPS, www variations. Single 301 is not broken.</p></div>';
    if (blocked.length) html += '<div class="audit-panel wide"><h3>Blocked / Unable to Verify (' + blocked.length + ')</h3><p class="muted">401, 403, 429, bot protection, CAPTCHA, Cloudflare challenge, not classified as broken.</p></div>';
    if (dns.length || ssl.length || timeouts.length) html += '<div class="audit-panel wide"><h3>Network Issues</h3><p class="muted">DNS: ' + dns.length + ' · SSL: ' + ssl.length + ' · Timeouts: ' + timeouts.length + '</p></div>';
    if (anchors.length) html += '<div class="audit-panel wide"><h3>Anchor Issues (' + anchors.length + ')</h3><p class="muted">Fragment targets that do not exist.</p></div>';
    if (report.sitemapIssues && report.sitemapIssues.length) {
      html += '<div class="audit-panel wide"><h3>Sitemap Issues (' + report.sitemapIssues.length + ')</h3><div class="bl-sitemap-issues">' + report.sitemapIssues.map(function (s) {
        return '<div class="calc-line"><span>' + esc(s.type) + '</span><b>' + esc(s.reason || s.url) + '</b></div>';
      }).join('') + '</div></div>';
    }
    if (report.canonicalIssues && report.canonicalIssues.length) {
      html += '<div class="audit-panel wide"><h3>Canonical Issues (' + report.canonicalIssues.length + ')</h3><p class="muted">Canonical points to 404, redirect, or another domain.</p><div>' + report.canonicalIssues.slice(0, 20).map(function (c) {
        return '<div class="calc-line"><span>' + wrapUrl(c.pageUrl) + '</span><b>' + esc((c.issues || []).join(', ')) + ' → ' + wrapUrl(c.canonical) + '</b></div>';
      }).join('') + '</div></div>';
    }

    var filterOptions = [
      ['all', 'All (' + issues.length + ')'],
      ['confirmed_broken', 'Confirmed Broken (' + confirmedBroken.length + ')'],
      ['404', '404'],
      ['410', '410'],
      ['5xx', '5xx'],
      ['dns', 'DNS Errors (' + dns.length + ')'],
      ['ssl', 'SSL Errors (' + ssl.length + ')'],
      ['redirect', 'Redirects (' + redirects.length + ')'],
      ['chain', 'Redirect Chains'],
      ['loop', 'Redirect Loops (' + redirectLoops.length + ')'],
      ['blocked', 'Blocked (' + blocked.length + ')'],
      ['timeout', 'Timeout (' + timeouts.length + ')'],
      ['anchor', 'Broken Anchors (' + anchors.length + ')'],
      ['internal', 'Internal (' + issues.filter(function (i) { return i.isInternal; }).length + ')'],
      ['external', 'External (' + issues.filter(function (i) { return !i.isInternal; }).length + ')'],
      ['image', 'Images (' + issues.filter(function (i) { return i.linkType === 'image'; }).length + ')'],
      ['file', 'Files (' + issues.filter(function (i) { return i.linkType === 'file'; }).length + ')']
    ];

    html += '<div class="audit-panel wide"><h3>Detailed Results</h3><div class="tabs" id="bl-filter-tabs">' + filterOptions.map(function (f, i) {
      return '<button type="button" data-f="' + f[0] + '" class="' + (i === 0 ? 'active' : '') + '">' + esc(f[1]) + '</button>';
    }).join('') + '</div><input type="search" id="bl-search" class="text-input" placeholder="Search by source, destination, anchor, status, error..." aria-label="Search results" style="margin-bottom:12px;max-width:420px"><div id="bl-table-container">' + renderTable(issues) + '</div></div>';

    out.innerHTML = html;

    document.getElementById('bl-rerun').onclick = function () { form.requestSubmit(); };
    document.getElementById('bl-export-csv').onclick = function () { exportCsv(report); };
    document.getElementById('bl-export-json').onclick = function () { exportJson(report); };
    document.getElementById('bl-copy-broken').onclick = function () { copyBroken(report); };

    var tabs = document.getElementById('bl-filter-tabs');
    var searchInput = document.getElementById('bl-search');
    var tableContainer = document.getElementById('bl-table-container');

    function applyFilters() {
      var filtered = filterIssues(issues, currentFilter, currentSearch);
      tableContainer.innerHTML = renderTable(filtered);
      bindRowExpands();
    }

    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      Array.prototype.forEach.call(tabs.querySelectorAll('button'), function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      currentFilter = b.dataset.f;
      applyFilters();
    });

    searchInput.addEventListener('input', function () {
      currentSearch = searchInput.value;
      applyFilters();
    });

    function bindRowExpands() {
      var rows = tableContainer.querySelectorAll('.bl-row');
      rows.forEach(function (row) {
        row.style.cursor = 'pointer';
        row.onclick = function () {
          var idx = row.dataset.idx;
          var detail = document.getElementById('bl-detail-' + idx);
          if (detail) detail.style.display = detail.style.display === 'none' ? '' : 'none';
        };
      });
      var cards = tableContainer.querySelectorAll('.bl-card .bl-expand');
      cards.forEach(function (btn) {
        btn.onclick = function () {
          var idx = btn.dataset.idx;
          var detail = document.getElementById('bl-detail-' + idx);
          if (detail) {
            detail.style.display = detail.style.display === 'none' ? '' : 'none';
            if (detail.style.display !== 'none') detail.scrollIntoView({ behavior: 'smooth' });
          }
        };
      });
    }

    bindRowExpands();
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function exportCsv(report) {
    var issues = report.issues || [];
    var headers = ['Source URL', 'Destination URL', 'Anchor text', 'HTTP status', 'Final URL', 'Classification', 'Error', 'Link type', 'Crawl depth', 'Occurrences'];
    var rows = [headers.map(function (h) { return '"' + h.replace(/"/g, '""') + '"'; }).join(',')];
    issues.forEach(function (iss) {
      var res = iss.result || {};
      var cls = iss.classification || {};
      var row = [
        iss.source || '',
        iss.destination || '',
        iss.anchorText || '',
        res.status || '',
        res.finalUrl || '',
        cls.classification || '',
        cls.reason || res.error || '',
        iss.linkType || '',
        iss.depth != null ? iss.depth : '',
        iss.occurrences || 1
      ];
      rows.push(row.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','));
    });
    var blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'broken-links-' + (new Date().toISOString().slice(0, 10)) + '.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('CSV downloaded');
  }

  function exportJson(report) {
    var blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'broken-links-' + (new Date().toISOString().slice(0, 10)) + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('JSON downloaded');
  }

  function copyBroken(report) {
    var broken = (report.issues || []).filter(function (i) { return i.classification.classification === 'Confirmed Broken'; }).map(function (i) { return i.destination; });
    var unique = Array.from(new Set(broken));
    if (!unique.length) { toast('No confirmed broken URLs'); return; }
    copyText(unique.join('\n'));
  }

  function runServerScan(payload) {
    return new Promise(function (resolve, reject) {
      abortCtrl = new AbortController();
      var timeout = setTimeout(function () { abortCtrl.abort(); reject({ code: 'timeout', message: 'Scan timed out' }); }, 200000);
      fetch('/api/brokenlink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortCtrl.signal
      }).then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () { return {}; }).then(function (j) {
            throw { code: j.code || 'http_' + res.status, message: j.message || ('Server answered HTTP ' + res.status) };
          });
        }
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        var eventName = '';
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) { clearTimeout(timeout); resolve(null); return; }
            buffer += decoder.decode(r.value, { stream: true });
            var idx;
            while ((idx = buffer.indexOf('\n\n')) !== -1) {
              var chunk = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              var lines = chunk.split('\n');
              var data = '';
              eventName = '';
              for (var i = 0; i < lines.length; i++) {
                if (lines[i].indexOf('event:') === 0) eventName = lines[i].slice(6).trim();
                else if (lines[i].indexOf('data:') === 0) data += lines[i].slice(5).trim();
              }
              if (!data) continue;
              var obj = null;
              try { obj = JSON.parse(data); } catch {}
              if (eventName === 'progress' && obj) progressUI(obj);
              else if (eventName === 'result' && obj) { clearTimeout(timeout); resolve(obj); return; }
              else if (eventName === 'error') { clearTimeout(timeout); reject({ code: (obj && obj.code) || 'error', message: (obj && obj.message) || 'Scan failed' }); return; }
            }
            return pump();
          });
        }
        return pump();
      }).catch(function (e) {
        clearTimeout(timeout);
        reject({ code: (e && e.code) || 'network', message: (e && e.message) || 'Network error' });
      });
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var url = urlInput.value.trim();
    if (!url) return;
    var payload = {
      url: url,
      maxPages: getMaxPages(),
      maxDepth: maxDepthSel ? maxDepthSel.value : '5',
      scanScope: scanScopeSel ? scanScopeSel.value : 'internal+external',
      checkExternal: checkExternalToggle ? checkExternalToggle.checked : true,
      checkImages: checkImagesToggle ? checkImagesToggle.checked : false,
      checkDocuments: checkDocsToggle ? checkDocsToggle.checked : false,
      checkAnchors: checkAnchorsToggle ? checkAnchorsToggle.checked : false,
      respectRobots: respectRobotsToggle ? respectRobotsToggle.checked : true
    };
    out.innerHTML = '';
    progressUI({ stage: 'validate', message: 'Starting scan for ' + url });
    runServerScan(payload).then(function (report) {
      if (!report) { errorUI({ code: 'error', message: 'Server ended without report' }); return; }
      lastReport = report;
      renderDashboard(report);
    }).catch(function (err) {
      // Fallback to browser runner for network failures
      var fallbackCodes = ['unreachable','fetch_failed','timeout','dns','tls','network','ECONNREFUSED','ENOTFOUND'];
      var shouldFallback = fallbackCodes.indexOf(err.code) >= 0 || /fetch failed|unreachable|timeout|dns|tls|network/i.test(err.message || '');
      // Don't fallback for invalid_url, ssrf, robots, busy, ratelimit
      if (shouldFallback && window.BrokenLinkBrowserRunner && window.BrokenLinkBrowserRunner.run) {
        progressUI({ stage: 'connect', message: 'Server could not reach site. Retrying through your browser...' });
        var browserPayload = {
          url: payload.url,
          maxPages: payload.maxPages,
          maxDepth: payload.maxDepth,
          scanScope: payload.scanScope,
          checkExternal: payload.checkExternal,
          checkImages: payload.checkImages,
          checkDocuments: payload.checkDocuments,
          checkAnchors: payload.checkAnchors,
          signal: abortCtrl.signal
        };
        window.BrokenLinkBrowserRunner.run(browserPayload, progressUI).then(function (report) {
          lastReport = report;
          renderDashboard(report);
        }).catch(function (be) {
          errorUI(be || err);
        }).finally(function () { abortCtrl = null; });
      } else {
        errorUI(err);
        abortCtrl = null;
      }
    });
  });

  var qs = new URLSearchParams(location.search).get('url');
  if (qs) {
    urlInput.value = qs;
    form.requestSubmit();
  }
})();
