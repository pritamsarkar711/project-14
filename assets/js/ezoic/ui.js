/* huvanti Ezoic Eligibility Checker, report UI (separate from AdSense). */
(function () {
  'use strict';
  var form = document.getElementById('ezoic-form');
  if (!form) return;
  var urlInput = document.getElementById('ezoic-url');
  var limitSel = document.getElementById('ezoic-limit');
  var out = document.getElementById('ezoic-results');
  var lastReport = null;
  var abortCtrl = null;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function sevIcon(s) {
    return s === 'passed' ? 'check_circle' : s === 'critical' ? 'error' : s === 'high' ? 'cancel' : s === 'medium' ? 'warning' : s === 'manual' ? 'hourglass_empty' : 'info';
  }
  function sevPill(s) { return '<span class="badge ' + s + '">' + esc(s) + '</span>'; }
  function sourceChip(t) {
    var label = t === 'official' ? 'Official requirement' : t === 'best_practice' ? 'Best practice' : t === 'heuristic' ? 'Heuristic' : (t || '');
    if (!label) return '';
    return '<span class="ez-source ez-' + esc(t) + '">' + label + '</span>';
  }
  function ringColor(n) { return n >= 70 ? '#2e7d32' : n >= 40 ? '#ed6c02' : '#d32f2f'; }

  var STEPS = [
    ['connect', 'Website connected'],
    ['robots', 'Robots.txt analyzed'],
    ['sitemap', 'Sitemap discovered'],
    ['crawler', 'Pages crawled'],
    ['important', 'Important pages detected'],
    ['content', 'Content analyzed'],
    ['duplicates', 'Duplicate analysis completed'],
    ['technical', 'Technical audit completed'],
    ['policy', 'Policy-risk screening completed'],
    ['score', 'Calculating readiness score']
  ];
  function stepState(key, current) {
    var order = ['init', 'connect', 'robots', 'sitemap', 'crawler', 'parse', 'important', 'content', 'duplicates', 'technical', 'ux', 'trust', 'monetization', 'policy', 'ezoic', 'score', 'done'];
    var map = { parse: 'important', ux: 'technical', trust: 'technical', monetization: 'policy', ezoic: 'policy' };
    var cur = map[current] || current;
    var a = ['connect', 'robots', 'sitemap', 'crawler', 'important', 'content', 'duplicates', 'technical', 'policy', 'score'].indexOf(key);
    var b = ['connect', 'robots', 'sitemap', 'crawler', 'important', 'content', 'duplicates', 'technical', 'policy', 'score'].indexOf(cur);
    if (current === 'done') return 'done';
    if (current === 'init') return key === 'connect' ? 'active' : 'wait';
    if (a < 0) return 'wait';
    if (b < 0) return a === 0 ? 'active' : 'wait';
    return a < b ? 'done' : a === b ? 'active' : 'wait';
  }

    function progressUI(state) {
    var ICONS = {'connect': 'power', 'robots': 'rule', 'sitemap': 'account_tree', 'crawler': 'travel_explore', 'important': 'star', 'content': 'article', 'duplicates': 'merge_type', 'technical': 'build', 'policy': 'gpp_maybe', 'score': 'grading'};
    var steps = STEPS.map(function (s) { return { key: s[0], label: s[1], icon: ICONS[s[0]] || 'radio_button_unchecked' }; });
    var states = {};
    STEPS.forEach(function (s) { states[s[0]] = stepState(s[0], state.stage); });
    var p = window.ScanProgress.reuse(out, {
      title: 'Checking Ezoic readiness', target: (urlInput && urlInput.value) || '', icon: 'insights', steps: steps,
      note: state.message || 'Working\u2026',
      onCancel: function () { if (abortCtrl) abortCtrl.abort(); }
    });
    p.set(states, state.message || 'Working\u2026', 8 + Math.round(Object.keys(states).filter(function (k) { return states[k] === 'done'; }).length / steps.length * 88));
    if (state.crawled != null) p.label('crawler', state.crawled + (state.limit ? ' of ' + state.limit : '') + ' pages crawled');
  }

  function errorUI(err) {
    var msg = err.message || String(err);
    var code = err.code || 'error';
    var friendly = {
      invalid_url: 'Please enter a valid public website URL (e.g. https://example.com).',
      ssrf: 'That address cannot be audited (private, local, or metadata target).',
      dns: 'The domain could not be resolved.',
      unreachable: 'The website could not be reached. It may be offline or blocking this checker.',
      ssl: 'A secure HTTPS connection could not be established.',
      timeout: 'The website took too long to respond.',
      challenge: 'The site appears to be protected by a Cloudflare/bot challenge and cannot be read automatically. Status: Unable to Verify.',
      too_large: 'A page response was too large to analyse.',
      cancelled: 'The audit was cancelled.',
      empty: 'No readable HTML pages were found. The site may be JavaScript-only or empty.',
      busy: 'Another audit is already running on this server. Please wait and try again.',
      ratelimit: 'Too many audits from this network. Please wait a few minutes.'
    }[code] || 'The audit could not be completed.';
    out.innerHTML = '<div class="paper paper-padded adsense-error"><span class="material-icons">error_outline</span><h3>'
      + (code === 'cancelled' ? 'Audit cancelled' : (code === 'challenge' ? 'Unable to Verify' : 'Could not complete the audit'))
      + '</h3><p>' + esc(friendly) + '</p>'
      + (code !== 'cancelled' ? '<p class="muted">Technical detail: ' + esc(msg) + '</p>' : '')
      + '<button class="btn" id="ezoic-retry">Try again</button></div>';
    var b = document.getElementById('ezoic-retry');
    if (b) b.onclick = function () { form.requestSubmit(); };
  }

  function verdictBlock(r) {
    var s = r.score;
    var icon = s.verdict === 'Likely Ready' ? 'verified' : s.verdict === 'Unable to Verify' ? 'help' : s.total >= 40 ? 'trending_up' : 'gpp_bad';
    return '<div class="score-card adsense-scorecard ezoic-scorecard"><div class="score-ring" style="--score:' + s.total + ';background:conic-gradient(' + ringColor(s.total) + ' calc(var(--score)*1%),var(--chip-bg) 0)"><b style="color:' + ringColor(s.total) + '">' + s.total + '</b></div><div class="score-summary">'
      + '<div class="verdict ' + esc(r.verdict.class) + '"><span class="material-icons">' + icon + '</span>' + esc(r.verdict.label) + '</div>'
      + '<h2>Ezoic Readiness Score</h2>'
      + '<p>' + esc(r.verdict.summary) + '</p>'
      + '<div class="source-chip">Not an official Ezoic score · confidence ' + s.confidence + '% · Ezoic makes the final eligibility decision.</div>'
      + '<div class="ad-summary-grid">'
      + '<div class="ad-stat"><span>Pages crawled</span><b>' + r.stats.pagesCrawled + '</b></div>'
      + '<div class="ad-stat"><span>Issues</span><b>' + r.stats.issues + '</b></div>'
      + '<div class="ad-stat"><span>Critical</span><b>' + r.stats.critical + '</b></div>'
      + '<div class="ad-stat"><span>High</span><b>' + r.stats.high + '</b></div>'
      + '<div class="ad-stat"><span>Medium</span><b>' + r.stats.medium + '</b></div>'
      + '<div class="ad-stat"><span>Low</span><b>' + r.stats.low + '</b></div>'
      + '<div class="ad-stat"><span>Passed</span><b>' + r.stats.passed + '</b></div>'
      + '<div class="ad-stat"><span>Manual items</span><b>' + r.stats.manual + '</b></div>'
      + '</div></div></div>';
  }

  function categoryBreakdown(r) {
    return '<div class="cat-breakdown"><h3>Score breakdown, expand a category to see the calculation</h3>'
      + r.score.categories.map(function (c, idx) {
        var neg = (c.lines || []).filter(function (l) { return l.delta < 0; }).length;
        var rows = (c.lines || []).map(function (l) {
          var d = l.delta || 0;
          var cls = l.status === 'info' || l.status === 'manual' ? 'neutral' : (d < 0 ? 'neg' : 'pos');
          return '<div class="calc-line ' + cls + '"><span>' + sevPill(l.status) + ' ' + esc(l.name)
            + (l.page && l.page !== 'Site' ? ' · ' + esc(String(l.page).slice(0, 48)) : '')
            + (l.sourceType ? ' ' + sourceChip(l.sourceType) : '')
            + '</span><b>' + (d < 0 ? ('−' + Math.abs(Math.round(d * 10) / 10)) : (l.status === 'passed' ? '+0' : ','))
            + ' / ' + l.weight + '</b></div>';
        }).join('');
        var manuals = (c.manuals || []).map(function (m) {
          return '<div class="calc-line neutral"><span>' + sevPill('manual') + ' ' + esc(m.name) + ': Unable to verify automatically</span><b>,</b></div>';
        }).join('');
        return '<details class="cat-row" ' + (idx < 2 ? 'open' : '') + '><summary><span class="cat-gauge" style="--s:' + c.pct + ';background:conic-gradient(' + ringColor(c.pct) + ' calc(var(--s)*1%),var(--chip-bg) 0)"><b>' + c.score + '</b></span>'
          + '<span class="cat-meta">' + esc(c.label) + ' <small>' + c.score + '/' + c.max + ' points · ' + c.pct + '% · ' + neg + ' issue' + (neg === 1 ? '' : 's') + '</small></span>'
          + '<span class="material-icons cat-arrow">expand_more</span></summary>'
          + '<div class="cat-body"><div class="calc-line total"><span>Category weight</span><b>' + c.max + '</b></div>'
          + rows + manuals
          + '<div class="calc-line total"><span>Final ' + esc(c.label) + ' score</span><b>' + c.score + '/' + c.max + '</b></div>'
          + (c.capNote ? '<div class="calc-note"><span class="material-icons">info</span>' + esc(c.capNote) + '</div>' : '')
          + '</div></details>';
      }).join('') + '</div>';
  }

  function renderIssues(findings, f, q) {
    q = (q || '').toLowerCase();
    var list = findings.filter(function (x) {
      if (f !== 'all') {
        if (['critical', 'high', 'medium', 'low', 'info', 'passed', 'manual'].indexOf(f) >= 0) {
          if (f === 'manual') { if (x.status !== 'manual' && x.status !== 'info') return false; }
          else if (x.status !== f) return false;
        } else if (f === 'ezoic') {
          if (x.category !== 'ezoic' && x.category !== 'monetization') return false;
        } else if (x.category !== f) return false;
      }
      if (q) {
        var hay = (x.name + ' ' + x.evidence + ' ' + (x.fix || '') + ' ' + x.page + ' ' + (x.urls || []).join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    if (!list.length) return '<p class="muted">No issues match this filter.</p>';
    var order = { critical: 0, high: 1, medium: 2, low: 3, info: 4, manual: 5, passed: 6 };
    list.sort(function (a, b) { return (order[a.status] - order[b.status]) || (b.confidence - a.confidence); });
    return list.slice(0, 400).map(function (x) {
      return '<div class="issue sev-' + x.status + '"><span class="material-icons issue-icon">' + sevIcon(x.status) + '</span><div>'
        + '<h6>' + esc(x.name) + '</h6>'
        + '<div class="issue-meta"><b>' + esc(x.page) + '</b> · ' + sevPill(x.status)
        + ' · <span class="conf">confidence ' + x.confidence + '%</span> '
        + sourceChip(x.sourceType)
        + (x.tier ? ' · <b>' + esc(x.tier) + '</b>' : '')
        + '</div>'
        + '<p>' + esc(x.evidence) + '</p>'
        + (x.sharedText ? '<div class="evidence">' + esc(x.sharedText) + '</div>' : '')
        + (x.why ? '<small class="why"><span>Why it matters</span> ' + esc(x.why) + '</small>' : '')
        + (x.fix ? '<small class="fix"><span>Recommended action</span> ' + esc(x.fix) + '</small>' : '')
        + (x.sourceUrl ? '<small class="why"><span>Source</span> <a href="' + esc(x.sourceUrl) + '" target="_blank" rel="noopener">' + esc(x.sourceUrl) + '</a> · verified ' + esc(x.lastVerified || '') + '</small>' : '')
        + '</div></div>';
    }).join('');
  }

  function issueExplorer(r) {
    var filters = [
      ['all', 'All'], ['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'],
      ['passed', 'Passed'], ['manual', 'Manual'],
      ['ezoic', 'Ezoic Requirements'], ['content', 'Content'], ['tech', 'Technical'],
      ['ux', 'UX'], ['trust', 'Trust'], ['policy', 'Policy'], ['monetization', 'Monetization']
    ];
    var tabs = '<div class="tabs" id="ez-issue-tabs">' + filters.map(function (f, i) {
      return '<button type="button" data-f="' + f[0] + '" class="' + (i === 0 ? 'active' : '') + '">' + f[1] + '</button>';
    }).join('') + '</div>';
    return '<div class="audit-panel wide"><h3>Issue explorer</h3>' + tabs
      + '<input type="search" id="ez-issue-search" class="text-input" placeholder="Search issues or URLs…" aria-label="Search issues">'
      + '<div id="ez-issue-list">' + renderIssues(r.findings, 'all', '') + '</div></div>';
  }

  function pageTable(r) {
    var rows = (r.pages || []).map(function (p) {
      var st = p.error ? 'err' : p.status >= 400 ? 'err' : p.status >= 300 ? 'redir' : 'ok';
      return '<tr data-url="' + esc(p.url) + '"><td class="pt-url" title="' + esc(p.url) + '">' + esc(p.path) + '</td>'
        + '<td><span class="badge low">' + esc(p.type) + '</span></td>'
        + '<td><span class="status-pill s-' + st + '">' + (p.error ? 'ERR' : (p.status || '?')) + '</span></td>'
        + '<td>' + (p.wordCount || ',') + '</td>'
        + '<td>' + p.technical + '</td>'
        + '<td>' + p.ux + '</td>'
        + '<td>' + p.risk + '</td>'
        + '<td>' + p.issues + '</td></tr>';
    }).join('');
    return '<div class="audit-panel wide"><h3>Page-level analysis</h3>'
      + '<input type="search" id="ez-page-search" class="text-input" placeholder="Filter pages by URL…" aria-label="Filter pages">'
      + '<div class="page-table-wrap"><table class="page-table" id="ez-page-table"><thead><tr>'
      + '<th data-k="path">URL</th><th data-k="type">Type</th><th data-k="status">Status</th><th data-k="words">Content</th>'
      + '<th data-k="tech">Technical</th><th data-k="ux">UX</th><th data-k="risk">Risk</th><th data-k="issues">Issues</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  function manuals(r) {
    if (!r.manuals || !r.manuals.length) return '';
    return '<div class="audit-panel wide"><h3>Manual verification required</h3><p class="muted">These official Ezoic items cannot be verified from a public crawl. They are excluded from the automated score rather than guessed.</p>'
      + r.manuals.map(function (m) {
        return '<div class="issue sev-info"><span class="material-icons issue-icon">hourglass_empty</span><div><h6>' + esc(m.name) + '</h6>'
          + '<div class="issue-meta">' + sourceChip('official') + ' · <b>Unable to verify automatically</b></div>'
          + '<p>' + esc(m.evidence) + '</p>'
          + (m.fix ? '<small class="fix"><span>What you should do</span> ' + esc(m.fix) + '</small>' : '')
          + (m.sourceUrl ? '<small class="why"><span>Source</span> <a href="' + esc(m.sourceUrl) + '" target="_blank" rel="noopener">' + esc(m.sourceUrl) + '</a></small>' : '')
          + '</div></div>';
      }).join('') + '</div>';
  }

  function important(r) {
    if (!r.importantPages || !r.importantPages.length) return '';
    return '<div class="audit-panel"><h3>Important pages detected</h3><div class="ad-trust-list">'
      + r.importantPages.map(function (x) {
        return '<div class="ad-trust-card"><span class="material-icons">verified</span><div><b>' + esc(x.label) + '</b><small>'
          + esc(x.path) + ' · ' + x.confidence + '% confidence' + (x.linkedFromNav ? ' · linked in nav/footer' : '') + ' · ' + x.words + ' words</small></div></div>';
      }).join('') + '</div></div>';
  }

  function dups(r) {
    if (!r.duplicates || !r.duplicates.length) return '';
    return '<div class="audit-panel"><h3>Duplicate groups</h3>'
      + r.duplicates.map(function (d) {
        return '<div class="priority ' + (d.similarity >= 90 ? 'fail' : 'warn') + '"><b>' + esc(d.a) + ' ↔ ' + esc(d.b) + ' · ' + d.similarity + '% similar</b>'
          + '<span>' + (d.shared && d.shared[0] ? 'Shared text: “' + esc(d.shared[0]) + '”' : (d.exact ? 'Exact normalized-text match.' : 'Near-duplicate by Jaccard / TF-IDF / SimHash.')) + '</span></div>';
      }).join('') + '</div>';
  }

  function priorityFixes(r) {
    var fix = r.findings.filter(function (f) { return f.status === 'critical' || f.status === 'high' || f.status === 'medium'; })
      .sort(function (a, b) { var o = { critical: 0, high: 1, medium: 2 }; return (o[a.status] - o[b.status]) || (b.confidence - a.confidence); })
      .slice(0, 12);
    if (!fix.length) return '<div class="priority passed"><b>No critical or high-priority automated issues detected</b><span>Public signals look relatively strong. Still complete the manual items (traffic, MCM, consent) with Ezoic.</span></div>';
    return fix.map(function (f) {
      var label = { critical: 'Critical, fix before applying', high: 'High, strongly recommended', medium: 'Medium, improvement recommended' }[f.status];
      return '<div class="priority ' + f.status + '"><b>' + esc(f.name) + ' · ' + esc(f.page) + '</b><span>' + esc(label) + ': ' + esc(f.fix || f.evidence) + '</span></div>';
    }).join('');
  }

  function toast(msg) {
    var t = el('div', 'toast', msg);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }
  function exportCSV(r) {
    var rows = [['Category', 'Check', 'Status', 'Page', 'Evidence', 'Confidence', 'Source', 'Why', 'Fix']];
    r.findings.forEach(function (f) {
      rows.push([f.category, f.name, f.status, f.page, f.evidence, f.confidence + '%', f.sourceType, f.why || '', f.fix || '']);
    });
    var csv = rows.map(function (row) { return row.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'ezoic-eligibility.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function copySummary(r) {
    var s = 'Ezoic Readiness Score: ' + r.score.total + '/100, ' + r.verdict.label + '\n' + r.url + '\nNot an official Ezoic score.\n';
    r.score.categories.forEach(function (c) { s += '- ' + c.label + ': ' + c.score + '/' + c.max + '\n'; });
    if (navigator.clipboard) navigator.clipboard.writeText(s);
    toast('Summary copied');
  }

  function render(r) {
    lastReport = r;
    var actions = '<div class="report-actions"><button class="btn" type="button" id="ez-rerun"><span class="material-icons">refresh</span>Re-run</button>'
      + '<button class="btn" type="button" id="ez-csv"><span class="material-icons">download</span>CSV</button>'
      + '<button class="btn" type="button" id="ez-print"><span class="material-icons">picture_as_pdf</span>PDF / Print</button>'
      + '<button class="btn" type="button" id="ez-copy"><span class="material-icons">content_copy</span>Copy summary</button></div>';
    var inv = r.inventory || {};
    var insights = [
      ['Website type', r.siteType || ','],
      ['Language', (r.language && r.language.name) || ','],
      ['Useful content pages', (inv.useful || 0) + ' / ' + (inv.contentPages || 0)],
      ['Thin pages', String(inv.thinPct || 0) + '%'],
      ['Near-duplicates', String(inv.dupPct || 0) + '%'],
      ['Avg / max depth', (r.architecture && r.architecture.avgDepth || 0) + ' / ' + (r.architecture && r.architecture.maxDepth || 0)],
      ['Sitemap URLs', r.crawl.sitemapCount],
      ['ads.txt', r.crawl.adsTxt && r.crawl.adsTxt.present ? 'present' : 'not found']
    ];
    out.innerHTML = actions + verdictBlock(r) + important(r) + categoryBreakdown(r)
      + '<div class="audit-grid refined"><div class="audit-panel top-panel"><h3>Priority fixes</h3><div class="priority-list">' + priorityFixes(r) + '</div></div>'
      + '<div class="audit-panel"><h3>Summary</h3><div class="insight-row">'
      + insights.map(function (x) { return '<div class="insight-card"><span>' + esc(x[0]) + '</span><b>' + esc(String(x[1])) + '</b></div>'; }).join('')
      + '</div></div></div>'
      + dups(r) + manuals(r) + issueExplorer(r) + pageTable(r)
      + '<p class="adsense-footnote">' + esc(r.disclaimer) + ' Review <a href="https://support.ezoic.com/kb/article/getting-started-ezoics-requirements" target="_blank" rel="noopener">Ezoic’s current requirements</a> before applying.</p>';

    document.getElementById('ez-rerun').onclick = function () { form.requestSubmit(); };
    document.getElementById('ez-csv').onclick = function () { exportCSV(r); };
    document.getElementById('ez-print').onclick = function () { window.print(); };
    document.getElementById('ez-copy').onclick = function () { copySummary(r); };
    var tabs = document.getElementById('ez-issue-tabs');
    var search = document.getElementById('ez-issue-search');
    var list = document.getElementById('ez-issue-list');
    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      Array.prototype.forEach.call(tabs.querySelectorAll('button'), function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      list.innerHTML = renderIssues(r.findings, b.dataset.f, search.value);
    });
    search.addEventListener('input', function () {
      var active = tabs.querySelector('button.active');
      list.innerHTML = renderIssues(r.findings, active.dataset.f, search.value);
    });
    var table = document.getElementById('ez-page-table');
    var tbody = table.querySelector('tbody');
    var sortKey = 'path', sortDir = 1;
    table.querySelectorAll('th').forEach(function (th) {
      th.onclick = function () {
        var k = th.dataset.k;
        if (k === sortKey) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
        var idx = { path: 0, type: 1, status: 2, words: 3, tech: 4, ux: 5, risk: 6, issues: 7 }[k] || 0;
        var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
        rows.sort(function (a, b) {
          var av = a.querySelectorAll('td')[idx].textContent.trim();
          var bv = b.querySelectorAll('td')[idx].textContent.trim();
          var an = parseInt(av, 10), bn = parseInt(bv, 10);
          if (!isNaN(an) && !isNaN(bn) && String(an) === av && String(bn) === bv) return sortDir * (an - bn);
          return sortDir * String(av).localeCompare(String(bv));
        });
        rows.forEach(function (row) { tbody.appendChild(row); });
      };
    });
    var ps = document.getElementById('ez-page-search');
    ps.addEventListener('input', function () {
      var q = ps.value.toLowerCase();
      Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function (tr) {
        tr.style.display = (tr.getAttribute('data-url') || '').toLowerCase().indexOf(q) >= 0 ? '' : 'none';
      });
    });
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function slimScan(scan) {
    return {
      start: scan.start,
      origin: scan.origin,
      limit: scan.limit,
      robots: scan.robots,
      sitemapUrls: (scan.sitemapUrls || []).slice(0, 400),
      adsTxt: scan.adsTxt,
      challenge: !!scan.challenge,
      reachedLimit: !!scan.reachedLimit,
      errors: scan.errors || [],
      pages: (scan.pages || []).map(function (p) {
        var html = p.html || '';
        if (html.length > 90000) html = html.slice(0, 90000);
        return {
          url: p.url,
          finalUrl: p.finalUrl || p.url,
          status: p.status || 0,
          depth: p.depth || 0,
          redirected: !!p.redirected,
          via: p.via || 'browser',
          ms: p.ms,
          bytes: p.bytes || html.length,
          headers: p.headers || {},
          html: html,
          error: p.error,
          errorCode: p.errorCode,
          skipped: p.skipped,
          challenge: !!p.challenge
        };
      })
    };
  }

  function run() {
    var url = urlInput.value.trim();
    if (!url) return;
    abortCtrl = new AbortController();
    progressUI({ stage: 'init', message: 'Starting…' });
    var crawler;
    try {
      crawler = new Ezoic.Crawler(url, {
        limit: parseInt(limitSel.value, 10) || 50,
        concurrency: 4,
        signal: abortCtrl.signal,
        onProgress: progressUI
      });
    } catch (e) {
      errorUI(e);
      abortCtrl = null;
      return;
    }
    crawler.run().then(function (scan) {
      var readable = (scan.pages || []).filter(function (p) { return p.html && !p.error && !p.skipped; });
      if (!readable.length) {
        var first = (scan.errors && scan.errors[0]) || {};
        throw { code: first.code || (scan.challenge ? 'challenge' : 'empty'), message: first.message || 'No readable HTML pages were found.' };
      }
      progressUI({ stage: 'parse', message: 'Scoring crawled pages…' });
      return fetch('/api/ezoic-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slimScan(scan)),
        signal: abortCtrl.signal
      }).then(function (res) {
        return res.json().then(function (j) {
          if (!res.ok || (j && j.code && !j.score)) throw j;
          return j;
        });
      });
    }).then(render).catch(function (err) {
      if (err && (err.name === 'AbortError' || (abortCtrl && abortCtrl.signal.aborted))) {
        errorUI({ code: 'cancelled', message: 'Cancelled' });
        return;
      }
      errorUI(err && err.code ? err : { code: 'fetch_failed', message: (err && err.message) || 'Network error' });
    }).then(function () { abortCtrl = null; });
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); run(); });
  var qs = new URLSearchParams(location.search).get('url');
  if (qs) { urlInput.value = qs; form.requestSubmit(); }
})();
