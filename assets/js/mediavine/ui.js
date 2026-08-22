/* huvanti Mediavine Eligibility Checker, report UI (independent of AdSense & Ezoic). */
(function () {
  'use strict';
  var form = document.getElementById('mediavine-form');
  if (!form) return;
  var urlInput = document.getElementById('mediavine-url');
  var limitSel = document.getElementById('mediavine-limit');
  var programSel = document.getElementById('mediavine-program');
  var out = document.getElementById('mediavine-results');
  var lastReport = null;
  var abortCtrl = null;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function sevIcon(s) { return s === 'passed' ? 'check_circle' : s === 'critical' ? 'error' : s === 'high' ? 'cancel' : s === 'medium' ? 'warning' : s === 'manual' ? 'hourglass_empty' : 'info'; }
  function sevPill(s) { return '<span class="badge ' + esc(s) + '">' + esc(s) + '</span>'; }
  function sourceChip(t) {
    var label = t === 'official' ? 'Official requirement' : t === 'quality_signal' ? 'Quality signal' : t === 'heuristic' ? 'Heuristic' : (t || '');
    if (!label) return '';
    return '<span class="ez-source ez-' + esc(t) + '">' + label + '</span>';
  }
  function ringColor(n) { return n >= 70 ? '#2e7d32' : n >= 40 ? '#ed6c02' : '#d32f2f'; }
  function statusClassChip(st) { var c = st === 'passed' ? 'passed' : st === 'problem' ? 'high' : 'manual'; return sevPill(c); }

  var STEPS = [
    ['connect', 'Website connected'],
    ['robots', 'Robots.txt analyzed'],
    ['sitemap', 'Sitemap analyzed'],
    ['crawler', 'Pages crawled'],
    ['important', 'Important pages detected'],
    ['content', 'Content extraction completed'],
    ['duplicates', 'Duplicate analysis completed'],
    ['technical', 'Technical audit completed'],
    ['ux', 'UX & architecture analyzed'],
    ['brand', 'Brand-safety screening completed'],
    ['traffic', 'Traffic signals assessed'],
    ['requirements', 'Official requirements evaluated'],
    ['score', 'Calculating readiness']
  ];
  var ORDER = ['init', 'connect', 'robots', 'sitemap', 'crawler', 'parse', 'important', 'content', 'duplicates', 'technical', 'ux', 'trust', 'advertising', 'brand', 'traffic', 'requirements', 'score', 'done'];
  function stepState(key, current) {
    var map = { parse: 'important', trust: 'ux', advertising: 'brand', requirements: 'score' };
    var cur = map[current] || current;
    var keys = ['connect', 'robots', 'sitemap', 'crawler', 'important', 'content', 'duplicates', 'technical', 'ux', 'brand', 'traffic', 'score'];
    var a = keys.indexOf(key), b = keys.indexOf(cur);
    if (current === 'done') return 'done';
    if (current === 'init') return key === 'connect' ? 'active' : 'wait';
    if (a < 0) return 'wait';
    if (b < 0) return a === 0 ? 'active' : 'wait';
    return a < b ? 'done' : a === b ? 'active' : 'wait';
  }
    function progressUI(state) {
    var ICONS = {'connect': 'power', 'robots': 'rule', 'sitemap': 'account_tree', 'crawler': 'travel_explore', 'important': 'star', 'content': 'article', 'duplicates': 'merge_type', 'technical': 'build', 'ux': 'touch_app', 'brand': 'verified_user', 'traffic': 'trending_up', 'score': 'grading'};
    var steps = STEPS.map(function (s) { return { key: s[0], label: s[1], icon: ICONS[s[0]] || 'radio_button_unchecked' }; });
    var states = {};
    STEPS.forEach(function (s) { states[s[0]] = stepState(s[0], state.stage); });
    var p = window.ScanProgress.reuse(out, {
      title: 'Checking Mediavine readiness', target: (urlInput && urlInput.value) || '', icon: 'savings', steps: steps,
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
      + '<button class="btn" id="mediavine-retry">Try again</button></div>';
    var b = document.getElementById('mediavine-retry');
    if (b) b.onclick = function () { form.requestSubmit(); };
  }

  function verdictBlock(r) {
    var s = r.score;
    var icon = s.verdict === 'Strong Readiness' ? 'verified' : s.verdict === 'Unable to Determine' ? 'help' : s.total >= 40 ? 'trending_up' : 'gpp_bad';
    return '<div class="score-card adsense-scorecard mediavine-scorecard"><div class="score-ring" style="--score:' + s.total + ';background:conic-gradient(' + ringColor(s.total) + ' calc(var(--score)*1%),var(--chip-bg) 0)"><b style="color:' + ringColor(s.total) + '">' + s.total + '</b></div><div class="score-summary">'
      + '<div class="verdict ' + esc(r.verdict.class) + '"><span class="material-icons">' + icon + '</span>' + esc(r.verdict.label) + '</div>'
      + '<h2>Mediavine Website Readiness Score</h2>'
      + '<p>' + esc(r.verdict.summary) + '</p>'
      + '<div class="source-chip">Not an official Mediavine score · internal estimate · confidence ' + s.confidence + '% · Mediavine makes the final decision.</div>'
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

  function programEligibility(r) {
    var o = r.programEligibility.official, j = r.programEligibility.journey;
    function progCard(p) {
      return '<div class="audit-panel prog-card"><h3>' + esc(p.name) + '</h3>'
        + '<div class="prog-line"><span>Website quality readiness</span><b>' + esc(p.websiteQualityReady) + '/100</b></div>'
        + '<div class="prog-line"><span>' + (p.revenueRequirement != null ? 'Official revenue requirement' : 'Journey session requirement') + '</span><b>' + esc(p.revenueRequirement != null ? p.revenueRequirement : p.sessionRequirement) + '</b></div>'
        + '<div class="prog-line"><span>Final application eligibility</span><b class="cannot-confirm">' + esc(p.applicationEligibility) + '</b></div>'
        + (p.revenueThresholdUsd ? '<div class="prog-line small"><span>Threshold</span><b>$' + p.revenueThresholdUsd + '+ annual ad revenue</b></div>' : '')
        + (p.sessionThreshold ? '<div class="prog-line small"><span>Threshold</span><b>' + p.sessionThreshold + '+ sessions / month</b></div>' : '')
        + (p.revenueShare ? '<div class="prog-line small"><span>Revenue share</span><b>' + esc(p.revenueShare) + '</b></div>' : '')
        + '<p class="muted">' + esc(p.reason) + '</p></div>';
    }
    return '<div class="audit-panel wide"><h3>Program Eligibility: Official vs Journey (applied separately)</h3>'
      + '<div class="prog-grid">' + progCard(o) + progCard(j) + '</div>'
      + '<p class="muted">A public URL audit cannot verify the private revenue or session data that Mediavine requires. The Website Quality Readiness above reflects only publicly observable signals.</p></div>';
  }

  function appRequirements(r) {
    return '<div class="audit-panel wide"><h3>Application Requirements Status</h3>'
      + '<table class="page-table"><thead><tr><th>Requirement</th><th>Program</th><th>Status</th><th>Evidence</th><th>Verify with</th></tr></thead><tbody>'
      + (r.applicationRequirements || []).map(function (a) {
        return '<tr><td><b>' + esc(a.item) + '</b></td><td>' + esc(a.affects) + '</td><td>' + statusClassChip(a.statusClass) + ' <span class="muted">' + esc(a.status) + '</span></td>'
          + '<td class="muted">' + esc(a.evidence) + '</td><td class="muted">' + esc(a.verifyWith) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function categoryBreakdown(r) {
    return '<div class="cat-breakdown"><h3>Readiness score breakdown, expand a category to see the calculation</h3>'
      + r.score.categories.map(function (c, idx) {
        var neg = (c.lines || []).filter(function (l) { return l.delta < 0; }).length;
        var rows = (c.lines || []).map(function (l) {
          var d = l.delta || 0;
          var cls = l.status === 'info' || l.status === 'manual' ? 'neutral' : (d < 0 ? 'neg' : 'pos');
          return '<div class="calc-line ' + cls + '"><span>' + sevPill(l.status) + ' ' + esc(l.name)
            + (l.page && l.page !== 'Site' ? ' · ' + esc(String(l.page).slice(0, 48)) : '')
            + (l.sourceType ? ' ' + sourceChip(l.sourceType) : '')
            + '</span><b>' + (d < 0 ? ('−' + Math.abs(Math.round(d * 10) / 10)) : (l.status === 'passed' ? '+0' : ',')) + ' / ' + l.weight + '</b></div>';
        }).join('');
        var manuals = (c.manuals || []).map(function (m) { return '<div class="calc-line neutral"><span>' + sevPill('manual') + ' ' + esc(m.name) + ': Unable to verify automatically</span><b>,</b></div>'; }).join('');
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
        if (['critical', 'high', 'medium', 'low', 'info', 'passed', 'manual'].indexOf(f) >= 0) { if (f === 'manual') { if (x.status !== 'manual' && x.status !== 'info') return false; } else if (x.status !== f) return false; }
        else if (x.category !== f) return false;
      }
      if (q) { var hay = (x.name + ' ' + x.evidence + ' ' + (x.fix || '') + ' ' + x.page + ' ' + (x.urls || []).join(' ')).toLowerCase(); if (hay.indexOf(q) < 0) return false; }
      return true;
    });
    if (!list.length) return '<p class="muted">No issues match this filter.</p>';
    var order = { critical: 0, high: 1, medium: 2, low: 3, info: 4, manual: 5, passed: 6 };
    list.sort(function (a, b) { return (order[a.status] - order[b.status]) || (b.confidence - a.confidence); });
    return list.slice(0, 400).map(function (x) {
      return '<div class="issue sev-' + x.status + '"><span class="material-icons issue-icon">' + sevIcon(x.status) + '</span><div>'
        + '<h6>' + esc(x.name) + '</h6>'
        + '<div class="issue-meta"><b>' + esc(x.page) + '</b> · ' + sevPill(x.status)
        + ' · <span class="conf">confidence ' + x.confidence + '%</span> ' + sourceChip(x.sourceType)
        + (x.tier ? ' · <b>' + esc(x.tier) + '</b>' : '')
        + (x.confidenceLevel ? ' · ' + esc(x.confidenceLevel) : '')
        + (x.brandCat ? ' · <b>' + esc(x.brandCat) + '</b>' : '')
        + '</div><p>' + esc(x.evidence) + '</p>'
        + (x.sharedText ? '<div class="evidence">' + esc(x.sharedText) + '</div>' : '')
        + (x.why ? '<small class="why"><span>Why it matters</span> ' + esc(x.why) + '</small>' : '')
        + (x.fix ? '<small class="fix"><span>Recommended action</span> ' + esc(x.fix) + '</small>' : '')
        + (x.sourceUrl ? '<small class="why"><span>Source</span> <a href="' + esc(x.sourceUrl) + '" target="_blank" rel="noopener">' + esc(x.sourceTitle || x.sourceUrl) + '</a> · verified ' + esc(x.lastVerified || '') + '</small>' : '')
        + '</div></div>';
    }).join('');
  }

  function issueExplorer(r) {
    var filters = [
      ['all', 'All'], ['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'],
      ['passed', 'Passed'], ['manual', 'Manual'],
      ['content', 'Content'], ['brand', 'Brand Safety'], ['ux', 'Reader Experience'], ['tech', 'Technical'],
      ['trust', 'Trust'], ['advertising', 'Advertising'], ['architecture', 'Architecture'], ['traffic', 'Traffic']
    ];
    var tabs = '<div class="tabs" id="mv-issue-tabs">' + filters.map(function (f, i) { return '<button type="button" data-f="' + f[0] + '" class="' + (i === 0 ? 'active' : '') + '">' + f[1] + '</button>'; }).join('') + '</div>';
    return '<div class="audit-panel wide"><h3>Issue explorer</h3>' + tabs
      + '<input type="search" id="mv-issue-search" class="text-input" placeholder="Search issues or URLs…" aria-label="Search issues">'
      + '<div id="mv-issue-list">' + renderIssues(r.findings, 'all', '') + '</div></div>';
  }

  function pageTable(r) {
    var rows = (r.pages || []).map(function (p) {
      var st = p.error ? 'err' : p.status >= 400 ? 'err' : p.status >= 300 ? 'redir' : 'ok';
      return '<tr data-url="' + esc(p.url) + '"><td class="pt-url" title="' + esc(p.url) + '">' + esc(p.path) + '</td>'
        + '<td><span class="badge low">' + esc(p.type) + '</span></td>'
        + '<td><span class="status-pill s-' + st + '">' + (p.error ? 'ERR' : (p.status || '?')) + '</span></td>'
        + '<td>' + (p.wordCount || ',') + '</td>'
        + '<td>' + p.content + '</td>'
        + '<td>' + p.brandSafety + '</td>'
        + '<td>' + p.ux + '</td>'
        + '<td>' + p.technical + '</td>'
        + '<td>' + p.issues + '</td>'
        + '<td><button type="button" class="row-detail" data-url="' + esc(p.url) + '" aria-label="View details">view</button></td></tr>';
    }).join('');
    return '<div class="audit-panel wide"><h3>Page-level analysis</h3>'
      + '<input type="search" id="mv-page-search" class="text-input" placeholder="Filter pages by URL…" aria-label="Filter pages">'
      + '<div class="tabs" id="mv-page-type-filter"><button type="button" data-t="all" class="active">All</button><button type="button" data-t="content">Content</button><button type="button" data-t="brand">Brand issues</button><button type="button" data-t="ux">UX issues</button><button type="button" data-t="tech">Technical issues</button><button type="button" data-t="err">Errors</button></div>'
      + '<div class="page-table-wrap"><table class="page-table" id="mv-page-table"><thead><tr>'
      + '<th data-k="path">URL</th><th data-k="type">Type</th><th data-k="status">Status</th><th data-k="words">Content</th>'
      + '<th data-k="content">Content issues</th><th data-k="brandSafety">Brand safety</th><th data-k="ux">UX</th><th data-k="technical">Technical</th><th data-k="issues">Issues</th><th></th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '<div id="mv-page-detail" class="page-detail"></div></div>';
  }

  function manuals(r) {
    if (!r.manualVerification || !r.manualVerification.length) return '';
    return '<div class="audit-panel wide"><h3>Requires Your Verification</h3><p class="muted">These items cannot be verified from a public URL audit. They are excluded from the automated score rather than guessed, never invented.</p>'
      + '<table class="page-table"><thead><tr><th>Metric</th><th>Affects</th><th>Why it cannot be verified</th><th>What evidence to provide</th></tr></thead><tbody>'
      + r.manualVerification.map(function (m) {
        return '<tr><td><b>' + esc(m.metric) + '</b><br><span class="badge manual">' + esc(m.status) + '</span></td><td>' + esc(m.affects) + '</td><td class="muted">' + esc(m.whyCannotVerify) + '</td><td class="muted">' + esc(m.evidenceToProvide) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function trafficBlock(r) {
    var t = r.traffic || {};
    return '<div class="audit-panel wide"><h3>Traffic Verification</h3>'
      + '<p class="muted">Mediavine evaluates traffic sources, countries, demographics and authenticity. Most of this is private analytics data that a URL-only audit cannot read. It is split below into what is observable and what is not.</p>'
      + '<h5 class="traffic-subhead">Automatically Observable</h5><div class="priority-list">'
      + (t.observable && t.observable.length ? t.observable.map(function (f) { return '<div class="priority ' + f.status + '"><b>' + esc(f.name) + '</b><span>' + esc(f.evidence) + '</span></div>'; }).join('') : '<div class="priority passed"><b>No adverse public traffic signals detected</b><span>Obvious bot-like, incentivized or traffic-generation patterns were not found.</span></div>')
      + '</div><h5 class="traffic-subhead">Cannot Be Verified (manual)</h5><div class="priority-list">'
      + (t.cannotVerify && t.cannotVerify.length ? t.cannotVerify.map(function (f) { return '<div class="priority manual"><b>' + esc(f.name) + ': Unable to verify automatically</b><span>' + esc(f.evidence) + '</span></div>'; }).join('') : '<div class="priority manual"><b>Unable to verify automatically</b></div>')
      + '</div>'
      + '<div class="google-standing"><b>Google AdSense / Ad Exchange Standing</b>, <span class="badge manual">' + esc(t.googleStanding || 'Manual Verification Required') + '</span><p class="muted">Google account status is private. Mediavine states a site need not have worked with AdSense, but an AdSense ban is a problem. This cannot be inferred from the website.</p></div></div>';
  }

  function brandSafetyBlock(r) {
    var bs = r.brandSafety || { findings: [], stats: {} };
    var st = bs.stats || {};
    return '<div class="audit-panel wide"><h3>Brand Safety</h3>'
      + '<p class="muted">Mediavine adheres to strict brand-safety standards. This is a deterministic, contextual public-content screen with confidence levels. Isolated keywords never create a high finding, and these are not official Mediavine violations.</p>'
      + '<div class="ad-summary-grid"><div class="ad-stat"><span>Signals</span><b>' + (st.total || 0) + '</b></div><div class="ad-stat"><span>High</span><b>' + (st.high || 0) + '</b></div><div class="ad-stat"><span>Medium</span><b>' + (st.medium || 0) + '</b></div><div class="ad-stat"><span>Pages</span><b>' + (st.pages || 0) + '</b></div></div>'
      + '<div class="priority-list">'
      + (bs.findings && bs.findings.length ? bs.findings.map(function (f) {
        return '<div class="priority ' + f.status + '"><b>' + esc(f.label) + ' · ' + esc(f.page) + '</b><span>' + esc(f.confidenceLevel) + ' · ' + f.confidence + '% confidence. ' + esc(f.evidence) + '</span></div>';
      }).join('') : '<div class="priority passed"><b>No high-confidence brand-safety signals detected</b><span>Isolated keywords are ignored.</span></div>')
      + '</div></div>';
  }

  function important(r) {
    if (!r.importantPages || !r.importantPages.length) return '';
    return '<div class="audit-panel"><h3>Important pages detected</h3><div class="ad-trust-list">'
      + r.importantPages.map(function (x) { return '<div class="ad-trust-card"><span class="material-icons">verified</span><div><b>' + esc(x.label) + '</b><small>' + esc(x.path) + ' · ' + x.confidence + '% confidence' + (x.linkedFromNav ? ' · linked in nav/footer' : '') + ' · ' + x.words + ' words</small></div></div>'; }).join('')
      + '</div></div>';
  }

  function dups(r) {
    if (!r.duplicates || !r.duplicates.length) return '';
    return '<div class="audit-panel"><h3>Near-duplicate clusters</h3><div class="priority-list">'
      + r.duplicates.map(function (d) {
        return '<div class="priority ' + (d.similarity >= 90 ? 'fail' : 'warn') + '"><b>' + esc(d.a) + ' ↔ ' + esc(d.b) + ' · ' + d.similarity + '% similar</b>'
          + '<span>' + (d.shared && d.shared[0] ? 'Shared text: "' + esc(d.shared[0]) + '"' : (d.exact ? 'Exact normalized-text match.' : 'Near-duplicate by Jaccard / TF-IDF cosine / SimHash.')) + '</span></div>';
      }).join('') + '</div></div>';
  }

  function portfolio(r) {
    var p = r.contentPortfolio || {};
    var inv = r.inventory || {};
    return '<div class="audit-panel"><h3>Content Portfolio</h3><div class="insight-row">'
      + [['Crawled pages', String(p.totalCrawled || r.stats.pagesCrawled || 0)], ['Content pages', String(p.contentPages || 0)],
         ['Useful pages', String(p.useful || 0)], ['Thin pages', String(p.thin || 0)],
         ['% unique content', (p.uniqueContentPct || 0) + '%'], ['% thin content', (p.thinContentPct || 0) + '%'],
         ['Near-duplicate %', (inv.dupPct || 0) + '%'], ['Avg depth', String(p.averageDepth || 0)]
        ].map(function (x) { return '<div class="insight-card"><span>' + esc(x[0]) + '</span><b>' + esc(String(x[1])) + '</b></div>'; }).join('')
      + '</div></div>';
  }

  function insightsRow(r) {
    var inv = r.inventory || {};
    var perf = r.performance || {};
    var adv = r.advertising || {};
    return '<div class="audit-grid refined"><div class="audit-panel top-panel"><h3>Priority fixes</h3><div class="priority-list">' + priorityFixes(r) + '</div></div>'
      + '<div class="audit-panel"><h3>Summary</h3><div class="insight-row">'
      + [['Site type', r.siteType || ','], ['Language', (r.language && r.language.name) || ','],
         ['Useful content', (inv.useful || 0) + ' / ' + (inv.contentPages || 0)], ['Thin %', String(inv.thinPct || 0) + '%'],
         ['Near-dupes %', String(inv.dupPct || 0) + '%'], ['Avg TTFB', (perf.avgTtfb != null ? perf.avgTtfb + 'ms' : ',')],
         ['Ad networks', (adv.networks && adv.networks.length ? adv.networks.join(', ') : 'none')], ['Sitemap URLs', r.crawl.sitemapCount]
        ].map(function (x) { return '<div class="insight-card"><span>' + esc(x[0]) + '</span><b>' + esc(String(x[1])) + '</b></div>'; }).join('')
      + '</div></div></div>';
  }

  function priorityFixes(r) {
    var fix = r.findings.filter(function (f) { return f.status === 'critical' || f.status === 'high' || f.status === 'medium'; })
      .sort(function (a, b) { var o = { critical: 0, high: 1, medium: 2 }; return (o[a.status] - o[b.status]) || (b.confidence - a.confidence); })
      .slice(0, 12);
    if (!fix.length) return '<div class="priority passed"><b>No critical or high-priority automated issues detected</b><span>Public signals look relatively strong. Complete the manual verification items (revenue, sessions, traffic) before applying.</span></div>';
    return fix.map(function (f) {
      var label = { critical: 'Critical, fix before applying', high: 'High, strongly recommended', medium: 'Medium, improvement recommended' }[f.status];
      return '<div class="priority ' + f.status + '"><b>' + esc(f.name) + ' · ' + esc(f.page) + '</b><span>' + esc(label) + ': ' + esc(f.fix || f.evidence) + '</span></div>';
    }).join('');
  }

  function criticalIssues(r) {
    var crit = r.findings.filter(function (f) { return f.status === 'critical'; });
    if (!crit.length) return '';
    return '<div class="audit-panel wide"><h3>Critical Issues</h3><div class="priority-list">' + crit.map(function (f) {
      return '<div class="priority critical"><b>' + esc(f.name) + ' · ' + esc(f.page) + '</b><span>Critical: ' + esc(f.evidence) + '</span></div>';
    }).join('') + '</div></div>';
  }

  function toast(msg) { var t = el('div', 'toast', msg); document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600); }
  function exportCSV(r) {
    var rows = [['Category', 'Check', 'Status', 'Page', 'Evidence', 'Confidence', 'Source', 'Why', 'Fix']];
    r.findings.forEach(function (f) { rows.push([f.category, f.name, f.status, f.page, f.evidence, f.confidence + '%', f.sourceType, f.why || '', f.fix || '']); });
    var csv = rows.map(function (row) { return row.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'mediavine-eligibility.csv'; a.click(); URL.revokeObjectURL(a.href);
  }
  function copySummary(r) {
    var s = 'Mediavine Website Readiness Score: ' + r.score.total + '/100, ' + r.verdict.label + '\n' + r.url + '\nNot an official Mediavine score.\n';
    r.score.categories.forEach(function (c) { s += '- ' + c.label + ': ' + c.score + '/' + c.max + '\n'; });
    if (navigator.clipboard) navigator.clipboard.writeText(s);
    toast('Summary copied');
  }

  function render(r) {
    lastReport = r;
    var actions = '<div class="report-actions"><button class="btn" type="button" id="mv-rerun"><span class="material-icons">refresh</span>Re-run</button>'
      + '<button class="btn" type="button" id="mv-csv"><span class="material-icons">download</span>CSV</button>'
      + '<button class="btn" type="button" id="mv-print"><span class="material-icons">picture_as_pdf</span>PDF / Print</button>'
      + '<button class="btn" type="button" id="mv-copy"><span class="material-icons">content_copy</span>Copy summary</button></div>';

    out.innerHTML = actions + verdictBlock(r) + programEligibility(r) + categoryBreakdown(r) + appRequirements(r)
      + insightsRow(r) + criticalIssues(r)
      + '<div class="section-heading-row"><span class="material-icons" style="color:var(--primary)">article</span><h4 style="margin:0">Content Quality</h4></div>' + portfolio(r) + dups(r) + important(r)
      + brandSafetyBlock(r)
      + '<div class="section-heading-row"><span class="material-icons" style="color:var(--primary)">smartphone</span><h4 style="margin:0">Reader Experience, Advertising, Technical & Trust</h4></div>'
      + trafficBlock(r)
      + '<div class="audit-panel wide"><h3>Advertising Readiness</h3><div class="insight-row">'
      + [['Networks', (r.advertising && r.advertising.networks && r.advertising.networks.length) ? esc(r.advertising.networks.join(', ')) : 'none'],
         ['Ad pages', String((r.advertising && r.advertising.adPages) || 0)], ['Heavy thin pages', String((r.advertising && r.advertising.heavyPages) || 0)],
         ['Content:ad ratio', (r.advertising && r.advertising.contentToAdRatio != null) ? r.advertising.contentToAdRatio + ' words/slot' : ','],
         ['ads.txt', (r.crawl && r.crawl.adsTxt && r.crawl.adsTxt.present) ? 'present' : 'not found']
        ].map(function (x) { return '<div class="insight-card"><span>' + esc(x[0]) + '</span><b>' + String(x[1]) + '</b></div>'; }).join('')
      + '</div></div>'
      + '<div class="audit-panel wide"><h3>Performance Signals</h3><div class="insight-row">'
      + [['Avg TTFB', (r.performance && r.performance.avgTtfb != null) ? r.performance.avgTtfb + 'ms' : ','],
         ['Avg HTML size', (r.performance && r.performance.avgHtmlKb != null) ? r.performance.avgHtmlKb + 'KB' : ','],
         ['Third-party scripts', String((r.performance && r.performance.externalScripts) || 0)],
         ['Render-blocking', String((r.performance && r.performance.renderBlocking) || 0)],
         ['Compression', (r.performance && r.performance.compressionPct) + '%'], ['Cache headers', (r.performance && r.performance.cachePct) + '%']
        ].map(function (x) { return '<div class="insight-card"><span>' + esc(x[0]) + '</span><b>' + esc(String(x[1])) + '</b></div>'; }).join('')
      + '</div><p class="muted">These are observable server-side/HTML signals, not a Lighthouse or Core Web Vitals score. A browser-based Core Web Vitals measurement would be reported separately.</p></div>'
      + manuals(r) + issueExplorer(r) + pageTable(r)
      + '<p class="adsense-footnote">' + esc(r.disclaimer) + ' Review <a href="https://help.mediavine.com/what-does-it-take-to-get-approved-by-mediavine" target="_blank" rel="noopener">Mediavine’s current requirements</a> before applying.</p>';

    document.getElementById('mv-rerun').onclick = function () { form.requestSubmit(); };
    document.getElementById('mv-csv').onclick = function () { exportCSV(r); };
    document.getElementById('mv-print').onclick = function () { window.print(); };
    document.getElementById('mv-copy').onclick = function () { copySummary(r); };

    var tabs = document.getElementById('mv-issue-tabs');
    var search = document.getElementById('mv-issue-search');
    var list = document.getElementById('mv-issue-list');
    tabs.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; Array.prototype.forEach.call(tabs.querySelectorAll('button'), function (x) { x.classList.remove('active'); }); b.classList.add('active'); list.innerHTML = renderIssues(r.findings, b.dataset.f, search.value); });
    search.addEventListener('input', function () { var active = tabs.querySelector('button.active'); list.innerHTML = renderIssues(r.findings, active.dataset.f, search.value); });

    var table = document.getElementById('mv-page-table');
    var tbody = table.querySelector('tbody');
    var sortKey = 'path', sortDir = 1;
    table.querySelectorAll('th').forEach(function (th) {
      th.onclick = function () {
        var k = th.dataset.k;
        if (k === sortKey) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
        var idx = { path: 0, type: 1, status: 2, words: 3, content: 4, brandSafety: 5, ux: 6, technical: 7, issues: 8 }[k] || 0;
        var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
        rows.sort(function (a, b) { var av = a.querySelectorAll('td')[idx].textContent.trim(), bv = b.querySelectorAll('td')[idx].textContent.trim(); var an = parseInt(av, 10), bn = parseInt(bv, 10); if (!isNaN(an) && !isNaN(bn) && String(an) === av && String(bn) === bv) return sortDir * (an - bn); return sortDir * String(av).localeCompare(String(bv)); });
        rows.forEach(function (row) { tbody.appendChild(row); });
      };
    });
    var ps = document.getElementById('mv-page-search');
    ps.addEventListener('input', function () { var q = ps.value.toLowerCase(); Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function (tr) { tr.style.display = (tr.getAttribute('data-url') || '').toLowerCase().indexOf(q) >= 0 ? '' : 'none'; }); });
    var typeFilter = document.getElementById('mv-page-type-filter');
    typeFilter.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      Array.prototype.forEach.call(typeFilter.querySelectorAll('button'), function (x) { x.classList.remove('active'); }); b.classList.add('active');
      var t = b.dataset.t, q = ps.value.toLowerCase();
      Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function (tr) {
        var show = (tr.getAttribute('data-url') || '').toLowerCase().indexOf(q) >= 0;
        if (show && t !== 'all') {
          var tds = tr.querySelectorAll('td');
          if (t === 'content') show = parseInt(tds[4].textContent, 10) > 0;
          else if (t === 'brand') show = parseInt(tds[5].textContent, 10) > 0;
          else if (t === 'ux') show = parseInt(tds[6].textContent, 10) > 0;
          else if (t === 'tech') show = parseInt(tds[7].textContent, 10) > 0;
          else if (t === 'err') show = tr.querySelector('.status-pill.s-err') != null;
        }
        tr.style.display = show ? '' : 'none';
      });
    });
    tbody.addEventListener('click', function (e) {
      var b = e.target.closest('button.row-detail'); if (!b) return;
      var url = b.getAttribute('data-url');
      var f = r.findings.filter(function (x) { return x.page === '/' + (url.split('/').filter(Boolean).join('/')) || (x.urls || []).indexOf(url) >= 0; });
      var det = document.getElementById('mv-page-detail');
      det.innerHTML = '<h5>Details, ' + esc(url) + '</h5>' + (f.length ? renderIssues(f, 'all', '') : '<p class="muted">No findings for this page.</p>');
      det.style.display = 'block';
    });
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function slimScan(scan) {
    return {
      start: scan.start, origin: scan.origin, limit: scan.limit, robots: scan.robots,
      sitemapUrls: (scan.sitemapUrls || []).slice(0, 400), adsTxt: scan.adsTxt,
      challenge: !!scan.challenge, reachedLimit: !!scan.reachedLimit, errors: scan.errors || [],
      pages: (scan.pages || []).map(function (p) {
        var html = p.html || '';
        if (html.length > 90000) html = html.slice(0, 90000);
        return { url: p.url, finalUrl: p.finalUrl || p.url, status: p.status || 0, depth: p.depth || 0, redirected: !!p.redirected, via: p.via || 'browser', ms: p.ms, bytes: p.bytes || html.length, headers: p.headers || {}, html: html, error: p.error, errorCode: p.errorCode, skipped: p.skipped, challenge: !!p.challenge };
      })
    };
  }

  function run() {
    var url = urlInput.value.trim();
    if (!url) return;
    abortCtrl = new AbortController();
    progressUI({ stage: 'init', message: 'Starting…' });
    var crawler;
    try { crawler = new MediavineChecker.Crawler(url, { limit: parseInt(limitSel.value, 10) || 50, concurrency: 4, signal: abortCtrl.signal, onProgress: progressUI }); }
    catch (e) { errorUI(e); abortCtrl = null; return; }
    crawler.run().then(function (scan) {
      var readable = (scan.pages || []).filter(function (p) { return p.html && !p.error && !p.skipped; });
      if (!readable.length) { var first = (scan.errors && scan.errors[0]) || {}; throw { code: first.code || (scan.challenge ? 'challenge' : 'empty'), message: first.message || 'No readable HTML pages were found.' }; }
      progressUI({ stage: 'parse', message: 'Scoring crawled pages…' });
      return fetch('/api/mediavine-analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(slimScan(scan)), signal: abortCtrl.signal })
        .then(function (res) { return res.json().then(function (j) { if (!res.ok || (j && j.code && !j.score)) throw j; return j; }); });
    }).then(render).catch(function (err) {
      if (err && (err.name === 'AbortError' || (abortCtrl && abortCtrl.signal.aborted))) { errorUI({ code: 'cancelled', message: 'Cancelled' }); return; }
      errorUI(err && err.code ? err : { code: 'fetch_failed', message: (err && err.message) || 'Network error' });
    }).then(function () { abortCtrl = null; });
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); run(); });
  var qs = new URLSearchParams(location.search).get('url');
  if (qs) { urlInput.value = qs; form.requestSubmit(); }
})();
