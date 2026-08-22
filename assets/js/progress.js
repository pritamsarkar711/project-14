/* Huvanti shared scan progress panel.
 * Attaches window.ScanProgress. Used by every tool to show which check is
 * running right now, with smooth step and bar updates. Falls back silently
 * when a minimal DOM (tests) cannot support in place updates.
 */
(function (global) {
  'use strict';
  if (global.ScanProgress) return;

  var escP = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; });
  };

  function ScanProgress(mount, cfg) {
    this.mount = mount; this.cfg = cfg || {};
    this.keys = (this.cfg.steps || []).map(function (st) { return st.key; });
    this.markup(); this.wire();
  }
  var STEP_ICONS = { done: 'check_circle', fail: 'error', wait: 'radio_button_unchecked' };
  ScanProgress.prototype.markup = function (states, note, pct) {
    var c = this.cfg;
    states = states || {};
    var steps = (c.steps || []).map(function (st) {
      var s = states[st.key] || 'wait';
      var icon = s === 'active' ? (st.icon || 'radio_button_unchecked') : (STEP_ICONS[s] || 'radio_button_unchecked');
      return '<li class="scan-step ' + s + '" data-key="' + escP(st.key) + '"><span class="material-icons">' + escP(icon) + '</span><span class="sc-label">' + escP(st.label) + '</span></li>';
    }).join('');
    var head = '<div class="scan-head">' +
      '<span class="scan-head-icon"><span class="material-icons" aria-hidden="true">' + escP(c.icon || 'radar') + '</span></span>' +
      '<div class="scan-title"><h3>' + escP(c.title || 'Working') + '</h3>' + (c.target ? '<span class="scan-target">' + escP(c.target) + '</span>' : '') + '</div>' +
      '</div>';
    this.mount.innerHTML = '<div class="scan-card" role="status" aria-live="polite">' + head +
      '<div class="scan-bar"><i' + (pct != null ? ' style="width:' + Math.max(0, Math.min(100, pct)) + '%"' : '') + '></i></div>' +
      '<p class="scan-status"><span class="material-icons" aria-hidden="true">autorenew</span><span class="sc-text">' + escP(note != null ? note : (c.note || 'Starting')) + '</span></p>' +
      '<ol class="scan-steps">' + steps + '</ol>' +
      (c.onCancel ? '<div class="scan-actions"><button type="button" class="btn btn-secondary scan-cancel"><span class="material-icons" aria-hidden="true">close</span>Cancel</button></div>' : '') +
      '</div>';
    this.wire();
  };
  ScanProgress.prototype.wire = function () {
    var c = this.cfg;
    this.card = this.mount.firstElementChild || null;
    this.bar = this.card && this.card.querySelector ? this.card.querySelector('.scan-bar i') : null;
    this.statusText = this.card && this.card.querySelector ? this.card.querySelector('.sc-text') : null;
    var btn = this.card && this.card.querySelector ? this.card.querySelector('.scan-cancel') : null;
    if (btn && btn.addEventListener && c.onCancel) btn.addEventListener('click', function () { c.onCancel(); });
    this.live = this.card && this.card.querySelectorAll && this.card.querySelectorAll('.scan-step').length > 0;
  };
  ScanProgress.prototype.set = function (states, note, pct) {
    var connected = this.card && (this.card.isConnected === undefined || this.card.isConnected);
    if (!this.live || !connected) { this.markup(states, note != null ? note : undefined, pct); this.wire(); return; }
    var self = this;
    var lis = this.card.querySelectorAll('.scan-step');
    for (var i = 0; i < lis.length; i++) {
      (function (li) {
        var key = li.getAttribute ? li.getAttribute('data-key') : '';
        var st = states[key] || 'wait';
        if (li.className !== 'scan-step ' + st) {
          li.className = 'scan-step ' + st;
          var ic = li.querySelector ? li.querySelector('.material-icons') : null;
          if (ic) ic.textContent = (st === 'active' ? ((self.cfg.steps.filter(function (x) { return x.key === key; })[0] || {}).icon) : STEP_ICONS[st]) || 'radio_button_unchecked';
        }
      })(lis[i]);
    }
    if (note != null) this.note(note);
    if (pct != null) this.progress(pct);
  };
  ScanProgress.prototype.note = function (text) {
    var connected = this.card && (this.card.isConnected === undefined || this.card.isConnected);
    if (!this.statusText || !connected) { if (this.card) { this.markup(undefined, text, null); this.wire(); } return; }
    if (text != null) this.statusText.textContent = text;
  };
  ScanProgress.prototype.progress = function (p) { if (this.bar && this.bar.style) this.bar.style.width = Math.max(0, Math.min(100, p)) + '%'; };
  ScanProgress.prototype.label = function (key, text) {
    var li = this.card && this.card.querySelector ? this.card.querySelector('.scan-step[data-key="' + key + '"] .sc-label') : null;
    if (li) li.textContent = text;
  };
  ScanProgress.prototype.finish = function (msg) {
    var states = {}; var self = this;
    this.keys.forEach(function (k) { states[k] = 'done'; });
    this.set(states, msg || 'Finished', 100);
  };
  ScanProgress.prototype.fail = function (msg) {
    this.note(msg || 'Stopped');
    if (this.bar && this.bar.style) this.bar.style.width = '100%';
    var active = this.card && this.card.querySelector ? this.card.querySelector('.scan-step.active') : null;
    if (active) { active.className = 'scan-step fail'; var ic = active.querySelector ? active.querySelector('.material-icons') : null; if (ic) ic.textContent = 'error'; }
  };

  global.ScanProgress = {
    create: function (mount, cfg) { return new ScanProgress(mount, cfg); },
    reuse: function (mount, cfg) {
      var sig = (cfg.steps || []).map(function (s) { return s.key; }).join('|');
      var prev = mount && mount._scan;
      if (prev && prev._sig === sig) { prev.cfg = cfg; return prev; }
      var p = new ScanProgress(mount, cfg); p._sig = sig;
      if (mount) mount._scan = p;
      return p;
    }
  };
})(typeof window !== 'undefined' ? window : this);
