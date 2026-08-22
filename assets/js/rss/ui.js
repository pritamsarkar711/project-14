/* RSS Feed Generator: UI. Inherits the existing huvanti design system.
 * Deterministic pipeline renderer: progress, existing-feed detection,
 * quality score + breakdown, statistics, editable item table, visual + XML
 * previews, validation, comparison, export and installation instructions.
 * No AI, no account. */
(function () {
  'use strict';
  var form = document.getElementById('rss-form');
  var out = document.getElementById('rss-results');
  if (!form || !out) return;

  var state = null;
  var abortCtrl = null;
  var regenerateTimer = null;
  var filter = 'all';
  var search = '';
  var previewTab = 'visual';
  var xmlFormat = 'rss';

  var DATE_SOURCES = {
    'structured-data': ['structured data', 's-structured'],
    'article-published-time': ['article:published_time', 's-structured'],
    'time-datetime': ['<time datetime>', 's-structured'],
    'visible-publication': ['visible publication line', 's-visible'],
    'sitemap-lastmod': ['sitemap lastmod, fallback', 's-fallback'],
    'manual': ['set manually', 's-manual']
  };

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
      a.href = URL.createObjectURL(new Blob([text], { type: type || 'application/octet-stream' }));
      a.download = name;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(a.href); } catch (e) {} }, 1500);
    } catch (e) {
      copy(text);
      toast('Download was blocked, content copied to clipboard instead.');
    }
  }
  function shortUrl(u) {
    if (!u) return ',';
    try {
      var x = new URL(u);
      var p = x.pathname + x.search;
      if (p.length > 44) p = p.slice(0, 41) + '…';
      return x.host + (p === '/' ? '' : p);
    } catch (e) { return String(u).length > 58 ? String(u).slice(0, 55) + '…' : u; }
  }
  function fmtDate(iso) {
    if (!iso) return 'Unknown';
    try {
      var d = new Date(iso);
      if (Number.isNaN(d.getTime())) return 'Unknown';
      return d.toUTCString().replace(/:.. GMT$/, ' GMT');
    } catch (e) { return 'Unknown'; }
  }
  function isoDay(iso) { try { return String(iso).slice(0, 10); } catch (e) { return ''; } }
  function statusChip(p) {
    if (p.existing) return '<span class="status-pill s-ok">Existing feed</span>';
    if (p.added) return '<span class="status-pill s-ok">Manual</span>';
    if (p.blocked) return '<span class="status-pill s-unk">Robots blocked</span>';
    if (p.challenge) return '<span class="status-pill s-redir">Bot protection</span>';
    if (!p.status) return '<span class="status-pill s-err">Unreachable</span>';
    if (p.status >= 400) return '<span class="status-pill s-err">' + esc(p.status) + '</span>';
    if (p.status >= 300) return '<span class="status-pill s-redir">' + esc(p.status) + (p.redirected ? ' → final' : '') + '</span>';
    return '<span class="status-pill s-ok">200</span>' + (p.redirected ? ' <span class="muted">(redirected)</span>' : '');
  }

  /* ---------- progress ---------- */
  var STEPS = [
    ['URL validated', 'link'],
    ['robots.txt checked', 'rule'],
    ['Existing feed checked', 'rss_feed'],
    ['Sitemap discovered', 'account_tree'],
    ['Content pages discovered', 'search'],
    ['Metadata extracted', 'data_object'],
    ['Duplicate URLs removed', 'merge_type'],
    ['Broken URLs checked', 'link_off'],
    ['RSS XML generated', 'code'],
    ['XML validated', 'verified']
  ];
  var stageIndex = { validate: 0, connect: 0, robots: 1, feeds: 2, sitemaps: 3, crawl: 4, metadata: 5, verify: 6, select: 6, generate: 8, validate: 9, done: 10 };

    function progressUI(s) {
    var ICONS = {'validate': 'rule', 'robots': 'rule', 'feeds': 'rss_feed', 'sitemaps': 'account_tree', 'crawl': 'travel_explore', 'metadata': 'data_object', 'verify': 'link_off', 'select': 'filter_alt', 'generate': 'code', 'validate_x': 'verified', 'done': 'radio_button_unchecked'};
    var KEYS = ['validate', 'robots', 'feeds', 'sitemaps', 'crawl', 'metadata', 'verify', 'select', 'generate', 'validate2'];
    var LABELS = { validate2: 'XML validated' };
    var stageIndex = { validate: 0, connect: 0, robots: 1, feeds: 2, sitemaps: 3, crawl: 4, metadata: 5, verify: 6, select: 6, generate: 8, validate: 9, done: 10 };
    var cur = stageIndex[s.stage] != null ? stageIndex[s.stage] : 0;
    var done = s.stage === 'done';
    var steps = KEYS.map(function (k, i) { return { key: k, label: LABELS[k] || STEPS[i][0], icon: ICONS[k] || 'radio_button_unchecked' }; });
    var states = {};
    steps.forEach(function (st, i) { states[st.key] = (done || i < cur) ? 'done' : i === cur ? 'active' : 'wait'; });
    var p = window.ScanProgress.reuse(out, {
      title: 'Generating the RSS feed', target: (document.getElementById('rss-url') || {}).value || '', icon: 'rss_feed', steps: steps,
      note: s.message || 'Working\u2026',
      onCancel: function () { if (abortCtrl) abortCtrl.abort(); }
    });
    p.set(states, (s.message || 'Working\u2026') + (s.discovered != null ? ' \u00b7 ' + s.discovered + ' discovered, ' + (s.crawled || 0) + ' analyzed' : ''), 8 + Math.round((done ? KEYS.length : cur) / KEYS.length * 88));
  }

  function errorUI(e) {
    var code = e.code || 'error';
    var title = 'Unable to complete generation';
    if (/^robots/.test(code)) title = 'This page couldn\'t be crawled because of robots.txt restrictions';
    else if (code === 'dns') title = 'DNS resolution failed';
    else if (code === 'timeout') title = 'The website timed out';
    else if (code === 'unreachable') title = 'The website could not be reached';
    else if (code === 'challenge' || code === 'restricted') title = 'The website couldn\'t be fully crawled because access was restricted';
    else if (code === 'invalid_url' || code === 'invalid_input') title = 'Invalid URL';
    else if (code === 'sitemap_invalid') title = 'Sitemap could not be read';
    else if (code === 'busy') title = 'Generator busy';
    else if (code === 'ratelimit') title = 'Too many requests';
    else if (code === 'ssrf') title = 'Private or local addresses cannot be scanned';
    var hint = 'The tool reports access restrictions, bot protection, DNS, SSL, timeout and robots.txt errors accurately, it never claims the site has no pages when the crawler was blocked.';
    if (['unreachable', 'timeout', 'fetch_failed', 'tls_blocked', 'dns', 'challenge', 'restricted', 'budget'].indexOf(code) >= 0) {
      hint = 'This environment cannot reach the site directly, and the browser fallback was also unable to fetch it. The website may be blocking automated access (Cloudflare, CAPTCHA), require a login, or be temporarily unreachable. Try again, or check the URL.';
    }
    if (/^robots/.test(code)) hint = 'The site\'s robots.txt explicitly disallows crawling this path. The tool does not bypass robots.txt, so pages behind it are excluded, and are not claimed to be missing.';
    out.innerHTML = '<div class="paper paper-padded audit-error"><span class="material-icons">error_outline</span><h3>' + esc(title) + '</h3><p>' + esc(e.message || 'The generation could not be completed.') + '</p>' +
      '<p class="muted">' + esc(hint) + '</p>' +
      '<button class="btn" id="rss-retry">Try again</button></div>';
    var b = document.getElementById('rss-retry');
    if (b) b.onclick = function () { form.requestSubmit(); };
  }

  /* ---------- report ---------- */
  function renderReport(r) {
    state = {
      url: r.input || r.finalUrl,
      mode: r.mode || 'website',
      transport: r.transport || 'server',
      site: r.site || {},
      channel: r.channel || { title: r.site && r.site.name || '', link: r.finalUrl || '', description: r.site && r.site.description || '' },
      pages: (r.pages || []).map(function (p, i) {
        return {
          url: p.url, requestedUrl: p.requestedUrl || p.url, title: p.title || '', type: p.type || 'Other',
          feedable: !!p.feedable, status: p.status || 0, date: p.date || null, dateSource: p.dateSource || null,
          dateReliable: p.dateReliable != null ? p.dateReliable : null, author: p.author || null,
          category: p.category || '', image: p.image || null, canonical: p.canonical || null,
          noindex: !!p.noindex, blocked: !!p.blocked, challenge: !!p.challenge, redirected: !!p.redirected,
          jsHeavy: !!p.jsHeavy, wordCount: p.wordCount || 0, fromSitemap: !!p.fromSitemap,
          hasArticleTag: !!p.hasArticleTag, included: !!p.included, reason: p.reason || '',
          excludeReason: p.excludeReason || null, duplicateOf: p.duplicateOf || null,
          added: !!p.added, existing: !!p.existing, description: p.description || '',
          articleHtml: p.articleHtml || '', audioUrl: p.audioUrl || null,
          userTitle: null, userDescription: null, userDate: null, userCategory: null, userAuthor: null, userImage: null, userUrl: null,
          order: i, manualOrder: i, _removed: false
        };
      }),
      existingFeed: r.existingFeed || null,
      existingItems: r.existingItems || [],
      existingFeedCheck: r.existingFeedCheck || null,
      rssXml: r.rssXml || '', atomXml: r.atomXml || '',
      validation: r.validation || null,
      quality: r.quality || { score: 0, components: [] },
      stats: r.stats || {},
      exclusionReasons: r.exclusionReasons || [],
      warnings: r.warnings || {},
      comparison: r.comparison || null,
      robots: r.robots || {},
      sitemaps: r.sitemaps || [],
      options: r.options || readOptions()
    };
    previewTab = 'visual';
    xmlFormat = 'rss';
    render(true);
  }

  function countSel() { return state.pages.filter(function (p) { return !p._removed && p.included; }).length; }

  function render(full) {
    out.innerHTML =
      warningsPanel() +
      existingFeedPanel() +
      '<div id="rss-outputs"></div>' +
      tablePanel();
    renderOutputs();
    renderTable();
    bindStatic();
  }

  function renderOutputs() {
    var el = document.getElementById('rss-outputs');
    if (!el) return;
    el.innerHTML = scorePanel() + statsPanel() + exclusionPanel() + settingsPanel() + previewPanel() + validationPanel(state.validation) + comparisonPanel() + installPanel();
    bindOutputs();
  }

  function stat(label, val, cls) { return '<div class="audit-stat ' + (cls || '') + '"><strong>' + esc(val) + '</strong><span>' + esc(label) + '</span></div>'; }

  function warningsPanel() {
    var r = state.warnings;
    var html = '';
    if (r.robotsRestricted || r.jsHeavy || r.challenge || r.noContent) {
      html += '<div class="paper paper-padded rss-warnings">';
      if (r.robotsRestricted) html += '<div class="rss-warn"><span class="material-icons">block</span><span>Some pages couldn\'t be crawled because of robots.txt restrictions. They are excluded but not claimed to be missing.</span></div>';
      if (r.challenge) html += '<div class="rss-warn"><span class="material-icons">security</span><span>' + esc(r.challenge) + ' page(s) are behind bot protection and could not be verified. They are not included.</span></div>';
      if (r.jsHeavy) html += '<div class="rss-warn"><span class="material-icons">javascript</span><span>This website appears to rely heavily on JavaScript. Some content may not be discoverable without rendering.</span></div>';
      if (r.noContent) html += '<div class="rss-warn"><span class="material-icons">search_off</span><span>No article-like content pages were found. This may be a single-page site, a shop, or a JavaScript-only site, or the crawler may have been limited. Use <b>Add Item</b> to add articles manually.</span></div>';
      if (state.transport === 'browser') html += '<div class="rss-warn"><span class="material-icons">cloud_off</span><span>The scan ran through your browser (the server could not reach the site directly). Page budget is limited to 60 pages in this mode.</span></div>';
      html += '</div>';
    }
    return html;
  }

  function existingFeedPanel() {
    var ef = state.existingFeed;
    if (!ef) return '';
    var wp = ef.wordpress;
    return '<div class="paper paper-padded sitemap-detected rss-existing"><div class="rss-existing-head"><h3>' + icon(wp ? 'widgets' : 'rss_feed') + ' ' + esc(wp ? 'WordPress RSS feed detected' : 'Existing RSS feed detected') + '</h3><div class="report-actions"><button class="btn" id="rss-use-existing" type="button">' + icon('check') + ' Use Existing Feed</button><button class="btn" id="rss-gen-new" type="button">' + icon('refresh') + ' Generate New Feed</button>' + (state.rssXml ? '<button class="btn" id="rss-compare" type="button">' + icon('compare_arrows') + ' Compare Existing Feed</button>' : '') + '</div></div>' +
      '<p>This site already serves a feed at <span class="llmstxt-mono">' + esc(ef.url) + '</span> (' + esc(ef.format) + ', ' + esc(ef.itemCount) + ' items' + (ef.title ? ', “' + esc(ef.title) + '”' : '') + ').</p>' +
      '<p class="muted">Using the existing feed re-publishes its real items (validated and re-serialized) instead of creating a duplicate. Nothing on your site is modified automatically.' + (wp ? ' WordPress\'s built-in feed often already covers all posts, a second feed may be unnecessary.' : '') + '</p></div>';
  }

  function scorePanel() {
    var q = state.quality;
    var comps = (q.components || []).map(function (c) {
      return '<li>' + icon(c.earned >= c.max ? 'check_circle' : c.earned > 0 ? 'data_usage' : 'cancel') + '<span>' + esc(c.name) + '</span><b>' + esc(c.earned) + '/' + esc(c.max) + '</b>' + (c.note ? '<small>' + esc(c.note) + '</small>' : '') + '</li>';
    }).join('');
    return '<div class="score-card"><div class="score-ring" style="--score:' + esc(q.score) + '"><b>' + esc(q.score) + '</b></div><div class="score-summary"><h2>RSS Feed Quality Score</h2><span class="source-chip">' + esc(q.label || 'Tool-generated RSS quality score') + ', not a Google or official score</span><p>' + esc(q.note || '') + '</p><ul class="rss-score-breakdown">' + comps + '</ul></div></div>';
  }

  function statsPanel() {
    var s = state.stats || {};
    return '<div class="audit-stats">' +
      stat('Pages discovered', s.pagesDiscovered != null ? s.pagesDiscovered : state.pages.length) +
      stat('Content pages found', s.contentPagesFound != null ? s.contentPagesFound : 0) +
      stat('Items selected', s.itemsSelected != null ? s.itemsSelected : countSel()) +
      stat('Duplicates removed', s.duplicatesRemoved != null ? s.duplicatesRemoved : 0) +
      stat('Broken URLs excluded', s.brokenExcluded != null ? s.brokenExcluded : 0, (s.brokenExcluded > 0) ? 's-critical' : '') +
      stat('Items missing dates', s.missingDates != null ? s.missingDates : 0, (s.missingDates > 0) ? 's-warning' : '') +
      stat('Robots-restricted', s.robotsBlocked != null ? s.robotsBlocked : 0) +
      stat('Feed quality', (state.quality.score != null ? state.quality.score : 0) + '/100') +
      '</div>';
  }

  function exclusionPanel() {
    var reasons = state.exclusionReasons || [];
    if (!reasons.length) return '';
    return '<div class="audit-panel wide"><h3>Why pages were excluded</h3><div class="llmstxt-reasons">' +
      reasons.map(function (r) { return '<span class="chip">' + esc(r.reason) + ' <b>' + esc(r.count) + '</b></span>'; }).join('') +
      '</div></div>';
  }

  function settingsPanel() {
    var o = state.options;
    var c = state.channel;
    return '<div class="audit-panel wide rss-settings"><h3>' + icon('tune') + ' Feed Settings</h3>' +
      '<div class="rss-settings-grid">' +
      '<label>Feed title <input type="text" id="rss-feed-title" class="text-input" value="' + esc(c.title) + '" placeholder="Auto-detected, editable"></label>' +
      '<label>Feed URL (where you will publish it) <input type="text" id="rss-feed-url" class="text-input" value="' + esc(guessFeedUrl()) + '" inputmode="url"></label>' +
      '<label class="rss-span2">Feed description <textarea id="rss-feed-desc" class="text-input" rows="2" placeholder="Auto-detected, editable">' + esc(c.description) + '</textarea></label>' +
      '<label>Number of items <select id="rss-max-items" class="select">' + [10, 20, 25, 50, 100, 250].map(function (n) { return '<option value="' + n + '"' + (Number(o.maxItems) === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
      '<label>Feed content <select id="rss-content" class="select">' +
        '<option value="excerpt"' + (o.contentMode === 'excerpt' ? ' selected' : '') + '>Excerpt</option>' +
        '<option value="full"' + (o.contentMode === 'full' ? ' selected' : '') + '>Full Content</option>' +
        '<option value="description"' + (o.contentMode === 'description' ? ' selected' : '') + '>Description Only</option></select></label>' +
      '<label>Sort order <select id="rss-sort" class="select">' +
        '<option value="newest"' + (o.sortOrder === 'newest' ? ' selected' : '') + '>Newest First</option>' +
        '<option value="oldest"' + (o.sortOrder === 'oldest' ? ' selected' : '') + '>Oldest First</option>' +
        '<option value="manual"' + (o.sortOrder === 'manual' ? ' selected' : '') + '>Manual Order (use table arrows)</option></select></label>' +
      '<label>Feed format <select id="rss-format" class="select">' +
        '<option value="standard"' + (o.feedMode === 'standard' ? ' selected' : '') + '>Standard RSS 2.0</option>' +
        '<option value="news"' + (o.feedMode === 'news' ? ' selected' : '') + '>News Feed Mode (dates required)</option>' +
        '<option value="podcast"' + (o.feedMode === 'podcast' ? ' selected' : '') + '>Podcast RSS Mode (enclosures from detected audio)</option></select></label>' +
      '<label class="rss-check"><input type="checkbox" id="rss-inc-images" ' + (o.includeImages !== false ? 'checked' : '') + '> Include Images</label>' +
      '<label class="rss-check"><input type="checkbox" id="rss-inc-authors" ' + (o.includeAuthors !== false ? 'checked' : '') + '> Include Authors</label>' +
      '<label class="rss-check"><input type="checkbox" id="rss-inc-cats" ' + (o.includeCategories !== false ? 'checked' : '') + '> Include Categories</label>' +
      '<label class="rss-check"><input type="checkbox" id="rss-inc-dates" ' + (o.includePubDate !== false ? 'checked' : '') + '> Include Publication Date</label>' +
      '<label class="rss-check rss-check-wide"><input type="checkbox" id="rss-exc-undated" ' + (o.excludeUndated !== false ? 'checked' : '') + '> Exclude items without dates</label>' +
      '<div class="rss-settings-actions"><button class="btn" id="rss-regenerate" type="button">' + icon('refresh') + ' Regenerate Feed</button><span class="muted">Applies settings, table edits and manual additions.</span></div>' +
      '</div></div>';
  }

  function guessFeedUrl() {
    try { return new URL('/rss.xml', state.channel.link || state.url).toString(); } catch (e) { return (state.url || '') + '/rss.xml'; }
  }

  function currentXml() { return xmlFormat === 'atom' ? (state.atomXml || '') : (state.rssXml || ''); }

  /* Selected pages in feed order (matches how the generator sorts). */
  function orderedSelected() {
    var sel = state.pages.filter(function (p) { return !p._removed && p.included; });
    var ts = function (p) { try { return p.date ? new Date(p.date).getTime() : 0; } catch (e) { return 0; } };
    var order = state.options && state.options.sortOrder;
    if (order === 'oldest') sel.sort(function (a, b) { return ts(a) - ts(b) || a.manualOrder - b.manualOrder; });
    else if (order === 'manual') sel.sort(function (a, b) { return a.manualOrder - b.manualOrder || ts(b) - ts(a); });
    else sel.sort(function (a, b) { return ts(b) - ts(a) || a.manualOrder - b.manualOrder; });
    return sel;
  }

  function visualItemCard(p, i) {
    var d = p.date ? fmtDate(p.date) : 'Unknown';
    var dsrc = p.date ? (DATE_SOURCES[p.dateSource] ? DATE_SOURCES[p.dateSource][0] : (p.dateSource || '')) : '';
    return '<div class="rss-vitem">' +
      (p.image ? '<div class="rss-vthumb"><img src="' + esc(p.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.style.display=\'none\'"></div>' : '<div class="rss-vthumb rss-vthumb-none">' + icon('article') + '</div>') +
      '<div class="rss-vbody"><a class="rss-vtitle" href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.userTitle || p.title || '(untitled)') + '</a>' +
      '<div class="rss-vmeta"><span>' + icon('schedule') + ' ' + esc(d) + (dsrc ? ' <small>(' + esc(dsrc) + ')</small>' : '') + '</span>' +
      (p.userAuthor != null && p.userAuthor !== '' ? '<span>' + icon('person') + ' ' + esc(p.userAuthor) + '</span>' : (p.author ? '<span>' + icon('person') + ' ' + esc(p.author) + '</span>' : '')) +
      (p.userCategory || p.category ? '<span class="chip">' + esc((p.userCategory || p.category).split(',')[0]) + '</span>' : '') +
      '</div>' +
      '<p class="rss-vdesc">' + esc((p.userDescription != null && p.userDescription !== '' ? p.userDescription : p.description) || 'No description available.') + '</p>' +
      '</div></div>';
  }

  function previewPanel() {
    var sel = orderedSelected();
    var itemsXml = currentXml();
    var visual = '<div class="rss-vfeed"><div class="rss-vhead"><h4>' + esc(state.channel.title) + '</h4><p>' + esc(state.channel.description || '') + '</p><span class="muted">' + esc(state.channel.link || '') + ' · ' + esc(sel.length) + ' item(s) · RSS 2.0' + (xmlFormat === 'atom' ? '' : '') + '</span></div>' +
      (sel.length ? sel.map(function (p, i) { return visualItemCard(p, i); }).join('') : '<p class="muted">No items selected. Toggle pages in the table below or add items manually.</p>') +
      '</div>';
    var xmlView = '<div class="rss-xmlbar"><label class="rss-xmlbar-sel">' + icon('data_object') + ' Format <select id="rss-xml-sel" class="select">' +
      '<option value="rss"' + (xmlFormat === 'rss' ? ' selected' : '') + '>RSS 2.0 (rss.xml)</option>' +
      '<option value="atom"' + (xmlFormat === 'atom' ? ' selected' : '') + '>Atom 1.0 (atom.xml)</option></select></label>' +
      '<span class="muted">' + esc(itemsXml.length) + ' bytes</span></div>' +
      '<pre class="xml-preview rss-xml"><code>' + esc(itemsXml || '&lt;!-- no feed generated yet --&gt;') + '</code></pre>';
    return '<div class="audit-panel wide rss-preview-panel"><div class="llmstxt-preview-head"><h3>' + icon('preview') + ' Feed Preview</h3><div class="report-actions">' +
      '<div class="rss-tabs"><button class="btn ' + (previewTab === 'visual' ? 'rss-tab-on' : '') + '" id="rss-tab-visual" type="button">' + icon('list') + ' Visual</button><button class="btn ' + (previewTab === 'xml' ? 'rss-tab-on' : '') + '" id="rss-tab-xml" type="button">' + icon('code') + ' XML</button></div>' +
      '<button class="btn" id="rss-copy-xml" type="button">' + icon('content_copy') + ' Copy XML</button>' +
      '<button class="btn" id="rss-dl-rss" type="button">' + icon('download') + ' Download RSS Feed</button>' +
      '<button class="btn" id="rss-dl-atom" type="button">' + icon('download') + ' Download Atom</button>' +
      '<button class="btn" id="rss-dl-json" type="button">' + icon('download') + ' Download JSON</button>' +
      '</div></div>' +
      (previewTab === 'visual' ? visual : xmlView) +
      '</div>';
  }

  function validationPanel(v) {
    if (!v) return '';
    var rows = (v.checks || []).map(function (c) {
      var cls = c.status === 'pass' ? 'pass' : c.status === 'warn' ? 'warn' : 'fail';
      var ic = c.status === 'pass' ? 'check_circle' : c.status === 'warn' ? 'warning' : 'cancel';
      return '<div class="check ' + cls + '"><span class="check-icon material-icons">' + ic + '</span><div><b>' + esc(c.name) + '</b><p>' + esc(c.message) + '</p></div></div>';
    }).join('');
    return '<div class="audit-panel wide"><h3>' + icon('verified') + ' XML Validation</h3>' +
      (v.valid ? '<div class="llmstxt-valid-ok">' + icon('verified') + ' Valid ' + (xmlFormat === 'atom' ? 'document' : 'RSS 2.0') + ', ready to download</div>' : '<div class="llmstxt-valid-bad">' + icon('error') + ' Not presented as valid: ' + esc((v.errors || []).length) + ' issue(s)</div>') +
      ((v.autoFixes || []).length ? '<p class="muted">Auto-fixed: ' + v.autoFixes.map(esc).join('; ') + '</p>' : '') +
      rows + '</div>';
  }

  function comparisonPanel() {
    var ef = state.existingFeed, c = state.comparison;
    if (!ef) return '';
    if (!c) return '<div class="audit-panel wide"><h3>' + icon('compare_arrows') + ' Existing Feed Comparison</h3><p class="muted">Generate the feed (or press <b>Compare Existing Feed</b>) to compare it with the site\'s existing feed at <span class="llmstxt-mono">' + esc(ef.url) + '</span>.</p></div>';
    function list(items, label) {
      if (!items.length) return '<p class="muted">' + label + ': none</p>';
      return '<b>' + label + ' (' + items.length + ')</b><ul class="rss-cmp-list">' + items.map(function (i) { return '<li><a class="llmstxt-link" href="' + esc(i.url || i.link) + '" target="_blank" rel="noopener">' + esc(i.title || i.url || i.link) + '</a></li>'; }).join('') + '</ul>';
    }
    var diffs = c.metadataDifferences.items.map(function (i) { return '<li><a class="llmstxt-link" href="' + esc(i.url) + '" target="_blank" rel="noopener">' + esc(i.title) + '</a>, differs in: ' + i.diffs.map(esc).join(', ') + '</li>'; }).join('');
    var broken = '';
    if (state.existingFeedCheck) {
      var bad = state.existingFeedCheck.filter(function (x) { return !x.ok; });
      broken = bad.length
        ? '<b>Broken URLs in existing feed (' + bad.length + ')</b><ul class="rss-cmp-list">' + bad.map(function (x) { return '<li><span class="llmstxt-mono">' + esc(x.url) + '</span>, ' + esc(x.status) + '</li>'; }).join('') + '</ul>'
        : '<p class="muted">Spot-checked ' + state.existingFeedCheck.length + ' existing-feed URLs: all reachable (2xx/3xx).</p>';
    } else {
      broken = '<p class="muted">Broken-URL spot check of the existing feed is unavailable in this mode.</p>';
    }
    return '<div class="audit-panel wide"><h3>' + icon('compare_arrows') + ' Existing Feed Comparison</h3><div class="audit-stats">' +
      stat('Existing items', c.existingCount) + stat('Generated items', c.generatedCount) +
      stat('Duplicate items', c.duplicates.count) + stat('Missing in generated', c.missingFromGenerated.count) +
      '</div>' + list(c.duplicates.items, 'Duplicate items') +
      list(c.missingFromGenerated.items, 'In existing feed, missing from generated') +
      list(c.missingFromExisting.items, 'In generated feed, missing from existing') +
      (diffs ? '<b>Metadata differences</b><ul class="rss-cmp-list">' + diffs + '</ul>' : '<p class="muted">Metadata differences: none</p>') +
      broken +
      '<p class="muted">The existing feed is never modified or replaced automatically, you choose which to publish.</p></div>';
  }

  function installPanel() {
    var feedUrl = (document.getElementById('rss-feed-url') && document.getElementById('rss-feed-url').value.trim()) || guessFeedUrl();
    var title = (state.channel.title || 'Site').replace(/[<>&"]/g, '');
    return '<div class="audit-panel wide"><h3>' + icon('publish') + ' Installation</h3><ol class="llmstxt-install">' +
      '<li><b>Download</b>, click <b>Download RSS Feed</b> above. You get <code>rss.xml</code>' + (state.atomXml ? ' (plus <code>atom.xml</code> if you want an Atom 1.0 version)' : '') + '.</li>' +
      '<li><b>Upload</b>, place it on your website, e.g. at <code>' + esc(feedUrl) + '</code>.</li>' +
      '<li><b>Add RSS discovery</b> to your HTML <code>&lt;head&gt;</code>:<pre class="rss-install-snippet">&lt;link rel="alternate"\n      type="application/rss+xml"\n      title="' + esc(title) + ' RSS Feed"\n      href="' + esc(feedUrl) + '"></pre></li>' +
      '</ol><p class="muted">Publishing a feed helps readers and feed aggregators discover your content, it does not guarantee traffic, indexing or rankings.</p></div>';
  }

  /* ---------- table ---------- */
  function tablePanel() {
    return '<div class="audit-panel wide rss-table-panel"><div class="llmstxt-table-head"><h3>' + icon('table_view') + ' Article Selection</h3><button class="btn" id="rss-add-btn" type="button">' + icon('add') + ' Add Item</button></div>' +
      '<div class="sitemap-filterbar"><input id="rss-search" class="text-input" placeholder="Search titles, URLs, reasons"><select id="rss-filter" class="select">' +
      '<option value="all">All pages</option><option value="included">Included</option><option value="excluded">Excluded</option><option value="content">Content pages</option><option value="undated">Missing date</option><option value="broken">Broken / unreachable</option><option value="manual">Manual / existing</option></select></div>' +
      '<div id="rss-add-form" class="llmstxt-add-form rss-add-form" hidden>' +
      '<input id="rss-add-title" class="text-input" placeholder="Title"><input id="rss-add-url" class="text-input" placeholder="https://example.com/article" inputmode="url">' +
      '<input id="rss-add-desc" class="text-input" placeholder="Description"><input id="rss-add-date" class="text-input" type="date">' +
      '<input id="rss-add-author" class="text-input" placeholder="Author (optional)"><input id="rss-add-cat" class="text-input" placeholder="Category (optional)">' +
      '<input id="rss-add-image" class="text-input" placeholder="Image URL (optional)" inputmode="url">' +
      '<div class="rss-add-actions"><button class="btn" id="rss-add-confirm" type="button">Add</button><button class="btn" id="rss-add-cancel" type="button">Cancel</button></div>' +
      '<p class="muted" style="grid-column:1/-1">Manual items are validated for URL format only, they are not crawled, and nothing is invented for them.</p></div>' +
      '<div class="table-scroll"><table class="mini-table rss-table"><thead><tr><th>Include</th><th>Article</th><th>URL</th><th>Date</th><th>Category</th><th>Author</th><th>Status</th><th></th></tr></thead><tbody id="rss-rows"></tbody></table></div>' +
      '<p class="muted" style="margin-top:8px">Edits (title, description, URL, date, category, author, image, include/exclude, order) persist across regeneration. Assigning a date to an undated item makes it eligible for the feed.' + (state.options && state.options.sortOrder === 'manual' ? ' Sort is Manual, use the arrows.' : '') + '</p></div>';
  }

  function visiblePages() {
    var term = search.toLowerCase();
    return state.pages.filter(function (p) {
      if (p._removed) return false;
      if (filter === 'included') { if (!p.included) return false; }
      else if (filter === 'excluded') { if (p.included) return false; }
      else if (filter === 'content') { if (!p.feedable && !p.added && !p.existing) return false; }
      else if (filter === 'undated') { if (p.date) return false; }
      else if (filter === 'broken') { if (p.status && p.status < 400 && !p.blocked && p.status) return false; }
      else if (filter === 'manual') { if (!p.added && !p.existing) return false; }
      if (!term) return true;
      return String(p.url + ' ' + p.title + ' ' + p.reason + ' ' + p.category + ' ' + p.type).toLowerCase().indexOf(term) >= 0;
    });
  }

  function renderTable() {
    var tb = document.getElementById('rss-rows');
    if (!tb) return;
    var o = state.options;
    var rows = visiblePages().slice(0, 400);
    tb.innerHTML = rows.map(function (p) {
      var src = DATE_SOURCES[p.dateSource] ? DATE_SOURCES[p.dateSource][0] : (p.dateSource || '');
      var dcls = p.dateSource === 'sitemap-lastmod' ? 's-fallback' : (p.dateSource === 'manual' ? 's-manual' : '');
      return '<tr data-idx="' + p.order + '" class="' + (p.included ? 'rss-row-in' : 'rss-row-out') + '">' +
        '<td><label class="llmstxt-switch"><input type="checkbox" data-act="toggle" ' + (p.included ? 'checked' : '') + '><span></span></label></td>' +
        '<td class="url-cell"><a class="llmstxt-link" href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(shortUrl(p.url)) + '</a>' +
        (p.type ? ' <span class="chip">' + esc(p.type) + '</span>' : '') + (p.existing ? ' <span class="chip">existing</span>' : '') + (p.added ? ' <span class="chip">manual</span>' : '') + (p.duplicateOf ? ' <span class="chip">dup</span>' : '') +
        '<input data-act="title" class="text-input rss-inline" value="' + esc(p.userTitle || p.title) + '" placeholder="Title" title="Title (edit to override)">' +
        '<input data-act="desc" class="text-input rss-inline" value="' + esc(p.userDescription != null ? p.userDescription : p.description) + '" placeholder="Description (edit to override)">' +
        (p.image ? '<span class="chip">' + icon('image') + ' image</span>' : '') + (p.audioUrl ? ' <span class="chip">' + icon('mic') + ' audio</span>' : '') +
        (p.reason && !p.included ? '<p class="rss-row-reason">' + esc(p.reason) + '</p>' : '') +
        '</td>' +
        '<td class="url-cell"><input data-act="url" class="text-input rss-inline rss-url-input" value="' + esc(p.userUrl || p.url) + '" placeholder="Item URL" title="URL (edit to override)"></td>' +
        '<td><input data-act="date" class="text-input rss-inline" type="date" value="' + esc(isoDay(p.userDate || p.date)) + '" title="Publication date" ' + (p.date ? '' : 'data-nodate="1"') + '>' + (src ? '<span class="chip ' + dcls + '">' + esc(src) + '</span>' : (p.included ? '<span class="chip">no date</span>' : '')) + '</td>' +
        '<td><input data-act="cat" class="text-input rss-inline" value="' + esc(p.userCategory != null ? p.userCategory : p.category) + '" placeholder="Category"></td>' +
        '<td><input data-act="author" class="text-input rss-inline" value="' + esc(p.userAuthor != null ? p.userAuthor : p.author) + '" placeholder="Author"></td>' +
        '<td>' + statusChip(p) + (p.noindex ? '<br><span class="chip">noindex</span>' : '') + '</td>' +
        '<td class="llmstxt-row-actions"><button class="llmstxt-mini" data-act="up" title="Move up">' + icon('arrow_upward') + '</button><button class="llmstxt-mini" data-act="down" title="Move down">' + icon('arrow_downward') + '</button><button class="llmstxt-mini" data-act="remove" title="Remove from list">' + icon('close') + '</button></td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="8">No matching pages.</td></tr>';
    var note = document.getElementById('rss-row-count');
    if (note) note.textContent = Math.min(visiblePages().length, 400) + ' of ' + visiblePages().length + ' pages shown.';
  }

  function rowPage(orderIdx) {
    return state.pages.filter(function (p) { return !p._removed; }).find(function (p) { return p.order === orderIdx; });
  }

  /* ---------- edits + regenerate ---------- */
  function buildPayload() {
    var pages = state.pages.filter(function (p) { return !p._removed; }).map(function (p) {
      return {
        url: p.url, title: p.userTitle || p.title || '', description: p.userDescription != null ? p.userDescription : (p.description || ''),
        userTitle: p.userTitle || null, userDescription: p.userDescription != null ? p.userDescription : null,
        userDate: p.userDate || null, userCategory: p.userCategory != null ? p.userCategory : null,
        userAuthor: p.userAuthor != null ? p.userAuthor : null, userImage: p.userImage != null ? p.userImage : null,
        userUrl: p.userUrl || null,
        date: p.date || null, dateSource: p.dateSource || null, dateReliable: p.dateReliable,
        author: p.author || null, category: p.category || '', image: p.image || null, canonical: p.canonical || null,
        audioUrl: p.audioUrl || null, articleHtml: p.articleHtml || '',
        status: p.status, type: p.type, feedable: p.feedable, wordCount: p.wordCount,
        included: p.included, removed: false, added: p.added, existing: p.existing,
        order: p.manualOrder
      };
    });
    return {
      url: state.url,
      mode: state.mode,
      channel: {
        title: (document.getElementById('rss-feed-title') || {}).value || state.channel.title,
        description: (document.getElementById('rss-feed-desc') || {}).value || state.channel.description,
        link: state.channel.link
      },
      options: readOptions(),
      platform: state.site.platform || [],
      existingFeed: state.existingFeed ? { url: state.existingFeed.url, format: state.existingFeed.format, title: state.existingFeed.title, itemCount: state.existingFeed.itemCount, items: state.existingItems } : null,
      pages: pages
    };
  }

  function regenerate(immediate) {
    if (regenerateTimer) clearTimeout(regenerateTimer);
    var run = function () {
      var body = buildPayload();
      fetch('/api/rss-finalize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (res) { return res.json(); })
        .then(function (json) {
          if (json && json.rssXml != null) {
            state.rssXml = json.rssXml;
            state.atomXml = json.atomXml || '';
            state.validation = json.validation;
            state.quality = json.quality;
            state.stats = Object.assign({}, state.stats, json.stats || {});
            state.comparison = json.comparison || null;
            state.exclusionReasons = json.exclusionReasons || state.exclusionReasons;
            // Sync per-row included/reason back from the server decision.
            (json.pages || []).forEach(function (jp) {
              var p = state.pages.find(function (x) { return x.url === jp.url && !x._removed; });
              if (p) { p.included = !!jp.included; if (jp.reason && !p.included && !p.reason) p.reason = jp.reason; }
            });
            renderOutputs();
            renderTable();
            var ip = document.getElementById('rss-feed-url');
            if (ip && !ip.value.trim()) ip.value = guessFeedUrl();
          } else if (json && json.message) {
            toast(json.message);
          }
        })
        .catch(function () { toast('Could not regenerate the feed.'); });
    };
    if (immediate) run(); else regenerateTimer = setTimeout(run, 350);
  }

  function movePage(page, dir) {
    var list = state.pages.filter(function (p) { return !p._removed; });
    var i = list.indexOf(page);
    var j = i + dir;
    if (j < 0 || j >= list.length) return;
    var tmp = page.manualOrder; page.manualOrder = list[j].manualOrder; list[j].manualOrder = tmp;
  }

  /* ---------- bindings ---------- */
  function bindStatic() {
    // existing feed panel
    var use = document.getElementById('rss-use-existing');
    if (use) use.onclick = useExistingFeed;
    var genNew = document.getElementById('rss-gen-new');
    if (genNew) genNew.onclick = function () { form.requestSubmit(); };
    var cmp = document.getElementById('rss-compare');
    if (cmp) cmp.onclick = function () { regenerate(true); };

    // table
    var tb = document.getElementById('rss-rows');
    if (tb) tb.addEventListener('change', onRowChange);
    if (tb) tb.addEventListener('click', onRowClick);
    if (tb) tb.addEventListener('input', onRowInput);

    var searchEl = document.getElementById('rss-search');
    if (searchEl) searchEl.addEventListener('input', function () { search = searchEl.value; renderTable(); });
    var filterEl = document.getElementById('rss-filter');
    if (filterEl) filterEl.addEventListener('change', function () { filter = filterEl.value; renderTable(); });

    var addBtn = document.getElementById('rss-add-btn');
    if (addBtn) addBtn.onclick = function () { var f = document.getElementById('rss-add-form'); f.hidden = !f.hidden; if (!f.hidden) document.getElementById('rss-add-title').focus(); };
    var addCancel = document.getElementById('rss-add-cancel');
    if (addCancel) addCancel.onclick = function () { document.getElementById('rss-add-form').hidden = true; };
    var addConfirm = document.getElementById('rss-add-confirm');
    if (addConfirm) addConfirm.onclick = addItem;
  }

  function bindOutputs() {
    var tabV = document.getElementById('rss-tab-visual');
    if (tabV) tabV.onclick = function () { previewTab = 'visual'; renderOutputs(); };
    var tabX = document.getElementById('rss-tab-xml');
    if (tabX) tabX.onclick = function () { previewTab = 'xml'; renderOutputs(); };
    var xmlSel = document.getElementById('rss-xml-sel');
    if (xmlSel) xmlSel.onchange = function () { xmlFormat = xmlSel.value; renderOutputs(); };

    var cp = document.getElementById('rss-copy-xml');
    if (cp) cp.onclick = function () { copy(currentXml()); };
    function warnIfInvalid() {
      var v = state.validation;
      if (v && !v.valid) toast('Downloaded, note: validation reported ' + (v.errors || []).length + ' issue(s).');
    }
    var dlr = document.getElementById('rss-dl-rss');
    if (dlr) dlr.onclick = function () { if (state.rssXml) { download('rss.xml', state.rssXml, 'application/rss+xml;charset=utf-8'); warnIfInvalid(); } else toast('Generate the feed first.'); };
    var dla = document.getElementById('rss-dl-atom');
    if (dla) dla.onclick = function () { if (state.atomXml) { download('atom.xml', state.atomXml, 'application/atom+xml;charset=utf-8'); warnIfInvalid(); } else toast('Generate the feed first.'); };
    var dlj = document.getElementById('rss-dl-json');
    if (dlj) dlj.onclick = function () {
      var sel = orderedSelected();
      var data = {
        site: state.channel, generatedAt: new Date().toISOString(),
        items: sel.map(function (p) { return {
          title: p.userTitle || p.title, url: p.userUrl || p.url,
          description: p.userDescription != null ? p.userDescription : p.description,
          pubDate: p.userDate || p.date, dateSource: p.dateSource,
          author: p.userAuthor != null ? p.userAuthor : p.author,
          category: p.userCategory != null ? p.userCategory : p.category,
          image: p.userImage != null ? p.userImage : p.image,
          canonical: p.canonical, type: p.type
        }; })
      };
      download('rss-items.json', JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
    };

    var title = document.getElementById('rss-feed-title');
    if (title) title.addEventListener('input', function () { state.channel.title = title.value; regenerate(false); });
    var desc = document.getElementById('rss-feed-desc');
    if (desc) desc.addEventListener('input', function () { state.channel.description = desc.value; regenerate(false); });
    var reg = document.getElementById('rss-regenerate');
    if (reg) reg.onclick = function () { regenerate(true); };
    ['rss-max-items', 'rss-content', 'rss-sort', 'rss-format', 'rss-inc-images', 'rss-inc-authors', 'rss-inc-cats', 'rss-inc-dates', 'rss-exc-undated'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'change', function () { syncOptionsFromSettings(); regenerate(false); });
    });
    var feedUrl = document.getElementById('rss-feed-url');
    if (feedUrl) feedUrl.value = feedUrl.value || guessFeedUrl();
  }

  function syncOptionsFromSettings() {
    var v = id => document.getElementById(id);
    state.options.maxItems = Number(v('rss-max-items').value);
    state.options.contentMode = v('rss-content').value;
    state.options.sortOrder = v('rss-sort').value;
    state.options.feedMode = v('rss-format').value;
    state.options.includeImages = v('rss-inc-images').checked;
    state.options.includeAuthors = v('rss-inc-authors').checked;
    state.options.includeCategories = v('rss-inc-cats').checked;
    state.options.includePubDate = v('rss-inc-dates').checked;
    state.options.excludeUndated = v('rss-exc-undated').checked;
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
    if (act === 'toggle') {
      page.included = !page.included;
      // Manually including a broken/blocked page: allowed, but flagged.
      if (page.included && (page.status === 0 || page.status >= 400 || page.blocked)) {
        page.reason = '';
        toast('Note: this URL was not verified, double-check it resolves.');
      }
      regenerate(true);
    }
    if (act === 'date') {
      page.userDate = e.target.value || null;
      if (page.userDate && !page.date) { page.date = page.userDate + 'T00:00:00.000Z'; page.dateSource = 'manual'; page.dateReliable = true; }
      regenerate(true);
    }
    if (act === 'cat') { page.userCategory = e.target.value; regenerate(false); }
    if (act === 'author') { page.userAuthor = e.target.value; regenerate(false); }
  }

  function onRowInput(e) {
    var act = e.target.getAttribute && e.target.getAttribute('data-act');
    var page = rowFromEvent(e);
    if (!page || !act) return;
    if (act === 'title') { page.userTitle = e.target.value; regenerate(false); }
    if (act === 'desc') { page.userDescription = e.target.value; regenerate(false); }
    if (act === 'url') { page.userUrl = e.target.value; regenerate(false); }
  }

  function onRowClick(e) {
    var act = e.target.getAttribute && e.target.getAttribute('data-act');
    var page = rowFromEvent(e);
    if (!page || !act) return;
    if (act === 'up') { movePage(page, -1); regenerate(true); }
    if (act === 'down') { movePage(page, 1); regenerate(true); }
    if (act === 'remove') { page._removed = true; regenerate(true); }
  }

  function addItem() {
    var t = (document.getElementById('rss-add-title').value || '').trim();
    var u = (document.getElementById('rss-add-url').value || '').trim();
    var d = (document.getElementById('rss-add-desc').value || '').trim();
    var dt = (document.getElementById('rss-add-date').value || '').trim();
    var a = (document.getElementById('rss-add-author').value || '').trim();
    var c = (document.getElementById('rss-add-cat').value || '').trim();
    var im = (document.getElementById('rss-add-image').value || '').trim();
    if (!u) { toast('Enter the item URL.'); return; }
    var parsed = null;
    try { parsed = new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u); } catch (e) { toast('That URL is not valid.'); return; }
    if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname || parsed.hostname.indexOf('.') < 0) { toast('Enter an absolute public URL.'); return; }
    if (parsed.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname) || parsed.hostname.indexOf('127.') === 0) { toast('Private or local URLs cannot be added.'); return; }
    if (!t) { toast('Enter a title (titles are never invented).'); return; }
    state.pages.push({
      url: parsed.toString(), requestedUrl: parsed.toString(), title: t, type: 'Manual', feedable: true,
      status: 200, date: dt ? dt + 'T00:00:00.000Z' : null, dateSource: dt ? 'manual' : null, dateReliable: dt ? true : null,
      author: a || null, category: c, image: im || null, canonical: parsed.toString(),
      noindex: false, blocked: false, challenge: false, redirected: false, jsHeavy: false, wordCount: 0,
      fromSitemap: false, hasArticleTag: false, included: true, reason: 'Manually added item', excludeReason: null,
      duplicateOf: null, added: true, existing: false, description: d, articleHtml: '', audioUrl: null,
      userTitle: t, userDescription: d || null, userDate: dt || null, userCategory: c || null, userAuthor: a || null, userImage: im || null, userUrl: null,
      order: Date.now(), manualOrder: Date.now()
    });
    document.getElementById('rss-add-form').hidden = true;
    ['rss-add-title', 'rss-add-url', 'rss-add-desc', 'rss-add-date', 'rss-add-author', 'rss-add-cat', 'rss-add-image'].forEach(function (id) { document.getElementById(id).value = ''; });
    renderTable();
    regenerate(true);
    toast('Item added.');
  }

  function useExistingFeed() {
    if (!state.existingItems.length) { toast('No items available from the existing feed.'); return; }
    state.pages = state.existingItems.map(function (it, i) {
      var iso = null, source = null, reliable = false;
      if (it.pubDate) {
        var d = new Date(it.pubDate);
        if (!Number.isNaN(d.getTime())) { iso = d.toISOString(); source = 'existing-feed'; reliable = true; }
      }
      return {
        url: it.link || it.guid, requestedUrl: it.link || it.guid, title: it.title || it.link, type: 'Existing feed', feedable: true,
        status: 200, date: iso, dateSource: source, dateReliable: reliable, author: it.author || null,
        category: (it.categories || []).join(', '), image: it.image || null, canonical: it.guid || it.link,
        noindex: false, blocked: false, challenge: false, redirected: false, jsHeavy: false, wordCount: 0,
        fromSitemap: false, hasArticleTag: false, included: true, reason: 'From existing feed at ' + state.existingFeed.url,
        excludeReason: null, duplicateOf: null, added: false, existing: true,
        description: (it.description || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300),
        articleHtml: it.description && it.description.indexOf('<') >= 0 ? it.description.replace(/<!\[CDATA\[|\]\]>/g, '') : '',
        audioUrl: null,
        userTitle: it.title || null, userDescription: null, userDate: null, userCategory: null, userAuthor: it.author || null, userImage: it.image || null, userUrl: null,
        order: i, manualOrder: i, _removed: false
      };
    });
    toast('Loaded ' + state.pages.length + ' items from the existing feed.');
    render(true);
    regenerate(true);
  }

  /* ---------- submit ---------- */
  function readOptions() {
    var fd = new FormData(form);
    return {
      mode: (fd.get('mode') || 'website'),
      maxPages: Number(fd.get('maxPages') || 60),
      maxDepth: fd.get('maxDepth') || 3,
      maxItems: Number(fd.get('maxItems') || 20),
      includeSubdomains: !!fd.get('includeSubdomains'),
      contentMode: fd.get('contentMode') || 'excerpt',
      feedMode: fd.get('feedMode') || 'standard',
      includeImages: fd.get('incImages') !== null,
      includeAuthors: fd.get('incAuthors') !== null,
      includeCategories: fd.get('incCategories') !== null,
      includePubDate: fd.get('incDates') !== null,
      excludeUndated: fd.get('excUndated') !== null,
      sortOrder: fd.get('sortOrder') || 'newest'
    };
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var body = readOptions();
    body.url = (document.getElementById('rss-url') || {}).value;
    abortCtrl = new AbortController();
    progressUI({ stage: 'validate', message: 'Validating URL…' });
    fetch('/api/rss', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: abortCtrl.signal })
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
              var eName = (part.match(/^event: (.+)$/m) || [])[1];
              var data = (part.match(/^data: ([\s\S]*)$/m) || [])[1];
              if (!data) return;
              var j = JSON.parse(data);
              if (eName === 'progress') progressUI(j);
              if (eName === 'result') renderReport(j);
              if (eName === 'error') throw j;
            });
            return pump();
          });
        }
        return pump();
      })
      .catch(function (e) {
        if (e && e.name === 'AbortError') e = { code: 'cancelled', message: 'The crawl was cancelled.' };
        if (e && e.code === 'cancelled') { out.innerHTML = '<div class="paper paper-padded audit-error"><span class="material-icons">cancel</span><h3>Cancelled</h3><p>' + esc(e.message) + '</p></div>'; return; }
        var fallback = ['unreachable', 'timeout', 'fetch_failed', 'tls_blocked', 'dns', 'ssrf', 'challenge', 'restricted', 'error'];
        if (e && fallback.indexOf(e.code) >= 0 && window.RssBrowserRunner && window.RssBrowserRunner.run) {
          progressUI({ stage: 'connect', message: 'The server could not reach the site, so your browser is fetching the pages instead…' });
          body.signal = abortCtrl.signal;
          return window.RssBrowserRunner.run(body, progressUI).then(renderReport).catch(function (be) { errorUI(be || e || {}); });
        }
        errorUI(e || {});
      })
      .finally(function () { abortCtrl = null; });
  });
})();
