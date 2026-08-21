/* huvanti Domain Information Checker — UI.
 *
 * Renders the scan progress (SSE) and the full evidence-based report using
 * the site's existing design system (audit-panel, chips, pills, folds,
 * status colours). Every value carries its source; unavailable data is shown
 * as "Not publicly available" / "Unable to Verify" — never fabricated.
 *
 * Browser relay: when the scanner server has no direct HTTPS egress, the page
 * collects the site's HTTP response through the visitor's browser (direct
 * CORS fetch first, public CORS relays as fallback) and merges the HTTP
 * section, technology and observed subdomains into the same report.
 */
(function (global) {
  'use strict';
  var DC = global.DomainCheckUI = global.DomainCheckUI || {};

  var RESULTS = null; // results container element
  var current = { report: null, relayPromise: null };

  /* ---------------- helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  }
  function icon(name) { return '<span class="material-icons" aria-hidden="true">' + esc(name) + '</span>'; }
  function fmtDate(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return esc(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  }
  function copyText(text, label) {
    var done = function () { toast((label || 'Value') + ' copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(String(text)).then(done, function () { legacyCopy(String(text)); done(); });
    } else {
      legacyCopy(String(text)); done();
    }
  }
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }
  var toastTimer = null;
  function toast(msg) {
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2200);
  }

  function pill(status) {
    var cls = 's-unk', label = String(status || 'Unknown');
    if (/valid|active|registered|detected|enabled|ok|pass/i.test(status)) cls = 's-ok';
    if (/expired|invalid|fail|error|suspended|problem/i.test(status)) cls = 's-err';
    if (/unavailable|unable|not|partial|possible|unknown|redirect/i.test(status)) cls = 's-unk';
    if (/hold|pending|warn/i.test(status)) cls = 's-redir';
    return '<span class="status-pill ' + cls + '">' + esc(label) + '</span>';
  }
  function confPill(conf) {
    if (conf == null) return '';
    return '<span class="conf" title="Detection confidence">' + esc(conf) + '% confidence</span>';
  }
  function srcChip(src) {
    if (!src) return '';
    return '<span class="source-chip">Source: ' + esc(src) + '</span>';
  }
  function NA(text) {
    return '<span class="dc-na">' + esc(text || 'Not publicly available') + '</span>';
  }
  function copyBtn(text, label) {
    return '<button type="button" class="row-detail" data-copy="' + esc(String(text).replace(/"/g, '&quot;')) + '" data-label="' + esc(label || 'Value') + '">' + icon('content_copy') + '</button>';
  }

  /* ---------------- scan (SSE) ---------------- */
  function runScan(input, onProgress) {
    return new Promise(function (resolve, reject) {
      var ac = new AbortController();
      var timer = setTimeout(function () { ac.abort(); reject({ code: 'timeout', message: 'The check timed out.' }); }, 90000);
      fetch('/api/domaincheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: input }),
        signal: ac.signal
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
            if (r.done) { clearTimeout(timer); resolve(null); return; }
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
              try { obj = JSON.parse(data); } catch (e) { /* keep null */ }
              if (eventName === 'progress' && onProgress) onProgress(obj);
              else if (eventName === 'result' && obj) { clearTimeout(timer); resolve(obj); return; }
              else if (eventName === 'error') {
                clearTimeout(timer);
                reject({ code: (obj && obj.code) || 'error', message: (obj && obj.message) || 'The check failed.' });
                return;
              }
            }
            return pump();
          });
        }
        return pump();
      }).catch(function (e) {
        clearTimeout(timer);
        reject({ code: (e && e.code) || 'network', message: (e && e.message) || 'Network error while checking.' });
      });
    });
  }

  /* ---------------- browser relay (HTTP section) ---------------- */
  var RELAYS = [
    { name: 'allorigins', build: function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); }, parse: 'text' },
    { name: 'corsproxy', build: function (u) { return 'https://corsproxy.io/?url=' + encodeURIComponent(u); }, parse: 'text' },
    { name: 'codetabs', build: function (u) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u); }, parse: 'text' }
  ];
  function relayFetch(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var ac = new AbortController();
      var timer = setTimeout(function () { ac.abort(); reject({ code: 'timeout' }); }, timeoutMs || 9000);
      fetch(url, { signal: ac.signal, redirect: 'follow' })
        .then(function (res) {
          clearTimeout(timer);
          var headers = {};
          try {
            res.headers.forEach(function (v, k) { headers[k.toLowerCase()] = v; });
          } catch (e) { /* opaque */ }
          res.text().then(function (text) {
            resolve({ status: res.status, statusText: res.statusText, headers: headers, body: text, finalUrl: res.url || null, ok: res.ok, type: res.type });
          }).catch(function () {
            resolve({ status: res.status, statusText: res.statusText, headers: headers, body: '', finalUrl: res.url || null, ok: res.ok, type: res.type });
          });
        })
        .catch(function (e) { clearTimeout(timer); reject({ code: e && e.name === 'AbortError' ? 'timeout' : 'blocked' }); });
    });
  }

  function collectBrowserBundle(domain, onStatus) {
    var httpsUrl = 'https://' + domain + '/';
    var httpUrl = 'http://' + domain + '/';
    var bundle = { https: null, http: null, redirectChain: [] };

    function directTry() {
      if (onStatus) onStatus('Trying a direct fetch from your browser…');
      var ac = new AbortController();
      var timer = setTimeout(function () { ac.abort(); }, 6000);
      return fetch(httpsUrl, { signal: ac.signal, redirect: 'follow' })
        .then(function (res) {
          clearTimeout(timer);
          var headers = {};
          try { res.headers.forEach(function (v, k) { headers[k.toLowerCase()] = v; }); } catch (e) { /* opaque */ }
          if (res.type === 'opaque') return { status: 200, statusText: '', headers: {}, body: '', finalUrl: httpsUrl, opaque: true };
          return res.text().then(function (text) {
            return { status: res.status, statusText: res.statusText, headers: headers, body: text.slice(0, 300000), finalUrl: res.url || httpsUrl };
          });
        })
        .catch(function () { clearTimeout(timer); return null; });
    }

    function relaysFor(url, which) {
      return (function next(i) {
        if (i >= RELAYS.length) return Promise.resolve(null);
        var r = RELAYS[i];
        return relayFetch(r.build(url), 10000).then(function (res) {
          if (res.status >= 400 && res.status !== 404) return next(i + 1);
          var out = { status: res.status, statusText: res.statusText, headers: res.headers || {}, body: res.body || '', finalUrl: res.finalUrl || url, viaRelay: r.name };
          if (which === 'https') bundle.https = out;
          else bundle.http = out;
          return out;
        }).catch(function () { return next(i + 1); });
      })(0);
    }

    return directTry().then(function (direct) {
      if (direct) {
        if (onStatus) onStatus('Direct browser fetch succeeded.');
        bundle.https = direct;
        return bundle;
      }
      if (onStatus) onStatus('Direct fetch is blocked by CORS — trying public read-only relays…');
      return relaysFor(httpsUrl, 'https').then(function () {
        return relaysFor(httpUrl, 'http').then(function () {
          return bundle;
        });
      });
    }).catch(function () { return bundle; });
  }

  function mergeRelayResult(report, merged) {
    if (!merged || !merged.http) return report;
    if (merged.http.status === 'unavailable') return report;
    report.http = merged.http;
    if (merged.technology) report.technology.items = merged.technology;
    if (merged.subdomains) report.subdomains = merged.subdomains;
    if (report.transport) { report.transport.browserRelay = true; }
    var idx = -1;
    for (var i = 0; i < report.unverified.length; i++) {
      if (report.unverified[i].subject === 'HTTP status') idx = i;
    }
    if (idx !== -1) report.unverified.splice(idx, 1);
    return report;
  }

  /* ---------------- progress UI ---------------- */
  function renderProgress(container, message, completed) {
    var items = [
      ['domain_validated', 'Domain validated'],
      ['rdap_completed', 'RDAP / WHOIS lookup completed'],
      ['dns_retrieved', 'DNS records retrieved'],
      ['ip_retrieved', 'IP information retrieved'],
      ['ns_analyzed', 'Nameservers analyzed'],
      ['ssl_analyzed', 'SSL analyzed'],
      ['http_analyzed', 'HTTP analyzed'],
      ['email_analyzed', 'Email records analyzed'],
      ['dnssec_analyzed', 'DNSSEC checked'],
      ['technology_completed', 'Technology detection completed'],
      ['age_calculated', 'Domain age calculated']
    ];
    var done = completed || [];
    var html = '<div class="audit-loading domaincheck-progress"><h3>' + icon('dns') + ' Checking ' + esc(currentInput()) + '</h3>' +
      '<div class="progress-bar"><i style="width:' + Math.min(100, Math.round((done.length / items.length) * 100)) + '%"></i></div>' +
      '<ul class="progress-list">';
    for (var i = 0; i < items.length; i++) {
      var isDone = done.indexOf(items[i][0]) !== -1;
      html += '<li>' +
        (isDone ? '<span class="material-icons pi-done">check_circle</span>'
          : '<span class="material-icons ' + (done.length === i ? 'pi-active' : 'pi-wait') + '">' + (done.length === i ? 'sync' : 'radio_button_unchecked') + '</span>') +
        items[i][1] + '</li>';
    }
    html += '</ul><p class="muted">' + esc(message || 'Working…') + '</p></div>';
    container.innerHTML = html;
  }
  var lastInput = '';
  function currentInput() { return lastInput; }

  /* ---------------- report sections ---------------- */
  function section(title, iconName, body, extra) {
    return '<div class="audit-panel' + (extra ? ' ' + extra : '') + '"><h3>' + icon(iconName) + ' ' + esc(title) + '</h3>' + body + '</div>';
  }
  function statRow(label, valueHtml, copyable) {
    return '<div class="ad-stat"><span>' + esc(label) + '</span><b>' + valueHtml + '</b></div>';
  }
  function kv(label, valueHtml) {
    return '<div class="calc-line"><span>' + esc(label) + '</span><b>' + valueHtml + '</b></div>';
  }

  function overviewHtml(r) {
    var d = r.domain;
    var status = r.domainStatus || {};
    var age = r.age || {};
    var reg = r.registration;
    var html = '<div class="dc-hero-card">';
    html += '<div class="dc-domain-row"><div class="dc-domain-big">' + esc(d.ascii) +
      (d.isIdn ? ' <span class="dc-puny" title="Unicode form">(' + esc(d.unicode || '') + ')</span>' : '') +
      '</div>' + copyBtn(d.ascii, 'Domain') + '</div>';
    html += '<div class="dc-hero-meta">' + pill(status.status || 'Unknown') + ' ' + pill(r.availability.display) + '</div>';
    if (status.note) html += '<p class="muted">' + esc(status.note) + '</p>';
    html += '</div>';
    html += '<div class="ad-summary-grid dc-overview-grid">';
    html += statRow('Domain status', pill(status.status || 'Unknown'));
    html += statRow('Registration', age.registeredDate ? fmtDate(age.registeredIso) : NA());
    html += statRow('Expiration', age.expiresIso ? fmtDate(age.expiresIso) : NA());
    html += statRow('Registrar', reg && reg.registrar && reg.registrar.name ? esc(reg.registrar.name) : NA());
    html += '</div>';
    html += '<div class="dc-age-box">';
    if (age.available) {
      html += '<div class="dc-age-big">' + esc(age.ageTextValue || '') + '</div>';
      html += '<div class="dc-age-sub">Registered ' + fmtDate(age.registeredIso) + ' · ' + esc(age.totalDays != null ? age.totalDays.toLocaleString() + ' total days' : '') + '</div>';
      if (age.expiry) {
        html += '<div class="dc-age-expiry ' + esc(age.expiry.level) + '">' + esc(age.expiry.label) + (age.expiry.daysUntilExpiry != null ? ' (' + (age.expiry.daysUntilExpiry < 0 ? Math.abs(age.expiry.daysUntilExpiry) + ' days ago' : age.expiry.daysUntilExpiry + ' days') + ')' : '') + '</div>';
        if (age.expiry.note) html += '<div class="calc-note">' + icon('info') + '<span>' + esc(age.expiry.note) + '</span></div>';
      }
    } else {
      html += '<div class="dc-age-big dc-age-unknown">' + esc(age.note || 'Domain age cannot be reliably determined.') + '</div>';
    }
    html += '</div>';
    return section('Domain Overview', 'public', html, 'dc-overview');
  }

  function registrationHtml(r) {
    var reg = r.registration;
    if (!reg) {
      return section('Domain Registration Information', 'assignment', '<div class="dc-na-box">' + icon('search_off') +
        '<b>Registration information unavailable.</b><p class="muted">' + esc(r.availability.note || 'Neither RDAP nor WHOIS returned a record for this domain.') + '</p></div>', 'dc-registration');
    }
    var html = '';
    var g = reg.dates || {};
    html += '<div class="ad-summary-grid">';
    html += statRow('Registration date', g.registered ? fmtDate(g.registered) : NA());
    html += statRow('Last updated', g.updated ? fmtDate(g.updated) : NA());
    html += statRow('Expiration date', g.expires ? fmtDate(g.expires) : NA());
    html += statRow('Registry DB updated', g.databaseUpdated ? fmtDate(g.databaseUpdated) : NA());
    html += '</div>';
    html += '<details class="audit-fold" open><summary><span>Registrar</span><b>RDAP/WHOIS</b></summary><div style="padding:4px 14px 12px">';
    if (reg.registrar) {
      var rr = reg.registrar;
      html += kv('Registrar', esc(rr.name || 'Unknown') + ' ' + (rr.ianaId ? '<span class="chip">IANA ID ' + esc(rr.ianaId) + '</span>' : ''));
      if (rr.url) html += kv('Registrar website', '<a class="dc-link" href="' + esc(rr.url) + '" rel="noopener nofollow" target="_blank">' + esc(rr.url) + '</a>');
      if (rr.abuseEmail) html += kv('Registrar abuse email', esc(rr.abuseEmail) + copyBtn(rr.abuseEmail, 'Abuse email'));
      if (rr.abusePhone) html += kv('Registrar abuse phone', esc(rr.abusePhone));
    } else {
      html += kv('Registrar', NA());
    }
    html += kv('Registry', r.tld && r.tld.registry ? esc(r.tld.registry) : NA());
    html += kv('RDAP endpoint', reg.rdapServer ? '<span class="dc-mono">' + esc(reg.rdapServer) + '</span>' : (r.tld && r.tld.rdapEndpoint ? '<span class="dc-mono">' + esc(r.tld.rdapEndpoint) + '</span>' : NA()));
    html += kv('WHOIS server', reg.whoisServer ? esc(reg.whoisServer) : (r.tld && r.tld.whoisServer ? esc(r.tld.whoisServer) : NA()));
    html += '</div></details>';

    html += '<details class="audit-fold" open><summary><span>Domain status (EPP codes)</span><b>' + (reg.statuses || []).length + '</b></summary><div style="padding:4px 14px 12px">';
    if (reg.statuses && reg.statuses.length) {
      var groups = reg.statusGroups || { normal: [], 'transfer-restricted': [], 'update-restricted': [], pending: [], problem: [] };
      var order = [['normal', 'Normal', 'check_circle'], ['transfer-restricted', 'Transfer restricted', 'swap_horiz'], ['update-restricted', 'Update restricted', 'edit_off'], ['pending', 'Pending', 'hourglass_top'], ['problem', 'Problem / attention', 'error_outline']];
      for (var i = 0; i < order.length; i++) {
        var list = groups[order[i][0]] || [];
        if (!list.length) continue;
        html += '<div class="dc-status-group"><div class="dc-status-group-head">' + icon(order[i][2]) + esc(order[i][1]) + '</div>';
        for (var j = 0; j < list.length; j++) {
          html += '<div class="dc-status-item"><span class="dc-mono">' + esc(list[j].code) + '</span> — ' + esc(list[j].label || list[j].code) +
            '<p class="muted">' + esc(list[j].explanation || '') + '</p></div>';
        }
        html += '</div>';
      }
      html += '<p class="muted">Standard registrar locks (such as clientTransferProhibited) are normal anti-hijacking settings — they are grouped under “Normal” and are not problems.</p>';
    } else {
      html += '<p class="muted">No status codes were returned by the registry.</p>';
    }
    html += '</div></details>';

    html += '<details class="audit-fold"><summary><span>Registry nameservers</span><b>' + (reg.nameservers || []).length + '</b></summary><div style="padding:4px 14px 12px">';
    if (reg.nameservers && reg.nameservers.length) {
      html += reg.nameservers.map(function (n) { return '<div class="dc-ns-line"><span class="dc-mono">' + esc(n) + '</span>' + copyBtn(n, 'Nameserver') + '</div>'; }).join('');
    } else html += '<p class="muted">None published in the registry record.</p>';
    html += '</div></details>';

    html += '<details class="audit-fold"><summary><span>DNSSEC (registry view)</span><b>' + esc(reg.dnssec || 'unknown') + '</b></summary><div style="padding:4px 14px 12px"><p class="muted">' +
      (reg.dnssec === 'signed' ? 'The registry records that the delegation is DNSSEC-signed.' : reg.dnssec === 'unsigned' ? 'The registry records that the delegation is not DNSSEC-signed.' : 'The registry record did not state a DNSSEC delegation status.') +
      '</p></div></details>';

    html += '<details class="audit-fold"><summary><span>Registrant privacy</span><b>' + (reg.privacy && reg.privacy.redacted ? 'Protected' : 'unknown') + '</b></summary><div style="padding:4px 14px 12px"><p class="muted">' +
      (reg.privacy && reg.privacy.redacted
        ? 'Registrant information is privacy-protected or unavailable. Owner name, address, phone and email are respected as private and are never shown or bypassed.'
        : 'Registrant details were not shown by the registry output. This tool never displays private registrant information regardless.') +
      '</p></div></details>';

    html += srcChip('Source: ' + (reg.source === 'rdap' ? 'RDAP (registry)' : 'WHOIS (registry)'));
    return section('Domain Registration Information', 'assignment', html, 'dc-registration');
  }

  function timelineHtml(r) {
    var items = r.timeline || [];
    if (!items.length) return section('Registration Timeline', 'timeline', NA('No dates available to build a timeline.'), 'dc-timeline');
    var html = '<div class="dc-timeline">';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var cls = it.event === 'now' ? 'now' : it.event;
      var date = fmtDate(it.date);
      html += '<div class="dc-tl-item ' + esc(cls) + '">' +
        '<div class="dc-tl-dot">' + icon(it.event === 'registered' ? 'flag' : it.event === 'updated' ? 'sync' : it.event === 'expires' ? 'event_busy' : 'today') + '</div>' +
        '<div class="dc-tl-label">' + esc(it.label || it.event) + '</div>' +
        '<div class="dc-tl-date">' + (date || esc(it.date)) + '</div>' +
        '</div>';
      if (i < items.length - 1) html += '<div class="dc-tl-line"><span class="material-icons">arrow_downward</span></div>';
    }
    html += '</div>';
    return section('Registration Timeline', 'timeline', html, 'dc-timeline');
  }

  function hostingHtml(r) {
    var h = r.ip.hosting || {};
    var cdn = r.cdn || {};
    var html = '';
    html += '<div class="ad-summary-grid">';
    if (h.originHosting === 'identified' && h.provider) {
      html += statRow('Hosting / network provider', '<span class="dc-value">' + esc(h.provider) + '</span> ' + confPill(h.confidence));
      html += statRow('ASN', h.asn ? 'AS' + esc(h.asn) : NA());
      html += statRow('Organization', esc(h.organization || ''));
      html += statRow('IP address', h.ip ? '<span class="dc-mono">' + esc(h.ip) + '</span>' + copyBtn(h.ip, 'IP address') : NA());
    } else if (h.originHosting === 'not-determinable') {
      html += statRow('Hosting / network provider', NA('Not publicly determinable'));
    } else {
      html += statRow('Hosting / network provider', NA());
    }
    html += statRow('CDN / proxy', cdn.status === 'detected' ? '<span class="dc-value">' + esc(cdn.provider) + '</span> ' + confPill(cdn.confidence) : (cdn.status === 'possible' ? 'Possible: ' + esc(cdn.provider) : 'Not detected'));
    html += statRow('Origin hosting', h.originHosting === 'identified' ? esc(h.provider || '') : (h.originHosting === 'not-determinable' ? NA('Not publicly determinable') : NA()));
    html += '</div>';
    if (cdn.status === 'detected') {
      html += '<div class="calc-note">' + icon('layers') + '<span>The domain is served through the <b>' + esc(cdn.provider) + '</b> CDN/proxy. That network is the edge — it is NOT claimed as the origin host. ' +
        (h.originHosting === 'identified' ? 'The origin appears to be hosted at ' + esc(h.provider) + '.' : 'The origin host is not publicly determinable.') + '</span></div>';
      if (cdn.evidence && cdn.evidence.length) {
        html += '<details class="audit-fold"><summary><span>CDN evidence</span><b>' + cdn.evidence.length + ' signals</b></summary><div style="padding:4px 14px 12px">';
        html += cdn.evidence.map(function (e) { return '<div class="dc-evidence">' + esc(e.signal) + ': ' + esc(e.detail) + '</div>'; }).join('');
        html += '</div></details>';
      }
    }
    if (h.notes && h.notes.length) {
      html += '<div class="dc-notes">' + h.notes.map(function (n) { return '<p class="muted">' + esc(n) + '</p>'; }).join('') + '</div>';
    }
    if (h.source) html += srcChip(h.source);
    return section('Hosting & Network', 'dns', html, 'dc-hosting');
  }

  function ipTableHtml(r) {
    var ips = r.ip.all || [];
    if (!ips.length) return section('IP Information', 'router', NA('No A/AAAA records were found, so no IP information is available.'), 'dc-ip');
    var html = '<div class="table-scroll"><table class="mini-table"><thead><tr><th>IP</th><th>Version</th><th>ASN</th><th>Organization</th><th>Network (prefix)</th><th>Country</th><th>Reverse DNS</th><th>Confidence</th></tr></thead><tbody>';
    for (var i = 0; i < ips.length; i++) {
      var ip = ips[i];
      var ptr = (r.ip && r.ip.ptrs || {})[ip.ip];
      html += '<tr><td><span class="dc-mono">' + esc(ip.ip) + '</span>' + copyBtn(ip.ip, 'IP') + '</td>' +
        '<td>IPv' + esc(ip.version) + '</td>' +
        '<td>' + (ip.asn ? 'AS' + esc(ip.asn) : NA()) + '</td>' +
        '<td>' + (ip.provider || ip.asnOrg ? esc(ip.provider || ip.asnOrg) : NA()) + '</td>' +
        '<td><span class="dc-mono">' + (ip.network ? esc(ip.network) : NA()) + '</span></td>' +
        '<td>' + (ip.country ? esc(ip.country) : NA()) + '</td>' +
        '<td><span class="dc-mono">' + (ptr && ptr.length ? esc(ptr[0]) : NA()) + '</span></td>' +
        '<td>' + (ip.confidence ? esc(ip.confidence) + '%' : '—') + '</td></tr>';
      if (ip.conflicts && ip.conflicts.length) {
        html += '<tr><td colspan="8" class="dc-conflict">Conflicting data: ' + esc(ip.conflicts.map(function (c) { return c.subject + ' → ' + c.values.map(function (v) { return v.value + ' (' + v.source + ')'; }).join(' vs '); }).join('; ')) + '</td></tr>';
      }
    }
    html += '</tbody></table></div>';
    html += '<p class="muted">Country-level network data only. No precise geolocation is claimed — a server can be managed from anywhere.</p>';
    return section('IP Information', 'router', html, 'dc-ip');
  }

  function nameserversHtml(r) {
    var ns = r.nameservers || [];
    var html = '<div class="ad-summary-grid">' +
      statRow('DNS provider', r.dns.provider ? esc(r.dns.provider) + (r.dns.providerConfident ? '' : ' <span class="conf">partial match</span>') : NA()) +
      statRow('Nameservers', String(ns.length)) +
      '</div>';
    if (r.dns.provider && r.dns.providerSignals && r.dns.providerSignals.length) {
      html += srcChip('Signals: ' + r.dns.providerSignals.slice(0, 4).join(', '));
    }
    if (!ns.length) {
      html += '<p class="muted">No nameservers were returned in DNS.</p>';
    } else {
      html += '<div class="table-scroll"><table class="mini-table"><thead><tr><th>Nameserver</th><th>IP addresses</th><th>Network</th></tr></thead><tbody>';
      for (var i = 0; i < ns.length; i++) {
        var n = ns[i];
        html += '<tr><td><span class="dc-mono">' + esc(n.host) + '</span>' + copyBtn(n.host, 'Nameserver') + '</td>' +
          '<td><span class="dc-mono">' + (n.ips && n.ips.length ? n.ips.map(esc).join(', ') : NA()) + '</span></td>' +
          '<td>' + ((n.ipInfo || []).map(function (x) { return x.provider || ('AS' + x.asn) || null; }).filter(Boolean).join(', ') || NA()) + '</td></tr>';
      }
      html += '</tbody></table></div>';
    }
    return section('Nameserver Analysis', 'account_tree', html, 'dc-ns');
  }

  function dnsHtml(r) {
    var recs = r.dns.records || {};
    var types = [['A', 'IPv4 addresses'], ['AAAA', 'IPv6 addresses'], ['CNAME', 'Canonical name'], ['MX', 'Mail servers'], ['NS', 'Nameservers'], ['TXT', 'Text records'], ['CAA', 'Certificate authority authorization'], ['SOA', 'Start of authority']];
    var html = '<div class="dc-dns-tabs">';
    for (var i = 0; i < types.length; i++) {
      var t = types[i][0];
      var rows = recs[t] || [];
      var title = types[i][1];
      html += '<details class="audit-fold" id="dc-dns-' + t + '"><summary><span><span class="chip">' + t + '</span> ' + esc(title) + '</span><b>' + rows.length + '</b></summary><div class="dc-dns-body">';
      if (!rows.length) {
        html += '<p class="muted">No ' + t + ' records.</p>';
      } else {
        html += '<div class="table-scroll"><table class="mini-table"><thead><tr><th>Value</th><th>TTL</th><th></th></tr></thead><tbody>';
        for (var j = 0; j < rows.length; j++) {
          var row = rows[j];
          var v = row.value;
          if (t === 'MX' && row.priority != null) v = 'Priority ' + row.priority + ' → ' + v;
          html += '<tr><td><span class="dc-mono dc-wrap">' + esc(v) + '</span></td><td>' + esc(row.ttl != null ? row.ttl + 's' : '—') + '</td><td>' + copyBtn(row.value, t + ' record') + '</td></tr>';
        }
        html += '</tbody></table></div>';
      }
      html += '</div></details>';
    }
    html += '</div>';
    if (r.dns.cnameChain && r.dns.cnameChain.length) {
      html += '<details class="audit-fold"><summary><span>CNAME chain</span><b>' + r.dns.cnameChain.length + '</b></summary><div style="padding:4px 14px 12px">';
      html += r.dns.cnameChain.map(function (c) {
        return '<div class="dc-cname"><span class="dc-mono">' + esc(c.from) + '</span> → <span class="dc-mono">' + esc(c.to || '(loop)') + '</span></div>';
      }).join('');
      html += '</div></details>';
    }
    html += '<details class="audit-fold"><summary><span>Raw DNS records (technical)</span><b>JSON</b></summary><pre class="dc-raw">' + esc(JSON.stringify(recs, null, 1).slice(0, 60000)) + '</pre></details>';
    html += srcChip('Resolvers: ' + (r.dns.resolvers || []).join(', '));
    return section('DNS Records', 'storage', html, 'dc-dns');
  }

  function dnsHealthHtml(r) {
    var checks = (r.dns && r.dns.health) || [];
    if (!checks.length) return section('DNS Health', 'health_and_safety', NA(), 'dc-dnshealth');
    var html = '';
    for (var i = 0; i < checks.length; i++) {
      var c = checks[i];
      var level = c.level === 'pass' ? 'pass' : c.level === 'warn' ? 'warn' : c.level === 'fail' ? 'fail' : 'info';
      html += '<div class="check ' + level + '"><div class="check-icon"><span class="material-icons">' + (level === 'pass' ? 'check' : level === 'warn' ? 'priority_high' : level === 'fail' ? 'close' : 'info') + '</span></div>' +
        '<div><b>' + esc(c.title) + '</b><p>' + esc(c.detail || '') + '</p></div></div>';
    }
    return section('DNS Health', 'health_and_safety', html, 'dc-dnshealth');
  }

  function emailHtml(r) {
    var e = r.email;
    if (!e) return section('Email Infrastructure', 'mail', NA(), 'dc-email');
    var html = '<div class="ad-summary-grid">' +
      statRow('SPF', e.security.spf === 'detected' ? pill('Detected') : NA('Not detected')) +
      statRow('DMARC', e.security.dmarc === 'detected' ? pill('Detected') : NA('Not detected')) +
      statRow('DKIM (common selectors)', e.security.dkim === 'detected' ? pill('Detected') : 'Not observed') +
      statRow('Mail provider', e.provider ? esc(e.provider) : (e.nullMx ? 'None (null MX)' : NA())) +
      '</div>';
    if (e.dmarc) {
      html += kv('DMARC policy', '<span class="dc-mono">p=' + esc(e.dmarc.policy || 'none') + '</span>' +
        (e.dmarc.subdomainPolicy ? ' <span class="dc-mono">sp=' + esc(e.dmarc.subdomainPolicy) + '</span>' : '') +
        (e.dmarc.pct ? ' <span class="dc-mono">pct=' + esc(e.dmarc.pct) + '</span>' : '') +
        (e.dmarc.rua ? ' <span class="dc-mono">rua present</span>' : ''));
    }
    if (e.spf) {
      html += kv('SPF record', '<span class="dc-mono dc-wrap">' + esc(e.spf.raw) + '</span>');
      if (e.spf.all) html += kv('SPF default', e.spf.hardFail ? 'Hard fail (-all) — spoofed mail from this domain is rejected by receivers that check SPF' : e.spf.softFail ? 'Soft fail (~all)' : e.spf.neutral ? 'Neutral (?all)' : 'Permissive (+all)');
    }
    html += '<details class="audit-fold" open><summary><span>MX records</span><b>' + e.mx.length + '</b></summary><div style="padding:4px 14px 12px">';
    if (e.nullMx) {
      html += '<div class="calc-note">' + icon('info') + '<span>Null MX record (RFC 7505): this domain explicitly accepts no email.</span></div>';
    } else if (!e.mx.length) {
      html += '<p class="muted">No MX records — the domain does not receive email via DNS-advertised mail servers (normal for many websites).</p>';
    } else {
      html += '<div class="table-scroll"><table class="mini-table"><thead><tr><th>Priority</th><th>Mail server</th><th>IPs</th><th>Provider</th></tr></thead><tbody>';
      for (var i = 0; i < e.mx.length; i++) {
        var m = e.mx[i];
        html += '<tr><td>' + esc(m.priority) + '</td><td><span class="dc-mono">' + esc(m.host) + '</span></td><td><span class="dc-mono">' + (m.ips && (m.ips.a.length || m.ips.aaaa.length) ? m.ips.a.concat(m.ips.aaaa).slice(0, 4).join(', ') : NA()) + '</span></td><td>' + (m.provider ? esc(m.provider) : '—') + '</td></tr>';
      }
      html += '</tbody></table></div>';
    }
    html += '</div></details>';
    if (e.dkim.found && e.dkim.found.length) {
      html += '<details class="audit-fold"><summary><span>DKIM selectors observed</span><b>' + e.dkim.found.length + '</b></summary><div style="padding:4px 14px 12px">';
      for (var j = 0; j < e.dkim.found.length; j++) {
        html += '<div class="dc-evidence">' + esc(e.dkim.found[j].selector) + '._domainkey → <span class="dc-mono">' + esc(e.dkim.found[j].value) + '</span></div>';
      }
      html += '<p class="muted">' + esc(e.dkim.note || '') + '</p></div></details>';
    } else {
      html += '<p class="muted">' + esc(e.dkim.note || '') + '</p>';
    }
    if (e.notes && e.notes.length) {
      html += '<div class="dc-notes">' + e.notes.map(function (n) { return '<div class="calc-note">' + icon('info') + '<span>' + esc(n) + '</span></div>'; }).join('') + '</div>';
    }
    html += '<p class="muted">SPF/DMARC presence does not mean email is “fully protected” — deliverability and filtering depend on the receiving side too.</p>';
    return section('Email Infrastructure', 'mail', html, 'dc-email');
  }

  function dnssecHtml(r) {
    var d = r.dnssec;
    if (!d) return section('DNSSEC', 'verified_user', NA(), 'dc-dnssec');
    var html = '<div class="ad-summary-grid">' +
      statRow('DNSSEC', d.status === 'enabled' ? pill('Enabled') : d.status === 'partial' ? pill('Partially observed') : pill('Not detected')) +
      statRow('DS records (parent)', String(d.dsRecords.length)) +
      statRow('DNSKEY records', String(d.dnskeys.length)) +
      statRow('Signed responses observed', d.rrSigObserved ? 'Yes' : 'Not visible to resolver') +
      '</div>';
    if (d.dsRecords.length) {
      html += '<details class="audit-fold"><summary><span>DS records</span><b>' + d.dsRecords.length + '</b></summary><pre class="dc-raw">' + esc(d.dsRecords.map(function (x) { return x.keyTag + ' ' + x.algorithm + ' ' + x.digestType + ' ' + x.digest; }).join('\n')) + '</pre></details>';
    }
    if (d.dnskeys.length) {
      html += '<details class="audit-fold"><summary><span>DNSKEY records</span><b>' + d.dnskeys.length + '</b></summary><pre class="dc-raw">' + esc(d.dnskeys.map(function (x) { return x.keyType + ' alg=' + x.algorithm + ' ' + x.publicKey; }).join('\n')) + '</pre></details>';
    }
    if (d.note) html += '<p class="muted">' + esc(d.note) + '</p>';
    html += '<p class="muted">The absence of DNSSEC is not a vulnerability — most domains do not sign their zones.</p>';
    return section('DNSSEC', 'verified_user', html, 'dc-dnssec');
  }

  function sslHtml(r) {
    var s = r.ssl;
    if (!s || s.status === 'unavailable') {
      return section('SSL / TLS', 'lock', '<div class="dc-na-box">' + icon('lock_open') +
        '<b>Certificate could not be inspected.</b><p class="muted">' + esc((s && s.note) || 'TLS inspection was not possible.') + '</p></div>', 'dc-ssl');
    }
    var label = s.status === 'valid' ? 'Valid' : s.status === 'expired' ? 'Expired' : s.status === 'invalid' ? 'Invalid' : s.status;
    var html = '<div class="ad-summary-grid">' +
      statRow('SSL certificate', pill(label)) +
      statRow('Expires in', s.daysRemaining != null ? (s.daysRemaining < 0 ? Math.abs(s.daysRemaining) + ' days ago' : s.daysRemaining + ' days') : NA()) +
      statRow('Issuer', s.issuer ? esc(s.issuer) : NA()) +
      statRow('TLS version', s.tlsVersion ? esc(s.tlsVersion) : NA()) +
      '</div>';
    html += kv('Subject (CN)', s.subject ? '<span class="dc-mono">' + esc(s.subject) + '</span>' : NA());
    html += kv('Valid from', s.validFrom ? fmtDate(s.validFrom) : NA());
    html += kv('Valid until', s.validUntil ? fmtDate(s.validUntil) : NA());
    html += kv('Certificate type', s.certType ? esc(s.certType) : NA());
    html += kv('Chain status', s.chainValid ? pill('Valid chain') : pill('Chain problem') + (s.chainError ? ' <span class="muted">' + esc(s.chainError) + '</span>' : ''));
    html += kv('Hostname match', s.hostnameMatches == null ? NA() : s.hostnameMatches ? pill('Matches') : pill('Mismatch'));
    if (s.sanDomains && s.sanDomains.length) {
      html += '<details class="audit-fold"><summary><span>SAN domains</span><b>' + s.sanDomains.length + '</b></summary><div style="padding:4px 14px 12px"><div class="dc-san-list">' +
        s.sanDomains.map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('') + '</div></div></details>';
    }
    if (s.signals && s.signals.length) {
      html += '<details class="audit-fold" open><summary><span>SSL security signals</span><b>' + s.signals.length + '</b></summary><div style="padding:4px 14px 12px">';
      for (var i = 0; i < s.signals.length; i++) {
        var sg = s.signals[i];
        var lv = sg.status === 'ok' ? 'pass' : sg.status === 'warn' ? 'warn' : sg.status === 'fail' ? 'fail' : 'info';
        html += '<div class="check ' + lv + '"><div class="check-icon"><span class="material-icons">' + (lv === 'pass' ? 'check' : lv === 'warn' ? 'priority_high' : lv === 'fail' ? 'close' : 'info') + '</span></div><div><b>' + esc(sg.name) + '</b><p>' + esc(sg.detail || '') + '</p></div></div>';
      }
      html += '</div></details>';
    }
    if (s.note) html += '<p class="muted">' + esc(s.note) + '</p>';
    return section('SSL / TLS', 'lock', html, 'dc-ssl');
  }

  function httpHtml(r) {
    var h = r.http;
    if (!h || h.status === 'unavailable') {
      var note = (h && h.note) || 'Direct HTTP checks were not possible.';
      var body = '<div class="dc-na-box">' + icon('link_off') + '<b>Website could not be checked over HTTP.</b><p class="muted">' + esc(note) + '</p></div>';
      if (h && h.status === 'unavailable' && !current.relayPromise) {
        body += '<div class="dc-relay-box" id="dc-relay-box"><p class="muted">The checker server cannot reach websites directly from this environment. You can retry the HTTP check through your own browser (only if the site allows it).</p>' +
          '<button class="btn" type="button" id="dc-relay-btn">' + icon('sync') + 'Retry HTTP via my browser</button><div id="dc-relay-status" class="muted" style="margin-top:8px"></div></div>';
      }
      return section('Website (HTTP)', 'language', body, 'dc-http');
    }
    var hs = h.https || {};
    var html = '<div class="ad-summary-grid">' +
      statRow('HTTP status', hs.status ? '<span class="dc-value">' + esc(hs.status) + (hs.statusText ? ' ' + esc(hs.statusText) : '') + '</span>' : NA()) +
      statRow('Final URL', hs.finalUrl ? '<span class="dc-mono dc-wrap">' + esc(hs.finalUrl) + '</span>' : NA()) +
      statRow('Response time', hs.responseTimeMs != null ? esc(hs.responseTimeMs) + ' ms' : NA()) +
      statRow('HTTPS redirect', h.httpsRedirect === true ? pill('Yes') : h.httpsRedirect === false ? pill('No') : NA()) +
      '</div>';
    html += kv('HTTP version', hs.httpVersion ? esc(hs.httpVersion) : NA());
    html += kv('Server header', hs.server ? '<span class="dc-mono">' + esc(hs.server) + '</span>' : NA());
    html += kv('Content type', hs.contentType ? esc(hs.contentType) : NA());
    html += kv('Compression', hs.compressed ? esc(hs.contentEncoding || 'Yes') : 'None');
    html += kv('Cache control', hs.cacheControl ? '<span class="dc-mono dc-wrap">' + esc(hs.cacheControl) + '</span>' : NA());
    html += kv('ETag', hs.etag ? '<span class="dc-mono">' + esc(hs.etag) + '</span>' : NA());
    html += kv('Last-Modified', hs.lastModified ? esc(hs.lastModified) : NA());
    html += '<details class="audit-fold" open><summary><span>HSTS (HTTP Strict Transport Security)</span><b>' + (h.hsts && h.hsts.present ? 'Enabled' : 'Not set') + '</b></summary><div style="padding:4px 14px 12px">';
    if (h.hsts && h.hsts.present) {
      html += kv('Max-age', h.hsts.maxAge != null ? Math.round(h.hsts.maxAge / 86400) + ' days (' + h.hsts.maxAge + 's)' : NA());
      html += kv('Include subdomains', h.hsts.includeSubDomains ? 'Yes' : 'No');
      html += kv('Preload signal', h.hsts.preload ? 'Yes' : 'No');
    } else {
      html += '<p class="muted">No HSTS header was observed. HSTS is optional.</p>';
    }
    html += '</div></details>';
    html += '<details class="audit-fold" open><summary><span>Redirect chain</span><b>' + (h.redirects.count || 0) + ' redirect(s)</b></summary><div style="padding:4px 14px 12px">';
    if (h.redirects.chain && h.redirects.chain.length) {
      html += '<div class="dc-redirects">';
      for (var i = 0; i < h.redirects.chain.length; i++) {
        var hop = h.redirects.chain[i];
        html += '<div class="dc-hop"><span class="dc-mono dc-wrap">' + esc(hop.url) + '</span><span class="status-pill s-unk">' + esc(hop.status) + '</span></div>';
        if (hop.location) html += '<div class="dc-hop-arrow"><span class="material-icons">arrow_downward</span><span class="muted">' + (hop.kind === 'permanent' ? 'permanent (301/308)' : hop.kind === 'temporary' ? 'temporary (302/303/307)' : '') + '</span></div>';
      }
      html += '</div>';
      var an = h.redirects.analysis;
      if (an && an.notes) {
        for (var k = 0; k < an.notes.length; k++) {
          var isWarn = an.loopDetected || an.httpsToHttp || an.excessive;
          html += '<div class="' + (isWarn && /loop|downgrade|long/i.test(an.notes[k]) ? 'calc-note' : 'calc-note dc-note-ok') + '">' + icon(isWarn ? 'warning' : 'check_circle') + '<span>' + esc(an.notes[k]) + '</span></div>';
        }
      }
    } else {
      html += '<p class="muted">No redirects observed.</p>';
    }
    html += '</div></details>';
    if (h.source === 'browser-relay') html += srcChip('Collected through the visitor’s browser (CORS-exposed headers only).');
    return section('Website (HTTP)', 'language', html, 'dc-http');
  }

  function technologyHtml(r) {
    var t = r.technology || { items: [] };
    var items = t.items || [];
    var html = '<p class="muted">' + esc(t.note || '') + '</p>';
    if (!items.length) {
      html += '<p class="muted">' + (r.http && r.http.status === 'ok' ? 'No known technology fingerprints were detected.' : 'Technology detection needs the site’s HTML, which was not available in this scan.') + '</p>';
    } else {
      html += '<div class="dc-tech-list">';
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        html += '<div class="dc-tech-item"><div class="dc-tech-head"><b>' + esc(it.name) + '</b><span class="chip">' + esc(it.category) + '</span>' + confPill(it.confidence) +
          '<span class="status-pill ' + (it.status === 'detected' ? 's-ok' : 's-unk') + '">' + esc(it.status) + '</span></div>';
        if (it.evidence && it.evidence.length) {
          html += '<div class="dc-evidence">' + it.evidence.map(function (e) { return esc(e); }).join(' · ') + '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
    return section('Website Technology', 'memory', html, 'dc-tech');
  }

  function subdomainsHtml(r) {
    var s = r.subdomains || {};
    var html = '';
    if (s.count) {
      html += '<div class="dc-san-list">';
      for (var i = 0; i < (s.list || []).length; i++) {
        var sub = s.list[i];
        html += '<span class="chip" title="' + esc(sub.sources.join(', ')) + '">' + esc(sub.subdomain) + '</span>';
      }
      html += '</div>';
      if (s.truncated) html += '<p class="muted">Showing the first 60 observed subdomains.</p>';
    } else {
      html += '<p class="muted">No subdomains were publicly observed in DNS records, certificates or served HTML.</p>';
    }
    html += '<p class="muted">' + esc(s.note || '') + '</p>';
    return section('Publicly Observed Subdomains', 'account_tree', html, 'dc-sub');
  }

  function tldHtml(r) {
    var t = r.tld || {};
    var html = '<div class="ad-summary-grid">' +
      statRow('TLD', '.' + esc(t.suffix || '')) +
      statRow('Type', t.type === 'ccTLD' ? 'Country-code TLD' : t.type === 'gTLD' ? 'Generic TLD' : esc(t.type || 'Unknown')) +
      statRow('Registry', t.registry ? esc(t.registry) : NA()) +
      statRow('Country', t.country ? esc(t.country) : '—') +
      '</div>';
    html += kv('IDN support', t.idn == null ? NA() : t.idn ? 'Yes' : 'No');
    html += kv('Registry RDAP endpoint', t.rdapEndpoint ? '<span class="dc-mono">' + esc(t.rdapEndpoint) + '</span>' : NA());
    html += kv('WHOIS server', t.whoisServer ? esc(t.whoisServer) : NA());
    if (t.note) html += '<p class="muted">' + esc(t.note) + '</p>';
    if (!r.domain.tldKnown) {
      html += '<div class="calc-note">' + icon('info') + '<span>This suffix is outside the local public-suffix snapshot — the registrable-domain split may be approximate.</span></div>';
    }
    return section('TLD Information', 'public', html, 'dc-tld');
  }

  function structureHtml(r) {
    var d = r.domain;
    var st = d.structure || {};
    var html = '<div class="ad-summary-grid">' +
      statRow('Protocol', esc(st.protocol || 'https') + (st.protocolAssumed ? ' <span class="conf">assumed</span>' : '')) +
      statRow('Subdomain', st.subdomain ? esc(st.subdomain) : '—') +
      statRow('Root domain', esc(st.rootDomain || '')) +
      statRow('TLD', '.' + esc(st.tld || '')) +
      '</div>';
    html += kv('Port', st.port ? esc(st.port) : '—');
    html += kv('Path', st.path ? '<span class="dc-mono dc-wrap">' + esc(st.path) + '</span>' : '—');
    html += '<details class="audit-fold"><summary><span>IDN / Punycode</span><b>' + (d.isIdn ? 'IDN domain' : 'ASCII domain') + '</b></summary><div style="padding:4px 14px 12px">';
    if (d.isIdn) {
      html += kv('Unicode domain', esc(d.unicode || ''));
      html += kv('ASCII / Punycode domain', '<span class="dc-mono">' + esc(d.ascii) + '</span>' + copyBtn(d.ascii, 'Punycode domain'));
    } else {
      html += '<p class="muted">This domain is plain ASCII — no internationalized (IDN) characters.</p>';
    }
    html += '</div></details>';
    return section('Domain Structure', 'data_object', html, 'dc-structure');
  }

  function sourcesHtml(r) {
    var html = '<div class="dc-sources">';
    for (var i = 0; i < (r.sources || []).length; i++) {
      html += '<div class="dc-source-row"><span class="chip">' + esc(r.sources[i].name) + '</span><span class="muted">' + esc(r.sources[i].what) + '</span></div>';
    }
    html += '</div>';
    if (r.conflicts && r.conflicts.length) {
      html += '<h4 style="margin:14px 0 6px">Conflicting data detected</h4>';
      for (var j = 0; j < r.conflicts.length; j++) {
        var c = r.conflicts[j];
        html += '<div class="dc-conflict"><b>' + esc(c.subject) + ':</b> ' + c.values.map(function (v) { return esc(v.value) + ' <span class="source-chip">' + esc(v.source) + '</span>'; }).join(' vs ') + '</div>';
      }
    }
    if (r.unverified && r.unverified.length) {
      html += '<h4 style="margin:14px 0 6px">Not publicly available / unable to verify</h4>';
      for (var k = 0; k < r.unverified.length; k++) {
        html += '<div class="dc-unverified"><b>' + esc(r.unverified[k].subject) + '</b> — <span class="muted">' + esc(r.unverified[k].reason) + '</span></div>';
      }
    }
    return section('Data Sources & Transparency', 'fact_check', html, 'dc-sources');
  }

  function reportHtml(r) {
    return '<div class="dc-report">' +
      overviewHtml(r) +
      timelineHtml(r) +
      registrationHtml(r) +
      hostingHtml(r) +
      ipTableHtml(r) +
      nameserversHtml(r) +
      dnsHtml(r) +
      dnsHealthHtml(r) +
      emailHtml(r) +
      dnssecHtml(r) +
      sslHtml(r) +
      httpHtml(r) +
      technologyHtml(r) +
      subdomainsHtml(r) +
      tldHtml(r) +
      structureHtml(r) +
      sourcesHtml(r) +
      '</div>';
  }

  function reportText(r) {
    var L = [];
    L.push('Domain Information Report — ' + r.domain.ascii);
    L.push('Generated: ' + r.generatedAt);
    L.push('');
    L.push('== Domain Overview ==');
    L.push('Domain: ' + r.domain.ascii);
    L.push('Status: ' + (r.domainStatus.status || 'Unknown'));
    L.push('Availability: ' + r.availability.display);
    L.push('Registrable domain: ' + r.domain.registrable + ' | TLD: .' + r.domain.tld);
    if (r.age.available) {
      L.push('Registered: ' + r.age.registeredDate);
      L.push('Domain age: ' + r.age.ageTextValue + ' (' + r.age.totalDays + ' days)');
      if (r.age.expiresIso) L.push('Expires: ' + fmtDate(r.age.expiresIso));
      if (r.age.expiry) L.push('Expiration: ' + r.age.expiry.label);
    } else {
      L.push('Domain age: cannot be reliably determined (no official registration date).');
    }
    L.push('');
    L.push('== Registration ==');
    if (r.registration) {
      L.push('Source: ' + r.registration.source);
      L.push('Registrar: ' + (r.registration.registrar ? r.registration.registrar.name + (r.registration.registrar.ianaId ? ' (IANA ' + r.registration.registrar.ianaId + ')' : '') : 'Not publicly available'));
      L.push('Statuses: ' + (r.registration.statuses.join(', ') || 'none reported'));
    } else {
      L.push('Registration information unavailable.');
    }
    L.push('');
    L.push('== Hosting & Network ==');
    var h = r.ip.hosting || {};
    L.push('CDN/Proxy: ' + (r.cdn.status === 'detected' ? r.cdn.provider + ' (confidence ' + r.cdn.confidence + '%)' : 'Not detected'));
    L.push('Hosting/Network provider: ' + (h.provider || 'Not publicly determinable'));
    if (h.asn) L.push('ASN: AS' + h.asn + ' (' + h.organization + ')');
    L.push('');
    L.push('== IP addresses ==');
    for (var i = 0; i < (r.ip.all || []).length; i++) {
      var ip = r.ip.all[i];
      L.push(ip.ip + ' IPv' + ip.version + ' AS' + (ip.asn || '?') + ' ' + (ip.provider || ip.asnOrg || ''));
    }
    L.push('');
    L.push('== DNS ==');
    var recs = r.dns.records || {};
    ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'CAA', 'SOA'].forEach(function (t) {
      L.push(t + ': ' + (recs[t] || []).map(function (x) { return x.value; }).join(', ') || '(none)');
    });
    L.push('DNS provider: ' + (r.dns.provider || 'Not detected'));
    L.push('');
    L.push('== Security ==');
    L.push('SSL: ' + (r.ssl ? r.ssl.status : 'unavailable') + (r.ssl && r.ssl.daysRemaining != null ? ' (expires in ' + r.ssl.daysRemaining + ' days)' : ''));
    L.push('DNSSEC: ' + (r.dnssec ? r.dnssec.status : 'unknown'));
    L.push('SPF: ' + (r.email && r.email.security.spf));
    L.push('DMARC: ' + (r.email && r.email.security.dmarc) + (r.email && r.email.dmarc ? ' (p=' + (r.email.dmarc.policy || 'none') + ')' : ''));
    L.push('DKIM: ' + (r.email && r.email.security.dkim));
    L.push('');
    L.push('== Website ==');
    if (r.http && r.http.https && r.http.https.status) {
      L.push('HTTP status: ' + r.http.https.status + ' ' + (r.http.https.statusText || ''));
      L.push('Final URL: ' + r.http.https.finalUrl);
      L.push('Response time: ' + (r.http.https.responseTimeMs != null ? r.http.https.responseTimeMs + ' ms' : 'n/a'));
      L.push('Server header: ' + (r.http.https.server || 'not set'));
      L.push('HTTPS redirect: ' + (r.http.httpsRedirect === true ? 'Yes' : r.http.httpsRedirect === false ? 'No' : 'Unknown'));
    } else {
      L.push('HTTP check unavailable: ' + (r.http ? r.http.note : ''));
    }
    L.push('');
    L.push('== Technology (heuristic) ==');
    var items = (r.technology && r.technology.items) || [];
    if (items.length) {
      items.forEach(function (it) { L.push(it.name + ' [' + it.category + '] ' + it.confidence + '% ' + it.status); });
    } else {
      L.push('None detected / HTML unavailable.');
    }
    L.push('');
    L.push('== Not publicly available ==');
    (r.unverified || []).forEach(function (u) { L.push('- ' + u.subject + ': ' + u.reason); });
    L.push('');
    L.push('Sources: ' + (r.sources || []).map(function (s) { return s.name; }).join(', '));
    return L.join('\n');
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); if (a.parentNode) a.parentNode.removeChild(a); }, 300);
  }

  function renderReport(container, r) {
    current.report = r;
    var actions = '<div class="report-actions">' +
      '<button class="btn" type="button" id="dc-copy-all">' + icon('content_copy') + 'Copy All Information</button>' +
      '<button class="btn" type="button" id="dc-download-json">' + icon('download') + 'Download JSON Report</button>' +
      '<button class="btn" type="button" id="dc-download-txt">' + icon('download') + 'Download Text Report</button>' +
      '</div>';
    container.innerHTML = actions + reportHtml(r);
    // copy-all / downloads
    var el = $('dc-copy-all');
    if (el) el.addEventListener('click', function () { copyText(reportText(r), 'Report'); });
    el = $('dc-download-json');
    if (el) el.addEventListener('click', function () { download(r.domain.ascii + '-domain-report.json', JSON.stringify(r, null, 2), 'application/json'); });
    el = $('dc-download-txt');
    if (el) el.addEventListener('click', function () { download(r.domain.ascii + '-domain-report.txt', reportText(r), 'text/plain'); });
    // per-value copy buttons
    var copies = container.querySelectorAll('[data-copy]');
    for (var i = 0; i < copies.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          copyText(btn.getAttribute('data-copy'), btn.getAttribute('data-label') || 'Value');
        });
      })(copies[i]);
    }
    // browser relay button
    var rb = $('dc-relay-btn');
    if (rb) {
      rb.addEventListener('click', function () {
        if (current.relayPromise) return;
        rb.disabled = true;
        var st = $('dc-relay-status');
        if (st) st.textContent = 'Collecting through your browser…';
        current.relayPromise = collectBrowserBundle(r.domain.ascii, function (msg) { if (st) st.textContent = msg; })
          .then(function (bundle) {
            if (!bundle || !bundle.https) {
              if (st) st.textContent = 'The site does not allow cross-origin reads from the browser either — the HTTP section stays unavailable.';
              return;
            }
            if (st) st.textContent = 'Analyzing the browser-collected response…';
            return fetch('/api/domaincheck-analyze', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ domain: r.domain.ascii, bundle: bundle, rootDomain: r.domain.registrable })
            }).then(function (res) { return res.json(); })
              .then(function (merged) {
                mergeRelayResult(r, merged);
                renderReport(container, r);
              });
          })
          .catch(function () {
            if (st) st.textContent = 'The browser relay failed. The HTTP section stays unavailable.';
          })
          .finally(function () { current.relayPromise = null; });
      });
    }
    var first = container.querySelector('.dc-report');
    if (first && first.scrollIntoView) first.scrollIntoView();
  }

  function renderError(container, err) {
    container.innerHTML = '<div class="audit-error adsense-error">' + icon('error_outline') +
      '<h3>' + esc(err.message || 'The check failed.') + '</h3>' +
      (err.code === 'invalid_input' ? '<p class="muted">Enter a domain name such as <b>example.com</b> or a URL such as <b>https://example.com</b>.</p>' : '') +
      (err.code === 'ratelimit' ? '<p class="muted">Please wait a few minutes before the next check.</p>' : '') +
      '<button class="btn" type="button" onclick="location.reload()">Try again</button></div>';
  }

  /* ---------------- boot ---------------- */
  function boot() {
    var form = $('domaincheck-form');
    var input = $('domaincheck-url');
    var container = $('domaincheck-results');
    if (!form || !input || !container) return;
    RESULTS = container;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var value = (input.value || '').trim();
      if (!value) return;
      lastInput = value;
      current = { report: null, relayPromise: null };
      container.innerHTML = '';
      renderProgress(container, 'Starting…', []);
      runScan(value, function (p) {
        renderProgress(container, p.message, p.completed);
      }).then(function (report) {
        if (!report) { renderError(container, { code: 'error', message: 'The server ended the scan without a report.' }); return; }
        renderReport(container, report);
      }).catch(function (err) {
        renderError(container, err);
      });
    });
    // URL examples helper
    var ex = $('dc-examples');
    if (ex) {
      ex.addEventListener('click', function (e) {
        var t = e.target;
        if (t && t.tagName === 'BUTTON') {
          input.value = t.textContent.trim();
        }
      });
    }
  }

  DC.boot = boot;
  DC.renderReport = renderReport;
  DC.renderProgress = renderProgress;
  DC.renderError = renderError;
  DC.reportText = reportText;
  DC.reportHtml = reportHtml;
  DC.runScan = runScan;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
