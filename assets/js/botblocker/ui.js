/* AI Crawler & LLM Bot Blocker: UI. Inherits the huvanti design system.
 * Deterministic, fully local pipeline (bot database → classification → mode →
 * robots.txt + server configs → validation → conflicts → simulator →
 * coverage → score → export). The only network calls are the two the user
 * explicitly triggers: fetching an existing robots.txt / live website check. */
(function () {
  'use strict';
  var BB = window.BB;
  var form = document.getElementById('botblocker-form');
  var out = document.getElementById('botblocker-results');
  if (!form || !out || !BB) return;

  var db = BB.botDatabase, classifier = BB.botClassifier, parser = BB.robotsParser,
      simulator = BB.robotsSimulator, conflicts = BB.ruleConflictDetector,
      matcher = BB.botPatternMatcher, uaAnalyzer = BB.userAgentAnalyzer;

  var state = {
    report: null,
    config: null,
    customBots: [],
    overrides: {},
    paths: [],
    exceptions: [],
    activeTab: null,
    existing: { text: '', parsed: null, analyzed: false },
    liveReport: null,
    simBot: 'GPTBot',
    filter: 'all',
    search: ''
  };

  /* ---------- helpers ---------- */
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function icon(n) { return '<span class="material-icons" aria-hidden="true">' + esc(n) + '</span>'; }
  function toast(t) {
    var e = document.createElement('div'); e.className = 'toast'; e.textContent = t;
    document.body.appendChild(e); setTimeout(function () { e.remove(); }, 2600);
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast('Copied to clipboard'); }, function () { fallbackCopy(text); });
    else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied to clipboard'); } catch (e) { }
    document.body.removeChild(ta);
  }
  function download(name, text, type) {
    try {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain;charset=utf-8' }));
      a.download = name; a.rel = 'noopener'; a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(a.href); } catch (e) { } }, 1500);
      toast('Downloading ' + name);
    } catch (e) { copy(text); toast('Download was blocked, content copied to clipboard instead.'); }
  }
  function el(id) { return document.getElementById(id); }
  function chip(label, on, attr) {
    return '<button type="button" class="chip botblocker-pathchip' + (on ? ' is-on' : '') + '" ' + attr + ' aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(label) + '</button>';
  }

  /* ---------- config ⇄ form ---------- */
  var PATH_SUGGESTIONS = ['/blog/', '/articles/', '/premium/', '/api/', '/docs/'];
  var EXCEPTION_SUGGESTIONS = ['/public/', '/docs/', '/pricing/'];
  var OUTPUT_KEYS = ['robots', 'nginx', 'apache', 'cloudflare', 'node', 'php', 'laravel'];
  var OUTPUT_LABELS = { robots: 'robots.txt', nginx: 'Nginx', apache: 'Apache', cloudflare: 'Cloudflare', node: 'Node.js', php: 'PHP', laravel: 'Laravel' };

  function readConfig() {
    var outputs = { robots: true };
    for (var i = 1; i < OUTPUT_KEYS.length; i++) {
      var c = el('botblocker-out-' + OUTPUT_KEYS[i]);
      outputs[OUTPUT_KEYS[i]] = !!(c && c.checked);
    }
    return {
      website: (el('botblocker-url').value || '').trim() || 'https://example.com',
      mode: el('botblocker-mode').value,
      paths: {
        mode: (el('botblocker-scope-entire') && el('botblocker-scope-entire').checked) ? 'entire' : 'specific',
        list: state.paths.slice()
      },
      exceptions: { enabled: !!(el('botblocker-exceptions-on') && el('botblocker-exceptions-on').checked), list: state.exceptions.slice() },
      defaultGroup: el('botblocker-default-group') ? el('botblocker-default-group').value : 'allow',
      sitemap: el('botblocker-sitemap') ? (el('botblocker-sitemap').value || '').trim() : '',
      overrides: JSON.parse(JSON.stringify(state.overrides)),
      customBots: state.customBots.slice(),
      rateLimit: {
        enabled: !!(el('botblocker-rate-on') && el('botblocker-rate-on').checked),
        requestsPerSecond: parseFloat(el('botblocker-rps') ? el('botblocker-rps').value : 1) || 1,
        requestsPerMinute: parseFloat(el('botblocker-rpm') ? el('botblocker-rpm').value : 60) || 60,
        burst: parseFloat(el('botblocker-burst') ? el('botblocker-burst').value : 20) || 20
      },
      outputs: outputs
    };
  }

  function writeConfig(cfg) {
    cfg = BB.index.normalizeConfig(cfg);
    el('botblocker-url').value = cfg.website || '';
    var modeEl = el('botblocker-mode');
    var modeOpts = modeEl.options ? Array.prototype.map.call(modeEl.options, function (o) { return o.value; }) : null;
    if (modeOpts && modeOpts.indexOf(cfg.mode) === -1) cfg.mode = 'custom'; // legacy modes map to the per-crawler editor
    modeEl.value = cfg.mode;
    if (el('botblocker-mode-desc')) el('botblocker-mode-desc').textContent = (classifier.MODES.find(function (m) { return m.id === cfg.mode; }) || {}).desc || '';
    state.paths = (cfg.paths && cfg.paths.list || []).slice();
    state.exceptions = (cfg.exceptions && cfg.exceptions.list || []).slice();
    state.overrides = Object.assign({}, cfg.overrides);
    state.customBots = (cfg.customBots || []).slice();
    if (el('botblocker-scope-entire')) el('botblocker-scope-entire').checked = cfg.paths.mode !== 'specific';
    if (el('botblocker-scope-specific')) el('botblocker-scope-specific').checked = cfg.paths.mode === 'specific';
    if (el('botblocker-exceptions-on')) el('botblocker-exceptions-on').checked = !!cfg.exceptions.enabled;
    if (el('botblocker-default-group')) el('botblocker-default-group').value = cfg.defaultGroup;
    if (el('botblocker-sitemap')) el('botblocker-sitemap').value = cfg.sitemap || '';
    for (var i = 1; i < OUTPUT_KEYS.length; i++) { var c = el('botblocker-out-' + OUTPUT_KEYS[i]); if (c) c.checked = !!cfg.outputs[OUTPUT_KEYS[i]]; }
    if (el('botblocker-rate-on')) el('botblocker-rate-on').checked = !!cfg.rateLimit.enabled;
    if (el('botblocker-rps')) el('botblocker-rps').value = cfg.rateLimit.requestsPerSecond;
    if (el('botblocker-rpm')) el('botblocker-rpm').value = cfg.rateLimit.requestsPerMinute;
    if (el('botblocker-burst')) el('botblocker-burst').value = cfg.rateLimit.burst;
    renderChips();
  }

  function renderChips() {
    var pc = el('botblocker-pathchips');
    if (pc) {
      var all = [];
      PATH_SUGGESTIONS.concat(state.paths).forEach(function (p) { if (all.indexOf(p) === -1) all.push(p); });
      pc.innerHTML = all.map(function (p) {
        var on = state.paths.indexOf(p) !== -1;
        return chip(p, on, 'data-path="' + esc(p) + '"');
      }).join('');
    }
    var ec = el('botblocker-exceptionchips');
    if (ec) {
      var allE = [];
      EXCEPTION_SUGGESTIONS.concat(state.exceptions).forEach(function (p) { if (allE.indexOf(p) === -1) allE.push(p); });
      ec.innerHTML = allE.map(function (p) {
        var on = state.exceptions.indexOf(p) !== -1;
        return chip(p, on, 'data-exc="' + esc(p) + '"');
      }).join('');
    }
  }

  /* ---------- generate + render ---------- */
  function generate() {
    var cfg = readConfig();
    state.config = cfg;
    state.report = BB.index.generate(cfg);
    render();
  }

  function regen() {
    var y = window.scrollY || 0;
    generate();
    window.scrollTo(0, y);
  }

  function panel(title, ic, inner, extraCls) {
    return '<section class="audit-panel' + (extraCls || '') + '"><h3>' + icon(ic) + ' ' + esc(title) + '</h3>' + inner + '</section>';
  }

  function actionBadge(eff) {
    if (eff === 'block') return '<span class="chip botblocker-badge is-block">' + icon('block') + ' Blocked</span>';
    if (eff === 'allow') return '<span class="chip botblocker-badge is-allow">' + icon('check') + ' Allowed</span>';
    return '<span class="chip botblocker-badge is-default">' + icon('remove') + ' Default</span>';
  }

  function render() {
    var r = state.report;
    if (!r) return;
    var html = '';

    /* profiles bar */
    html += profilesBar();

    /* security explanation */
    html += panel('Advisory control vs technical blocking', 'info', advisoryTable(), ' botblocker-security');

    /* score */
    html += '<div class="score-card"><div class="score-ring" style="--score:' + r.score.score + '"><b>' + r.score.score + '</b></div><div class="score-summary"><h2>AI Crawler Protection Score</h2><span class="source-chip">Tool-generated diagnostic score, not a Google score, not an official security score</span><p>' + esc(r.score.label) + '. Based on known-crawler coverage, rule consistency, robots.txt correctness, server-level configuration, bot-specific controls and path coverage.</p></div></div>';
    html += panel('Score breakdown', 'grading', r.score.components.map(function (c) {
      return '<div class="calc-line"><span>' + esc(c.name) + '</span><b>' + c.points + ' / ' + c.max + '</b></div><p class="muted botblocker-scorenote">' + esc(c.note) + '</p>';
    }).join(''));

    /* coverage */
    var cov = r.coverage;
    html += panel('AI Bot Coverage', 'hub',
      '<div class="audit-stats">' +
      '<div class="audit-stat"><strong>' + cov.knownAi + '</strong><span>Known AI crawlers in our database</span></div>' +
      '<div class="audit-stat"><strong>' + cov.configuredCount + '</strong><span>Explicitly configured</span></div>' +
      '<div class="audit-stat"><strong>' + cov.implicitlyCoveredCount + '</strong><span>Covered by default (*) group</span></div>' +
      '<div class="audit-stat"><strong>' + cov.notConfiguredCount + '</strong><span>Not explicitly configured</span></div>' +
      '</div><p class="muted">' + esc(cov.disclaimer) + '</p>', '');

    /* validation */
    var v = r.validation;
    var validInner = (v.productionReady
      ? '<div class="llmstxt-valid-ok">' + icon('check_circle') + ' Validated, configuration is syntactically clean and logically consistent.</div>'
      : '<div class="llmstxt-valid-bad">' + icon('error') + ' Not production-ready, fix the errors below.</div>') +
      '<div class="llmstxt-reasons">' + v.checks.map(function (c) {
        return '<span class="chip">' + icon(c.status === 'pass' ? 'check' : 'info') + ' <b>' + esc(c.name) + ':</b> ' + esc(c.message) + '</span>';
      }).join('') + '</div>';
    if (v.errors.length) validInner += '<ul class="botblocker-issues">' + v.errors.map(function (e) { return '<li class="calc-line neg">' + esc(e) + '</li>'; }).join('') + '</ul>';
    if (v.warnings.length) validInner += '<ul class="botblocker-issues">' + v.warnings.map(function (e) { return '<li class="calc-line neutral">' + esc(e) + '</li>'; }).join('') + '</ul>';
    if (v.configErrors && v.configErrors.length) validInner += '<ul class="botblocker-issues">' + v.configErrors.map(function (e) { return '<li class="calc-line neg">' + esc(e) + '</li>'; }).join('') + '</ul>';
    html += panel('Configuration Validation', 'verified', validInner, ' botblocker-validation');

    /* warnings */
    var warn = '';
    warn += '<div class="llmstxt-warn"><span class="material-icons">visibility_off</span><span><b>User-Agent spoofing:</b> any client can change its User-Agent. robots.txt = voluntary crawler control; User-Agent blocking = practical filtering; IP/network verification = stronger verification. No method here guarantees absolute protection.</span></div>';
    warn += '<div class="llmstxt-warn"><span class="material-icons">gavel</span><span><b>robots.txt does not enforce access control.</b> Compliant crawlers may respect it; malicious crawlers can ignore it. For stronger protection use server-level blocking, CDN/WAF rules, rate limiting, authentication and IP verification.</span></div>';
    for (var n = 0; n < (r.robotsNotes || []).length; n++) {
      var note = r.robotsNotes[n];
      warn += '<div class="llmstxt-warn"><span class="material-icons">' + (note.level === 'warning' ? 'warning' : 'info') + '</span><span>' + (note.bot ? '<b>' + esc(note.bot) + ':</b> ' : '') + esc(note.message) + '</span></div>';
    }
    html += '<div class="paper paper-padded llmstxt-warnings">' + warn + '</div>';

    /* config tabs */
    html += renderTabs(r);

    /* export */
    var exp = renderExport(r);
    html += exp.html;

    /* rate control */
    if (r.config.rateLimit.enabled) {
      html += panel('AI Crawler Rate Control', 'speed',
        '<div class="audit-stats">' +
        '<div class="audit-stat"><strong>' + esc(r.config.rateLimit.requestsPerMinute) + '</strong><span>Requests / minute (recommendation)</span></div>' +
        '<div class="audit-stat"><strong>' + esc(r.config.rateLimit.requestsPerSecond) + '</strong><span>Requests / second (recommendation)</span></div>' +
        '<div class="audit-stat"><strong>' + esc(r.config.rateLimit.burst) + '</strong><span>Burst limit (recommendation)</span></div>' +
        '</div><p class="muted">These values are embedded as commented recommendations in the generated server configurations. Rate limiting is sometimes preferable to outright blocking, it keeps AI visibility while controlling load. Tune to your real traffic before enabling; the tool never generates unsafe server configurations.</p>');
    }

    /* bot table */
    html += renderBotTable(r);

    /* simulator */
    html += renderSimulator(r);

    /* existing robots.txt analyzer + compare */
    html += renderExisting();

    /* live checker */
    html += renderLive();

    out.innerHTML = html;
    wire();
  }

  function advisoryTable() {
    return '<div class="botblocker-advisory">' +
      '<div class="botblocker-advisory-col"><h4>' + icon('description') + ' Advisory control, robots.txt</h4><p>Requests compliant crawlers not to access these paths. Well-behaved AI crawlers usually honor it; malicious ones can ignore it. This tool never claims “robots.txt will completely block AI bots”.</p></div>' +
      '<div class="botblocker-advisory-col"><h4>' + icon('dns') + ' Technical blocking, server / CDN</h4><p>Nginx, Apache, Cloudflare WAF, CDN rules, application middleware and firewall rules reject requests at server level (403). Stronger enforcement, but User-Agent values can still be spoofed, so combine with IP verification where available.</p></div>' +
      '</div>';
  }

  /* ---------- profiles ---------- */
  var LS_KEY = 'huvanti-botblocker-profiles';
  function loadProfiles() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function storeProfiles(p) { try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch (e) { toast('Local storage unavailable, profiles kept for this session only.'); } }
  function profilesBar() {
    var profiles = loadProfiles();
    var names = Object.keys(profiles);
    return '<div class="paper paper-padded botblocker-profiles"><h3>' + icon('folder') + ' Configuration Profiles <small class="muted">(stored only in this browser, no account, nothing sent anywhere)</small></h3>' +
      '<div class="botblocker-profile-row">' +
      '<input type="text" id="botblocker-profilename" class="text-input botblocker-inline-profile" placeholder="Profile name (e.g. Strict, Training Only, Search Only, Custom)" maxlength="40">' +
      '<button type="button" class="btn" id="botblocker-profile-save">' + icon('save') + ' Save current</button>' +
      '<select id="botblocker-profile-load" class="select botblocker-profile-select">' + (names.length ? names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('') : '<option value="">No saved profiles</option>') + '</select>' +
      '<button type="button" class="btn" id="botblocker-profile-loadbtn" ' + (names.length ? '' : 'disabled') + '>' + icon('upload') + ' Load</button>' +
      '<button type="button" class="btn" id="botblocker-profile-del" ' + (names.length ? '' : 'disabled') + '>' + icon('delete') + ' Delete</button>' +
      '<button type="button" class="btn" id="botblocker-profile-export">' + icon('download') + ' Export JSON</button>' +
      '<label class="btn botblocker-importbtn">' + icon('upload_file') + ' Import JSON<input type="file" id="botblocker-profile-import" accept="application/json,.json" hidden></label>' +
      '</div></div>';
  }

  /* ---------- tabs ---------- */
  function tabOrder(key) {
    var order = ['robots', 'nginx', 'apache', 'cloudflare', 'node', 'php', 'laravel'];
    return order.indexOf(key);
  }
  function renderTabs(r) {
    var keys = Object.keys(r.outputs).sort(function (a, b) { return tabOrder(a) - tabOrder(b); });
    if (!keys.length) return '';
    if (!state.activeTab || keys.indexOf(state.activeTab) === -1) state.activeTab = keys[0];
    var tabs = keys.map(function (k) {
      return '<button type="button" class="' + (state.activeTab === k ? 'active' : '') + '" data-tab="' + esc(k) + '">' + esc(r.outputs[k].label) + '</button>';
    }).join('');
    var k = state.activeTab, o = r.outputs[k];
    var ext = { robots: 'robots.txt', nginx: 'nginx-ai-bots.conf', apache: '.htaccess', cloudflare: 'cloudflare-waf-rule.txt', node: 'ai-bot-blocker.js', php: 'ai-bot-blocker.php', laravel: 'BlockAiBots.php' }[k];
    var inner =
      '<div class="botblocker-tabbar-head"><div class="tabs botblocker-tabs">' + tabs + '</div>' +
      '<div class="report-actions">' +
      '<button type="button" class="btn" id="botblocker-copy">' + icon('content_copy') + ' Copy</button>' +
      '<button type="button" class="btn" id="botblocker-download">' + icon('download') + ' Download ' + esc(ext) + '</button>' +
      '</div></div>' +
      '<pre class="botblocker-code" id="botblocker-codetext">' + esc(o.text) + '</pre>' +
      '<div class="botblocker-install"><b>' + icon('build') + ' Installation, ' + esc(o.label) + '</b>' +
      '<ul class="llmstxt-install">' + (o.placement || []).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' +
      '<p class="muted">This tool generates configuration, it never installs anything on your server.</p></div>';
    return panel('Generated Configuration', 'code', inner, ' botblocker-configtabs');
  }

  /* ---------- export ---------- */
  function renderExport(r) {
    var keys = Object.keys(r.outputs).sort(function (a, b) { return tabOrder(a) - tabOrder(b); });
    var files = {
      robots: ['robots.txt', r.outputs.robots ? r.outputs.robots.text : ''],
      nginx: ['nginx-ai-bots.conf', r.outputs.nginx ? r.outputs.nginx.text : ''],
      apache: ['.htaccess', r.outputs.apache ? r.outputs.apache.text : ''],
      cloudflare: ['cloudflare-waf-rule.txt', r.outputs.cloudflare ? r.outputs.cloudflare.text : ''],
      node: ['ai-bot-blocker.js', r.outputs.node ? r.outputs.node.text : ''],
      php: ['ai-bot-blocker.php', r.outputs.php ? r.outputs.php.text : ''],
      laravel: ['BlockAiBots.php', r.outputs.laravel ? r.outputs.laravel.text : '']
    };
    var buttons = keys.map(function (k) {
      return '<button type="button" class="btn" data-dl="' + esc(k) + '">' + icon('download') + ' ' + esc(OUTPUT_LABELS[k]) + ' (' + esc(files[k][0]) + ')</button>';
    }).join('');
    var inner = '<div class="report-actions">' + buttons +
      '<button type="button" class="btn" id="botblocker-dl-json">' + icon('data_object') + ' JSON configuration</button>' +
      '<button type="button" class="btn" id="botblocker-dl-all">' + icon('download_done') + ' Download All (selected formats only)</button>' +
      '</div><p class="muted">“Download All” bundles only the formats you selected, nothing else. The JSON configuration reproduces this exact setup (import it from the Profiles panel later).</p>';
    return { html: panel('Export', 'save_alt', inner), files: files };
  }

  /* ---------- bot table ---------- */
  function passesFilter(b) {
    if (state.filter === 'all') return true;
    if (state.filter === 'assistant') return b.category === 'user' || b.category === 'retrieval';
    return b.category === state.filter;
  }
  function passesSearch(b, s) {
    if (!s) return true;
    var q = s.toLowerCase();
    return b.name.toLowerCase().indexOf(q) !== -1 ||
      b.token.toLowerCase().indexOf(q) !== -1 ||
      b.organization.toLowerCase().indexOf(q) !== -1 ||
      (b.userAgents || []).some(function (u) { return u.toLowerCase().indexOf(q) !== -1; });
  }
  function renderBotTable(r) {
    var filters = [['all', 'All'], ['training', 'Training'], ['search', 'Search'], ['retrieval', 'Retrieval'], ['assistant', 'Assistant'], ['extraction', 'Extraction'], ['other', 'Other']];
    var rows = r.resolved.filter(function (x) { return passesFilter(x.bot) && passesSearch(x.bot, state.search); });
    var tableRows = rows.map(function (x) {
      var b = x.bot;
      var cur = x.action; // allow | block | default
      var seg = '<div class="botblocker-seg" role="group" aria-label="Action for ' + esc(b.name) + '">' +
        ['allow', 'block', 'default'].map(function (a) {
          var on = cur === a;
          return '<button type="button" class="botblocker-segbtn bb-' + a + (on ? ' is-on' : '') + '" data-bot="' + esc(b.id) + '" data-action="' + a + '" aria-pressed="' + on + '">' + (a === 'allow' ? 'Allow' : a === 'block' ? 'Block' : 'Default') + '</button>';
        }).join('') + '</div>';
      return '<tr class="bb-row" data-botrow="' + esc(b.id) + '">' +
        '<td><b>' + esc(b.name) + '</b>' + (b.deprecated ? ' <span class="chip">legacy</span>' : '') + (b.custom ? ' <span class="chip">custom</span>' : '') + '<div class="botblocker-ua">' + esc(b.userAgents && b.userAgents[0] ? b.userAgents[0] : 'token: ' + b.token) + '</div></td>' +
        '<td>' + esc(b.organization) + '</td>' +
        '<td><span class="chip">' + esc(db.CATEGORY_LABELS[b.category] || b.category) + '</span></td>' +
        '<td class="botblocker-purpose">' + esc(b.purpose) + '</td>' +
        '<td>' + actionBadge(x.effective) + (x.source === 'preset' ? '<div class="muted botblocker-src">preset</div>' : x.source === 'override' ? '<div class="muted botblocker-src">your override</div>' : '<div class="muted botblocker-src">custom entry</div>') + '</td>' +
        '<td>' + seg + '</td></tr>';
    }).join('');

    var cards = rows.map(function (x) {
      var b = x.bot;
      var cur = x.action;
      var seg = '<div class="botblocker-seg">' + ['allow', 'block', 'default'].map(function (a) {
        return '<button type="button" class="botblocker-segbtn bb-' + a + (cur === a ? ' is-on' : '') + '" data-bot="' + esc(b.id) + '" data-action="' + a + '">' + (a === 'allow' ? 'Allow' : a === 'block' ? 'Block' : 'Default') + '</button>';
      }).join('') + '</div>';
      return '<div class="card bl-card botblocker-card" data-botrow="' + esc(b.id) + '"><div class="card-content">' +
        '<div class="bl-card-head"><b>' + esc(b.name) + '</b><span class="chip">' + esc(db.CATEGORY_LABELS[b.category] || b.category) + '</span></div>' +
        '<div class="calc-line"><span>Organization</span><b>' + esc(b.organization) + '</b></div>' +
        '<div class="calc-line"><span>Purpose</span><b>' + esc(b.purpose.length > 140 ? b.purpose.slice(0, 140) + '…' : b.purpose) + '</b></div>' +
        '<div class="calc-line"><span>Status</span><b>' + (x.effective === 'block' ? 'Blocked' : x.effective === 'allow' ? 'Allowed' : 'Default') + '</b></div>' +
        seg + '</div></div>';
    }).join('');

    var customList = state.customBots.map(function (cb, idx) {
      return '<span class="chip">' + esc(cb.name) + ' (' + esc(cb.token) + ') <button type="button" class="botblocker-mini" data-delcustom="' + idx + '" aria-label="Remove ' + esc(cb.name) + '">&times;</button></span>';
    }).join(' ');

    var inner =
      '<div class="botblocker-tablehead">' +
      '<input type="search" id="botblocker-search" class="text-input botblocker-search" placeholder="Search bot name, User-Agent or organization…" value="' + esc(state.search) + '">' +
      '<div class="tabs">' + filters.map(function (f) {
        return '<button type="button" class="' + (state.filter === f[0] ? 'active' : '') + '" data-filter="' + f[0] + '">' + f[1] + '</button>';
      }).join('') + '</div></div>' +
      '<div class="page-table-wrap botblocker-tablewrap"><table class="mini-table botblocker-table"><thead><tr><th>Bot</th><th>Organization</th><th>Category</th><th>Purpose</th><th>Default</th><th>Action</th></tr></thead><tbody>' + tableRows + '</tbody></table></div>' +
      '<div class="botblocker-cards">' + cards + '</div>' +
      '<p class="muted">Click a row for full details (documentation, robots.txt support, verification notes, confidence, last verified). “Default” = no explicit rule, the crawler follows the default (*) group or is allowed when nothing matches.</p>' +
      '<details class="botblocker-custombox"><summary>' + icon('add') + ' Add a custom bot</summary>' +
      '<div class="botblocker-customform">' +
      '<input type="text" id="botblocker-custom-name" class="text-input" placeholder="Bot name (e.g. MyCorpBot)">' +
      '<input type="text" id="botblocker-custom-token" class="text-input" placeholder="User-Agent token (exact product token)">' +
      '<input type="text" id="botblocker-custom-org" class="text-input" placeholder="Organization (optional)">' +
      '<select id="botblocker-custom-cat" class="select">' + db.CATEGORY_ORDER.map(function (c) { return '<option value="' + c + '">' + esc(db.CATEGORY_LABELS[c]) + '</option>'; }).join('') + '</select>' +
      '<select id="botblocker-custom-action" class="select"><option value="block">Block</option><option value="allow">Allow</option><option value="default">Default</option></select>' +
      '<button type="button" class="btn" id="botblocker-custom-add">' + icon('add_circle') + ' Add bot</button>' +
      '</div><div id="botblocker-custom-warn" class="botblocker-customwarn"></div>' +
      (customList ? '<div class="botblocker-customlist"><b>Custom bots:</b> ' + customList + '</div>' : '') +
      '<p class="muted">Custom User-Agent rules may produce false positives if the pattern is too broad, the tool validates tokens and rejects generic words like “AI” or “bot”.</p>' +
      '</details>';

    var detail = '<div id="botblocker-botdetail" class="botblocker-detail"></div>';
    return panel('Bot Database, ' + db.stats().total + ' known crawlers (v' + db.DB_VERSION + ')', 'smart_toy', inner + detail, ' botblocker-botdb');
  }

  function botDetailHtml(res) {
    var b = res.bot;
    var robotsLabels = {
      'documented-yes': 'Documented: follows robots.txt',
      'documented-partial': 'Documented: partial / conditional',
      'documented-no': 'Documented: does not generally follow robots.txt',
      'reported-mixed': 'Reported inconsistently (no reliable documentation)',
      'unknown': 'Unknown, no reliable documentation'
    };
    return '<div class="paper paper-padded botblocker-detailbox" id="botblocker-detailbox">' +
      '<div class="botblocker-detailhead"><h4>' + esc(b.name) + '</h4><button type="button" class="btn botblocker-mini" id="botblocker-detail-close">' + icon('close') + ' Close</button></div>' +
      '<div class="calc-line"><span>Bot name</span><b>' + esc(b.name) + '</b></div>' +
      '<div class="calc-line"><span>User-Agent token</span><b class="botblocker-ua">' + esc(b.token) + '</b></div>' +
      (b.userAgents && b.userAgents.length ? '<div class="calc-line"><span>Example User-Agent</span><b class="botblocker-ua">' + esc(b.userAgents[0]) + '</b></div>' : '') +
      '<div class="calc-line"><span>Organization</span><b>' + esc(b.organization) + '</b></div>' +
      '<div class="calc-line"><span>Category</span><b>' + esc(db.CATEGORY_LABELS[b.category] || b.category) + '</b></div>' +
      '<div class="calc-line"><span>Purpose</span><b>' + esc(b.purpose) + '</b></div>' +
      '<div class="calc-line"><span>Recommended action</span><b>' + esc(b.recommended === 'block' ? 'Block' : b.recommended === 'allow' ? 'Allow' : 'Your choice (Default)') + '</b></div>' +
      '<div class="calc-line"><span>robots.txt support</span><b>' + esc(robotsLabels[b.robotsSupport] || b.robotsSupport) + '</b></div>' +
      '<div class="calc-line"><span>Technical blocking</span><b>' + esc(b.technicalBlockingNotes) + '</b></div>' +
      '<div class="calc-line"><span>Verification notes</span><b>' + esc(b.verificationNotes) + '</b></div>' +
      '<div class="calc-line"><span>Official documentation</span><b>' + (b.officialDocumentation ? '<a class="botblocker-link" href="' + esc(b.officialDocumentation) + '" target="_blank" rel="noopener noreferrer">' + esc(b.officialDocumentation) + '</a>' : 'No official documentation found, kept as “unverified/low confidence” rather than guessing.') + '</b></div>' +
      '<div class="calc-line"><span>Database last updated</span><b>' + (b.lastVerified ? esc(b.lastVerified) : 'unverified custom entry') + '</b></div>' +
      '<div class="calc-line"><span>Confidence</span><b>' + esc(b.confidence) + '</b></div>' +
      '<div class="calc-line"><span>Current action</span><b>' + (res.effective === 'block' ? 'Blocked' : res.effective === 'allow' ? 'Allowed' : 'Default') + (res.source === 'override' || res.source === 'custom' ? ' (your setting)' : ' (preset)') + '</b></div>' +
      '</div>';
  }

  /* ---------- simulator ---------- */
  function renderSimulator(r) {
    var bots = r.resolved.map(function (x) { return x.bot; });
    var options = bots.map(function (b) {
      return '<option value="' + esc(b.token) + '"' + (state.simBot === b.token ? ' selected' : '') + '>' + esc(b.name) + ' (' + esc(b.token) + ')</option>';
    }).join('');
    var inner =
      '<div class="botblocker-simrow">' +
      '<select id="botblocker-sim-bot" class="select">' + options + '</select>' +
      '<input type="text" id="botblocker-sim-custom" class="text-input" placeholder="…or a custom User-Agent token">' +
      '<input type="text" id="botblocker-sim-path" class="text-input" value="/blog/example-page" placeholder="Path or URL, e.g. /blog/example-page">' +
      '<button type="button" class="btn" id="botblocker-sim-run">' + icon('play_arrow') + ' Test access</button>' +
      '</div>' +
      '<label class="botblocker-simsrc"><input type="radio" name="botblocker-sim-src" value="generated" checked> Test the generated rules</label>' +
      '<label class="botblocker-simsrc"><input type="radio" name="botblocker-sim-src" value="existing"' + (state.existing.parsed ? '' : ' disabled') + '> Test the pasted existing robots.txt' + (state.existing.parsed ? '' : ' (paste one below first)') + '</label>' +
      '<div id="botblocker-sim-result"></div>' +
      '<p class="muted">Deterministic rules simulator: exact User-agent group selection, wildcard (*) fallback, longest-pattern precedence and Allow tie-breaking, the same logic major crawlers document. It simulates robots.txt behavior only; it cannot prove what a real crawler does.</p>';
    return panel('Bot Access Simulator', 'science', inner, ' botblocker-simulator');
  }

  function runSim() {
    var customTok = (el('botblocker-sim-custom').value || '').trim();
    var token = customTok || el('botblocker-sim-bot').value || 'GPTBot';
    state.simBot = token;
    var path = (el('botblocker-sim-path').value || '/').trim() || '/';
    var srcRadio = document.querySelector('input[name="botblocker-sim-src"]:checked');
    var src = srcRadio ? srcRadio.value : 'generated';
    if (src === 'existing' && !state.existing.parsed) {
      el('botblocker-sim-result').innerHTML = '<p class="calc-line neutral">Analyze the pasted robots.txt below first, then it can be selected as the simulation source.</p>';
      return;
    }
    var parsed = src === 'existing' ? state.existing.parsed : state.report.parsed;
    var res = simulator.check(parsed, token, path);
    var known = db.byToken(token);
    var cls = res.verdict === 'blocked' ? 'is-blocked' : res.verdict === 'allowed' ? 'is-allowed' : 'is-uncertain';
    var label = res.verdict === 'blocked' ? 'BLOCKED' : res.verdict === 'allowed' ? 'ALLOWED' : 'UNCERTAIN';
    var html = '<div class="botblocker-simresult ' + cls + '"><div class="botblocker-simverdict">' + icon(res.verdict === 'blocked' ? 'block' : res.verdict === 'allowed' ? 'check_circle' : 'help_outline') +
      ' ' + esc(token) + ' → ' + label + '</div>' +
      '<div class="botblocker-simmeta"><b>Path:</b> <span class="botblocker-ua">' + esc(res.path) + '</span>' +
      (known ? ' · <b>Known crawler:</b> ' + esc(known.name) + ' (' + esc(known.organization) + ')' : ' · <b>Not in the database</b>') +
      (res.rule ? ' · <b>Rule:</b> <span class="botblocker-ua">' + esc(res.rule.type + ': ' + res.rule.path) + '</span>' : '') + '</div>' +
      '<div class="botblocker-simreason"><b>Reason:</b> ' + esc(res.reason) + '</div>' +
      '<details open class="botblocker-simexp"><summary>' + icon('rule') + ' Why (matching logic)</summary><ul>' +
      res.explanation.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul></details></div>';
    el('botblocker-sim-result').innerHTML = html;
  }

  /* ---------- existing robots.txt analyzer + compare ---------- */
  function renderExisting() {
    var inner =
      '<div class="botblocker-simrow">' +
      '<input type="text" id="botblocker-existing-url" class="text-input" placeholder="https://example.com/robots.txt">' +
      '<button type="button" class="btn" id="botblocker-existing-fetch">' + icon('cloud_download') + ' Fetch (external request)</button>' +
      '<button type="button" class="btn" id="botblocker-existing-analyze">' + icon('manage_search') + ' Analyze pasted text</button>' +
      '</div>' +
      '<textarea id="botblocker-existing-text" class="text-input botblocker-textarea" placeholder="Paste your current robots.txt here, or fetch it by URL…">' + esc(state.existing.text || '') + '</textarea>' +
      '<div id="botblocker-existing-result"></div>' +
      '<p class="muted">Fetching makes one external request to the URL you enter (robots.txt only, size- and time-limited). Nothing is stored server-side. The analyzer checks syntax, User-agent groups, Allow/Disallow, Sitemap, conflicts, duplicates, unreachable rules and potentially unintended blocking.</p>';
    return panel('Test Existing robots.txt', 'fact_check', inner, ' botblocker-existing');
  }

  function analyzeExisting() {
    var text = el('botblocker-existing-text').value || '';
    if (!text.trim()) { el('botblocker-existing-result').innerHTML = '<p class="calc-line neg">Paste a robots.txt or fetch one first.</p>'; return; }
    var parsed = parser.parse(text);
    var cf = conflicts.analyze(parsed);
    state.existing = { text: text, parsed: parsed, analyzed: true };
    var html =
      '<div class="audit-stats">' +
      '<div class="audit-stat"><strong>' + parsed.stats.groups + '</strong><span>User-agent groups</span></div>' +
      '<div class="audit-stat"><strong>' + parsed.stats.rules + '</strong><span>Allow/Disallow rules</span></div>' +
      '<div class="audit-stat"><strong>' + parsed.stats.sitemaps + '</strong><span>Sitemaps</span></div>' +
      '<div class="audit-stat ' + (parsed.errors.length ? 's-critical' : parsed.warnings.length ? 's-warning' : 's-pass') + '"><strong>' + (parsed.errors.length + parsed.warnings.length) + '</strong><span>Issues found</span></div>' +
      '</div>';
    var issues = parsed.errors.map(function (e) { return ['bad', 'Line ' + e.line + ': ' + e.message]; })
      .concat(parsed.warnings.map(function (w) { return ['warn', 'Line ' + w.line + ': ' + w.message]; }))
      .concat(cf.issues.map(function (i) { return [i.level === 'error' ? 'bad' : i.level === 'warning' ? 'warn' : 'info', i.title + ', ' + i.detail]; }));
    if (issues.length) html += '<ul class="botblocker-issues">' + issues.map(function (x) { return '<li class="calc-line ' + (x[0] === 'bad' ? 'neg' : x[0] === 'warn' ? 'neutral' : '') + '">' + esc(x[1]) + '</li>'; }).join('') + '</ul>';
    else html += '<p class="calc-line pos">No syntax errors, conflicts or warnings detected.</p>';

    if (state.report) {
      var diff = conflicts.compare(parsed, state.report.parsed);
      html += '<div class="botblocker-diff"><h4>' + icon('difference') + ' Compare: your existing robots.txt vs the generated configuration</h4>' +
        '<div class="audit-stats">' +
        '<div class="audit-stat s-pass"><strong>' + diff.added.length + '</strong><span>Added rules</span></div>' +
        '<div class="audit-stat s-critical"><strong>' + diff.removed.length + '</strong><span>Removed rules</span></div>' +
        '<div class="audit-stat s-warning"><strong>' + diff.changed.length + '</strong><span>Groups with changed rule counts</span></div>' +
        '</div>';
      if (diff.added.length) html += '<p class="calc-line pos"><b>Added:</b> ' + diff.added.slice(0, 30).map(function (d) { return esc(d.agent + ' → ' + d.rule); }).join(' · ') + '</p>';
      if (diff.removed.length) html += '<p class="calc-line neg"><b>Removed:</b> ' + diff.removed.slice(0, 30).map(function (d) { return esc(d.agent + ' → ' + d.rule); }).join(' · ') + '</p>';
      if (diff.changed.length) html += '<p class="calc-line neutral"><b>Changed:</b> ' + diff.changed.slice(0, 30).map(function (d) { return esc(d.agent + ' (' + d.before + ' → ' + d.after + ' rules)'); }).join(' · ') + '</p>';
      html += '</div>';
    }
    html += '<p class="muted">The pasted file is now also selectable as a source in the Bot Access Simulator above. Test bots and paths (e.g. GPTBot → /articles/test) to see exactly which rule decides the outcome.</p>';
    el('botblocker-existing-result').innerHTML = html;
    // refresh simulator radio availability
    var rad = document.querySelector('input[name="botblocker-sim-src"][value="existing"]');
    if (rad) { rad.disabled = false; rad.parentNode.classList.remove('muted'); }
  }

  /* ---------- live checker ---------- */
  function renderLive() {
    var inner =
      '<div class="botblocker-simrow">' +
      '<input type="text" id="botblocker-live-url" class="text-input" placeholder="https://example.com" value="' + esc(state.config ? state.config.website : '') + '">' +
      '<button type="button" class="btn" id="botblocker-live-run">' + icon('radar') + ' Check current protection</button>' +
      '</div>' +
      '<div id="botblocker-live-result"><p class="muted">This makes one external request to the site you enter (robots.txt + homepage) from our server, with strict limits. The checker reports evidence only, it never claims a crawler is technically blocked unless a technical control was actually observed (robots.txt is not one).</p></div>';
    return panel('Live Website Checker (optional)', 'travel_explore', inner, ' botblocker-live');
  }

  function runLive() {
    var url = (el('botblocker-live-url').value || '').trim();
    var box = el('botblocker-live-result');
    if (!url) { box.innerHTML = '<p class="calc-line neg">Enter a URL to check.</p>'; return; }
    box.innerHTML = '<p class="muted">' + icon('autorenew') + ' Fetching robots.txt and homepage for ' + esc(url) + '…</p>';
    fetch('/api/botblocker-inspect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: url })
    }).then(function (res) { return res.json(); }).then(function (data) {
      if (!data.ok) { box.innerHTML = '<p class="calc-line neg">' + icon('error_outline') + ' ' + esc(data.message || 'The check could not be completed.') + '</p>'; return; }
      state.liveReport = data.report;
      var rep = data.report;
      var html = rep.sections.map(function (s) {
        return '<h4>' + esc(s.title) + '</h4><ul class="botblocker-issues">' + s.items.map(function (it) {
          var ic = it.status === 'ok' ? 'check_circle' : it.status === 'warn' ? 'warning' : it.status === 'bad' ? 'error' : 'info';
          var cls = it.status === 'ok' ? 'pos' : it.status === 'warn' || it.status === 'bad' ? 'neg' : 'neutral';
          return '<li class="calc-line ' + cls + '"><span class="material-icons botblocker-li-ic">' + ic + '</span><span>' + esc(it.text) + '</span></li>';
        }).join('') + '</ul>';
      }).join('');
      html += '<p class="muted">' + esc(rep.disclaimer) + '</p>';
      if (rep.robotsBody) {
        html += '<button type="button" class="btn" id="botblocker-live-userobots">' + icon('input') + ' Load this robots.txt into the analyzer above</button>';
      }
      box.innerHTML = html;
      var b = el('botblocker-live-userobots');
      if (b) b.onclick = function () {
        var ta = el('botblocker-existing-text');
        if (ta) { ta.value = rep.robotsBody; analyzeExisting(); ta.scrollIntoView({ behavior: 'smooth' }); }
      };
    }).catch(function (e) {
      box.innerHTML = '<p class="calc-line neg">Request failed: ' + esc(e && e.message || 'network error') + '. If this environment has no direct outbound access, the server-side check may be unavailable, paste the robots.txt instead.</p>';
    });
  }

  /* ---------- wire events after render ---------- */
  function wire() {
    var r = state.report;

    // tabs
    var tabBtns = out.querySelectorAll('[data-tab]');
    for (var i = 0; i < tabBtns.length; i++) tabBtns[i].onclick = function () { state.activeTab = this.getAttribute('data-tab'); render(); };
    var cp = el('botblocker-copy'), dl = el('botblocker-download');
    if (cp) cp.onclick = function () { var k = state.activeTab; copy(r.outputs[k].text); };
    if (dl) dl.onclick = function () {
      var k = state.activeTab;
      var ext = { robots: 'robots.txt', nginx: 'nginx-ai-bots.conf', apache: '.htaccess', cloudflare: 'cloudflare-waf-rule.txt', node: 'ai-bot-blocker.js', php: 'ai-bot-blocker.php', laravel: 'BlockAiBots.php' }[k];
      download(ext, r.outputs[k].text);
    };

    // export panel buttons
    var dlBtns = out.querySelectorAll('[data-dl]');
    for (var j = 0; j < dlBtns.length; j++) dlBtns[j].onclick = function () {
      var k = this.getAttribute('data-dl');
      var files = { robots: ['robots.txt', 'text/plain'], nginx: ['nginx-ai-bots.conf', 'text/plain'], apache: ['.htaccess', 'text/plain'], cloudflare: ['cloudflare-waf-rule.txt', 'text/plain'], node: ['ai-bot-blocker.js', 'text/javascript'], php: ['ai-bot-blocker.php', 'text/plain'], laravel: ['BlockAiBots.php', 'text/plain'] };
      download(files[k][0], r.outputs[k].text, files[k][1]);
    };
    var dj = el('botblocker-dl-json');
    if (dj) dj.onclick = function () {
      download('ai-crawler-blocker-config.json', JSON.stringify({ tool: 'huvanti AI Crawler & LLM Bot Blocker', databaseVersion: db.DB_VERSION, generatedAt: new Date().toISOString(), config: r.config }, null, 2), 'application/json');
    };
    var da = el('botblocker-dl-all');
    if (da) da.onclick = function () {
      var names = { robots: 'robots.txt', nginx: 'nginx-ai-bots.conf', apache: '.htaccess', cloudflare: 'cloudflare-waf-rule.txt', node: 'ai-bot-blocker.js', php: 'ai-bot-blocker.php', laravel: 'BlockAiBots.php' };
      Object.keys(r.outputs).forEach(function (k, idx) {
        setTimeout(function () { download(names[k], r.outputs[k].text); }, idx * 400);
      });
    };

    // bot table: segmented actions
    var segs = out.querySelectorAll('[data-action]');
    for (var s = 0; s < segs.length; s++) segs[s].onclick = function (ev) {
      ev.stopPropagation();
      var id = this.getAttribute('data-bot'), action = this.getAttribute('data-action');
      if (action === 'default') delete state.overrides[id]; else state.overrides[id] = action;
      regen();
    };

    // bot table: row click → detail
    var rows = out.querySelectorAll('[data-botrow]');
    for (var w = 0; w < rows.length; w++) rows[w].onclick = function () {
      var id = this.getAttribute('data-botrow');
      var res = state.report.resolved.find(function (x) { return x.bot.id === id; });
      var box = el('botblocker-botdetail');
      if (box && res) {
        box.innerHTML = botDetailHtml(res);
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        var c = el('botblocker-detail-close');
        if (c) c.onclick = function () { box.innerHTML = ''; };
      }
    };

    // filter + search
    var fbtns = out.querySelectorAll('[data-filter]');
    for (var f = 0; f < fbtns.length; f++) fbtns[f].onclick = function () { state.filter = this.getAttribute('data-filter'); regen(); };
    var si = el('botblocker-search');
    if (si) si.oninput = function () { state.search = this.value; var y = window.scrollY; render(); window.scrollTo(0, y); this.focus(); };

    // custom bots
    var ca = el('botblocker-custom-add');
    if (ca) ca.onclick = function () {
      var name = (el('botblocker-custom-name').value || '').trim();
      var token = (el('botblocker-custom-token').value || '').trim();
      var org = (el('botblocker-custom-org').value || '').trim() || 'Custom';
      var cat = el('botblocker-custom-cat').value;
      var action = el('botblocker-custom-action').value;
      var warnBox = el('botblocker-custom-warn');
      if (db.byToken(token)) { warnBox.innerHTML = '<p class="calc-line neg">“' + esc(token) + '” already exists in the database, set its action in the table instead of adding a duplicate.</p>'; return; }
      var v = matcher.validateToken(token);
      if (!v.ok) { warnBox.innerHTML = '<p class="calc-line neg">' + v.errors.map(esc).join(' ') + '</p>'; return; }
      state.customBots.push({ id: 'custom-' + token.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: name || token, token: token, organization: org, category: cat, action: action });
      warnBox.innerHTML = v.warnings.length ? '<p class="calc-line neutral">' + v.warnings.map(esc).join(' ') + '</p>' : '';
      regen();
    };
    var dels = out.querySelectorAll('[data-delcustom]');
    for (var d = 0; d < dels.length; d++) dels[d].onclick = function (ev) {
      ev.stopPropagation();
      state.customBots.splice(parseInt(this.getAttribute('data-delcustom'), 10), 1);
      regen();
    };

    // simulator
    var run = el('botblocker-sim-run');
    if (run) run.onclick = runSim;

    // existing robots.txt
    var ta = el('botblocker-existing-text');
    if (ta) ta.oninput = function () {
      state.existing.text = this.value;
      state.existing.parsed = null; // pasted rules changed, require re-analysis before simulating
    };
    var an = el('botblocker-existing-analyze');
    if (an) an.onclick = analyzeExisting;
    var fe = el('botblocker-existing-fetch');
    if (fe) fe.onclick = function () {
      var url = (el('botblocker-existing-url').value || '').trim();
      var ta = el('botblocker-existing-text');
      if (!url) { ta.value = ''; analyzeExisting(); return; }
      ta.value = 'Fetching ' + url + ' …';
      fetch('/api/botblocker-inspect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: url }) })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data.ok) { ta.value = ''; toast('Fetch failed: ' + (data.message || 'unreachable')); return; }
          ta.value = data.report.robotsBody || '';
          if (!data.report.robotsBody) { ta.value = ''; toast('robots.txt not readable (' + (data.report.robotsFetchError || 'no body') + ')'); return; }
          analyzeExisting();
        })
        .catch(function (e) { ta.value = ''; toast('Fetch failed: ' + (e && e.message || 'network error')); });
    };

    // live checker
    var lr = el('botblocker-live-run');
    if (lr) lr.onclick = runLive;

    // profiles
    var ps = el('botblocker-profile-save');
    if (ps) ps.onclick = function () {
      var name = (el('botblocker-profilename').value || '').trim();
      if (!name) { toast('Enter a profile name first'); return; }
      var profiles = loadProfiles();
      profiles[name] = readConfig();
      storeProfiles(profiles);
      toast('Profile saved in this browser');
      regen();
    };
    var pl = el('botblocker-profile-loadbtn');
    if (pl) pl.onclick = function () {
      var sel = el('botblocker-profile-load');
      var name = sel.value;
      var profiles = loadProfiles();
      if (!name || !profiles[name]) { toast('No profile selected'); return; }
      writeConfig(profiles[name]);
      toast('Profile loaded');
      regen();
    };
    var pd = el('botblocker-profile-del');
    if (pd) pd.onclick = function () {
      var sel = el('botblocker-profile-load');
      var name = sel.value;
      var profiles = loadProfiles();
      if (name && profiles[name]) { delete profiles[name]; storeProfiles(profiles); toast('Profile deleted'); }
      regen();
    };
    var pe = el('botblocker-profile-export');
    if (pe) pe.onclick = function () {
      download('ai-crawler-blocker-profiles.json', JSON.stringify(loadProfiles(), null, 2), 'application/json');
    };
    var pi = el('botblocker-profile-import');
    if (pi) pi.onchange = function () {
      var file = this.files && this.files[0];
      if (!file) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var data = JSON.parse(String(fr.result));
          if (data && data.config && data.config.mode) data = { imported: data.config };
          var profiles = loadProfiles();
          Object.keys(data).forEach(function (k) { if (data[k] && data[k].mode) profiles[k] = data[k]; });
          storeProfiles(profiles);
          toast('Profiles imported');
          regen();
        } catch (e) { toast('Invalid profile file'); }
      };
      fr.readAsText(file);
    };
  }

  /* ---------- form events (page-level, wired once) ---------- */
  form.addEventListener('submit', function (e) { e.preventDefault(); generate(); window.scrollTo({ top: out.offsetTop - 90, behavior: 'smooth' }); });
  var modeSel = el('botblocker-mode');
  if (modeSel) modeSel.addEventListener('change', function () {
    var m = classifier.MODES.find(function (x) { return x.id === modeSel.value; });
    if (el('botblocker-mode-desc') && m) el('botblocker-mode-desc').textContent = m.desc;
    if (state.report) regen();
  });
  var wireChange = function (id, fn) { var e = el(id); if (e) e.addEventListener('change', function () { fn(); if (state.report) regen(); }); };
  wireChange('botblocker-url', function () { });
  ['botblocker-scope-entire', 'botblocker-scope-specific', 'botblocker-exceptions-on', 'botblocker-default-group', 'botblocker-out-nginx', 'botblocker-out-apache', 'botblocker-out-cloudflare', 'botblocker-out-node', 'botblocker-out-php', 'botblocker-out-laravel', 'botblocker-rate-on', 'botblocker-rps', 'botblocker-rpm', 'botblocker-burst'].forEach(function (id) {
    wireChange(id, function () { });
  });
  var sitemapEl = el('botblocker-sitemap');
  if (sitemapEl) sitemapEl.addEventListener('change', function () { if (state.report) regen(); });
  // path chips (event delegation on the containers)
  ['botblocker-pathchips', 'botblocker-exceptionchips'].forEach(function (id) {
    var c = el(id);
    if (c) c.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-path],button[data-exc]') : null;
      if (!b) return;
      var path = b.getAttribute('data-path'), exc = b.getAttribute('data-exc');
      if (path !== null && path !== undefined && path !== '' && b.hasAttribute('data-path')) {
        var ix = state.paths.indexOf(path);
        if (ix === -1) state.paths.push(path); else state.paths.splice(ix, 1);
      } else if (b.hasAttribute('data-exc')) {
        var je = state.exceptions.indexOf(exc);
        if (je === -1) state.exceptions.push(exc); else state.exceptions.splice(je, 1);
      }
      renderChips();
      if (state.report) regen();
    });
  });
  var pathAdd = el('botblocker-path-add');
  if (pathAdd) pathAdd.addEventListener('click', function () {
    var v = (el('botblocker-path-input').value || '').trim();
    if (!v) return;
    if (!v.startsWith('/')) v = '/' + v;
    if (state.paths.indexOf(v) === -1) state.paths.push(v);
    el('botblocker-path-input').value = '';
    renderChips();
    if (state.report) regen();
  });
  var excAdd = el('botblocker-exc-add');
  if (excAdd) excAdd.addEventListener('click', function () {
    var v = (el('botblocker-exc-input').value || '').trim();
    if (!v) return;
    if (!v.startsWith('/')) v = '/' + v;
    if (state.exceptions.indexOf(v) === -1) state.exceptions.push(v);
    el('botblocker-exc-input').value = '';
    renderChips();
    if (state.report) regen();
  });

  /* initial render: generate immediately for the default mode so the page
   * never shows an empty state */
  var initMode = classifier.MODES.find(function (x) { return x.id === el('botblocker-mode').value; });
  if (initMode && el('botblocker-mode-desc')) el('botblocker-mode-desc').textContent = initMode.desc;
  generate();
})();
