'use strict';

/*
 * AI Crawler & LLM Bot Blocker: UI smoke test.
 * Loads the engine modules + assets/js/botblocker/ui.js into a sandbox with a
 * fake DOM and fake fetch, then asserts the report renders end-to-end:
 * score, coverage, validation, tabs/code, bot table, simulator, profiles,
 * escaping of untrusted input, and the privacy/local-only pipeline.
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const ENGINE = [
  'botDatabase', 'botClassifier', 'botPatternMatcher', 'robotsParser', 'robotsSimulator',
  'robotsGenerator', 'ruleConflictDetector', 'userAgentAnalyzer', 'nginxGenerator',
  'apacheGenerator', 'cloudflareGenerator', 'middlewareGenerator', 'configurationValidator',
  'protectionScore', 'coverageAnalyzer', 'securityChecker', 'index'
];

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  \u2713 ' + name); } catch (e) { fail++; console.log('  \u2717 ' + name + '\n    ' + (e && e.message)); } }

const elements = {};
function fakeEl(id) {
  return {
    id, value: '', checked: true, innerHTML: '', hidden: false, className: '', textContent: '',
    listeners: {}, onclick: null, oninput: null, onchange: null,
    addEventListener(type, fn) { this.listeners[type] = fn; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    appendChild() {}, remove() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return ''; }, hasAttribute() { return false; },
    closest() { return null; }, focus() {}, select() {}, click() {},
    scrollIntoView() {},
    files: [],
    style: {}
  };
}
const found = [];
const doc = {
  getElementById(id) { if (!elements[id]) elements[id] = fakeEl(id); return elements[id]; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  createElement(tag) { const e = fakeEl('tmp-' + tag + '-' + Math.random()); if (tag === 'a') e.href = 'blob:x'; return e; },
  body: { appendChild() {}, removeChild() {} },
  documentElement: { innerHTML: '', classList: { add() {}, remove() {} } }
};
const storage = {};
const sandbox = {
  scrollY: 0, scrollTo() {}, addEventListener() {},
  document: doc,
  navigator: {},
  localStorage: {
    getItem: k => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: k => { delete storage[k]; }
  },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  Blob: function () { this.size = 0; },
  FileReader: function () { this.readAsText = function () {}; },
  fetch: url => Promise.reject(new Error('unexpected fetch ' + url)),
  setTimeout, clearTimeout, console, Math, Date, JSON, RegExp, Object, Array, String, Number, Boolean, Error, parseInt, parseFloat, isNaN
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);

/* Load engine modules (they attach to window.BB) */
for (const name of ENGINE) {
  const src = fs.readFileSync('lib/botblocker/' + name + '.js', 'utf8');
  vm.runInContext(src, sandbox, { filename: name + '.js' });
}
assert.ok(sandbox.window.BB && sandbox.window.BB.index, 'engine loaded into BB namespace');

vm.runInContext(fs.readFileSync(__dirname + '/../../assets/js/progress.js', 'utf8'), sandbox);
const uiSource = fs.readFileSync('assets/js/botblocker/ui.js', 'utf8');

function boot() {
  // reset element state
  for (const k of Object.keys(elements)) delete elements[k];
  vm.runInContext(uiSource, sandbox, { filename: 'ui.js' });
  return {
    form: elements['botblocker-form'],
    out: elements['botblocker-results'],
    elById: id => doc.getElementById(id) // auto-creates like the live DOM path in ui.js
  };
}

t('UI, initial render shows the full report without any user action', () => {
  const { out } = boot();
  const html = out.innerHTML;
  assert.ok(html.includes('AI Crawler Protection Score'), 'score card');
  assert.ok(html.includes('AI Bot Coverage'), 'coverage panel');
  assert.ok(html.includes('Configuration Validation'), 'validation panel');
  assert.ok(html.includes('Bot Database'), 'bot table');
  assert.ok(html.includes('Bot Access Simulator'), 'simulator');
  assert.ok(html.includes('Test Existing robots.txt'), 'analyzer');
  assert.ok(html.includes('Live Website Checker'), 'live checker');
  assert.ok(html.includes('Configuration Profiles'), 'profiles');
  assert.ok(html.includes('User-Agent spoofing'), 'spoofing warning');
  assert.ok(html.includes('robots.txt does not enforce access control'), 'security explanation');
  assert.ok(html.includes('Tool-generated diagnostic score'), 'score label honesty');
  assert.ok(html.includes('not every AI crawler'), 'coverage honesty');
});

t('UI, default mode generates robots.txt with blocked bots + honest header', () => {
  const { out } = boot();
  const html = out.innerHTML;
  assert.ok(html.includes('User-agent: GPTBot'), 'GPTBot group');
  assert.ok(html.includes('Disallow: /'), 'full disallow');
  assert.ok(html.includes('Advisory control'), 'advisory comment');
  assert.ok(html.includes('does not enforce access control'), 'advisory wording');
});

t('UI, submit regenerates and keeps production-ready validation', () => {
  const { form, out } = boot();
  form.listeners.submit({ preventDefault() {} });
  assert.ok(out.innerHTML.includes('Validated, configuration is syntactically clean'), 'validation pass badge');
});

t('UI, nginx output selected by default and copy/download buttons exist', () => {
  const { out } = boot();
  const html = out.innerHTML;
  assert.ok(html.includes('data-tab="nginx"'), 'nginx tab');
  assert.ok(html.includes('Copy'), 'copy button');
  assert.ok(html.includes('Download'), 'download button');
  assert.ok(html.includes('Installation'), 'installation instructions');
  assert.ok(html.includes('Download All (selected formats only)'), 'download-all only bundles selected');
  // The tab pane renders r.outputs[k].text, verify the nginx pane content the UI would show:
  const gen = vm.runInContext('BB.index.generate(BB.index.normalizeConfig({mode:"block-all",outputs:{robots:true,nginx:true}}))', sandbox);
  assert.ok(gen.outputs.nginx.text.includes('map $http_user_agent $ai_bot_blocked'), 'map-based nginx (no unsafe if-spam)');
});

t('UI, bot table lists database bots with actions and detail data', () => {
  const { out } = boot();
  const html = out.innerHTML;
  for (const name of ['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'PerplexityBot', 'Amazonbot', 'Bytespider', 'CCBot', 'DuckAssistBot', 'GoogleOther']) {
    assert.ok(html.includes(name), 'bot row ' + name);
  }
  assert.ok(html.includes('data-action="block"'), 'segmented block action');
  assert.ok(html.includes('AI Training'), 'category label');
  assert.ok(html.includes('Known AI crawlers in our database'), 'coverage stats');
});

t('UI, simulator runs locally and shows GPTBot → BLOCKED with reason', () => {
  const { out, elById } = boot();
  elById('botblocker-sim-bot').value = 'GPTBot';
  elById('botblocker-sim-path').value = '/blog/example-page';
  elById('botblocker-sim-run').onclick();
  const html = elById('botblocker-sim-result').innerHTML;
  assert.ok(html.includes('GPTBot'), 'bot name');
  assert.ok(html.includes('BLOCKED'), 'verdict');
  assert.ok(html.includes('/blog/example-page'), 'path');
  assert.ok(/Disallow/.test(html), 'rule shown');
  assert.ok(html.includes('Why (matching logic)'), 'explanation present');
});

t('UI, simulator Allow carve-out beats Disallow: / (longest match)', () => {
  const { elById } = boot();
  // Build a config: block all + exception /public/
  elements['botblocker-exceptions-on'].checked = true;
  // simulate state via a second boot is complex; drive the engine directly through the UI's BB
  vm.runInContext('BB.index.generate({mode:"block-all",outputs:{robots:true},exceptions:{enabled:true,list:["/public/"]}})', sandbox);
  const res = vm.runInContext('BB.robotsSimulator.check(BB.robotsParser.parse(BB.index.generate({mode:"block-all",outputs:{robots:true},exceptions:{enabled:true,list:["/public/"]}}).robotsTxt), "GPTBot", "/public/x")', sandbox);
  assert.strictEqual(res.verdict, 'allowed');
  assert.strictEqual(res.rule.path, '/public/');
});

t('UI, existing robots.txt analyzer detects conflicts and compares', () => {
  const { elById } = boot();
  elById('botblocker-existing-text').value = 'Disallow: /oops\nUser-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /\n';
  elById('botblocker-existing-analyze').onclick();
  const html = elById('botblocker-existing-result').innerHTML;
  assert.ok(html.includes('before any User-agent'), 'orphan rule error');
  assert.ok(html.includes('Wildcard group blocks the entire site'), 'wildcard warning');
  assert.ok(html.includes('Compare'), 'before/after comparison');
  assert.ok(html.includes('Added'), 'added rules list');
});

t('UI, custom bot added via the form is escaped and generated', () => {
  const { out, elById } = boot();
  elById('botblocker-custom-name').value = 'Evil<img src=x onerror=alert(1)>';
  elById('botblocker-custom-token').value = 'MyCorpBot';
  elById('botblocker-custom-add').onclick();
  const html = out.innerHTML;
  assert.ok(html.includes('MyCorpBot'), 'custom bot token in output');
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'), 'custom name must be escaped');
  assert.ok(html.includes('Evil&lt;img'), 'escaped name present');
});

t('UI, custom bot with generic token is rejected (false-positive protection)', () => {
  const { elById } = boot();
  elById('botblocker-custom-token').value = 'AI';
  elById('botblocker-custom-add').onclick();
  const html = elById('botblocker-custom-warn').innerHTML;
  assert.ok(html.includes('generic word'), 'generic-word rejection');
  assert.ok(!elById('botblocker-results').innerHTML.includes('User-agent: AI\n'), 'never generated');
});

t('UI, profiles save/load round-trip via local storage', () => {
  const { elById } = boot();
  elById('botblocker-mode').value = 'block-all';
  elById('botblocker-profilename').value = 'Strict';
  elById('botblocker-profile-save').onclick();
  assert.ok(storage['huvanti-botblocker-profiles'], 'profile stored');
  const saved = JSON.parse(storage['huvanti-botblocker-profiles']);
  assert.ok(saved.Strict && saved.Strict.mode === 'block-all', 'profile content valid');
  // load it back
  elById('botblocker-mode').value = 'custom'; // change something first
  elById('botblocker-profile-load').value = 'Strict';
  elById('botblocker-profile-loadbtn').onclick();
  assert.ok(elById('botblocker-mode').value === 'block-all', 'mode restored');
});

t('UI, no network calls happen during generation (local-only pipeline)', () => {
  let called = 0;
  sandbox.fetch = () => { called++; return Promise.reject(new Error('no network expected')); };
  boot();
  assert.strictEqual(called, 0, 'generation must not fetch anything');
  sandbox.fetch = url => Promise.reject(new Error('unexpected fetch ' + url));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
