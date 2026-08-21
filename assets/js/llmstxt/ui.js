/* LLMs.txt Generator — UI. Inherits the existing huvanti design system.
 * Deterministic pipeline renderer: coverage, quality, preview, validation,
 * editable URL table, download + installation instructions. No AI, no account. */
(function () {
  'use strict';
  var form = document.getElementById('llmstxt-form');
  var out = document.getElementById('llmstxt-results');
  if (!form || !out) return;

  var state = null;          // { url, site, pages, options, llmsTxt, validation, quality, stats }
  var abortCtrl = null;
  var regenerateTimer = null;
  var filter = 'all';
  var search = '';
  var sortKey = 'order';

  var CATEGORIES = ['Documentation', 'Knowledge Base', 'Guides', 'Tutorials', 'Products', 'Services', 'Blog', 'Resources', 'Tools', 'FAQ', 'About', 'Contact', 'Other'];

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function icon(n) { return '<span class="material-icons" aria-hidden="true">' + esc(n) + '</span>'; }
  function toast(t) { var e = document.createElement('div'); e.className = 'toast'; e.textContent = t; document.body.appendChild(e); setTimeout(function () { e.remove(); }, 2600); }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast('Copied'); });
    else { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Copied'); } catch (e) {} document.body.removeChild(ta); }
  }
  function download(name, text, type) {
    try {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/markdown;charset=utf-8' }));
      a.download = name;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(a.href); } catch (e) {} }, 1500);
    } catch (e) {
      copy(text);
      toast('Download was blocked — content copied to clipboard instead.');
    }
  }

  /* ---------- progress ---------- */
  var STEPS = [
    ['validate', 'Domain validated'],
    ['robots', 'robots.txt analyzed'],
    ['sitemaps', 'Sitemap discovered'],
    ['crawl', 'Pages discovered'],
    ['metadata', 'Page metadata extracted'],
    ['generate', 'Important pages identified'],
    ['validate', 'llms.txt generated'],
    ['done', 'Output validated']
  ];
  var stageIndex = { validate: 0, connect: 0, robots: 1, sitemaps: 2, crawl: 3, external: 4, metadata: 4, generate: 6, validate: 7, done: 8 };

  function progressUI(s) {
    var cur = stageIndex[s.stage] != null ? stageIndex[s.stage] : 0;
    var done = s.stage === 'done';
    out.innerHTML = '<div class="paper paper-padded sitemap-progress llmstxt-progress"><h3>' + icon('auto_stories') + ' Generating llms.txt…</h3><ul class="progress-list">' +
      STEPS.map(function (x, i) {
        var st = done || i < cur ? 'done' : i === cur ? 'active' : 'wait';
        var ic = st === 'done' ? 'check_circle' : st === 'active' ? 'autorenew' : 'hourglass_empty';
        return '<li class="pi-' + st + '"><span class="material-icons pi-' + st + '">' + ic + '</span>' + esc(x[1]) + '</li>';
      }).join('') +
      '</ul><p class="muted">' + esc(s.message || 'Working…') + '</p>' +
      (s.discovered != null ? '<p class="muted">' + esc(s.discovered) + ' discovered · ' + esc(s.crawled || 0) + ' analyzed</p>' : '') +
      '<button class="btn" type="button" id="llmstxt-cancel">Cancel</button></div>';
    var b = document.getElementById('llmstxt-cancel');
    if (b) b.onclick = function () { if (abortCtrl) abortCtrl.abort(); };
  }

  function errorUI(e) {
    var code = e.code || 'error';
    var title = 'Unable to complete generation';
    if (/robots/.test(code)) title = 'Crawling restricted by robots.txt';
    else if (code === 'dns') title = 'DNS resolution failed';
    else if (code === 'timeout') title = 'The website timed out';
    else if (code === 'unreachable') title = 'The website could not be reached';
    else if (code === 'challenge') title = 'The site is behind bot protection';
    else if (code === 'invalid_url' || code === 'invalid_input') title = 'Invalid website URL';
    else if (code === 'busy') title = 'Generator busy';
    else if (code === 'ratelimit') title = 'Too many requests';
    var hint = 'The tool reports access restrictions, bot protection, DNS, SSL, timeout and robots.txt errors accurately — it never claims the site has no pages when the crawler was blocked.';
    if (code === 'unreachable' || code === 'challenge' || code === 'timeout' || code === 'budget') {
      hint = 'This environment cannot reach the site directly, and the browser fallback was also unable to fetch it. The website may be blocking automated access (Cloudflare, CAPTCHA), require a login, or be temporarily unreachable. Try again, or check the URL.';
    }
    out.innerHTML = '<div class="paper paper-padded audit-error"><span class="material-icons">error_outline</span><h3>' + esc(title) + '</h3><p>' + esc(e.message || 'The generation could not be completed.') + '</p>' +
      '<p class="muted">' + esc(hint) + '</p>' +
      '<button class="btn" id="llmstxt-retry">Try again</button></div>';
    var b = document.getElementById('llmstxt-retry');
    if (b) b.onclick = function () { form.requestSubmit(); };
  }

  /* ---------- stat helpers ---------- */
  function stat(label, val) { return '<div class="audit-stat"><strong>' + esc(val) + '</strong><span>' + esc(label) + '</span></div>'; }

  /* ---------- main report ---------- */
  function renderReport(r) {
    state = {
      url: r.input || r.finalUrl,
      site: r.site || {},
      pages: (r.pages || []).map(function (p, i) {
        return {
          url: p.url, title: p.title || '', description: p.description || '', category: p.category || 'Other',
          kind: p.kind || 'normal', priority: p.priority || 'Low', status: p.status, canonical: p.canonical || '',
          included: !!p.included, reason: p.reason || '', excludeReason: p.excludeReason || null,
          depth: p.depth, wordCount: p.wordCount, external: !!p.external, isPdf: !!p.isPdf, blocked: !!p.blocked,
          noindex: !!p.noindex, duplicateOf: p.duplicateOf, redirected: !!p.redirected,
          userTitle: '', userDescription: '', userCategory: null, order: i, added: false
        };
      }),
      options: readOptions(),
      llmsTxt: r.llmsTxt || '',
      validation: r.validation || null,
      quality: r.quality || 0,
      stats: r.stats || {},
      robots: r.robots || {},
      sitemaps: r.sitemaps || [],
      existingLlmsTxt: r.existingLlmsTxt || null,
      exclusionReasons: r.exclusionReasons || [],
      warnings: r.warnings || {}
    };
    render();
  }

  function render() {
    var r = state;
    var html = '';

    // Warnings
    if (r.warnings.robotsRestricted || r.warnings.jsHeavy || r.warnings.unableToVerify || r.robots.restrictedCount) {
      html += '<div class="paper paper-padded llmstxt-warnings">';
      if (r.warnings.robotsRestricted) html += '<div class="llmstxt-warn"><span class="material-icons">block</span><span>Some pages could not be crawled because of robots.txt restrictions. Those pages are not included, but they are not claimed to be missing.</span></div>';
      if (r.warnings.jsHeavy) html += '<div class="llmstxt-warn"><span class="material-icons">javascript</span><span>This website appears to rely heavily on JavaScript. Some pages may not be fully discoverable without rendering.</span></div>';
      if (r.warnings.unableToVerify) html += '<div class="llmstxt-warn"><span class="material-icons">help_outline</span><span>' + esc(r.warnings.unableToVerify) + ' page(s) could not be verified (401/403/429 or bot protection). You can choose to include them manually.</span></div>';
      html += '</div>';
    }

    // Existing llms.txt detected
    if (r.existingLlmsTxt && (r.existingLlmsTxt.exists || (r.existingLlmsTxt.describedBy || []).length)) {
      html += '<div class="paper paper-padded sitemap-detected"><h3>Existing llms.txt detected</h3><p>' +
        (r.existingLlmsTxt.exists ? 'This site already serves <span class="llmstxt-mono">' + esc(r.existingLlmsTxt.url) + '</span>.' : '') +
        ((r.existingLlmsTxt.describedBy || []).length ? '<br>Referenced via <code>rel="describedby"</code>: ' + r.existingLlmsTxt.describedBy.map(esc).join(', ') : '') +
        '</p><p class="muted">This tool never modifies your robots.txt or existing files automatically.</p></div>';
    }

    // Coverage + score
    html += '<div class="score-card"><div class="score-ring" style="--score:' + esc(r.quality) + '"><b>' + esc(r.quality) + '</b></div><div class="score-summary"><h2>LLMs.txt Quality Score</h2><span class="source-chip">Internal diagnostic score — not a Google or official OpenAI score</span><p>Based on valid URLs, duplicates, metadata completeness, description quality, important-page coverage, category organisation and canonical consistency.</p></div></div>';

    html += '<div class="audit-stats">' +
      stat('Pages discovered', r.stats.pagesDiscovered != null ? r.stats.pagesDiscovered : r.pages.length) +
      stat('Pages included', r.stats.pagesIncluded != null ? r.stats.pagesIncluded : countIncluded()) +
      stat('Pages excluded', r.stats.pagesExcluded != null ? r.stats.pagesExcluded : countExcluded()) +
      stat('In generated file', r.stats.inFile != null ? r.stats.inFile : countInFile()) +
      stat('Duplicates', r.stats.duplicates != null ? r.stats.duplicates : 0) +
      stat('Canonicalized', r.stats.canonicalized != null ? r.stats.canonicalized : 0) +
      stat('Noindex', r.stats.noindex != null ? r.stats.noindex : 0) +
      stat('Broken', r.stats.broken != null ? r.stats.broken : 0) +
      '</div>';

    // Exclusion reasons
    html += exclusionPanel();

    // Actions + preview
    html += '<div class="audit-panel wide llmstxt-preview-panel"><div class="llmstxt-preview-head"><h3>' + icon('description') + ' Preview</h3><div class="report-actions"><button class="btn" id="llmstxt-copy">' + icon('content_copy') + ' Copy</button><button class="btn" id="llmstxt-download">' + icon('download') + ' Download llms.txt</button></div></div>' +
      '<div class="llmstxt-edit-fields"><label>Site title <input type="text" id="llmstxt-sitename" class="text-input" value="' + esc(r.site.name || '') + '"></label><label>Site description <textarea id="llmstxt-sitedesc" class="text-input" rows="2">' + esc(r.site.description || '') + '</textarea></label></div>' +
      '<pre class="xml-preview llmstxt-preview"><code>' + esc(r.llmsTxt) + '</code></pre></div>';

    // Validation
    html += validationPanel(r.validation);

    // Table
    html += tablePanel();

    // Installation
    html += installPanel();

    out.innerHTML = html;

    bind();
    renderTable();
  }

  function countIncluded() { return state.pages.filter(function (p) { return p.included; }).length; }
  function countExcluded() { return state.pages.filter(function (p) { return !p.included; }).length; }
  function countInFile() { return state.pages.filter(function (p) { return p.included; }).length; }

  function exclusionPanel() {
    var reasons = state.exclusionReasons || [];
    if (!reasons.length) return '';
    return '<div class="audit-panel wide"><h3>Why pages were excluded</h3><div class="llmstxt-reasons">' +
      reasons.map(function (r) { return '<span class="chip">' + esc(r.reason) + ' <b>' + esc(r.count) + '</b></span>'; }).join('') +
      '</div></div>';
  }

  function validationPanel(v) {
    if (!v) return '';
    var checks = v.checks || [];
    var rows = checks.map(function (c) {
      var cls = c.status === 'pass' ? 'pass' : c.status === 'warn' ? 'warn' : 'fail';
      var ic = c.status === 'pass' ? 'check_circle' : c.status === 'warn' ? 'warning' : 'cancel';
      return '<div class="check ' + cls + '"><span class="check-icon material-icons">' + ic + '</span><div><b>' + esc(c.name) + '</b><p>' + esc(c.message) + '</p></div></div>';
    }).join('');
    return '<div class="audit-panel wide"><h3>LLMs.txt Validation</h3>' +
      (v.valid ? '<div class="llmstxt-valid-ok">' + icon('verified') + ' Valid structure</div>' : '<div class="llmstxt-valid-bad">' + icon('error') + ' ' + esc((v.errors || []).length) + ' issue(s) to fix</div>') +
      rows + '</div>';
  }

  function installPanel() {
    var host = '';
    try { host = new URL(state.url).host; } catch (e) { host = 'example.com'; }
    return '<div class="audit-panel wide"><h3>' + icon('publish') + ' Installation</h3><ol class="llmstxt-install"><li><b>Download</b> — click <b>Download llms.txt</b> above.</li><li><b>Upload</b> — place it at <code>' + esc('https://' + host + '/llms.txt') + '</code>.</li><li><b>Verify</b> — open <code>' + esc('https://' + host + '/llms.txt') + '</code> and confirm it loads as plain Markdown.</li></ol><p class="muted">Publishing an llms.txt never guarantees AI visibility, citations, rankings, indexing or traffic.</p></div>';
  }

  /* ---------- table ---------- */
  function tablePanel() {
    return '<div class="audit-panel wide"><div class="llmstxt-table-head"><h3>' + icon('table_view') + ' URL Selection</h3><button class="btn" id="llmstxt-add-btn" type="button">' + icon('add') + ' Add URL</button></div>' +
      '<div class="sitemap-filterbar"><input id="llmstxt-search" class="text-input" placeholder="Search URLs, titles, reasons"><select id="llmstxt-filter" class="select">' +
      '<option value="all">All pages</option><option value="included">Included</option><option value="excluded">Excluded</option><option value="docs">Documentation</option><option value="blog">Blog</option><option value="products">Products</option><option value="broken">Broken</option><option value="unverified">Unable to verify</option></select></div>' +
      '<div id="llmstxt-add-form" class="llmstxt-add-form" hidden><input id="add-url" class="text-input" placeholder="https://example.com/page" inputmode="url"><input id="add-title" class="text-input" placeholder="Title"><input id="add-desc" class="text-input" placeholder="Description"><select id="add-cat" class="select">' + CATEGORIES.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select><button class="btn" id="add-confirm" type="button">Add</button><button class="btn" id="add-cancel" type="button">Cancel</button><p class="muted" style="grid-column:1/-1">External URLs are added as-is and marked external.</p></div>' +
      '<div class="table-scroll"><table class="mini-table llmstxt-table"><thead><tr><th>Include</th><th>Page</th><th>Category</th><th>Status</th><th>Canonical</th><th>Reason</th><th></th></tr></thead><tbody id="llmstxt-rows"></tbody></table></div>' +
      '<p class="muted" style="margin-top:8px">Edits are applied locally and reflected in the preview. Auto-generated titles/descriptions are never overwritten by a regeneration.</p></div>';
  }

  function visiblePages() {
    var term = search.toLowerCase();
    return state.pages.filter(function (p) {
      if (p._removed) return false;
      var reason = String(p.reason || '').toLowerCase();
      if (filter === 'included') { if (!p.included) return false; }
      else if (filter === 'excluded') { if (p.included) return false; }
      else if (filter === 'docs') { if (!/documentation|knowledge base/i.test(p.category)) return false; }
      else if (filter === 'blog') { if (!/blog/i.test(p.category)) return false; }
      else if (filter === 'products') { if (!/product/i.test(p.category)) return false; }
      else if (filter === 'broken') { if (!/broken|404|410|5xx|dns/i.test(reason)) return false; }
      else if (filter === 'unverified') { if (!/unable to verify|403|429|bot/i.test(reason)) return false; }
      if (!term) return true;
      return String(p.url + ' ' + p.title + ' ' + p.reason + ' ' + p.category).toLowerCase().indexOf(term) >= 0;
    }).slice().sort(function (a, b) {
      if (sortKey === 'category') return String(a.category).localeCompare(String(b.category));
      if (sortKey === 'status') return (a.status || 0) - (b.status || 0);
      return (a.order - b.order);
    });
  }

  function renderTable() {
    var tb = document.getElementById('llmstxt-rows');
    if (!tb) return;
    var rows = visiblePages().slice(0, 400);
    tb.innerHTML = rows.map(function (p) {
      var catOpts = CATEGORIES.map(function (c) { return '<option' + ((p.userCategory || p.category) === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
      var statusTxt = p.blocked ? 'Blocked' : (p.status || '—');
      var canonTxt = p.canonical && p.canonical !== p.url ? p.canonical : '—';
      return '<tr data-idx="' + p.order + '" class="' + (p.included ? 'llmstxt-row-in' : 'llmstxt-row-out') + '">' +
        '<td><label class="llmstxt-switch"><input type="checkbox" data-act="toggle" ' + (p.included ? 'checked' : '') + '><span></span></label></td>' +
        '<td class="url-cell"><a class="llmstxt-link" href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(shortUrl(p.url)) + '</a>' + (p.external ? ' <span class="chip">external</span>' : '') + (p.isPdf ? ' <span class="chip">PDF</span>' : '') + '<input data-act="title" class="text-input llmstxt-inline" value="' + esc(p.userTitle || p.title) + '" placeholder="Title" title="Title"><input data-act="desc" class="text-input llmstxt-inline" value="' + esc(p.userDescription || p.description) + '" placeholder="Description" title="Description"></td>' +
        '<td><select data-act="cat" class="select llmstxt-cat">' + catOpts + '</select></td>' +
        '<td>' + esc(statusTxt) + '</td>' +
        '<td class="url-cell">' + esc(shortUrl(canonTxt)) + '</td>' +
        '<td>' + esc(p.reason || '—') + '</td>' +
        '<td class="llmstxt-row-actions"><button class="llmstxt-mini" data-act="up" title="Move up">' + icon('arrow_upward') + '</button><button class="llmstxt-mini" data-act="down" title="Move down">' + icon('arrow_downward') + '</button><button class="llmstxt-mini" data-act="remove" title="Remove">' + icon('close') + '</button></td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="7">No matching pages.</td></tr>';
  }

  function shortUrl(u) {
    if (!u) return '—';
    try {
      var x = new URL(u);
      var p = x.pathname + x.search;
      if (p.length > 46) p = p.slice(0, 43) + '…';
      return x.host + (p === '/' ? '' : p);
    } catch (e) { return String(u).length > 60 ? String(u).slice(0, 57) + '…' : u; }
  }

  function rowPage(orderIdx) {
    return state.pages.filter(function (p) { return !p._removed; }).find(function (p) { return p.order === orderIdx; });
  }

  /* ---------- edits ---------- */
  function applyEdit(page, act, value) {
    if (act === 'toggle') page.included = !page.included;
    else if (act === 'title') { page.userTitle = value; }
    else if (act === 'desc') { page.userDescription = value; }
    else if (act === 'cat') { page.userCategory = value; }
    return page;
  }

  function movePage(page, dir) {
    var list = state.pages.filter(function (p) { return !p._removed; });
    var i = list.indexOf(page);
    var j = i + dir;
    if (j < 0 || j >= list.length) return;
    var tmp = page.order; page.order = list[j].order; list[j].order = tmp;
  }

  function regenerate(immediate) {
    if (regenerateTimer) clearTimeout(regenerateTimer);
    var run = function () {
      var body = buildPayload();
      fetch('/api/llmstxt-finalize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (res) { return res.json(); })
        .then(function (json) {
          if (json && json.llmsTxt != null) {
            state.llmsTxt = json.llmsTxt;
            state.validation = json.validation;
            state.quality = json.quality;
            state.stats = Object.assign({}, state.stats, json.stats || {});
            // Re-mark inFile/section for display purposes (kept simple here).
            render();
          }
        })
        .catch(function () { toast('Could not regenerate the file.'); });
    };
    if (immediate) run(); else regenerateTimer = setTimeout(run, 300);
  }

  function buildPayload() {
    var pages = state.pages.filter(function (p) { return !p._removed; }).map(function (p) {
      return {
        url: p.url, canonical: p.canonical || p.url, title: p.title, description: p.description,
        userTitle: p.userTitle || null, userDescription: p.userDescription != null ? p.userDescription : null,
        category: p.userCategory || p.category, kind: p.kind, included: p.included, external: p.external,
        isPdf: p.isPdf, priority: p.priority, order: p.order
      };
    });
    return {
      url: state.url,
      websiteName: document.getElementById('llmstxt-sitename') ? document.getElementById('llmstxt-sitename').value.trim() : '',
      websiteDescription: document.getElementById('llmstxt-sitedesc') ? document.getElementById('llmstxt-sitedesc').value.trim() : '',
      site: state.site,
      options: state.options,
      pages: pages
    };
  }

  /* ---------- binding ---------- */
  function bind() {
    var cp = document.getElementById('llmstxt-copy');
    var dl = document.getElementById('llmstxt-download');
    if (cp) cp.onclick = function () { copy(state.llmsTxt); };
    if (dl) dl.onclick = function () { download('llms.txt', state.llmsTxt, 'text/markdown;charset=utf-8'); };

    var sn = document.getElementById('llmstxt-sitename');
    var sd = document.getElementById('llmstxt-sitedesc');
    if (sn) sn.addEventListener('input', function () { state.site.name = sn.value; regenerate(false); });
    if (sd) sd.addEventListener('input', function () { state.site.description = sd.value; regenerate(false); });

    var searchEl = document.getElementById('llmstxt-search');
    var filterEl = document.getElementById('llmstxt-filter');
    if (searchEl) searchEl.addEventListener('input', function () { search = searchEl.value; renderTable(); });
    if (filterEl) filterEl.addEventListener('change', function () { filter = filterEl.value; renderTable(); });

    var tb = document.getElementById('llmstxt-rows');
    if (tb) tb.addEventListener('change', onRowChange);
    if (tb) tb.addEventListener('click', onRowClick);
    if (tb) tb.addEventListener('input', onRowInput);

    var addBtn = document.getElementById('llmstxt-add-btn');
    if (addBtn) addBtn.onclick = function () { document.getElementById('llmstxt-add-form').hidden = false; };
    var addCancel = document.getElementById('add-cancel');
    if (addCancel) addCancel.onclick = function () { document.getElementById('llmstxt-add-form').hidden = true; };
    var addConfirm = document.getElementById('add-confirm');
    if (addConfirm) addConfirm.onclick = addUrl;
  }

  function rowFromEvent(e) {
    var tr = e.target && e.target.closest ? e.target.closest('tr') : null;
    if (!tr) return null;
    var idx = parseInt(tr.getAttribute('data-idx'), 10);
    return rowPage(idx);
  }

  function onRowChange(e) {
    var act = e.target.getAttribute && e.target.getAttribute('data-act');
    var page = rowFromEvent(e);
    if (!page || !act) return;
    if (act === 'toggle') { applyEdit(page, 'toggle', null); regenerate(true); }
    if (act === 'cat') { applyEdit(page, 'cat', e.target.value); regenerate(true); }
  }

  function onRowInput(e) {
    var act = e.target.getAttribute && e.target.getAttribute('data-act');
    var page = rowFromEvent(e);
    if (!page || !act) return;
    if (act === 'title') { applyEdit(page, 'title', e.target.value); regenerate(false); }
    if (act === 'desc') { applyEdit(page, 'desc', e.target.value); regenerate(false); }
  }

  function onRowClick(e) {
    var act = e.target.getAttribute && e.target.getAttribute('data-act');
    var page = rowFromEvent(e);
    if (!page || !act) return;
    if (act === 'up') { movePage(page, -1); regenerate(true); }
    if (act === 'down') { movePage(page, 1); regenerate(true); }
    if (act === 'remove') { page._removed = true; regenerate(true); }
  }

  function addUrl() {
    var u = document.getElementById('add-url').value.trim();
    var t = document.getElementById('add-title').value.trim();
    var d = document.getElementById('add-desc').value.trim();
    var c = document.getElementById('add-cat').value;
    if (!u) { toast('Enter a URL to add.'); return; }
    var parsed = null;
    try { parsed = new URL(/^https?:/i.test(u) ? u : 'https://' + u); } catch (e) { toast('That URL is not valid.'); return; }
    var isExt = false;
    try { isExt = new URL(state.url).hostname.replace(/^www\./, '') !== parsed.hostname.replace(/^www\./, ''); } catch (e) {}
    state.pages.push({
      url: parsed.toString(), title: t || parsed.hostname, description: d, category: c, kind: isExt ? 'external' : 'normal',
      priority: 'High', status: null, canonical: parsed.toString(), included: true, reason: isExt ? 'Manually added external URL' : 'Manually added URL',
      excludeReason: null, depth: 0, wordCount: 0, external: isExt, isPdf: /\.pdf$/i.test(parsed.pathname), blocked: false,
      noindex: false, duplicateOf: null, redirected: false, userTitle: t || null, userDescription: d || null, userCategory: c,
      order: state.pages.length, added: true
    });
    document.getElementById('llmstxt-add-form').hidden = true;
    document.getElementById('add-url').value = ''; document.getElementById('add-title').value = ''; document.getElementById('add-desc').value = '';
    regenerate(true);
    toast('URL added.');
  }

  function readOptions() {
    var fd = new FormData(form);
    return {
      maxPages: Number(fd.get('maxPages') || 500),
      maxDepth: fd.get('maxDepth') || 3,
      includeExternal: !!fd.get('includeExternal'),
      includePdfs: fd.get('includePdfs') !== null,
      includeBlog: fd.get('includeBlog') !== null,
      includeDocs: fd.get('includeDocs') !== null,
      includeCategories: !!fd.get('includeCategories'),
      includeAuthors: !!fd.get('includeAuthors'),
      includeNoindex: !!fd.get('includeNoindex'),
      maxBlogUrls: fd.get('maxBlogUrls') || 25,
      maxProducts: fd.get('maxProducts') || 50,
      websiteDescription: (fd.get('websiteDescription') || '').trim()
    };
  }

  /* ---------- noindex warning ---------- */
  var noindexToggle = document.getElementById('llmstxt-noindex-toggle');
  if (noindexToggle) {
    noindexToggle.addEventListener('change', function () {
      var w = document.querySelector('.llmstxt-noindex-warning');
      if (w) w.hidden = !noindexToggle.checked;
    });
  }

  /* ---------- submit ---------- */
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var body = readOptions();
    body.url = (document.getElementById('llmstxt-url') || {}).value;
    abortCtrl = new AbortController();
    progressUI({ stage: 'validate', message: 'Validating URL…' });
    fetch('/api/llmstxt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: abortCtrl.signal })
      .then(function (res) {
        if (!res.ok && res.headers.get('content-type') && res.headers.get('content-type').indexOf('json') >= 0) return res.json().then(function (j) { throw j; });
        if (!res.body) throw { message: 'Streaming is not available.' };
        var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
        function pump() {
          return reader.read().then(function (x) {
            if (x.done) return;
            buf += dec.decode(x.value, { stream: true });
            var parts = buf.split('\n\n'); buf = parts.pop();
            parts.forEach(function (part) {
              var ev = (part.match(/^event: (.+)$/m) || [])[1];
              var data = (part.match(/^data: ([\s\S]*)$/m) || [])[1];
              if (!data) return;
              var j = JSON.parse(data);
              if (ev === 'progress') progressUI(j);
              if (ev === 'result') renderReport(j);
              if (ev === 'error') throw j;
            });
            return pump();
          });
        }
        return pump();
      })
      .catch(function (e) {
        if (e && e.name === 'AbortError') e = { code: 'cancelled', message: 'The crawl was cancelled.' };
        var fallback = ['unreachable', 'timeout', 'fetch_failed', 'tls_blocked', 'dns', 'ssrf', 'challenge'];
        if (e && fallback.indexOf(e.code) >= 0 && window.LlmstxtBrowserRunner && window.LlmstxtBrowserRunner.run) {
          progressUI({ stage: 'connect', message: 'The server could not reach the site, so your browser is fetching the pages instead…' });
          body.signal = abortCtrl.signal;
          return window.LlmstxtBrowserRunner.run(body, progressUI).then(renderReport).catch(function (be) { errorUI(be || e || {}); });
        }
        errorUI(e || {});
      })
      .finally(function () { abortCtrl = null; });
  });
})();
