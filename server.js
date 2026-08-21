const http = require('http');
const fs = require('fs');
const path = require('path');
const ezoicApi = require('./lib/ezoic/api');

const criticalCss = fs.readFileSync('assets/css/style.css', 'utf8');
const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const icon = name => `<span class="material-icons" aria-hidden="true">${esc(name)}</span>`;

function otherToolsMenu(active) {
  return `<details class="tools-menu"><summary>${icon('build')}<span>Other Tools</span>${icon('arrow_drop_down')}</summary>
    <div class="tools-menu-panel" role="menu">
      <a href="/" role="menuitem" class="${active==='seo'?'is-active':''}">${icon('travel_explore')}<span><b>SEO Audit</b><small>Technical, content &amp; performance audit</small></span></a>
      <a href="/adsense-eligibility-checker" role="menuitem" class="${active==='adsense'?'is-active':''}">${icon('monetization_on')}<span><b>AdSense Eligibility Checker</b><small>Website readiness for AdSense</small></span></a>
      <a href="/ezoic-eligibility-checker" role="menuitem" class="${active==='ezoic'?'is-active':''}">${icon('insights')}<span><b>Ezoic Eligibility Checker</b><small>Website readiness for Ezoic</small></span></a>
    </div></details>`;
}

function layout(title, body, opts) {
  opts = opts || {};
  const active = opts.active || '';
  const scripts = opts.scripts || ['/assets/js/common.js','/assets/js/audit.js'];
  const meta = opts.meta || '';
  const jsonLd = opts.jsonLd ? `<script type="application/ld+json">${JSON.stringify(opts.jsonLd)}</script>` : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">${meta}<title>${esc(title)}</title><link rel="canonical" href="${opts.canonical||'https://huvanti.com/'}"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&family=Material+Icons&display=swap" rel="stylesheet"><style>${criticalCss}</style>${jsonLd}</head><body><a class="skip-link" href="#main">Skip to content</a><div class="app"><header class="appbar"><div class="toolbar"><a class="brand" href="/">${icon('travel_explore')}<span class="brand-name">huvanti</span></a><nav class="desktop-nav" aria-label="Primary"><a href="/">${icon('home')}<span>Home</span></a>${otherToolsMenu(active)}<a href="/about">${icon('info')}<span>About</span></a><a href="/contact">${icon('mail')}<span>Contact</span></a></nav><button type="button" class="icon-button theme-toggle" aria-label="toggle theme" id="theme-toggle"><span class="material-icons">brightness_4</span></button></div></header><main id="main">${body}</main><footer class="footer"><div class="container footer-grid"><div><div class="footer-brand">huvanti</div><p class="footer-tagline">Free, no-account website tools.</p></div><div><div class="footer-heading">Tools</div><div class="footer-links"><a href="/">SEO Audit</a><a href="/adsense-eligibility-checker">AdSense Eligibility Checker</a><a href="/ezoic-eligibility-checker">Ezoic Eligibility Checker</a></div></div><div><div class="footer-heading">Pages</div><div class="footer-links"><a href="/about">About</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></div></div></div><div class="container footer-copyright">&copy; 2026 huvanti. All rights reserved. Not affiliated with Google or Ezoic.</div></footer></div>${scripts.map(s=>`<script src="${s}"></script>`).join('')}</body></html>`;
}

function home() {
  return layout('huvanti — Free SEO Audit Tool (no account)',
    `<section class="hero audit-home"><span class="material-icons hero-icon" aria-hidden="true">travel_explore</span><h1>huvanti</h1><p class="hero-subtitle">Technical SEO audit for any public website</p><form id="audit-form" class="search-field audit-search" role="search" aria-label="SEO audit"><span class="material-icons" aria-hidden="true">link</span><input id="audit-url" type="url" placeholder="https://yourwebsite.com" required aria-label="Website URL"><select id="crawl-limit" class="crawl-select" aria-label="Crawl limit"><option value="1">1 page</option><option value="6" selected>6 pages</option><option value="15">15 pages</option><option value="30">30 pages</option><option value="50">50 pages</option></select><button class="btn" type="submit">Audit</button></form><div class="audit-trust"><span>No account</span><span>Technical</span><span>On-page</span><span>Content</span><span>Images</span><span>Performance</span><span>Mobile</span><span>Schema</span><span>Internal links</span><span>Security</span><span>AI Search</span></div></section><div id="audit-results" class="audit-results"></div><div class="container section"><div class="section-heading-row">${icon('verified')}<h4 style="margin:0;">What this audit checks — 250+ signals across 12 categories</h4></div><div class="grid feature-grid"><div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('settings_input_component')} Technical SEO</h6><p>HTTPS, SSL, HTTP→HTTPS &amp; WWW redirects, status codes (200/3xx/4xx/5xx), redirect chains, robots.txt, XML sitemap, canonical, noindex/nofollow, X-Robots, URL length &amp; structure, trailing-slash consistency, duplicate URLs.</p></div></div></div><div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('description')} On-page SEO</h6><p>Title &amp; meta-description length and duplicates, H1/H2–H6 hierarchy, multiple/missing H1, keyword placement &amp; density, headings, text-to-HTML ratio, anchor text, broken links.</p></div></div></div><div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('article')} Content SEO</h6><p>Word count, thin/empty content, Flesch readability, content freshness, duplicate &amp; near-duplicate pages, keyword cannibalization, search intent, entities and semantic coverage.</p></div></div></div><div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('image')} Image SEO</h6><p>Missing/empty alt text, image count, WebP/AVIF detection, lazy loading, width/height (CLS), responsive srcset, broken &amp; oversized images.</p></div></div></div><div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('speed')} Performance</h6><p>Render-blocking JS/CSS, inline scripts, compression (gzip/Brotli), browser caching, CDN &amp; CMS detection, third-party scripts, fonts, oversized images, TTFB; direct links to PageSpeed for LCP/INP/CLS.</p></div></div></div><div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('phone_iphone')} Mobile SEO</h6><p>Viewport meta, responsive media queries, tap-target &amp; horizontal-overflow guidance.</p></div></div></div><div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('account_tree')} Schema</h6><p>JSON-LD, Microdata, RDFa detection, invalid JSON, detected @type (Organization, WebSite, Article, Product, FAQ, Breadcrumb…), with a Rich Results test link.</p></div></div></div><div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('hub')} Internal &amp; external links</h6><p>Internal/external counts, orphan &amp; isolated pages, zero/excessive links, click depth, empty anchors, broken internal/external links, nofollow/sponsored/UGC, anchor distribution, internal-authority proxy.</p></div></div></div><div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('translate')} International &amp; Security</h6><p>Hreflang detection &amp; validation, HTML lang, canonical/hreflang conflicts; mixed content, HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.</p></div></div></div><div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('smart_toy')} AI Search</h6><p>GPTBot, ClaudeBot, PerplexityBot, Google-Extended blocking, AI-readable content, entity identification and entity/schema consistency.</p></div></div></div><div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('account_tree')} Architecture</h6><p>Visual crawled-URL table, crawl &amp; click depth, flat/deep structure, deep pages, isolated pages, URL discovery.</p></div></div></div><div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('grading')} Score, reports &amp; sharing</h6><p>Overall + 12 category scores, critical/warning/passed/info filters, why-it-matters &amp; how-to-fix guidance, priority fixes, CSV, PDF/Print, copy summary, shareable link, no-account history comparison.</p></div></div></div></div></div><div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('help')}<h4 style="margin:0;">FAQ</h4></div><div class="faq-accordion"><details><summary>Does this require an account?</summary><p>No account and no sign-up. Paste a URL, choose how many pages to crawl, and run the audit. Recent audits are stored only in your own browser for the compare feature.</p></details><details><summary>How does the crawl work?</summary><p>It starts from the URL you enter, reads robots.txt and sitemaps, then follows internal links up to the page limit you choose. A live progress indicator shows the page being crawled and you can cancel at any time.</p></details><details><summary>Can it crawl password-protected or blocked sites?</summary><p>No — only publicly reachable pages. Sites that block public readers or require authentication cannot be audited.</p></details><details><summary>Are LCP, INP and CLS scored?</summary><p>Core Web Vitals need a real browser lab/field run. The audit checks the performance signals it can measure (compression, caching, render-blocking resources, image sizing, TTFB when available) and links directly to PageSpeed Insights for LCP, INP, CLS, FCP and TBT instead of faking scores.</p></details><details><summary>Can I export or share the report?</summary><p>Yes — download CSV, print/save as PDF, copy a text summary, or generate a shareable link that reproduces the full report. The compare feature shows score changes against your previous audits, all without an account.</p></details></div></div>`,
    {active:'seo', canonical:'https://huvanti.com/',
     jsonLd:{'@context':'https://schema.org','@type':'WebApplication',name:'huvanti SEO Audit',applicationCategory:'SEOApplication',operatingSystem:'Any',browserRequirements:'Requires JavaScript',offers:{'@type':'Offer','price':'0','priceCurrency':'USD'},description:'Free no-account technical SEO audit with content, image, performance, mobile, schema, link and security checks.'}});
}

function adsensePage() {
  const meta = `<meta name="description" content="Free AdSense Eligibility Checker. Enter a URL and get an evidence-based Website Readiness Score across content, trust, policy risk, UX, technical and performance signals — no account, no AI."><meta name="robots" content="index,follow">
<meta property="og:title" content="AdSense Eligibility Checker — huvanti"><meta property="og:description" content="Get an evidence-based AdSense readiness score from deterministic crawling and rule-based checks. No account required."><meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">`;
  const jsonLd = {'@context':'https://schema.org','@graph':[
    {'@type':'WebSite',name:'huvanti',url:'https://huvanti.com/'},
    {'@type':'WebApplication',name:'AdSense Eligibility Checker',applicationCategory:'BusinessApplication',operatingSystem:'Any',browserRequirements:'Requires JavaScript',featureList:'AdSense readiness score, content quality, trust pages, policy-risk scanner, technical SEO, UX, performance',offers:{'@type':'Offer','price':'0','priceCurrency':'USD'},description:'Free, deterministic AdSense eligibility checker that scores publicly observable website signals.'}
  ]};
  const body = `<section class="hero audit-home adsense-home"><span class="material-icons hero-icon" aria-hidden="true">monetization_on</span><h1>AdSense Eligibility Checker</h1><p class="hero-subtitle">Get an evidence-based Website Readiness Score — no account, no AI.</p>
<form id="adsense-form" class="search-field audit-search" role="search" aria-label="AdSense eligibility checker"><span class="material-icons" aria-hidden="true">link</span><input id="adsense-url" type="url" placeholder="https://yourwebsite.com" required aria-label="Website URL" value="https://example.com"><select id="adsense-limit" class="crawl-select" aria-label="Crawl limit"><option value="10">10 pages</option><option value="25">25 pages</option><option value="50" selected>50 pages</option><option value="100">100 pages</option><option value="250">250 pages</option></select><button class="btn" type="submit">Check Eligibility</button></form>
<div class="audit-trust"><span>Content quality</span><span>Trust pages</span><span>Policy risk</span><span>UX</span><span>Technical</span><span>Performance</span></div></section>
<div id="adsense-results" class="audit-results adsense-results"></div>
<div class="container section">
  <div class="section-heading-row">${icon('rule_folder')}<h4 style="margin:0;">What it measures</h4></div>
  <div class="grid feature-grid">
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('article')} Content quality</h6><p>Unique word count after template removal, headings, repeated phrases, boilerplate, thin/empty pages and Flesch readability — with page-type awareness.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('verified_user')} Trust &amp; transparency</h6><p>Detects About, Contact, Privacy, Terms and Disclaimer pages by URL, title, H1 and nav links, with a confidence score and author/date checks.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('gpp_bad')} Policy risk</h6><p>Weighted screening for adult, gambling, piracy, malware, scam and similar signals, shown with matching context — never labelled an official violation.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('touch_app')} User experience</h6><p>Mobile viewport, responsive CSS, navigation, popups/overlays, autoplay media, broken links and detectable ad density.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('build_circle')} Technical quality</h6><p>HTTPS, status codes, redirects, canonical, robots meta, noindex, robots.txt, sitemap, title, description, H1 and broken images.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('speed')} Performance &amp; mobile</h6><p>Response time when available, page weight, render-blocking scripts, compression, cache headers and third-party requests.</p></div></div></div>
  </div>
</div>
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('help')}<h4 style="margin:0;">FAQ</h4></div><div class="faq-accordion"><details><summary>Does this guarantee AdSense approval?</summary><p>No. It produces a transparent readiness score from public signals so you can fix obvious issues; Google's review is final.</p></details><details><summary>Does it use AI or an LLM?</summary><p>No. Every check is deterministic — a crawler, DOM parser, text statistics, similarity and readability formulas, and a weighted rule engine. No API keys.</p></details><details><summary>Will short pages be flagged as thin content?</summary><p>No. Contact, Privacy, Terms and other utility pages are detected by type and not penalised for low word count.</p></details></div></div>`;
  return layout('AdSense Eligibility Checker — Free Website Readiness Score | huvanti', body, {
    active:'adsense', canonical:'https://huvanti.com/adsense-eligibility-checker', meta, jsonLd,
    scripts:['/assets/js/common.js','/assets/js/adsense/01-util.js','/assets/js/adsense/02-crawler.js','/assets/js/adsense/03-parser.js','/assets/js/adsense/04-rules.js','/assets/js/adsense/05-analyzers.js','/assets/js/adsense/09-siteanalysis.js','/assets/js/adsense/06-scoring.js','/assets/js/adsense/07-orchestrate.js','/assets/js/adsense/08-ui.js']
  });
}

function ezoicPage() {
  const meta = `<meta name="description" content="Free Ezoic Eligibility Checker. Enter a URL for an evidence-based Ezoic Readiness Score from a deep public crawl — no account, no AI. Not an official Ezoic score."><meta name="robots" content="index,follow">
<meta property="og:title" content="Ezoic Eligibility Checker — huvanti"><meta property="og:description" content="Deep, deterministic Ezoic website readiness check. No account required. Final eligibility belongs to Ezoic."><meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">`;
  const jsonLd = {'@context':'https://schema.org','@graph':[
    {'@type':'WebSite',name:'huvanti',url:'https://huvanti.com/'},
    {'@type':'WebApplication',name:'Ezoic Eligibility Checker',applicationCategory:'BusinessApplication',operatingSystem:'Any',browserRequirements:'Requires JavaScript',featureList:'Ezoic readiness score, official requirement checks, content quality, duplicate detection, trust pages, policy-risk scanner, technical SEO, UX, monetization signals',offers:{'@type':'Offer','price':'0','priceCurrency':'USD'},description:'Free, deterministic Ezoic eligibility checker that scores publicly observable website signals. Not affiliated with Ezoic.'}
  ]};
  const body = `<section class="hero audit-home ezoic-home"><span class="material-icons hero-icon" aria-hidden="true">insights</span><h1>Ezoic Eligibility Checker</h1><p class="hero-subtitle">Evidence-based Ezoic website readiness — no account, no AI.</p>
<form id="ezoic-form" class="search-field audit-search" role="search" aria-label="Ezoic eligibility checker"><span class="material-icons" aria-hidden="true">link</span><input id="ezoic-url" type="url" placeholder="https://yourwebsite.com" required aria-label="Website URL"><select id="ezoic-limit" class="crawl-select" aria-label="Crawl limit"><option value="10">10 pages</option><option value="25">25 pages</option><option value="50" selected>50 pages</option><option value="100">100 pages</option><option value="250">250 pages</option></select><button class="btn" type="submit">Check Eligibility</button></form>
<div class="audit-trust"><span>Official requirements</span><span>Content quality</span><span>Duplicates</span><span>Trust pages</span><span>Policy risk</span><span>UX</span><span>Technical</span><span>Monetization</span></div></section>
<div id="ezoic-results" class="audit-results ezoic-results"></div>
<div class="container section">
  <div class="section-heading-row">${icon('rule_folder')}<h4 style="margin:0;">What this checker actually does</h4></div>
  <div class="grid feature-grid">
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('verified')} Documented Ezoic requirements</h6><p>Rules are sourced from Ezoic Support (traffic, content, privacy, contact, site type, language). Items that cannot be seen on a public site are labelled <b>Unable to verify automatically</b> — never guessed.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('article')} Content &amp; uniqueness</h6><p>Unique words after template removal, thin/empty ratios, image-only articles, keyword stuffing, n-grams, Jaccard, TF-IDF cosine and SimHash near-duplicates with shared-text evidence.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('account_tree')} Architecture crawl</h6><p>Up to 250 internal pages with robots.txt, sitemaps, canonicals, redirects, click depth, orphans and dead-ends. Default 50 pages.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('verified_user')} Trust &amp; transparency</h6><p>About, Contact, Privacy, Terms, cookies — detected from URL, title, H1, nav, footer and body. Pages must be linked and substantive, not empty shells.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('gpp_bad')} Policy-risk screening</h6><p>Contextual patterns for adult, gambling, piracy, malware, scam and related signals. One isolated keyword is never a high-risk finding. Not an official Ezoic verdict.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('ads_click')} Monetization signals</h6><p>Existing ad scripts, ads.txt, download-like links and ad-heavy thin layouts. Competing ads are noted as a post-integration task, not an automatic rejection.</p></div></div></div>
  </div>
</div>
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('help')}<h4 style="margin:0;">FAQ</h4></div><div class="faq-accordion">
<details><summary>Does this guarantee Ezoic approval?</summary><p>No. It produces a transparent <b>Ezoic Readiness Score</b> from public signals. The final eligibility decision belongs to Ezoic. Status labels are Likely Ready, Needs Improvement, Not Ready, or Unable to Verify.</p></details>
<details><summary>Can it check the 250,000 monthly active users rule?</summary><p>No. Ezoic currently documents a general requirement of 250,000+ monthly active users, verified via Google Analytics during application. That cannot be read from public HTML, so it is listed as <b>Unable to verify automatically</b> and is not guessed in the score.</p></details>
<details><summary>Does it use AI or an LLM?</summary><p>No. The engine is a server-side crawler plus HTML parsing, similarity, statistics and a weighted rule registry. No OpenAI, Gemini, Claude, or paid AI APIs.</p></details>
<details><summary>Are tool sites treated like blogs?</summary><p>No. Ezoic’s content guidelines say tool sites are not required to have a blog component. Short tool/utility/privacy pages are not scored as thin articles.</p></details>
<details><summary>Is this affiliated with Ezoic?</summary><p>No. Findings cite Ezoic Support articles where a check maps to a documented rule, and are otherwise labelled best practice or heuristic.</p></details>
</div></div>`;
  return layout('Ezoic Eligibility Checker — Free Website Readiness Score | huvanti', body, {
    active:'ezoic', canonical:'https://huvanti.com/ezoic-eligibility-checker', meta, jsonLd,
    scripts:['/assets/js/common.js','/assets/js/ezoic/crawler.js','/assets/js/ezoic/ui.js']
  });
}

function page(name) { return layout(name, `<div class="container page"><h1 class="page-title">${esc(name)}</h1><div class="paper paper-padded"><p>huvanti provides free, no-account website tools including an SEO audit, an AdSense eligibility checker, and an Ezoic eligibility checker.</p></div></div>`); }

function readJson(req){ return new Promise(resolve=>{let b=''; req.on('data',d=>b+=d); req.on('end',()=>{try{resolve(JSON.parse(b||'{}'))}catch{resolve({})}});}); }

http.createServer(async (req,res)=>{
  const u = new URL(req.url, 'http://local');
  const p = decodeURIComponent(u.pathname).replace(/\/$/, '') || '/';
  if (p === '/api/audit' && req.method === 'POST') {
    const body = await readJson(req);
    res.setHeader('content-type','application/json; charset=utf-8');
    res.setHeader('cache-control','no-store');
    res.end(JSON.stringify({limited:true,url:body.url||'',grade:'Browser crawl',score:null,summary:'Using browser-readable crawl.',stats:{pages:0,issues:0,ttfb:'n/a',htmlKb:'n/a'},groups:{},priorities:[],crawl:[]}));
    return;
  }
  if (p === '/api/ezoic-audit' && req.method === 'POST') {
    const body = await readJson(req);
    await ezoicApi.handle(req, res, body);
    return;
  }
  if (p === '/api/ezoic-analyze' && req.method === 'POST') {
    const body = await readJson(req);
    await ezoicApi.handleAnalyze(req, res, body);
    return;
  }
  if (p.startsWith('/assets/')) {
    const safe = path.normalize(p).replace(/^([.][.][/\\])+/, '');
    const f = path.join(process.cwd(), safe);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ext = path.extname(f).toLowerCase();
      const type = {'.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.svg':'image/svg+xml'}[ext] || 'application/octet-stream';
      res.setHeader('content-type', type); res.setHeader('cache-control','no-store'); res.end(fs.readFileSync(f)); return;
    }
    res.statusCode=404; res.end('Not found'); return;
  }
  let html;
  if (p === '/') html = home();
  else if (p === '/adsense-eligibility-checker') html = adsensePage();
  else if (p === '/ezoic-eligibility-checker') html = ezoicPage();
  else if (['/about','/contact','/privacy','/terms'].includes(p)) html = page(p.slice(1).replace(/^./,c=>c.toUpperCase()));
  else html = layout('Not found', `<div class="container notfound"><h1>404</h1><p>Page not found.</p><a class="btn" href="/">Back home</a></div>`);
  res.setHeader('content-type','text/html; charset=utf-8'); res.setHeader('cache-control','no-store'); res.end(html);
}).listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('huvanti preview running'));
