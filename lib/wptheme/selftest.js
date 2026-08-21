'use strict';

/*
 * huvanti WordPress Theme Detector — offline self-test.
 * Run: node lib/wptheme/selftest.js
 *
 * The full production pipeline (collect → analyse → report) runs against an
 * injected fixture transport, so no network access is needed. DNS is stubbed
 * to a public IP so the SSRF/pinning path still executes.
 */

const assert = require('assert');
const dns = require('dns');

// Stub DNS for fixture domains (public IP, so the SSRF guard still passes).
dns.promises.lookup = async (host, opts) => {
  const rec = { address: '93.184.216.34', family: 4 };
  if (opts && opts.all) return [rec];
  return rec;
};

const U = require('./util');
const { runScan } = require('./orchestrate');
const { normalizeInputUrl } = U;

/* ---------------- fixtures ---------------- */

function cssHeader(f) {
  const lines = Object.keys(f).map(k => k + ': ' + f[k]);
  return '/*\n' + lines.join('\n') + '\n*/\n';
}

function wpHome(opt) {
  opt = opt || {};
  const o = opt.origin || 'https://astra.test';
  const slug = opt.slug || 'astra';
  const ver = opt.ver || '4.6.12';
  const wpVer = opt.wpVer || '6.8';
  const assetHost = opt.assetHost || o;
  const themeCss = '<link rel="stylesheet" id="' + slug + '-css" href="' + assetHost + '/wp-content/themes/' + slug + '/style.css' + (opt.noVer ? '' : '?ver=' + ver) + '">';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Test Site</title>
${opt.generator === false ? '' : '<meta name="generator" content="WordPress ' + wpVer + '">'}
<link rel="stylesheet" id="wp-block-library-css" href="${o}/wp-includes/css/dist/block-library/style.min.css?ver=${wpVer}">
${themeCss}
${opt.extraHead || ''}
<script src="${o}/wp-includes/js/wp-emoji-release.min.js?ver=${wpVer}"></script>
${opt.extraScripts || ''}
</head>
<body class="home blog ${opt.bodyClass || ''}">
<div class="wp-block-group"><figure class="wp-block-image"><img class="wp-image-12" src="${o}/wp-content/uploads/2026/01/pic.jpg" alt=""></figure></div>
<main><h1>Hello world</h1><p>Welcome to our website. We write about things and stuff and more things every week. ${'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor. '.repeat(8)}</p></main>
<a href="${o}/wp-login.php">Log in</a>
${opt.footer || ''}
</body></html>`;
}

const ASTRA_CSS = cssHeader({
  'Theme Name': 'Astra',
  'Theme URI': 'https://wpastra.com/',
  'Author': 'Brainstorm Force',
  'Author URI': 'https://wpastra.com/about/',
  'Description': 'Astra is the fastest, fully customizable WordPress theme.',
  'Version': '4.6.12',
  'License': 'GNU General Public License v2 or later',
  'License URI': 'http://www.gnu.org/licenses/gpl-2.0.html',
  'Text Domain': 'astra',
  'Tags': 'blog, one-column, two-columns, custom-colors'
}) + '.ast-container{max-width:1200px;margin:0 auto}.ast-grid{display:grid}';

function fixtureTransport(routes) {
  return async (urlObj, pin, fopt) => {
    const href = urlObj.href;
    for (const r of routes) {
      if (r.match.test(href)) {
        if (r.delayMs) await new Promise(res => setTimeout(res, r.delayMs));
        const text = typeof r.text === 'function' ? r.text() : (r.text || '');
        return { status: r.status || 200, headers: Object.assign({ 'content-type': r.ctype || 'text/html; charset=utf-8' }, r.headers || {}), text, bytes: text.length, ms: 12 };
      }
    }
    return { status: 404, headers: { 'content-type': 'text/html' }, text: 'not found', bytes: 9, ms: 5 };
  };
}

function routesFor(origin, opt) {
  opt = opt || {};
  const slug = opt.slug || 'astra';
  const styleCss = opt.styleCss != null ? opt.styleCss : ASTRA_CSS;
  const routes = [
    { match: new RegExp('^' + origin + '/robots\\.txt$'), text: 'User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n\nSitemap: ' + origin + '/wp-sitemap.xml', ctype: 'text/plain' },
    { match: new RegExp('^' + origin + '/\\??$|^' + origin + '/$'), status: opt.homeStatus || 200, headers: opt.homeHeaders, text: opt.homeHtml != null ? opt.homeHtml : wpHome(Object.assign({ origin }, opt)), ctype: 'text/html' },
    { match: new RegExp('^' + origin + '/wp-content/themes/' + slug + '/style\\.css'), status: opt.styleStatus || 200, text: styleCss, ctype: 'text/css' }
  ];
  if (opt.extraRoutes) routes.push(...opt.extraRoutes);
  return routes;
}

async function scan(url, routes) {
  return runScan(url, { transport: fixtureTransport(routes) });
}

/* ---------------- tests ---------------- */

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

/* 1 — URL normalisation */
test('URL normalisation accepts all input shapes', async () => {
  for (const [raw, want] of [
    ['example.com', 'https://example.com/'],
    ['www.example.com', 'https://www.example.com/'],
    ['https://example.com', 'https://example.com/'],
    ['http://example.com', 'http://example.com/'],
    [' https://example.com/page/ ', 'https://example.com/page/']
  ]) {
    assert.strictEqual(normalizeInputUrl(raw).href, want, raw);
  }
  for (const bad of ['', 'not a url', 'ftp://example.com', 'javascript:alert(1)', 'http://', 'example.123']) {
    let threw = false;
    try { normalizeInputUrl(bad); } catch (e) { threw = e.code === 'invalid_url'; }
    assert.ok(threw, 'should reject: ' + bad);
  }
});

/* 2 — SSRF guard */
test('SSRF guard blocks private, loopback, metadata and tricks', async () => {
  const { assertPublicUrl } = require('./ssrf');
  for (const bad of ['http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.10/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://0x7f000001/', 'http://2130706433/', 'http://metadata.google.internal/', 'https://10.0.0.1/']) {
    let code = '';
    try { assertPublicUrl(bad); } catch (e) { code = e.code; }
    assert.ok(code === 'ssrf', 'should block ' + bad);
  }
  assertPublicUrl('https://example.com/');
});

/* 3 — Theme header parser */
test('theme header parser handles headers, minified CSS and junk', async () => {
  const h = U.parseThemeHeader(ASTRA_CSS);
  assert.ok(h.found);
  assert.strictEqual(h.fields['Theme Name'], 'Astra');
  assert.strictEqual(h.fields['Version'], '4.6.12');
  const mini = U.parseThemeHeader('/*\nTheme Name: GenPress\nAuthor: Tom\nVersion: 3.1.1\n*/body{margin:0}.x{color:red}'.repeat(1));
  assert.ok(mini.found && mini.fields['Theme Name'] === 'GenPress');
  const none = U.parseThemeHeader('body{color:red}');
  assert.ok(!none.found);
});

/* 4 — Astra (scenario 1) */
test('Astra site: detects WordPress + theme + exact version', async () => {
  const r = await scan('https://astra.test', routesFor('https://astra.test', {
    bodyClass: 'ast-header-break-point ast-desktop'
  }));
  assert.strictEqual(r.status, 'detected');
  assert.ok(r.wordpress.confidence >= 90, 'wp conf ' + r.wordpress.confidence);
  assert.ok(r.theme.found && r.theme.name === 'Astra');
  assert.strictEqual(r.theme.slug, 'astra');
  assert.strictEqual(r.theme.version.label, 'exact');
  assert.strictEqual(r.theme.version.value, '4.6.12');
  assert.strictEqual(r.theme.author, 'Brainstorm Force');
  assert.ok(r.theme.confidence >= 90, 'theme conf ' + r.theme.confidence);
  assert.strictEqual(r.theme.type, 'standard');
  assert.ok(r.theme.evidence.length >= 3);
  assert.strictEqual(r.theme.source.label, 'WordPress.org');
});

/* 5 — GeneratePress (scenario 2) */
test('GeneratePress site: theme identified from slug + header', async () => {
  const r = await scan('https://gp.test', routesFor('https://gp.test', {
    slug: 'generatepress',
    styleCss: cssHeader({ 'Theme Name': 'GeneratePress', 'Theme URI': 'https://generatepress.com/', 'Author': 'Tom Usborne', 'Version': '3.5.1', 'License': 'GPL-2.0-or-later', 'Text Domain': 'generatepress' }),
    bodyClass: 'generatepress'
  }));
  assert.strictEqual(r.status, 'detected');
  assert.ok(r.theme.found && r.theme.name === 'GeneratePress');
  assert.strictEqual(r.theme.version.value, '3.5.1');
});

/* 6 — Kadence (scenario 3) */
test('Kadence site: theme identified', async () => {
  const r = await scan('https://kadence.test', routesFor('https://kadence.test', {
    slug: 'kadence',
    styleCss: cssHeader({ 'Theme Name': 'Kadence', 'Theme URI': 'https://kadencewp.com/kadence/', 'Author': 'Kadence WP', 'Version': '1.2.30', 'Text Domain': 'kadence' }),
    bodyClass: 'kadence-header-position'
  }));
  assert.ok(r.theme.found && r.theme.name === 'Kadence');
});

/* 7 — Divi with capital slug (scenario 4) */
test('Divi site: capitalised slug normalised and detected', async () => {
  const r = await scan('https://divi.test', routesFor('https://divi.test', {
    slug: 'Divi',
    styleCss: cssHeader({ 'Theme Name': 'Divi', 'Theme URI': 'https://www.elegantthemes.com/gallery/divi/', 'Author': 'Elegant Themes', 'Version': '4.27.4', 'License': 'GNU General Public License v2', 'Text Domain': 'Divi' }),
    bodyClass: 'et_pb_pagebuilder et-db'
  }));
  assert.strictEqual(r.theme.slug, 'divi');
  assert.ok(r.theme.premium.label.startsWith('Premium'));
  assert.ok(r.theme.source.label.indexOf('Elegant Themes') >= 0 || r.theme.source.label === 'Theme developer');
});

/* 8 — Avada (scenario 5) */
test('Avada site: premium theme detected with marketplace source', async () => {
  const r = await scan('https://avada.test', routesFor('https://avada.test', {
    slug: 'Avada',
    styleCss: cssHeader({ 'Theme Name': 'Avada', 'Theme URI': 'https://avada.com/', 'Author': 'ThemeFusion', 'Version': '7.11.2', 'Text Domain': 'Avada' }),
    bodyClass: 'fusion-image-hovers fusion-hover-type-1'
  }));
  assert.strictEqual(r.theme.slug, 'avada');
  assert.ok(r.theme.premium.label.startsWith('Premium'));
});

/* 9 — OceanWP (scenario 6) */
test('OceanWP site: theme identified', async () => {
  const r = await scan('https://ocean.test', routesFor('https://ocean.test', {
    slug: 'oceanwp',
    styleCss: cssHeader({ 'Theme Name': 'OceanWP', 'Theme URI': 'https://oceanwp.org/', 'Author': 'OceanWP', 'Version': '3.5.8', 'Text Domain': 'oceanwp' }),
    bodyClass: 'oceanwp-theme-2'
  }));
  assert.ok(r.theme.found && r.theme.name === 'OceanWP');
});

/* 10 — Hello Elementor (scenario 7) */
test('Hello Elementor + Elementor builder: theme and builder both reported', async () => {
  const r = await scan('https://hello.test', routesFor('https://hello.test', {
    slug: 'hello-elementor',
    styleCss: cssHeader({ 'Theme Name': 'Hello Elementor', 'Theme URI': 'https://elementor.com/', 'Author': 'Elementor Team', 'Version': '3.1.1', 'Text Domain': 'hello-elementor' }),
    bodyClass: 'hello-elementor elementor-default elementor-page-12',
    extraScripts: '<script src="https://hello.test/wp-content/plugins/elementor/assets/js/frontend.min.js?ver=3.25"></script>'
  }));
  assert.ok(r.theme.found && r.theme.name === 'Hello Elementor');
  assert.ok(r.wordpress.plugins.some(p => p.slug === 'elementor'));
});

/* 11 — Child theme (scenario 8) */
test('Child theme: Template: field resolves the parent with its version', async () => {
  const childCss = cssHeader({
    'Theme Name': 'My Custom Theme', 'Template': 'astra', 'Version': '1.0.0',
    'Theme URI': 'https://mybrand.test/', 'Author': 'My Brand Team'
  });
  const r = await scan('https://child.test', [
    { match: /^https:\/\/child\.test\/robots\.txt$/, text: 'User-agent: *\nDisallow: /wp-admin/', ctype: 'text/plain' },
    { match: /^https:\/\/child\.test\/$/, text: wpHome({ origin: 'https://child.test', slug: 'mybrand-child', bodyClass: 'ast-desktop', generator: 'WordPress 6.8' }).replace('/themes/mybrand-child/style.css', '/themes/mybrand-child/style.css'), ctype: 'text/html' },
    { match: /\/wp-content\/themes\/mybrand-child\/style\.css/, text: childCss, ctype: 'text/css' },
    { match: /\/wp-content\/themes\/astra\/style\.css/, text: ASTRA_CSS, ctype: 'text/css' }
  ]);
  assert.ok(r.theme.isChild);
  assert.strictEqual(r.theme.type, 'child');
  assert.strictEqual(r.theme.parent.slug, 'astra');
  assert.strictEqual(r.theme.parent.name, 'Astra');
  assert.strictEqual(r.theme.parent.version.value, '4.6.12');
});

/* 12 — Custom theme (scenario 9) */
test('Custom theme: flagged as possible custom, never guessed as known', async () => {
  const r = await scan('https://acme.test', routesFor('https://acme.test', {
    slug: 'acme-site',
    styleCss: cssHeader({ 'Theme Name': 'Acme Site Theme', 'Author': 'Acme Digital', 'Version': '2.1.0', 'Theme URI': 'https://acme.test/about' }),
    bodyClass: 'acme-layout'
  }));
  assert.ok(r.theme.found && r.theme.name === 'Acme Site Theme');
  assert.ok(r.theme.custom.flag, 'custom flag with signals: ' + JSON.stringify(r.theme.custom.signals));
  assert.ok(r.theme.custom.confidence >= 40);
  assert.strictEqual(r.theme.source.label, 'Custom / self-hosted');
});

/* 13 — Heavily modified assets (scenario 10) */
test('Modified assets: slug evidence still identifies the theme, no fingerprint overclaim', async () => {
  const r = await scan('https://mod.test', routesFor('https://mod.test', {
    slug: 'astra',
    styleCss: cssHeader({ 'Theme Name': 'Astra', 'Author': 'Brainstorm Force', 'Version': '4.0.0', 'Theme URI': 'https://wpastra.com/' }),
    bodyClass: 'custom-theme-mod',
    noVer: true
  }));
  assert.ok(r.theme.found && r.theme.name === 'Astra');
  assert.ok(r.theme.confidence >= 60 && r.theme.confidence <= 99);
});

/* 14 — Minified CSS (scenario 11) */
test('Minified style.css: header still parsed', async () => {
  const minCss = '/*\nTheme Name:Neve\nTheme URI:https://themeisle.com/themes/neve/\nAuthor:Themeisle\nVersion:3.8.9\nText Domain:neve\n*/body{margin:0}#nv-primary{color:#111}';
  const r = await scan('https://min.test', routesFor('https://min.test', {
    slug: 'neve',
    styleCss: minCss,
    bodyClass: 'neve-main'
  }));
  assert.ok(r.theme.found && r.theme.name === 'Neve');
  assert.strictEqual(r.theme.version.value, '3.8.9');
});

/* 15 — CDN assets (scenario 12) */
test('CDN-hosted assets: theme still detected from path', async () => {
  const r = await scan('https://cdnwp.test', routesFor('https://cdnwp.test', {
    slug: 'astra',
    assetHost: 'https://cdn.cdnwp.test',
    styleCss: ASTRA_CSS,
    bodyClass: 'ast-desktop'
  }));
  assert.strictEqual(r.status, 'detected');
  assert.ok(r.theme.found && r.theme.slug === 'astra');
});

/* 16 — Cloudflare challenge (scenario 13) */
test('Cloudflare challenge: Unable to Verify, never "not WordPress"', async () => {
  let err = null;
  try {
    await runScan('https://cf.test', {
      transport: fixtureTransport([
        { match: /^https:\/\/cf\.test\/robots\.txt$/, status: 403, headers: { server: 'cloudflare' }, text: '' },
        { match: /^https:\/\/cf\.test\/$/, status: 503, headers: { server: 'cloudflare', 'cf-ray': 'abc123' }, text: '<!doctype html><html><head><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/challenge_page"></script></head></html>' }
      ])
    });
  } catch (e) { err = e; }
  assert.ok(err, 'should throw');
  assert.strictEqual(err.code, 'challenge');
});

/* 17 — Non-WordPress marketing site (scenario 14) */
test('Non-WordPress site: Not Detected with transparent evidence', async () => {
  const html = `<!doctype html><html><head><title>Agency</title><meta name="generator" content="Eleventy v3.0.0"><script src="/assets/js/app.js"></script></head><body class="agency"><main><h1>We build brands</h1><p>${'Strategy and design for ambitious companies. '.repeat(10)}</p></main></body></html>`;
  const r = await scan('https://plain.test', [
    { match: /robots\.txt$/, status: 404, text: '' },
    { match: /^https:\/\/plain\.test\/$/, text: html, ctype: 'text/html' },
    { match: /^https:\/\/plain\.test\/wp-json\/$/, status: 404, text: '', ctype: 'application/json' }
  ]);
  assert.strictEqual(r.status, 'not_detected');
  assert.strictEqual(r.statusLabel, 'WordPress Not Detected');
  assert.ok(r.wordpress.confidence >= 90);
  assert.ok(!r.theme);
});

/* 18 — Static HTML (scenario 15) */
test('Static HTML site: Not Detected, no fake platform', async () => {
  const r = await scan('https://static.test', [
    { match: /robots\.txt$/, status: 404, text: '' },
    { match: /^https:\/\/static\.test\/$/, text: '<!doctype html><html><head><title>Hand made</title></head><body><h1>My page</h1><p>' + 'Hand written HTML with no CMS at all. '.repeat(12) + '</p></body></html>', ctype: 'text/html' },
    { match: /wp-json/, status: 404, text: '', ctype: 'application/json' }
  ]);
  assert.strictEqual(r.status, 'not_detected');
  assert.ok(!r.possiblePlatform);
});

/* 19 — Shopify (scenario 16) */
test('Shopify site: Not Detected + possible platform suggestion', async () => {
  const html = `<!doctype html><html><head><title>Shop</title><script>window.Shopify = {theme: {}};</script><link rel="stylesheet" href="https://cdn.shopify.com/s/files/1/x/t/2/assets/theme.css"></head><body class="template-index"><main><h1>Store</h1><p>${'Buy our wonderful products online today. '.repeat(10)}</p></main><script src="https://cdn.shopify.com/s/files/1/x/t/2/assets/theme.min.js" defer></script></body></html>`;
  const r = await scan('https://shop.test', [
    { match: /robots\.txt$/, status: 404, text: '' },
    { match: /^https:\/\/shop\.test\/$/, text: html, ctype: 'text/html' },
    { match: /wp-json/, status: 404, text: '', ctype: 'application/json' }
  ]);
  assert.strictEqual(r.status, 'not_detected');
  assert.ok(r.possiblePlatform, 'should suggest a platform');
  assert.strictEqual(r.possiblePlatform.name, 'Shopify');
});

/* 20 — Theme assets blocked (scenario 17) */
test('Blocked style.css: theme capped at Likely, reason shown', async () => {
  const r = await scan('https://blocked.test', routesFor('https://blocked.test', {
    slug: 'astra',
    styleStatus: 403,
    bodyClass: 'ast-desktop'
  }));
  assert.strictEqual(r.status, 'detected');
  assert.ok(r.theme.found);
  assert.ok(r.theme.confidence <= 72, 'confidence must be capped without style.css, got ' + r.theme.confidence);
  assert.notStrictEqual(r.theme.styleCssAccess, 'public');
});

/* 21 — Hidden version (scenario 18) */
test('Hidden version: core-version ?ver is ignored, version reported as not detectable', async () => {
  const noVersionCss = cssHeader({ 'Theme Name': 'Astra', 'Author': 'Brainstorm Force', 'Theme URI': 'https://wpastra.com/' });
  const r = await scan('https://hidden.test', routesFor('https://hidden.test', {
    slug: 'astra',
    styleCss: noVersionCss,
    ver: '6.8', // equals the WordPress core version → must NOT be reported as theme version
    wpVer: '6.8',
    bodyClass: 'ast-desktop'
  }));
  assert.strictEqual(r.theme.version.label, 'none');
  assert.ok(/not publicly detectable/i.test(r.theme.version.detail));
});

/* 22 — Multiple theme references (scenario 19) */
test('Multiple theme fingerprints: active theme chosen from enqueued stylesheet', async () => {
  const html = wpHome({ origin: 'https://multi.test', slug: 'astra', bodyClass: 'ast-desktop' })
    .replace('</head>', '<link rel="stylesheet" id="old-css" href="https://multi.test/wp-content/themes/twentytwenty/style.css?ver=2.4"></head>');
  const r = await scan('https://multi.test', [
    { match: /robots\.txt$/, text: 'User-agent: *\nDisallow: /wp-admin/', ctype: 'text/plain' },
    { match: /^https:\/\/multi\.test\/$/, text: html, ctype: 'text/html' },
    { match: /\/themes\/astra\/style\.css/, text: ASTRA_CSS, ctype: 'text/css' },
    { match: /\/themes\/twentytwenty\/style\.css/, text: cssHeader({ 'Theme Name': 'Twenty Twenty', 'Author': 'the WordPress team', 'Version': '2.4' }), ctype: 'text/css' }
  ]);
  assert.ok(r.theme.found && r.theme.slug === 'astra');
  assert.ok((r.theme.extraSlugs || []).includes('twentytwenty'));
});

/* 23 — Blocked requests (scenario 20) */
test('403 homepage: Unable to Verify with reason, scan details present', async () => {
  let err = null;
  try {
    await runScan('https://noaccess.test', {
      transport: fixtureTransport([
        { match: /robots\.txt$/, status: 403, text: '' },
        { match: /^https:\/\/noaccess\.test\/$/, status: 403, headers: { server: 'nginx' }, text: '403 Forbidden' }
      ])
    });
  } catch (e) { err = e; }
  assert.ok(err);
  assert.strictEqual(err.code, 'blocked');
  assert.ok(err.scan && err.scan.status === 403);
});

/* 24 — REST-driven detection when HTML is thin */
test('Thin HTML but public REST: WordPress detected via REST probe', async () => {
  const thin = '<!doctype html><html><head><title>App</title><link rel="stylesheet" href="/assets/main.css"></head><body><div id="root"></div><p>Loading… ' + 'x'.repeat(80) + '</p></body></html>';
  const r = await scan('https://thin.test', [
    { match: /robots\.txt$/, status: 404, text: '' },
    { match: /^https:\/\/thin\.test\/$/, text: thin, ctype: 'text/html' },
    { match: /\/wp-json\/$/, status: 200, text: JSON.stringify({ name: 'Thin', namespaces: ['wp/v2', 'oembed/1.0'] }), ctype: 'application/json' },
    { match: /\/wp-json\/wp\/v2\/posts/, status: 200, text: JSON.stringify([{ content: { rendered: wpHome({ origin: 'https://thin.test', slug: 'astra', generator: false }) } }]), ctype: 'application/json' },
    { match: /\/themes\/astra\/style\.css/, text: ASTRA_CSS, ctype: 'text/css' }
  ]);
  assert.strictEqual(r.status, 'detected');
  assert.ok(r.theme.found && r.theme.slug === 'astra');
  assert.ok(r.theme.evidence.some(e => e.method === 'WordPress REST API'));
});

/* 25 — Redirects are followed and revalidated */
test('http→https redirect followed, final URL recorded', async () => {
  const routes = [
    { match: /^http:\/\/redir\.test\/robots\.txt$/, status: 301, headers: { location: 'https://redir.test/robots.txt' }, text: '' },
    { match: /^https:\/\/redir\.test\/robots\.txt$/, text: 'User-agent: *\nDisallow: /wp-admin/', ctype: 'text/plain' },
    { match: /^http:\/\/redir\.test\/$/, status: 301, headers: { location: 'https://www.redir.test/' }, text: '' },
    { match: /^https:\/\/www\.redir\.test\/robots\.txt$/, status: 404, text: '' },
    { match: /^https:\/\/www\.redir\.test\/$/, text: wpHome({ origin: 'https://www.redir.test', slug: 'astra', bodyClass: 'ast-desktop' }), ctype: 'text/html' },
    { match: /\/themes\/astra\/style\.css/, text: ASTRA_CSS, ctype: 'text/css' }
  ];
  const r = await scan('http://redir.test', routes);
  assert.strictEqual(r.status, 'detected');
  assert.strictEqual(r.scan.finalUrl, 'https://www.redir.test/');
  assert.ok(r.scan.redirects.length >= 2);
});

/* 26 — Version status uses the bundled dataset honestly */
test('version status: older version flagged against local dataset only', async () => {
  const r = await scan('https://oldver.test', routesFor('https://oldver.test', {
    slug: 'astra', styleCss: ASTRA_CSS.replace('4.6.12', '3.0.0'), bodyClass: 'ast-desktop'
  }));
  assert.strictEqual(r.versionStatus.label, 'Older version detected');
  assert.ok(/dataset/.test(r.versionStatus.detail));
  assert.ok(!/(is vulnerable|vulnerable to|vulnerabilit(y|ies) (found|present|detected)|CVE-)/i.test(JSON.stringify(r)), 'must never claim vulnerabilities');
});

/* 27 — Exposure section is informational */
test('exposure analysis lists observable items without exploit claims', async () => {
  const r = await scan('https://exp.test', routesFor('https://exp.test', {
    slug: 'astra', bodyClass: 'ast-desktop',
    extraRoutes: [
      { match: /\/themes\/astra\/readme\.txt$/, text: '=== Astra ===\nChangelog here', ctype: 'text/plain' },
      { match: /\/themes\/astra\/changelog\.txt$/, status: 404, text: '' },
      { match: /\/themes\/astra\/$/, text: '<html><head><title>Index of /wp-content/themes/astra/</title></head><body><h1>Index of /wp-content/themes/astra/</h1></body></html>' },
      { match: /\/themes\/astra\/\.git\/HEAD$/, status: 404, text: '' },
      { match: /map$/, status: 404, text: '' },
      { match: /screenshot\.png$/, status: 200, ctype: 'image/png', text: 'PNGDATA'.repeat(200) }
    ]
  }));
  const byKey = {};
  r.exposure.items.forEach(i => { byKey[i.key] = i; });
  assert.strictEqual(byKey.stylecss.status, 'exposed');
  assert.strictEqual(byKey.readme.status, 'exposed');
  assert.strictEqual(byKey.dirindex.status, 'exposed');
  assert.strictEqual(byKey.devfile.status, 'not_found');
  assert.ok(r.theme.preview.available, 'screenshot detected');
});

/* 28 — No fake results: unknown theme on a WP site says so */
test('unknown theme slug: WordPress detected, theme honestly unknown', async () => {
  const r = await scan('https://mystery.test', [
    { match: /robots\.txt$/, text: 'User-agent: *\nDisallow: /wp-admin/', ctype: 'text/plain' },
    { match: /^https:\/\/mystery\.test\/$/, text: '<!doctype html><html><head><meta name="generator" content="WordPress 6.7"><script src="/wp-includes/js/jquery/jquery.min.js?ver=6.7"></script></head><body class="home"><main><h1>Blog</h1><p>' + 'Words '.repeat(200) + '</p></main></body></html>', ctype: 'text/html' },
    { match: /wp-json\/$/, status: 200, text: JSON.stringify({ namespaces: ['wp/v2'] }), ctype: 'application/json' },
    { match: /wp-json\/wp\/v2\/posts/, status: 401, text: '{"code":"rest_cannot_view"}', ctype: 'application/json' },
    { match: /oembed/, status: 404, text: '' }
  ]);
  assert.strictEqual(r.status, 'detected');
  assert.ok(!r.theme.found);
  assert.strictEqual(r.theme.confidenceLabel, 'Unable to determine');
  assert.ok(r.theme.why.length >= 2);
  assert.ok(r.theme.attempts.length >= 3);
});

/* 29 — Budget: scans never flood the target */
test('request budget: scan stays within limits', async () => {
  const r = await scan('https://budget.test', routesFor('https://budget.test', { slug: 'astra', bodyClass: 'ast-desktop' }));
  assert.ok(r.scan.requests <= 20, 'requests=' + r.scan.requests);
});

/* 30 — Copy text contains the essentials */
test('copy text includes theme essentials', async () => {
  const r = await scan('https://copy.test', routesFor('https://copy.test', { slug: 'astra', bodyClass: 'ast-desktop' }));
  assert.ok(/Theme: Astra/.test(r.copyText));
  assert.ok(/Slug: astra/.test(r.copyText));
  assert.ok(/Version: 4.6.12/.test(r.copyText));
});

/* ---------------- runner ---------------- */

(async () => {
  let pass = 0, fail = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      pass++;
      console.log('  ok  ' + name);
    } catch (e) {
      fail++;
      console.log('FAIL  ' + name);
      console.log('      ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n      ') : e));
    }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed, ' + tests.length + ' total');
  process.exit(fail ? 1 : 0);
})();
