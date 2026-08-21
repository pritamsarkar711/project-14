/* huvanti WordPress Theme Detector — report UI (independent of the other tools). */
(function () {
  'use strict';
  var form = document.getElementById('wptheme-form');
  if (!form) return;
  var urlInput = document.getElementById('wptheme-url');
  var out = document.getElementById('wptheme-results');
  var abortCtrl = null;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function ringColor(n) { return n >= 70 ? '#2e7d32' : n >= 40 ? '#ed6c02' : '#d32f2f'; }
  function pill(text, cls) { return '<span class="badge ' + (cls || 'info') + '">' + esc(text) + '</span>'; }
  function confChip(n) { return '<span class="conf">confidence ' + n + '%</span>'; }
  function toast(msg) {
    var t = el('div', 'toast', esc(msg));
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }
  function copy(text, label) {
    var done = function () { toast((label || 'Copied') + ' copied to clipboard'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
    else if (window.sumly && window.sumly.copy) { window.sumly.copy(text); done(); }
  }

  /* ---------- progress ---------- */
  var STEPS = [
    ['validate', 'URL validated'],
    ['connect', 'Website reached'],
    ['wordpress', 'WordPress signals analysed'],
    ['theme', 'Active theme located'],
    ['stylesheet', 'Theme stylesheet analysed'],
    ['parent', 'Child & parent theme resolved'],
    ['fingerprints', 'Fingerprints matched'],
    ['exposure', 'Public exposure checked'],
    ['report', 'Report built']
  ];
  function stepIndex(key) {
    var map = { parent: 'parent', stylesheet: 'stylesheet' };
    var k = map[key] || key;
    var i = STEPS.findIndex(function (s) { return s[0] === k; });
    return i < 0 ? 0 : i;
  }
  function progressUI(state) {
    var cur = stepIndex(state.stage);
    var doneAll = state.stage === 'done';
    var items = STEPS.map(function (s, i) {
      var st = doneAll || i < cur ? 'done' : i === cur ? 'active' : 'wait';
      var icon = st === 'done' ? 'check_circle' : st === 'active' ? 'autorenew' : 'hourglass_empty';
      return '<li class="pi-' + st + '"><span class="material-icons ' + (st === 'active' ? 'pi-active' : st === 'done' ? 'pi-done' : 'pi-wait') + '">' + icon + '</span>' + esc(s[1]) + '</li>';
    }).join('');
    out.innerHTML = '<div class="paper paper-padded adsense-progress wptheme-progress"><h3>Detecting the WordPress theme…</h3>'
      + '<ul class="progress-list">' + items + '</ul>'
      + '<p class="muted">' + esc(state.message || 'Working…') + '</p>'
      + '<button class="btn" type="button" id="wptheme-cancel">Cancel</button></div>';
    var b = document.getElementById('wptheme-cancel');
    if (b) b.onclick = function () { if (abortCtrl) abortCtrl.abort(); };
    if (state.stage === 'init') {
      var first = out.querySelector('li');
      if (first) first.className = 'pi-active';
    }
  }

  /* ---------- errors ---------- */
  function errorUI(err) {
    var msg = err.message || String(err);
    var code = err.code || 'error';
    var friendly = {
      invalid_url: 'Please enter a valid public website URL (e.g. https://example.com).',
      ssrf: 'That address cannot be scanned (private, local, or metadata target).',
      dns: 'The domain could not be resolved. Check the spelling or DNS.',
      ssl: 'The site’s HTTPS certificate could not be validated (expired, self-signed or incomplete chain). The scan cannot continue safely.',
      tls_blocked: 'The scanner server could not open a secure connection to the site (the TLS handshake was reset). This can be the site refusing server-side scanners — or the scanner server having no direct outbound access. Retrying through your browser usually resolves it.',
      timeout: 'The website took too long to respond.',
      unreachable: 'The website could not be reached. It may be offline or blocking this scanner.',
      blocked: 'The website refused every automated reader we tried — the direct connection, your browser, and three public relays (403/401). Some sites block all server-side traffic with their firewall. WordPress status cannot be honestly determined from here — this is an access failure, not a “not WordPress” result.',
      rate_limited_target: 'The website rate-limited this scanner (429).',
      server_error: 'The website returned a server error (5xx).',
      not_found: 'The page returned 404 — check the URL.',
      challenge: 'The site is behind a bot challenge (e.g. Cloudflare) that defeats automated readers, including public relays. Status: Unable to Verify — not “not WordPress”.',
      js_only: 'The page renders via JavaScript with almost no server HTML, so WordPress could not be verified from the initial response.',
      empty: 'The server returned an empty or non-HTML page.',
      redirect: 'Too many redirects or an unsafe redirect.',
      budget: 'The scan hit its safety budget before finishing.',
      too_large: 'A response was too large to analyse safely.',
      cancelled: 'The scan was cancelled.',
      busy: 'Another scan is already running on this server. Please wait a moment.',
      ratelimit: 'Too many scans from this network. Please wait a few minutes.'
    }[code] || 'The scan could not be completed.';
    var title = code === 'cancelled' ? 'Scan cancelled'
      : ['challenge', 'blocked', 'rate_limited_target', 'server_error', 'js_only', 'not_found', 'dns', 'ssl', 'tls_blocked', 'timeout', 'unreachable', 'redirect'].indexOf(code) >= 0
        ? 'Unable to determine' : 'Could not complete the scan';
    out.innerHTML = '<div class="paper paper-padded adsense-error wptheme-error"><span class="material-icons">' + (code === 'cancelled' ? 'cancel' : 'error_outline') + '</span><h3>' + title + '</h3>'
      + '<p>' + esc(friendly) + '</p>'
      + (code !== 'cancelled' && msg ? '<p class="muted">Reason: ' + esc(msg) + '</p>' : '')
      + (err.scan ? scanDetailsMini(err.scan) : '')
      + '<div class="report-actions"><button class="btn" id="wptheme-retry">' + (NETWORK_FALLBACK_CODES.indexOf(code) >= 0 ? 'Retry through browser' : 'Try again') + '</button></div></div>';
    var b = document.getElementById('wptheme-retry');
    if (b) b.onclick = function () { if (NETWORK_FALLBACK_CODES.indexOf(code) >= 0) browserScan(); else form.requestSubmit(); };
  }

  function scanDetailsMini(scan) {
    if (!scan) return '';
    return '<div class="ad-summary-grid" style="margin-top:8px">'
      + '<div class="ad-stat"><span>URL analysed</span><b style="font-size:.9rem;word-break:break-all">' + esc(scan.url || '—') + '</b></div>'
      + '<div class="ad-stat"><span>HTTP status</span><b>' + esc(scan.status || '—') + '</b></div>'
      + '<div class="ad-stat"><span>Requests</span><b>' + esc(scan.requests || 0) + '</b></div>'
      + '<div class="ad-stat"><span>Scan time</span><b>' + (scan.durationMs ? Math.round(scan.durationMs / 100) / 10 + 's' : '—') + '</b></div>'
      + '</div>';
  }

  /* ---------- report sections ---------- */

  function verdictCard(r) {
    var wp = r.wordpress;
    var isDetected = r.status === 'detected';
    var ring = wp ? wp.confidence : 0;
    var icon = r.status === 'detected' ? 'public' : r.status === 'not_detected' ? 'do_not_disturb_on' : 'help_outline';
    var vc = r.status === 'detected' ? 'ready' : r.status === 'not_detected' ? 'improve' : 'unverifiable';
    var summary;
    if (r.status === 'detected') summary = 'WordPress is running on this website. ' + (wp.note || '');
    else if (r.status === 'likely') summary = 'Strong WordPress signals were found, but not enough independent evidence for a definitive “Detected” verdict. ' + (wp.note || '');
    else if (r.status === 'not_detected') summary = 'No meaningful WordPress evidence was found in the readable page. ' + (wp.note || '');
    else summary = r.reason ? r.reason.message : 'The website could not be scanned.';
    var stats = '';
    if (wp) {
      stats = '<div class="ad-summary-grid">'
        + '<div class="ad-stat"><span>WordPress</span><b>' + (isDetected ? 'Yes' : r.status === 'likely' ? 'Likely' : 'No') + '</b></div>'
        + '<div class="ad-stat"><span>Core version</span><b>' + (wp.version ? esc(wp.version) : 'not shown') + '</b></div>'
        + '<div class="ad-stat"><span>Signal families</span><b>' + esc((wp.families || []).length) + '</b></div>'
        + '<div class="ad-stat"><span>Signals</span><b>' + esc((wp.signals || []).length) + '</b></div>'
        + '<div class="ad-stat"><span>Scan time</span><b>' + (r.scan && r.scan.durationMs ? Math.round(r.scan.durationMs / 100) / 10 + 's' : '—') + '</b></div>'
        + '</div>';
    }
    var plat = '';
    if (r.status === 'not_detected' && r.possiblePlatform) {
      plat = '<p class="calc-note"><span class="material-icons">travel_explore</span>Possible platform: <b>' + esc(r.possiblePlatform.name) + '</b> (' + r.possiblePlatform.confidence + '% match on ' + esc((r.possiblePlatform.matched || []).slice(0, 2).join(', ')) + '). This is a hint, not a CMS detection.</p>';
    }
    var builders = wp && wp.plugins && wp.plugins.length
      ? '<p class="muted" style="margin-top:10px">Detected WordPress plugins/builders (supporting evidence only): ' + wp.plugins.slice(0, 5).map(function (p) { return esc(p.name); }).join(' · ') + '</p>'
      : '';
    return '<div class="score-card adsense-scorecard wptheme-scorecard">'
      + '<div class="score-ring" style="--score:' + ring + ';background:conic-gradient(' + ringColor(ring) + ' calc(var(--score)*1%),var(--chip-bg) 0)"><b style="color:' + ringColor(ring) + '">' + ring + '</b></div>'
      + '<div class="score-summary">'
      + '<div class="verdict ' + vc + '"><span class="material-icons">' + icon + '</span>' + esc(r.statusLabel) + '</div>'
      + '<h2>WordPress ' + (isDetected ? 'Detected' : r.status === 'likely' ? 'Likely' : r.status === 'not_detected' ? 'Not Detected' : 'Unverifiable') + '</h2>'
      + '<p>' + esc(summary) + '</p>'
      + '<div class="source-chip">Confidence ' + ring + '% · every verdict is evidence-based · no AI, no third-party detection API' + (r.via === 'browser' ? ' · collected through your browser (server could not reach the site directly)' : '') + '</div>'
      + (r.homeBlocked ? '<p class="calc-note"><span class="material-icons">block</span>The live homepage refused automated readers (' + esc(r.homeBlocked.code === 'challenge' ? 'bot challenge' : 'HTTP ' + r.homeBlocked.status) + '). This verdict is based on other public endpoints, and the active theme could not be identified without the homepage HTML.</p>' : '')
      + (r.homeArchived ? '<p class="calc-note"><span class="material-icons">history</span>Theme discovery used an archived snapshot of the homepage (Wayback Machine' + (r.homeArchived.timestamp ? ', ' + esc(r.homeArchived.timestamp.slice(0, 8)) : '') + ') because the live site refused readers. Theme details were read from the live site; the discovered folder may lag behind reality.</p>' : '')
      + stats + plat + builders
      + '</div></div>';
  }

  function copyBtn(text, label) {
    return '<button type="button" class="row-detail wp-copy" data-copy="' + esc(text) + '" data-label="' + esc(label) + '" title="Copy ' + esc(label) + '"><span class="material-icons" style="font-size:14px;vertical-align:-3px">content_copy</span> copy</button>';
  }

  function versionHTML(v) {
    if (!v) return 'Not publicly detectable';
    if (v.label === 'exact') return '<b>' + esc(v.value) + '</b> <span class="muted">(exact — ' + esc(v.source) + ')</span>';
    if (v.label === 'appears') return '<b>' + esc(v.value) + '</b> <span class="muted">(appears to be — ' + esc(v.source) + ')</span>';
    return esc(v.detail || 'Not publicly detectable');
  }

  function themeCard(r) {
    var t = r.theme;
    if (!t) return '';
    if (!t.found) {
      return '<div class="audit-panel wide"><h3>Active theme</h3>'
        + '<div class="verdict unverifiable"><span class="material-icons">help</span>Unable to determine</div>'
        + '<p>WordPress is on this site, but the active theme could not be identified from public evidence. No guess is shown.</p>'
        + '<details class="audit-fold" open><summary>Why identification failed <b>' + t.why.length + ' reasons</b></summary><div>'
        + t.why.map(function (w) { return '<div class="prog-line small"><span>' + esc(w) + '</span></div>'; }).join('')
        + '</div></details>'
        + '<details class="audit-fold"><summary>Detection attempts <b>' + t.attempts.length + '</b></summary><div>'
        + t.attempts.map(function (a) { return '<div class="prog-line small"><span>' + esc(a) + '</span></div>'; }).join('')
        + '</div></details></div>';
    }
    var preview = '';
    if (t.preview && t.preview.available) {
      preview = '<div class="wp-preview"><img src="' + esc(t.preview.url) + '" alt="' + esc(t.name || t.slug) + ' theme screenshot" loading="lazy" onerror="this.closest(\'.wp-preview\').classList.add(\'wp-preview-missing\')"></div>';
    } else {
      preview = '<div class="wp-preview wp-preview-missing"><span class="material-icons" aria-hidden="true">palette</span><small>No public preview available</small></div>';
    }
    var fields = '';
    function field(label, value, copyText, copyLabel) {
      if (value == null || value === '') return '';
      return '<div class="ad-stat"><span>' + esc(label) + '</span><b class="wp-field-value">' + value + (copyText ? ' ' + copyBtn(copyText, copyLabel) : '') + '</b></div>';
    }
    var typePill = t.type === 'child' ? pill('Child theme', 'medium') : pill('Standard theme', 'info');
    fields += field('Theme name', esc(t.name), t.name, 'theme name');
    fields += field('Slug', '<code>' + esc(t.slug) + '</code>', t.slug, 'slug');
    fields += field('Version', versionHTML(t.version), t.version && t.version.value ? t.version.value : null, 'version');
    fields += field('Author', t.author ? esc(t.author) : null, t.author, 'author');
    fields += field('Theme type', typePill);
    fields += field('Detection confidence', '<span class="conf">' + t.confidence + '% — ' + esc(t.confidenceLabel) + '</span>');
    if (t.themeUri) fields += field('Official theme URL', '<a href="' + esc(t.themeUri) + '" target="_blank" rel="noopener nofollow">' + esc(t.themeUri) + '</a>');
    if (t.license) fields += field('License', esc(t.license) + (t.licenseUri ? ' · <a href="' + esc(t.licenseUri) + '" target="_blank" rel="noopener nofollow">license text</a>' : ''));

    var badges = '';
    if (t.premium && t.premium.label !== 'Unknown') badges += pill(t.premium.label, t.premium.label.indexOf('Premium') === 0 ? 'high' : 'passed');
    if (t.custom && t.custom.flag) badges += pill(t.custom.label || 'Possible custom theme', 'medium');
    badges += pill('Source: ' + (t.source ? t.source.label : 'Unknown'), 'info');

    return '<div class="audit-panel wide wp-theme-card"><h3>Active theme</h3>'
      + '<div class="wp-card">'
      + preview
      + '<div>'
      + '<div class="verdict ' + (t.confidence >= 85 ? 'ready' : t.confidence >= 55 ? 'improve' : 'unverifiable') + '"><span class="material-icons">palette</span>' + esc(t.name) + '</div>'
      + '<p class="muted" style="margin:4px 0 10px">' + badges + '</p>'
      + '<div class="ad-summary-grid">' + fields + '</div>'
      + (t.extraSlugs && t.extraSlugs.length ? '<p class="muted" style="margin-top:8px">Additional theme folders referenced (not active): ' + t.extraSlugs.map(function (s) { return '<code>' + esc(s) + '</code>'; }).join(', ') + '</p>' : '')
      + '</div></div>'
      + (t.description ? '<details class="audit-fold"><summary>Theme description</summary><div><p class="muted" style="padding:12px 14px;margin:0">' + esc(t.description) + '</p></div></details>' : '')
      + '</div>';
  }

  function parentCard(r) {
    var t = r.theme;
    if (!t || !t.isChild || !t.parent) return '';
    var p = t.parent;
    var fields = '';
    fields += '<div class="ad-stat"><span>Parent theme</span><b>' + esc(p.name) + ' ' + copyBtn(p.name, 'parent theme') + '</b></div>';
    fields += '<div class="ad-stat"><span>Parent slug</span><b><code>' + esc(p.slug) + '</code> ' + copyBtn(p.slug, 'parent slug') + '</b></div>';
    fields += '<div class="ad-stat"><span>Parent version</span><b>' + (p.version && p.version.value ? esc(p.version.value) + ' <span class="muted">(' + esc(p.version.label + (p.version.source ? ' — ' + p.version.source : '')) + ')</span>' : 'not detectable') + '</b></div>';
    fields += '<div class="ad-stat"><span>Parent author</span><b>' + (p.author ? esc(p.author) : 'unknown') + '</b></div>';
    fields += '<div class="ad-stat"><span>Parent style.css</span><b>' + esc(p.styleCssAccess) + '</b></div>';
    return '<div class="audit-panel wide"><h3>Parent theme</h3>'
      + '<div class="verdict improve"><span class="material-icons">account_tree</span>Child theme detected — parent: ' + esc(p.name) + '</div>'
      + '<div class="ad-summary-grid">' + fields + '</div>'
      + '<details class="audit-fold"><summary>Parent theme evidence <b>' + p.evidence.length + '</b></summary><div>'
      + p.evidence.map(function (e) { return '<div class="prog-line small"><span>' + esc(e) + '</span></div>'; }).join('')
      + '</div></details></div>';
  }

  function detailsCard(r) {
    var t = r.theme;
    if (!t || !t.found) return '';
    var rows = [];
    if (t.themeUri) rows.push(['Theme URI', '<a href="' + esc(t.themeUri) + '" target="_blank" rel="noopener nofollow">' + esc(t.themeUri) + '</a>']);
    if (t.authorUri) rows.push(['Author URI', '<a href="' + esc(t.authorUri) + '" target="_blank" rel="noopener nofollow">' + esc(t.authorUri) + '</a>']);
    if (t.license) rows.push(['License', esc(t.license) + (t.licenseUri ? ' (<a href="' + esc(t.licenseUri) + '" target="_blank" rel="noopener nofollow">text</a>)' : '')]);
    if (t.textDomain) rows.push(['Text domain', '<code>' + esc(t.textDomain) + '</code>']);
    if (t.tags && t.tags.length) rows.push(['Tags', t.tags.map(function (x) { return pill(x, 'low'); }).join(' ')]);
    if (t.styleCssAccess) rows.push(['style.css access', esc(t.styleCssAccess)]);
    if (!rows.length) return '';
    return '<div class="audit-panel wide"><h3>Theme details</h3><div class="page-table-wrap"><table class="mini-table wp-details-table"><tbody>'
      + rows.map(function (row) { return '<tr><td style="width:38%">' + esc(row[0]) + '</td><td>' + row[1] + '</td></tr>'; }).join('')
      + '</tbody></table></div></div>';
  }

  function versionStatusCard(r) {
    if (!r.versionStatus) return '';
    var cls = r.versionStatus.label === 'Current according to the available dataset' ? 'passed' : r.versionStatus.label === 'Older version detected' ? 'medium' : 'info';
    return '<div class="audit-panel wide"><h3>Version status</h3>'
      + '<div class="issue sev-info" style="border:0;padding:0 0 4px"><span class="material-icons issue-icon">history</span><div>'
      + '<h6>' + pill(r.versionStatus.label, cls) + '</h6><p>' + esc(r.versionStatus.detail) + '</p>'
      + '<small class="why"><span>Note</span> This comparison uses a bundled local dataset and never claims vulnerabilities. Verify with the theme vendor for security status.</small>'
      + '</div></div></div>';
  }

  function evidenceCard(r) {
    var wp = r.wordpress;
    if (!wp) return '';
    var wpRows = (wp.signals || []).map(function (s) {
      return '<div class="calc-line"><span>' + esc(s.detail) + ' <span class="muted">· family: ' + esc(s.family) + '</span></span><b>+' + s.weight + '</b></div>';
    }).join('');
    var tRows = r.theme && r.theme.evidence ? r.theme.evidence.map(function (e) {
      return '<div class="calc-line"><span>' + esc(e.label) + ' — <span class="muted">' + esc(e.detail) + '</span> · method: ' + esc(e.method) + '</span><b>+' + (e.weight || 0) + '</b></div>';
    }).join('') : '';
    var famChips = (wp.families || []).map(function (f) { return pill(f.label, 'low'); }).join(' ');
    return '<div class="audit-panel wide"><h3>Detection evidence</h3>'
      + '<p class="muted">Every verdict lists its evidence. Weights show how each signal contributed to the confidence score.</p>'
      + (famChips ? '<p>' + famChips + '</p>' : '')
      + '<details class="audit-fold" open><summary>WordPress signals <b>' + (wp.signals || []).length + ' · confidence ' + wp.confidence + '%</b></summary><div>' + (wpRows || '<p class="muted" style="padding:10px 14px">No WordPress signals.</p>') + '</div></details>'
      + (tRows ? '<details class="audit-fold"><summary>Theme evidence <b>' + r.theme.evidence.length + ' · confidence ' + r.theme.confidence + '%</b></summary><div>' + tRows + '</div></details>' : '')
      + '</div>';
  }

  function exposureCard(r) {
    if (!r.exposure) return '';
    var iconFor = { exposed: 'visibility', not_found: 'visibility_off', unknown: 'help_outline' };
    var clsFor = { exposed: 'sev-info', not_found: 'sev-passed', unknown: 'sev-info' };
    return '<div class="audit-panel wide"><h3>Theme exposure — publicly observable information</h3>'
      + '<p class="muted">' + esc(r.exposure.summary) + '</p>'
      + r.exposure.items.map(function (i) {
        return '<div class="issue ' + clsFor[i.status] + '" style="border:0"><span class="material-icons issue-icon">' + iconFor[i.status] + '</span><div>'
          + '<h6>' + esc(i.label) + ' ' + pill(i.status === 'exposed' ? 'publicly visible' : i.status === 'not_found' ? 'not exposed' : 'unknown', i.status === 'exposed' ? 'info' : i.status === 'not_found' ? 'passed' : 'manual') + '</h6>'
          + '<p>' + esc(i.detail) + '</p></div></div>';
      }).join('')
      + '<p class="muted" style="margin-top:8px">Informational only. This observes files a WordPress site normally makes public — it performs no exploitation or intrusive testing and makes no vulnerability claims.</p>'
      + '</div>';
  }

  function scanCard(r) {
    var s = r.scan;
    if (!s) return '';
    var methodChips = (s.methods || []).map(function (m) { return pill(m, 'low'); }).join(' ');
    return '<div class="audit-panel wide"><h3>Scan details</h3>'
      + '<div class="ad-summary-grid">'
      + '<div class="ad-stat"><span>URL analysed</span><b style="font-size:.85rem;word-break:break-all">' + esc(s.url) + '</b></div>'
      + '<div class="ad-stat"><span>Final URL</span><b style="font-size:.85rem;word-break:break-all">' + esc(s.finalUrl || '—') + '</b></div>'
      + '<div class="ad-stat"><span>HTTP status</span><b>' + esc(s.status || '—') + '</b></div>'
      + '<div class="ad-stat"><span>Duration</span><b>' + (s.durationMs ? Math.round(s.durationMs / 100) / 10 + 's' : '—') + '</b></div>'
      + '<div class="ad-stat"><span>Requests made</span><b>' + esc(s.requests) + '</b></div>'
      + '<div class="ad-stat"><span>Data read</span><b>' + (s.bytes ? (s.bytes / 1024).toFixed(0) + ' KB' : '—') + '</b></div>'
      + '<div class="ad-stat"><span>Signals collected</span><b>' + esc(s.signals || 0) + '</b></div>'
      + '<div class="ad-stat"><span>Redirects</span><b>' + esc((s.redirects || []).length) + '</b></div>'
      + '</div>'
      + ((s.robots && s.robots.notes && s.robots.notes.length) ? '<p class="muted" style="margin-top:8px">robots.txt: ' + s.robots.notes.map(esc).join(' · ') + '</p>' : '')
      + (methodChips ? '<p style="margin-top:8px">' + methodChips + '</p>' : '')
      + ((s.redirects || []).length > 1 ? '<details class="audit-fold"><summary>Redirect chain <b>' + s.redirects.length + ' hops</b></summary><div>' + s.redirects.map(function (h) { return '<div class="prog-line small"><span>' + esc(h.url) + '</span><b>' + esc(h.status) + '</b></div>'; }).join('') + '</div></details>' : '')
      + '</div>';
  }

  function actionsRow(r) {
    return '<div class="report-actions">'
      + '<button type="button" class="btn" id="wp-copy-all">Copy summary</button>'
      + '<button type="button" class="btn" id="wp-new-scan">Scan another site</button>'
      + '</div>';
  }

  function render(r) {
    var html = verdictCard(r)
      + (r.theme ? themeCard(r) : '')
      + parentCard(r)
      + detailsCard(r)
      + versionStatusCard(r)
      + evidenceCard(r)
      + exposureCard(r)
      + scanCard(r);
    out.innerHTML = actionsRow(r) + '<div class="audit-grid wptheme-report">' + html + '</div>';
    var copyAll = document.getElementById('wp-copy-all');
    if (copyAll) copyAll.onclick = function () { copy(r.copyText || '', 'Summary'); };
    var newScan = document.getElementById('wp-new-scan');
    if (newScan) newScan.onclick = function () { urlInput.focus(); urlInput.select(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    Array.prototype.forEach.call(out.querySelectorAll('.wp-copy'), function (b) {
      b.addEventListener('click', function () { copy(b.getAttribute('data-copy') || '', b.getAttribute('data-label') || 'Value'); });
    });
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- server scan + browser-relay fallback ---------- */
  /* When the scanner server itself cannot reach the site (no outbound access,
     TLS reset, firewall), the same resources are collected through the
     visitor's browser and analysed by the identical server-side engine. */
  var NETWORK_FALLBACK_CODES = ['tls_blocked', 'ssl', 'unreachable', 'timeout', 'dns', 'fetch_failed', 'network', 'blocked', 'challenge', 'rate_limited_target'];

  function browserScan() {
    if (!(window.WpThemeCollector && window.WpThemeCollector.collect)) {
      errorUI({ code: 'error', message: 'Browser collection is not available on this page.' });
      return;
    }
    progressUI({ stage: 'connect', message: 'The scanner server could not reach the site directly. Collecting evidence through your browser…' });
    window.WpThemeCollector.collect(urlInput.value.trim(), {
      signal: abortCtrl ? abortCtrl.signal : undefined,
      onProgress: progressUI
    }).then(function (bundle) {
      return fetch('/api/wptheme-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundle: bundle }),
        signal: abortCtrl ? abortCtrl.signal : undefined
      }).then(function (res) {
        return res.json().then(function (j) {
          if (!res.ok || (j && j.code && !j.wordpress)) throw j;
          return j;
        });
      });
    }).then(render).catch(function (err) {
      if (err && (err.name === 'AbortError' || (abortCtrl && abortCtrl.signal.aborted))) { errorUI({ code: 'cancelled', message: 'Cancelled' }); return; }
      errorUI(err && err.code ? err : { code: 'fetch_failed', message: (err && err.message) || 'Browser collection failed.' });
    });
  }

  function shouldFallback(err) {
    return err && NETWORK_FALLBACK_CODES.indexOf(err.code) >= 0;
  }

  /* ---------- SSE consumption ---------- */
  function run() {
    var url = urlInput.value.trim();
    if (!url) return;
    abortCtrl = new AbortController();
    progressUI({ stage: 'init', message: 'Starting…' });
    fetch('/api/wptheme-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url }),
      signal: abortCtrl.signal
    }).then(function (res) {
      if (!res.ok || !res.body) {
        return res.json().catch(function () { return {}; }).then(function (j) { throw { code: j.code || 'error', message: j.message || ('HTTP ' + res.status) }; });
      }
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = '';
      var result = null, error = null;
      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) return;
          buf += dec.decode(chunk.value, { stream: true });
          var parts = buf.split('\n\n');
          buf = parts.pop();
          parts.forEach(function (part) {
            var ev = (part.match(/^event:\s*(.+)$/m) || [])[1];
            var dataLine = (part.match(/^data:\s*(.+)$/m) || [])[1];
            if (!ev || dataLine == null) return;
            var data;
            try { data = JSON.parse(dataLine); } catch (e) { return; }
            if (ev === 'progress') progressUI(data);
            else if (ev === 'result') result = data;
            else if (ev === 'error') error = data;
          });
          if (result || error) return;
          return pump();
        });
      }
      return pump().then(function () {
        if (result) return result;
        throw error || { code: 'empty', message: 'The scan returned no result.' };
      });
    }).then(render).catch(function (err) {
      if (err && (err.name === 'AbortError' || (abortCtrl && abortCtrl.signal.aborted))) { errorUI({ code: 'cancelled', message: 'Cancelled' }); return; }
      if (shouldFallback(err)) { browserScan(); return; }
      errorUI(err && err.code ? err : { code: 'fetch_failed', message: (err && err.message) || 'Network error' });
    }).then(function () { abortCtrl = null; });
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); run(); });
  var qs = new URLSearchParams(location.search).get('url');
  if (qs) { urlInput.value = qs; form.requestSubmit(); }
})();
