/* huvanti Raptive Eligibility Checker, report UI (independent of AdSense, Ezoic & Mediavine). */
(function () {
  'use strict';
  var form = document.getElementById('raptive-form');
  if (!form) return;
  var urlInput = document.getElementById('raptive-url');
  var limitSel = document.getElementById('raptive-limit');
  var out = document.getElementById('raptive-results');
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
  function statusChip(st) {
    var c = st === 'Verified' || st === 'Likely' ? 'passed' : (st === 'Not Met' || st === 'Needs Review' ? 'high' : 'manual');
    return '<span class="badge ' + c + '">' + esc(st) + '</span>';
  }
  function val(id) {
    var n = document.getElementById(id);
    if (!n || n.value === '') return null;
    var x = Number(String(n.value).replace(/,/g, ''));
    return isFinite(x) ? x : null;
  }
  function userPayload() {
    return { pageviews: val('raptive-pageviews'), us: val('raptive-us'), uk: val('raptive-uk'), ca: val('raptive-ca'), au: val('raptive-au'), nz: val('raptive-nz') };
  }

  var STEPS = [
    ['connect', 'Website connected'],
    ['robots', 'Robots.txt analyzed'],
    ['sitemap', 'Sitemap discovered'],
    ['crawler', 'Pages crawled'],
    ['important', 'Page classification completed'],
    ['content', 'Content analysis completed'],
    ['duplicates', 'Duplicate analysis completed'],
    ['longform', 'Long-form analysis completed'],
    ['brand', 'Brand-safety analysis completed'],
    ['technical', 'Technical audit completed'],
    ['advertising', 'Ad-readiness analysis completed'],
    ['score', 'Calculating Raptive readiness']
  ];
  function stepState(key, current) {
    var map = { parse: 'important', ux: 'technical', trust: 'technical', analytics: 'brand', traffic: 'brand', requirements: 'score', domain: 'crawler', human: 'longform' };
    var cur = map[current] || current;
    var keys = STEPS.map(function (s) { return s[0]; });
    var a = keys.indexOf(key), b = keys.indexOf(cur);
    if (current === 'done') return 'done';
    if (current === 'init') return key === 'connect' ? 'active' : 'wait';
    if (a < 0) return 'wait';
    if (b < 0) return a === 0 ? 'active' : 'wait';
    return a < b ? 'done' : a === b ? 'active' : 'wait';
  }
    function progressUI(state) {
    var ICONS = {'connect': 'power', 'robots': 'rule', 'sitemap': 'account_tree', 'crawler': 'travel_explore', 'important': 'star', 'content': 'article', 'duplicates': 'merge_type', 'longform': 'notes', 'brand': 'verified_user', 'technical': 'build', 'advertising': 'campaign', 'score': 'grading'};
    var steps = STEPS.map(function (s) { return { key: s[0], label: s[1], icon: ICONS[s[0]] || 'radio_button_unchecked' }; });
    var states = {};
    STEPS.forEach(function (s) { states[s[0]] = stepState(s[0], state.stage); });
    var p = window.ScanProgress.reuse(out, {
      title: 'Checking Raptive readiness', target: (urlInput && urlInput.value) || '', icon: 'campaign', steps: steps,
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
      + '<button class="btn" id="raptive-retry">Try again</button></div>';
    var b = document.getElementById('raptive-retry');
    if (b) b.onclick = function () { form.requestSubmit(); };
  }

  function verdictBlock(r) {
    var s = r.score;
    var elig = r.applicationEligibility || {};
    var icon = s.verdict === 'Strong Website Quality' ? 'verified' : s.verdict === 'Unable to Verify' ? 'help' : s.total >= 40 ? 'trending_up' : 'gpp_bad';
    return '<div class="score-card adsense-scorecard raptive-scorecard"><div class="score-ring" style="--score:' + s.total + ';background:conic-gradient(' + ringColor(s.total) + ' calc(var(--score)*1%),var(--chip-bg) 0)"><b style="color:' + ringColor(s.total) + '">' + s.total + '</b></div><div class="score-summary">'
      + '<div class="verdict ' + esc(r.verdict.class) + '"><span class="material-icons">' + icon + '</span>' + esc(r.verdict.label) + '</div>'
      + '<h2>Raptive Readiness Score</h2>'
      + '<p>' + esc(r.verdict.summary) + '</p>'
      + '<div class="source-chip">Not an official Raptive score · internal estimate · confidence ' + s.confidence + '% · Raptive makes the final decision.</div>'
      + '<div class="ad-summary-grid">'
      + '<div class="ad-stat"><span>Website quality</span><b>' + r.websiteQualityScore + '/100</b></div>'
      + '<div class="ad-stat"><span>Pages crawled</span><b>' + r.stats.pagesCrawled + '</b></div>'
      + '<div class="ad-stat"><span>Issues</span><b>' + r.stats.issues + '</b></div>'
      + '<div class="ad-stat"><span>Critical</span><b>' + r.stats.critical + '</b></div>'
      + '<div class="ad-stat"><span>Passed</span><b>' + r.stats.passed + '</b></div>'
      + '<div class="ad-stat"><span>Manual items</span><b>' + r.stats.manual + '</b></div>'
      + '</div></div></div>'
      + '<div class="audit-panel wide"><h3>Application Eligibility</h3>'
      + '<div class="verdict ' + esc(elig.class || 'unverifiable') + '">' + esc(elig.status || 'Cannot Be Fully Verified') + '</div>'
      + '<p>' + esc(elig.reason || '') + '</p>'
      + (elig.tier ? '<p class="muted">Declared traffic tier: ' + esc(elig.tier.name) + ' · key-country target ' + (elig.tier.keyCountryPct != null ? elig.tier.keyCountryPct + '%+' : 'n/a') + '. User-provided values are never presented as independently verified.</p>' : '<p class="muted">Monthly pageviews and traffic-country percentages require private analytics data.</p>')
      + '</div>';
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
        var manuals = (c.manuals || []).map(function (m) { return '<div class="calc-line neutral"><span>' + sevPill('manual') + ' ' + esc(m.name) + ': Manual Verification Required</span><b>,</b></div>'; }).join('');
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

  function officialReqs(r) {
    return '<div class="audit-panel wide"><h3>Raptive requirements</h3><p class="muted">Official items from Raptive Support. Statuses: Verified, Likely, Needs Review, Manual Verification, Not Met, Unable to Verify. “Not Met” is used only when evidence or a user-provided value actually establishes a miss.</p>'
      + '<div class="page-table-wrap"><table class="page-table"><thead><tr><th>Requirement</th><th>Status</th><th>Evidence</th><th>Source</th></tr></thead><tbody>'
      + (r.officialRequirements || []).map(function (a) {
        return '<tr><td><b>' + esc(a.name) + '</b><br><span class="muted">' + esc((a.requirement || '').slice(0, 180)) + '</span></td>'
          + '<td>' + statusChip(a.status) + '</td><td class="muted">' + esc(a.evidence) + '</td>'
          + '<td class="muted">' + (a.sourceUrl ? '<a href="' + esc(a.sourceUrl) + '" target="_blank" rel="noopener">Raptive</a> · ' + esc(a.lastVerified || '') : ',') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
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
        + (x.reqStatus ? ' · ' + statusChip(x.reqStatus) : '')
        + (x.confidenceLevel ? ' · ' + esc(x.confidenceLevel) : '')
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
      ['requirement', 'Requirements'], ['content', 'Content'], ['brand', 'Brand Safety'], ['ux', 'Reader Experience'],
      ['tech', 'Technical'], ['traffic', 'Traffic'], ['advertising', 'Ad readiness']
    ];
    var tabs = '<div class="tabs" id="rp-issue-tabs">' + filters.map(function (f, i) { return '<button type="button" data-f="' + f[0] + '" class="' + (i === 0 ? 'active' : '') + '">' + f[1] + '</button>'; }).join('') + '</div>';
    return '<div class="audit-panel wide"><h3>Issue explorer</h3>' + tabs
      + '<input type="search" id="rp-issue-search" class="text-input" placeholder="Search issues or URLs…" aria-label="Search issues">'
      + '<div id="rp-issue-list">' + renderIssues(r.findings, 'all', '') + '</div></div>';
  }

  function pageTable(r) {
    var rows = (r.pages || []).map(function (p) {
      var st = p.error ? 'err' : p.status >= 400 ? 'err' : p.status >= 300 ? 'redir' : 'ok';
      return '<tr data-url="' + esc(p.url) + '"><td class="pt-url" title="' + esc(p.url) + '">' + esc(p.path) + '</td>'
        + '<td><span class="badge low">' + esc(p.type) + '</span></td>'
        + '<td><span class="status-pill s-' + st + '">' + (p.error ? 'ERR' : (p.status || '?')) + '</span></td>'
        + '<td>' + (p.wordCount || ',') + '</td>'
        + '<td>' + p.content + '</td>'
        + '<td>' + p.originality + '</td>'
        + '<td>' + p.ux + '</td>'
        + '<td>' + p.technical + '</td>'
        + '<td>' + p.brandSafety + '</td>'
        + '<td>' + p.issues + '</td>'
        + '<td><button type="button" class="row-detail" data-url="' + esc(p.url) + '" aria-label="View details">view</button></td></tr>';
    }).join('');
    return '<div class="audit-panel wide"><h3>Page-level analysis</h3>'
      + '<input type="search" id="rp-page-search" class="text-input" placeholder="Filter pages by URL…" aria-label="Filter pages">'
      + '<div class="tabs" id="rp-page-type-filter"><button type="button" data-t="all" class="active">All</button><button type="button" data-t="content">Content</button><button type="button" data-t="brand">Brand issues</button><button type="button" data-t="ux">UX issues</button><button type="button" data-t="tech">Technical issues</button><button type="button" data-t="err">Errors</button></div>'
      + '<div class="page-table-wrap"><table class="page-table" id="rp-page-table"><thead><tr>'
      + '<th data-k="path">URL</th><th data-k="type">Type</th><th data-k="status">Status</th><th data-k="words">Content</th>'
      + '<th data-k="content">Content</th><th data-k="originality">Originality</th><th data-k="ux">UX</th><th data-k="technical">Technical</th><th data-k="brandSafety">Brand Safety</th><th data-k="issues">Issues</th><th></th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '<div id="rp-page-detail" class="page-detail"></div></div>';
  }

  function manuals(r) {
    if (!r.manualVerification || !r.manualVerification.length) return '';
    return '<div class="audit-panel wide"><h3>Manual Verification Required</h3><p class="muted">A public URL crawler cannot know private analytics with certainty. These items are excluded from the automated score rather than guessed.</p>'
      + '<div class="page-table-wrap"><table class="page-table"><thead><tr><th>Metric</th><th>Status</th><th>Why it cannot be verified</th><th>What to provide</th></tr></thead><tbody>'
      + r.manualVerification.map(function (m) {
        return '<tr><td><b>' + esc(m.metric) + '</b></td><td><span class="badge manual">' + esc(m.status) + '</span></td><td class="muted">' + esc(m.whyCannotVerify) + '</td><td class="muted">' + esc(m.evidenceToProvide) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  function longFormBlock(r) {
    var lf = r.longForm || {};
    return '<div class="audit-panel"><h3>Long-form coverage</h3><div class="insight-row">'
      + [['Eligible content pages', String(lf.eligible || 0)], ['Long-form pages', String(lf.longForm || 0)],
         ['Coverage', (lf.coverage != null ? lf.coverage + '%' : ',')], ['Majority (≥50%)', lf.majority ? 'yes' : 'no']
        ].map(function (x) { return '<div class="insight-card"><span>' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('')
      + '</div><p class="muted">' + (lf.longForm || 0) + ' of ' + (lf.eligible || 0) + ' eligible content pages contain substantial long-form content. Privacy, terms, contact, about, search, login and utility pages are excluded. Word count is not used alone.</p></div>';
  }

  function humanBlock(r) {
    var h = r.humanInvolvement || {};
    return '<div class="audit-panel"><h3>Human-involvement signals</h3><div class="insight-row">'
      + [['Author bylines', (h.withAuthor || 0) + ' (' + (h.authorPct || 0) + '%)'],
         ['First-hand language', String(h.firstHand || 0)],
         ['Sources/references', String(h.sources || 0)],
         ['Low-involvement pattern', String(h.lowVar || 0)]
        ].map(function (x) { return '<div class="insight-card"><span>' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('')
      + '</div><p class="muted">A crawler cannot definitively determine whether humans wrote a page. This never claims “AI-generated content detected.”</p></div>';
  }

  function gaBlock(r) {
    var a = r.analytics || {};
    var d = r.domainAge || {};
    return '<div class="audit-panel wide"><h3>Google Analytics detection &amp; domain age</h3><div class="insight-row">'
      + [['Tracking code', a.detected ? 'detected' : 'not detected'],
         ['GA4 IDs', (a.ga4Ids && a.ga4Ids.length) ? a.ga4Ids.join(', ') : ','],
         ['GTM', (a.gtmIds && a.gtmIds.length) ? a.gtmIds.join(', ') : ','],
         ['Configuration verified', 'no'],
         ['Domain age', d.verified ? ('~' + d.ageMonths + ' months') : 'Unable to verify'],
         ['RDAP date', d.verified ? String(d.registeredAt || '').slice(0, 10) : ',']
        ].map(function (x) { return '<div class="insight-card"><span>' + esc(x[0]) + '</span><b>' + esc(String(x[1])) + '</b></div>'; }).join('')
      + '</div><p class="muted">Tracking code detected is not the same as Analytics configuration verified. Domain dates are never invented when RDAP fails.</p></div>';
  }

  function trafficBlock(r) {
    var t = r.traffic || {};
    var d = r.declaredTraffic || {};
    return '<div class="audit-panel wide"><h3>Traffic readiness</h3>'
      + '<p class="muted">Raptive reviews pageviews and country mix in Google Analytics. A URL-only crawler cannot calculate actual traffic percentages. SEO estimates are never treated as pageviews.</p>'
      + '<h5 class="traffic-subhead">Declared analytics (user-provided)</h5>'
      + '<div class="insight-row">'
      + [['Monthly pageviews', d.pageviews != null ? (Math.round(d.pageviews).toLocaleString('en-US') + ' · ' + d.label) : 'Not publicly verifiable'],
         ['Combined key countries', d.combinedKeyCountryPct != null ? d.combinedKeyCountryPct + '%' : 'Not provided']
        ].map(function (x) { return '<div class="insight-card"><span>' + esc(x[0]) + '</span><b>' + esc(String(x[1])) + '</b></div>'; }).join('')
      + '</div>'
      + '<h5 class="traffic-subhead">Observable traffic signals</h5><div class="priority-list">'
      + (t.observable && t.observable.length ? t.observable.map(function (f) { return '<div class="priority ' + f.status + '"><b>' + esc(f.name) + '</b><span>' + esc(f.evidence) + '</span></div>'; }).join('') : '<div class="priority passed"><b>No adverse public traffic signals detected</b><span>Obvious bot-like or incentivized patterns were not found.</span></div>')
      + '</div><h5 class="traffic-subhead">Private analytics requirements</h5><div class="priority-list">'
      + (t.cannotVerify && t.cannotVerify.length ? t.cannotVerify.map(function (f) { return '<div class="priority manual"><b>' + esc(f.name) + '</b><span>' + esc(f.evidence) + '</span></div>'; }).join('') : '')
      + '</div></div>';
  }

  function brandSafetyBlock(r) {
    var bs = r.brandSafety || { findings: [], stats: {} };
    var st = bs.stats || {};
    return '<div class="audit-panel wide"><h3>Brand safety</h3>'
      + '<p class="muted">Deterministic contextual screen. Isolated keywords never create a high finding. These are not official Raptive policy violations unless an official Raptive source is cited.</p>'
      + '<div class="ad-summary-grid"><div class="ad-stat"><span>Signals</span><b>' + (st.total || 0) + '</b></div><div class="ad-stat"><span>High</span><b>' + (st.high || 0) + '</b></div><div class="ad-stat"><span>Medium</span><b>' + (st.medium || 0) + '</b></div><div class="ad-stat"><span>Pages</span><b>' + (st.pages || 0) + '</b></div></div>'
      + '<div class="priority-list">'
      + (bs.findings && bs.findings.length ? bs.findings.map(function (f) {
        return '<div class="priority ' + f.status + '"><b>' + esc(f.label) + ' · ' + esc(f.page) + '</b><span>' + esc(f.confidenceLevel) + ' · ' + f.confidence + '% confidence. ' + esc(f.evidence) + '</span></div>';
      }).join('') : '<div class="priority passed"><b>No high-confidence brand-safety signals detected</b><span>Isolated keywords are ignored.</span></div>')
      + '</div></div>';
  }

  function portfolio(r) {
    var p = r.contentPortfolio || {};
    var o = r.originality || {};
    return '<div class="audit-panel"><h3>Content quality &amp; originality</h3><div class="insight-row">'
      + [['Crawled pages', String(p.totalCrawled || r.stats.pagesCrawled || 0)], ['Content pages', String(p.contentPages || 0)],
         ['Substantial', String(p.useful || 0)], ['Thin pages', String(p.thin || 0)],
         ['Unique content %', (p.uniqueContentPct || 0) + '%'], ['Near-duplicate %', (o.dupPct || 0) + '%']
        ].map(function (x) { return '<div class="insight-card"><span>' + esc(x[0]) + '</span><b>' + esc(String(x[1])) + '</b></div>'; }).join('')
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

  function important(r) {
    if (!r.importantPages || !r.importantPages.length) return '';
    return '<div class="audit-panel"><h3>Important pages detected</h3><div class="ad-trust-list">'
      + r.importantPages.map(function (x) { return '<div class="ad-trust-card"><span class="material-icons">verified</span><div><b>' + esc(x.label) + '</b><small>' + esc(x.path) + ' · ' + x.confidence + '% confidence' + (x.linkedFromNav ? ' · linked in nav/footer' : '') + ' · ' + x.words + ' words</small></div></div>'; }).join('')
      + '</div></div>';
  }

  function priorityFixes(r) {
    var fix = r.findings.filter(function (f) { return f.status === 'critical' || f.status === 'high' || f.status === 'medium'; })
      .sort(function (a, b) { var o = { critical: 0, high: 1, medium: 2 }; return (o[a.status] - o[b.status]) || (b.confidence - a.confidence); })
      .slice(0, 12);
    if (!fix.length) return '<div class="priority passed"><b>No critical or high-priority automated issues detected</b><span>Public signals look relatively strong. Complete the manual verification items before applying.</span></div>';
    return fix.map(function (f) {
      var label = { critical: 'Critical, fix before applying', high: 'High, strongly recommended', medium: 'Medium, improvement recommended' }[f.status];
      return '<div class="priority ' + f.status + '"><b>' + esc(f.name) + ' · ' + esc(f.page) + '</b><span>' + esc(label) + ': ' + esc(f.fix || f.evidence) + '</span></div>';
    }).join('');
  }

  function toast(msg) { var t = el('div', 'toast', msg); document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600); }
  function exportCSV(r) {
    var rows = [['Category', 'Check', 'Status', 'Page', 'Evidence', 'Confidence', 'Source', 'Why', 'Fix']];
    r.findings.forEach(function (f) { rows.push([f.category, f.name, f.status, f.page, f.evidence, f.confidence + '%', f.sourceType, f.why || '', f.fix || '']); });
    var csv = rows.map(function (row) { return row.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'raptive-eligibility.csv'; a.click(); URL.revokeObjectURL(a.href);
  }
  function copySummary(r) {
    var s = 'Raptive Readiness Score: ' + r.score.total + '/100, ' + r.verdict.label + '\nApplication eligibility: ' + r.applicationEligibility.status + '\n' + r.url + '\nNot an official Raptive score.\n';
    r.score.categories.forEach(function (c) { s += '- ' + c.label + ': ' + c.score + '/' + c.max + '\n'; });
    if (navigator.clipboard) navigator.clipboard.writeText(s);
    toast('Summary copied');
  }

  function render(r) {
    var actions = '<div class="report-actions"><button class="btn" type="button" id="rp-rerun"><span class="material-icons">refresh</span>Re-run</button>'
      + '<button class="btn" type="button" id="rp-csv"><span class="material-icons">download</span>CSV</button>'
      + '<button class="btn" type="button" id="rp-print"><span class="material-icons">picture_as_pdf</span>PDF / Print</button>'
      + '<button class="btn" type="button" id="rp-copy"><span class="material-icons">content_copy</span>Copy summary</button></div>';

    out.innerHTML = actions + verdictBlock(r) + categoryBreakdown(r) + officialReqs(r)
      + '<div class="audit-grid refined"><div class="audit-panel top-panel"><h3>Recommended fixes</h3><div class="priority-list">' + priorityFixes(r) + '</div></div>'
      + portfolio(r) + '</div>'
      + longFormBlock(r) + humanBlock(r) + dups(r) + important(r)
      + gaBlock(r) + trafficBlock(r) + brandSafetyBlock(r)
      + '<div class="audit-panel wide"><h3>Ad readiness &amp; performance</h3><div class="insight-row">'
      + [['Networks', (r.advertising && r.advertising.networks && r.advertising.networks.length) ? esc(r.advertising.networks.join(', ')) : 'none'],
         ['Ad pages', String((r.advertising && r.advertising.adPages) || 0)],
         ['Avg TTFB', (r.performance && r.performance.avgTtfb != null) ? r.performance.avgTtfb + 'ms' : ','],
         ['Compression', (r.performance && r.performance.compressionPct) + '%'],
         ['ads.txt', (r.crawl && r.crawl.adsTxt && r.crawl.adsTxt.present) ? 'present' : 'not found']
        ].map(function (x) { return '<div class="insight-card"><span>' + esc(x[0]) + '</span><b>' + String(x[1]) + '</b></div>'; }).join('')
      + '</div><p class="muted">Server-side measurements are not Lighthouse results. Layout suitability is not a claim of actual Raptive ad compatibility.</p></div>'
      + manuals(r) + issueExplorer(r) + pageTable(r)
      + '<p class="adsense-footnote">' + esc(r.disclaimer) + ' Review <a href="https://help.raptive.com/hc/en-us/articles/360032840891-Who-is-eligible-for-Raptive" target="_blank" rel="noopener">Raptive’s current requirements</a> before applying.</p>';

    document.getElementById('rp-rerun').onclick = function () { form.requestSubmit(); };
    document.getElementById('rp-csv').onclick = function () { exportCSV(r); };
    document.getElementById('rp-print').onclick = function () { window.print(); };
    document.getElementById('rp-copy').onclick = function () { copySummary(r); };

    var tabs = document.getElementById('rp-issue-tabs');
    var search = document.getElementById('rp-issue-search');
    var list = document.getElementById('rp-issue-list');
    tabs.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; Array.prototype.forEach.call(tabs.querySelectorAll('button'), function (x) { x.classList.remove('active'); }); b.classList.add('active'); list.innerHTML = renderIssues(r.findings, b.dataset.f, search.value); });
    search.addEventListener('input', function () { var active = tabs.querySelector('button.active'); list.innerHTML = renderIssues(r.findings, active.dataset.f, search.value); });

    var table = document.getElementById('rp-page-table');
    var tbody = table.querySelector('tbody');
    var sortKey = 'path', sortDir = 1;
    table.querySelectorAll('th').forEach(function (th) {
      th.onclick = function () {
        var k = th.dataset.k;
        if (k === sortKey) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
        var idx = { path: 0, type: 1, status: 2, words: 3, content: 4, originality: 5, ux: 6, technical: 7, brandSafety: 8, issues: 9 }[k] || 0;
        var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
        rows.sort(function (a, b) { var av = a.querySelectorAll('td')[idx].textContent.trim(), bv = b.querySelectorAll('td')[idx].textContent.trim(); var an = parseInt(av, 10), bn = parseInt(bv, 10); if (!isNaN(an) && !isNaN(bn) && String(an) === av && String(bn) === bv) return sortDir * (an - bn); return sortDir * String(av).localeCompare(String(bv)); });
        rows.forEach(function (row) { tbody.appendChild(row); });
      };
    });
    var ps = document.getElementById('rp-page-search');
    ps.addEventListener('input', function () { var q = ps.value.toLowerCase(); Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function (tr) { tr.style.display = (tr.getAttribute('data-url') || '').toLowerCase().indexOf(q) >= 0 ? '' : 'none'; }); });
    var typeFilter = document.getElementById('rp-page-type-filter');
    typeFilter.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      Array.prototype.forEach.call(typeFilter.querySelectorAll('button'), function (x) { x.classList.remove('active'); }); b.classList.add('active');
      var t = b.dataset.t, q = ps.value.toLowerCase();
      Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function (tr) {
        var show = (tr.getAttribute('data-url') || '').toLowerCase().indexOf(q) >= 0;
        if (show && t !== 'all') {
          var tds = tr.querySelectorAll('td');
          if (t === 'content') show = parseInt(tds[4].textContent, 10) > 0;
          else if (t === 'brand') show = parseInt(tds[8].textContent, 10) > 0;
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
      var det = document.getElementById('rp-page-detail');
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
    try { crawler = new RaptiveChecker.Crawler(url, { limit: parseInt(limitSel.value, 10) || 50, concurrency: 4, signal: abortCtrl.signal, onProgress: progressUI }); }
    catch (e) { errorUI(e); abortCtrl = null; return; }
    crawler.run().then(function (scan) {
      var readable = (scan.pages || []).filter(function (p) { return p.html && !p.error && !p.skipped; });
      if (!readable.length) { var first = (scan.errors && scan.errors[0]) || {}; throw { code: first.code || (scan.challenge ? 'challenge' : 'empty'), message: first.message || 'No readable HTML pages were found.' }; }
      progressUI({ stage: 'parse', message: 'Scoring crawled pages…' });
      var body = slimScan(scan);
      var u = userPayload();
      body.pageviews = u.pageviews; body.us = u.us; body.uk = u.uk; body.ca = u.ca; body.au = u.au; body.nz = u.nz;
      return fetch('/api/raptive-analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: abortCtrl.signal })
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
