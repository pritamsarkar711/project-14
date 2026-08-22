'use strict';

/*
 * Domain Information Checker — UI smoke test.
 * Drives assets/js/domaincheck/ui.js with a fake DOM and a fake fetch/SSE
 * transport, against REAL reports produced by the offline engine (fixtures).
 * Verifies: section rendering, honest "Not publicly available" output,
 * XSS escaping, progress steps, error states, and the copy/export helpers.
 */

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const dns = require('dns');
dns.promises.lookup = async (h, o) => { const r = { address: '93.184.216.34', family: 4 }; return o && o.all ? [r] : r; };

const F = require('./fixtures');
const { runScan } = require('./orchestrate');
const { createFetcher } = require('../wptheme/fetcher');

/* ---------------- fake DOM ---------------- */

function fakeEl(id) {
  return {
    id, value: '', innerHTML: '', className: '', disabled: false, textContent: '',
    listeners: {},
    addEventListener(t, fn) { this.listeners[t] = fn; },
    setAttribute() {}, getAttribute() { return ''; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    appendChild() {}, remove() {},
    focus() {}, select() {},
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
    scrollIntoView() {}
  };
}

function makeFakeDoc() {
  const elements = {};
  const doc = {
    readyState: 'complete',
    getElementById(id) { if (!elements[id]) elements[id] = fakeEl(id); return elements[id]; },
    createElement(tag) { return fakeEl('created-' + tag); },
    body: fakeEl('body'),
    documentElement: fakeEl('html'),
    head: { appendChild() {} },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}
  };
  return { doc, elements };
}

/* ---------------- report fixtures (real engine, offline) ---------------- */

function baseDns(zone, extra) {
  const d = F.makeDnsFixture({
    zoneRoot: zone,
    cymru: { '93.184.216.34': '15133 | 93.184.216.0/24 | US | arin | 2011-06-09' },
    asnNames: { '15133': '15133 | US | arin | 2011-06-09 | EDGECAST, US' }
  });
  if (extra) extra(d);
  return d;
}

function scanOpts(cfg) {
  return {
    dnsExchange: cfg.dns.exchange,
    rdapFetcher: createFetcher({ transport: F.makeRdapFixture(cfg.rdap || {}), maxRequests: 6, maxTotalBytes: 1 << 20 }),
    whoisTransport: cfg.whois || null,
    tlsTransport: cfg.tls || null,
    httpRequest: cfg.http || null,
    cache: new Map()
  };
}

async function fullReport() {
  const d = baseDns('uitest-example.com');
  d.add('uitest-example.com', 'A', [{ value: '93.184.216.34' }]);
  d.add('uitest-example.com', 'NS', [{ value: 'ns1.uitest-example.com' }, { value: 'ns2.uitest-example.com' }]);
  d.add('uitest-example.com', 'SOA', [{ mname: 'ns1.uitest-example.com' }]);
  d.add('uitest-example.com', 'MX', [{ value: 'mx.uitest-example.com', priority: 10 }]);
  d.add('uitest-example.com', 'TXT', [{ value: 'v=spf1 -all' }]);
  d.add('uitest-example.com', 'TXT', [{ value: '"><script>alert(1)</script>' }]);
  d.add('_dmarc.uitest-example.com', 'TXT', [{ value: 'v=DMARC1; p=quarantine' }]);
  const rdap = {};
  rdap['uitest-example.com'] = { record: () => F.rdapRecord({ domain: 'uitest-example.com', registered: '2019-01-15T00:00:00Z', expires: '2027-01-15T00:00:00Z' }) };
  return runScan('uitest-example.com', Object.assign(scanOpts({
    dns: d, rdap,
    tls: () => F.tlsInfo({ host: 'uitest-example.com' }),
    http: () => F.httpResponse({ status: 200, headers: { server: 'nginx' } })
  }), {}));
}

async function cloudflareReport() {
  const d = baseDns('uitest-cf.com');
  d.add('uitest-cf.com', 'A', [{ value: '104.16.0.1' }]);
  d.add('uitest-cf.com', 'NS', [{ value: 'era.ns.cloudflare.com' }]);
  d.setCymru({ '104.16.0.1': '13335 | 104.16.0.0/13 | US | arin | 2014-03-28' });
  const rdap = { 'uitest-cf.com': { record: () => F.rdapRecord({ domain: 'uitest-cf.com' }) } };
  return runScan('uitest-cf.com', scanOpts({
    dns: d, rdap,
    http: () => F.httpResponse({ headers: { 'cf-ray': 'abc', server: 'cloudflare' } })
  }));
}

async function unavailableReport() {
  const d = baseDns('uitest-opaque.com');
  d.add('uitest-opaque.com', 'A', [{ value: '93.184.216.34' }]);
  return runScan('uitest-opaque.com', scanOpts({
    dns: d,
    rdap: { 'uitest-opaque.com': { throw: Object.assign(new Error('reset'), { code: 'tls_blocked' }) } },
    whois: async () => { const e = new Error('reset'); e.code = 'egress_blocked'; throw e; }
  }));
}

/* ---------------- VM environment ---------------- */

function makeVm() {
  const { doc, elements } = makeFakeDoc();
  const sandbox = {
    console,
    window: null,
    document: doc,
    navigator: {},
    TextDecoder: require('util').TextDecoder,
    Uint8Array,
    AbortController,
    setTimeout, clearTimeout,
    location: { reload() {} },
    URL, Blob: function () {}, URL: require('url').URL
  };
  sandbox.window = sandbox;
  const code = fs.readFileSync(require('path').join(__dirname, '..', '..', 'assets', 'js', 'domaincheck', 'ui.js'), 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(__dirname + '/../../assets/js/progress.js', 'utf8'), sandbox);
  vm.runInContext(code, sandbox, { filename: 'ui.js' });
  return { sandbox, doc, elements };
}

function sseText(report) {
  const events = [
    'event: progress\ndata: ' + JSON.stringify({ stage: 'validate', message: 'Validating…', completed: [] }) + '\n\n',
    'event: progress\ndata: ' + JSON.stringify({ stage: 'rdap', message: 'RDAP…', completed: ['domain_validated'] }) + '\n\n',
    'event: result\ndata: ' + JSON.stringify(report) + '\n\n'
  ].join('');
  return events;
}

function fakeSseFetch(report, chunkSize) {
  const text = sseText(report);
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) chunks.push(text.slice(i, i + chunkSize));
  let idx = 0;
  return function () {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      body: {
        getReader() {
          return {
            read() {
              if (idx < chunks.length) {
                const chunk = chunks[idx++];
                return Promise.resolve({ done: false, value: new Uint8Array(Buffer.from(chunk, 'utf8')) });
              }
              return Promise.resolve({ done: true, value: undefined });
            }
          };
        }
      }
    });
  };
}

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

/* ---------------- tests ---------------- */

test('UI — complete report renders every section', async () => {
  const report = await fullReport();
  const { sandbox, doc } = makeVm();
  sandbox.fetch = () => Promise.reject(new Error('no fetch needed'));
  const ui = sandbox.DomainCheckUI;
  const html = ui.reportHtml(report);
  const required = [
    'Domain Overview', 'Registration Timeline', 'Domain Registration Information',
    'Hosting &amp; Network', 'IP Information', 'Nameserver Analysis', 'DNS Records',
    'DNS Health', 'Email Infrastructure', 'DNSSEC', 'SSL / TLS', 'Website (HTTP)',
    'Website Technology', 'Publicly Observed Subdomains', 'TLD Information',
    'Domain Structure', 'Data Sources &amp; Transparency'
  ];
  for (const s of required) assert.ok(html.includes(s), 'missing section: ' + s);
  assert.ok(html.includes('uitest-example.com'));
  assert.ok(html.includes('Example Registrar, Inc.'));
  assert.ok(html.includes('Registered'));
  assert.ok(html.includes('Not publicly available'), 'unavailable values must be stated');
  assert.ok(html.includes('% confidence') || html.includes('confidence'), 'confidence must be shown');
  // progress + error paths render
  const results = doc.getElementById('domaincheck-results');
  ui.renderProgress(results, 'Working', ['domain_validated']);
  assert.ok(results.innerHTML.includes('Domain validated'));
  assert.ok(results.innerHTML.includes('check_circle'));
  ui.renderError(results, { code: 'invalid_input', message: 'Please enter a domain name.' });
  assert.ok(results.innerHTML.includes('Please enter a domain name.'));
});

test('UI — XSS: untrusted TXT values are escaped', async () => {
  const report = await fullReport();
  const { sandbox } = makeVm();
  const html = sandbox.DomainCheckUI.reportHtml(report);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script must never appear');
  assert.ok(html.includes('&lt;script&gt;'), 'value must be HTML-escaped');
});

test('UI — Cloudflare report separates CDN from origin hosting', async () => {
  const report = await cloudflareReport();
  const { sandbox } = makeVm();
  const html = sandbox.DomainCheckUI.reportHtml(report);
  assert.ok(html.includes('Cloudflare'));
  assert.ok(html.includes('Not publicly determinable'), 'origin must be labelled not determinable');
  assert.ok(html.includes('CDN evidence') || html.includes('CDN'), 'CDN section present');
  const text = sandbox.DomainCheckUI.reportText(report);
  assert.ok(text.includes('CDN/Proxy: Cloudflare'));
  assert.ok(text.includes('Not publicly determinable'));
});

test('UI — unverifiable data is shown honestly', async () => {
  const report = await unavailableReport();
  const { sandbox } = makeVm();
  const html = sandbox.DomainCheckUI.reportHtml(report);
  assert.ok(html.includes('Unable to Verify'));
  assert.ok(html.includes('Registration information unavailable.'));
  assert.ok(html.includes('Retry HTTP via my browser'), 'relay button must be offered when HTTP is unavailable');
});

test('UI — reportText export contains the key facts', async () => {
  const report = await fullReport();
  const { sandbox } = makeVm();
  const text = sandbox.DomainCheckUI.reportText(report);
  for (const s of ['Domain Information Report', 'uitest-example.com', '== Domain Overview ==',
    '== Registration ==', '== Hosting & Network ==', '== DNS ==', '== Security ==',
    '== Website ==', '== Not publicly available ==', 'Example Registrar, Inc.']) {
    assert.ok(text.includes(s), 'missing in text report: ' + s);
  }
});

test('UI — full submit flow: SSE progress → rendered report', async () => {
  const report = await fullReport();
  const { sandbox, doc, elements } = makeVm();
  sandbox.fetch = fakeSseFetch(report, 64);
  // boot() ran on load; simulate a submit
  const form = doc.getElementById('domaincheck-form');
  const input = doc.getElementById('domaincheck-url');
  input.value = 'https://uitest-example.com';
  assert.ok(form.listeners.submit, 'submit handler wired');
  form.listeners.submit({ preventDefault() {} });
  // the submit handler runs an async SSE chain — give it time to complete
  await new Promise(r => setTimeout(r, 150));
  const results = doc.getElementById('domaincheck-results');
  assert.ok(results.innerHTML.includes('Domain Overview'), 'report rendered');
  assert.ok(results.innerHTML.includes('uitest-example.com'));
  assert.ok(results.innerHTML.includes('Copy All Information'));
  assert.ok(results.innerHTML.includes('Download JSON Report'));
  assert.ok(results.innerHTML.includes('Download Text Report'));
});

(async () => {
  let pass = 0;
  let fail = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      pass++;
      console.log('  ✓ ' + name);
    } catch (e) {
      fail++;
      console.error('  ✗ ' + name);
      console.error('    ' + (e && e.message ? e.message : e));
      if (e && e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
    }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
