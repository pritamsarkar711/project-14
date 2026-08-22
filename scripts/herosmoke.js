'use strict';
/* Load-time smoke test: runs each tool page's real scripts against a DOM that
   mirrors the page's rendered HTML (ids from the static markup), and returns
   null for any element that is not present — like a real browser.
   Dynamically rendered result ids (set via innerHTML) are registered as the
   markup is injected, so the initial botblocker render is exercised too. */
const fs = require('fs');
const vm = require('vm');
const { execFileSync } = require('child_process');

const BASE = 'http://localhost:3000';
const PAGES = [
  ['/', ['/assets/js/progress.js', '/assets/js/common.js', '/assets/js/audit.js']],
  ['/adsense-eligibility-checker', ['/assets/js/progress.js', '/assets/js/common.js', '/assets/js/adsense/01-util.js', '/assets/js/adsense/02-crawler.js', '/assets/js/adsense/03-parser.js', '/assets/js/adsense/04-rules.js', '/assets/js/adsense/05-analyzers.js', '/assets/js/adsense/09-siteanalysis.js', '/assets/js/adsense/06-scoring.js', '/assets/js/adsense/07-orchestrate.js', '/assets/js/adsense/08-ui.js']],
  ['/ezoic-eligibility-checker', ['/assets/js/progress.js', '/assets/js/common.js', '/assets/js/ezoic/crawler.js', '/assets/js/ezoic/ui.js']],
  ['/mediavine-eligibility-checker', ['/assets/js/progress.js', '/assets/js/common.js', '/assets/js/mediavine/crawler.js', '/assets/js/mediavine/ui.js']],
  ['/raptive-eligibility-checker', ['/assets/js/progress.js', '/assets/js/common.js', '/assets/js/raptive/crawler.js', '/assets/js/raptive/ui.js']],
  ['/wordpress-theme-detector', ['/assets/js/progress.js', '/assets/js/common.js', '/assets/js/wptheme/collector.js', '/assets/js/wptheme/ui.js']],
  ['/domain-information-checker', ['/assets/js/progress.js', '/assets/js/common.js', '/assets/js/domaincheck/ui.js']],
  ['/xml-sitemap-generator', ['/assets/js/progress.js', '/assets/js/common.js', '/assets/js/sitemap/browser.js', '/assets/js/sitemap/ui.js']],
  ['/broken-link-checker', ['/assets/js/progress.js', '/assets/js/common.js', '/assets/js/brokenlink/crawler.js', '/assets/js/brokenlink/ui.js']],
  ['/llms-txt-generator', ['/assets/js/progress.js', '/assets/js/common.js', '/assets/js/llmstxt/browser.js', '/assets/js/llmstxt/ui.js']],
  ['/ai-crawler-blocker', ['/assets/js/progress.js', '/assets/js/common.js',
    '/lib/botblocker/botDatabase.js', '/lib/botblocker/botClassifier.js', '/lib/botblocker/botPatternMatcher.js',
    '/lib/botblocker/robotsParser.js', '/lib/botblocker/robotsSimulator.js', '/lib/botblocker/robotsGenerator.js',
    '/lib/botblocker/ruleConflictDetector.js', '/lib/botblocker/userAgentAnalyzer.js', '/lib/botblocker/nginxGenerator.js',
    '/lib/botblocker/apacheGenerator.js', '/lib/botblocker/cloudflareGenerator.js', '/lib/botblocker/middlewareGenerator.js',
    '/lib/botblocker/configurationValidator.js', '/lib/botblocker/protectionScore.js', '/lib/botblocker/coverageAnalyzer.js',
    '/lib/botblocker/securityChecker.js', '/lib/botblocker/index.js', '/assets/js/botblocker/ui.js']],
  ['/core-web-vitals-auditor', ['/assets/js/progress.js', '/assets/js/common.js', '/lib/cwv/rewriter.js', '/assets/js/cwv/report.js', '/assets/js/cwv/ui.js']],
  ['/rss-feed-generator', ['/assets/js/progress.js', '/assets/js/common.js', '/assets/js/rss/browser.js', '/assets/js/rss/ui.js']]
];

function makeSandbox() {
  const ids = new Set();
  const elements = {};
  function fakeEl(id) {
    const el = {
      id, value: '', checked: false, innerHTML: '', textContent: '', hidden: false,
      className: '', style: {}, files: [], options: null,
      listeners: {}, onclick: null, oninput: null, onchange: null, onsubmit: null,
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      removeEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      appendChild() {}, removeChild() {}, remove() {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      setAttribute() {}, getAttribute() { return ''; }, hasAttribute() { return false; },
      closest() { return null; }, focus() {}, blur() {}, select() {}, click() {},
      requestSubmit() {}, scrollIntoView() {},
      dispatchEvent() { return true; }
    };
    Object.defineProperty(el, 'innerHTML', {
      get() { return this._html || ''; },
      set(v) {
        this._html = String(v == null ? '' : v);
        const re = /id="([^"]+)"/g;
        let m;
        while ((m = re.exec(this._html))) if (!elements[m[1]]) { elements[m[1]] = fakeEl(m[1]); ids.add(m[1]); }
      }
    });
    return el;
  }
  const doc = {
    getElementById(id) { return elements[id] || null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) { return fakeEl('tmp-' + tag); },
    addEventListener() {}, removeEventListener() {},
    body: fakeEl('body'),
    documentElement: fakeEl('html')
  };
  doc.body.classList.add = () => {};
  const sandbox = {
    scrollY: 0, scrollTo() {}, addEventListener() {}, removeEventListener() {},
    innerWidth: 1280, innerHeight: 900,
    document: doc,
    navigator: {},
    location: { search: '', href: BASE + '/', reload() {}, hash: '' },
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    URL: URL, URLSearchParams: URLSearchParams,
    Blob: function () { this.size = 0; },
    FileReader: function () { this.readAsText = function () {}; },
    fetch() { throw new Error('unexpected fetch at load time'); },
    setTimeout, clearTimeout, setInterval, clearInterval,
    console, Math, Date, JSON, RegExp, Object, Array, String, Number, Boolean, Error, Promise,
    parseInt, parseFloat, isNaN
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  sandbox.document = doc;
  sandbox.requestSubmit = () => {};
  return { sandbox, doc, elements, ids, fakeEl };
}

let failures = 0;
for (const [page, scripts] of PAGES) {
  const html = execFileSync('curl', ['-s', BASE + page], { encoding: 'utf8' });
  const { sandbox, doc, elements, ids, fakeEl } = makeSandbox();
  // Register every id present in the static page markup.
  const re = /id="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    if (!elements[m[1]]) { elements[m[1]] = fakeEl(m[1]); ids.add(m[1]); }
  }
  // The hero form's submit button is needed by some ui.js at load time.
  const ctx = vm.createContext(sandbox);
  try {
    for (const s of scripts) {
      const src = fs.readFileSync('.' + s, 'utf8');
      vm.runInContext(src, ctx, { filename: s });
    }
    console.log('  ✓ ' + page);
  } catch (e) {
    failures++;
    console.log('  ✗ ' + page + '  →  ' + (e && e.message));
    console.log('      at ' + (e && e.stack ? e.stack.split('\n')[1] : '').trim());
  }
}
console.log(failures ? '\n' + failures + ' page(s) failed' : '\nAll pages load cleanly');
process.exit(failures ? 1 : 0);
