'use strict';

/*
 * Website technology detection — fingerprints from publicly observable
 * signals only: HTTP headers, HTML meta/script/link markers, known paths.
 * Every finding carries its evidence and a confidence; the section header
 * always notes that detection is heuristic, never 100% certain.
 */

const U = require('./util');

const FINGERPRINTS = [
  // CMS / frameworks
  { id: 'wordpress', name: 'WordPress', category: 'CMS',
    weight: 1, tests: [
      { kind: 'html', re: /wp-content\/|wp-includes\//i, weight: 3 },
      { kind: 'meta', re: /<meta[^>]+name=["']generator["'][^>]+content=["'][^"']*WordPress[^"']*["']/i, weight: 3 },
      { kind: 'header', re: /x-pingback/i, header: 'x-pingback', weight: 1 },
      { kind: 'html', re: /wp-json\//i, weight: 1 },
      { kind: 'path', path: '/wp-json/', weight: 2 }
    ] },
  { id: 'shopify', name: 'Shopify', category: 'E-commerce',
    weight: 1, tests: [
      { kind: 'html', re: /cdn\.shopify\.com|shopifycdn/i, weight: 3 },
      { kind: 'meta', re: /<meta[^>]+name=["']generator["'][^>]+content=["'][^"']*Shopify/i, weight: 3 },
      { kind: 'header', header: 'x-shopid', re: /.+/, weight: 3 },
      { kind: 'html', re: /myshopify\.com/i, weight: 2 }
    ] },
  { id: 'wix', name: 'Wix', category: 'Site builder',
    weight: 1, tests: [
      { kind: 'html', re: /wixstatic\.com|static\.wixstatic\.com/i, weight: 3 },
      { kind: 'meta', re: /<meta[^>]+name=["']generator["'][^>]+content=["'][^"']*Wix/i, weight: 3 },
      { kind: 'header', header: 'x-wix-request-id', re: /.+/, weight: 2 },
      { kind: 'html', re: /_wixABTests|wix-code/i, weight: 1 }
    ] },
  { id: 'webflow', name: 'Webflow', category: 'Site builder',
    weight: 1, tests: [
      { kind: 'meta', re: /<meta[^>]+name=["']generator["'][^>]+content=["'][^"']*Webflow/i, weight: 3 },
      { kind: 'html', re: /webflow\.io|assets\.website-files\.com/i, weight: 3 },
      { kind: 'header', header: 'x-powered-by', re: /webflow/i, weight: 2 }
    ] },
  { id: 'drupal', name: 'Drupal', category: 'CMS',
    weight: 1, tests: [
      { kind: 'meta', re: /<meta[^>]+name=["']generator["'][^>]+content=["'][^"']*Drupal[^"']*/i, weight: 3 },
      { kind: 'header', header: 'x-generator', re: /Drupal/i, weight: 3 },
      { kind: 'header', header: 'x-drupal-cache', re: /.+/, weight: 3 },
      { kind: 'html', re: /\/sites\/(default|all)\/files\//i, weight: 2 }
    ] },
  { id: 'joomla', name: 'Joomla', category: 'CMS',
    weight: 1, tests: [
      { kind: 'meta', re: /<meta[^>]+name=["']generator["'][^>]+content=["'][^"']*Joomla/i, weight: 3 },
      { kind: 'html', re: /\/media\/system\/js\//i, weight: 2 },
      { kind: 'html', re: /com_content/i, weight: 1 }
    ] },
  { id: 'laravel', name: 'Laravel (PHP)', category: 'Framework',
    weight: 1, tests: [
      { kind: 'cookie', re: /laravel_session/i, weight: 3 },
      { kind: 'header', header: 'x-powered-by', re: /laravel/i, weight: 1 }
    ] },
  { id: 'nextjs', name: 'Next.js (React)', category: 'Framework',
    weight: 1, tests: [
      { kind: 'html', re: /\/_next\/static\//i, weight: 3 },
      { kind: 'html', re: /<div id=["']__next["']>/i, weight: 2 },
      { kind: 'html', re: /__NEXT_DATA__/i, weight: 3 }
    ] },
  { id: 'nuxt', name: 'Nuxt.js (Vue)', category: 'Framework',
    weight: 1, tests: [
      { kind: 'html', re: /\/_nuxt\//i, weight: 3 },
      { kind: 'html', re: /window\.__NUXT__/i, weight: 3 }
    ] },
  { id: 'react', name: 'React', category: 'Framework',
    weight: 0.5, tests: [
      { kind: 'html', re: /react(-dom)?(\.production)?\.min\.js/i, weight: 2 },
      { kind: 'html', re: /data-reactroot/i, weight: 2 }
    ] },
  { id: 'vue', name: 'Vue.js', category: 'Framework',
    weight: 0.5, tests: [
      { kind: 'html', re: /vue(\.runtime)?(\.global)?(\.prod)?\.js/i, weight: 2 },
      { kind: 'html', re: /data-v-[0-9a-f]{6,8}/i, weight: 2 }
    ] },
  { id: 'angular', name: 'Angular', category: 'Framework',
    weight: 0.5, tests: [
      { kind: 'html', re: /ng-version=/i, weight: 3 },
      { kind: 'html', re: /angular(\.min)?\.js/i, weight: 2 }
    ] },
  { id: 'jquery', name: 'jQuery', category: 'Library',
    weight: 0.4, tests: [
      { kind: 'html', re: /jquery[.-]([0-9.]+)(\.min)?\.js/i, weight: 2 }
    ] },
  { id: 'php', name: 'PHP', category: 'Language',
    weight: 0.5, tests: [
      { kind: 'header', header: 'x-powered-by', re: /^php\//i, weight: 3 },
      { kind: 'html', re: /\.php(?:["'?]|$)/i, weight: 1 }
    ] },
  { id: 'nodejs', name: 'Node.js', category: 'Language',
    weight: 0.5, tests: [
      { kind: 'header', header: 'x-powered-by', re: /express/i, weight: 2 },
      { kind: 'header', header: 'server', re: /node\.js/i, weight: 2 }
    ] },
  { id: 'cloudflare', name: 'Cloudflare', category: 'CDN / Proxy',
    weight: 0.5, tests: [
      { kind: 'header', header: 'server', re: /cloudflare/i, weight: 3 },
      { kind: 'header', header: 'cf-ray', re: /.+/, weight: 3 }
    ] },
  { id: 'gtm', name: 'Google Tag Manager', category: 'Analytics',
    weight: 0.5, tests: [
      { kind: 'html', re: /googletagmanager\.com\/gtm\.js\?id=GTM-[A-Z0-9]+/i, weight: 3 },
      { kind: 'html', re: /dataLayer\s*=\s*dataLayer/i, weight: 1 }
    ] },
  { id: 'ga4', name: 'Google Analytics (GA4)', category: 'Analytics',
    weight: 0.5, tests: [
      { kind: 'html', re: /googletagmanager\.com\/gtag\/js\?id=G-[A-Z0-9]+/i, weight: 3 },
      { kind: 'html', re: /gtag\(["']config["'],\s*["']G-[A-Z0-9]+/i, weight: 3 },
      { kind: 'html', re: /google-analytics\.com\/analytics\.js/i, weight: 1 }
    ] },
  { id: 'litespeed', name: 'LiteSpeed', category: 'Web server',
    weight: 0.5, tests: [
      { kind: 'header', header: 'server', re: /litespeed/i, weight: 3 },
      { kind: 'header', header: 'x-litespeed-cache', re: /.+/, weight: 3 },
      { kind: 'header', header: 'x-lsadc-cache', re: /.+/, weight: 2 }
    ] },
  { id: 'nginx', name: 'Nginx', category: 'Web server',
    weight: 0.5, tests: [
      { kind: 'header', header: 'server', re: /^nginx(\/|$)/i, weight: 3 }
    ] },
  { id: 'apache', name: 'Apache', category: 'Web server',
    weight: 0.5, tests: [
      { kind: 'header', header: 'server', re: /^apache(\/|$)/i, weight: 3 }
    ] },
  { id: 'cloudfront', name: 'Amazon CloudFront', category: 'CDN / Proxy',
    weight: 0.5, tests: [
      { kind: 'header', header: 'x-amz-cf-id', re: /.+/, weight: 3 },
      { kind: 'header', header: 'server', re: /cloudfront/i, weight: 3 }
    ] },
  { id: 'hugo', name: 'Hugo', category: 'Static site generator',
    weight: 0.5, tests: [
      { kind: 'meta', re: /<meta[^>]+name=["']generator["'][^>]+content=["'][^"']*Hugo[^"']*/i, weight: 3 }
    ] },
  { id: 'gatsby', name: 'Gatsby', category: 'Static site generator',
    weight: 0.5, tests: [
      { kind: 'html', re: /id="___gatsby"/i, weight: 3 },
      { kind: 'html', re: /\/page-data\/app-data\.json/i, weight: 2 }
    ] },
  { id: 'jekyll', name: 'Jekyll', category: 'Static site generator',
    weight: 0.5, tests: [
      { kind: 'meta', re: /<meta[^>]+name=["']generator["'][^>]+content=["'][^"']*Jekyll[^"']*/i, weight: 3 }
    ] },
  { id: 'elementor', name: 'Elementor', category: 'WordPress page builder',
    weight: 0.5, tests: [
      { kind: 'html', re: /\/wp-content\/plugins\/elementor\//i, weight: 3 },
      { kind: 'html', re: /elementor-widget-/i, weight: 2 }
    ] },
  { id: 'squarespace', name: 'Squarespace', category: 'Site builder',
    weight: 0.5, tests: [
      { kind: 'html', re: /static1\.squarespace\.com|squarespace-cdn\.com/i, weight: 3 },
      { kind: 'header', header: 'server', re: /squarespace/i, weight: 2 }
    ] },
  { id: 'ghost', name: 'Ghost', category: 'CMS',
    weight: 0.5, tests: [
      { kind: 'meta', re: /<meta[^>]+name=["']generator["'][^>]+content=["'][^"']*Ghost[^"']*/i, weight: 3 }
    ] },
  { id: 'netlify', name: 'Netlify', category: 'Hosting platform',
    weight: 0.5, tests: [
      { kind: 'header', header: 'server', re: /netlify/i, weight: 3 },
      { kind: 'html', re: /netlify-cdn|netlifyglobalcdn/i, weight: 2 }
    ] },
  { id: 'vercel', name: 'Vercel', category: 'Hosting platform',
    weight: 0.5, tests: [
      { kind: 'header', header: 'x-vercel-id', re: /.+/, weight: 3 },
      { kind: 'header', header: 'x-vercel-cache', re: /.+/, weight: 2 }
    ] }
];

function detectTechnology(ctx) {
  const headers = ctx.headers || {};
  const html = ctx.html || '';
  const cookies = ctx.cookies || '';
  const pathChecks = ctx.pathChecks || {}; // { path: status } from orchestrate probes
  const out = [];
  const meta = html ? (html.match(/<meta[^>]+name=["']generator["'][^>]+content=["'][^"']([^"']*)["']/ig) || []).join(' ') : '';

  for (const fp of FINGERPRINTS) {
    let score = 0;
    const evidence = [];
    for (const t of fp.tests) {
      let hay = null;
      if (t.kind === 'header') hay = headers[t.header] != null ? String(headers[t.header]) : null;
      else if (t.kind === 'html') hay = html;
      else if (t.kind === 'meta') hay = meta;
      else if (t.kind === 'cookie') hay = cookies;
      else if (t.kind === 'path') {
        const status = t.path && pathChecks[t.path] != null ? pathChecks[t.path] : null;
        if (status && status < 400) { score += t.weight; evidence.push('Known path ' + t.path + ' returned HTTP ' + status); }
        continue;
      }
      if (hay && t.re.test(hay)) {
        score += t.weight;
        const m = hay.match(t.re);
        evidence.push((t.kind === 'header' ? t.header + ' header' : t.kind) + ' matched: ' + U.safeString((m && m[0] || '').replace(/<[^>]+>/g, ''), 90));
      }
    }
    if (score >= 2.5) {
      const conf = U.conf(Math.min(96, 40 + score * 12));
      out.push({
        id: fp.id, name: fp.name, category: fp.category,
        status: conf >= 75 ? 'detected' : 'likely',
        confidence: conf, evidence: evidence.slice(0, 4)
      });
    }
  }
  out.sort((a, b) => b.confidence - a.confidence);
  return out;
}

module.exports = { detectTechnology, FINGERPRINTS };
