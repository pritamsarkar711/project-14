const http = require('http');
const fs = require('fs');
const path = require('path');
const ezoicApi = require('./lib/ezoic/api');
const mediavineApi = require('./lib/mediavine/api');
const raptiveApi = require('./lib/raptive/api');
const wpthemeApi = require('./lib/wptheme/api');
const sitemapApi = require('./lib/sitemap/api');
const domaincheckApi = require('./lib/domaincheck/api');

const criticalCss = fs.readFileSync('assets/css/style.css', 'utf8');
const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const icon = name => `<span class="material-icons" aria-hidden="true">${esc(name)}</span>`;

function otherToolsMenu(active) {
  return `<details class="tools-menu"><summary>${icon('build')}<span>Other Tools</span>${icon('arrow_drop_down')}</summary>
    <div class="tools-menu-panel" role="menu">
      <a href="/" role="menuitem" class="${active==='seo'?'is-active':''}">${icon('travel_explore')}<span><b>SEO Audit</b><small>Technical, content &amp; performance audit</small></span></a>
      <a href="/adsense-eligibility-checker" role="menuitem" class="${active==='adsense'?'is-active':''}">${icon('monetization_on')}<span><b>AdSense Eligibility Checker</b><small>Website readiness for AdSense</small></span></a>
      <a href="/ezoic-eligibility-checker" role="menuitem" class="${active==='ezoic'?'is-active':''}">${icon('insights')}<span><b>Ezoic Eligibility Checker</b><small>Website readiness for Ezoic</small></span></a>
      <a href="/mediavine-eligibility-checker" role="menuitem" class="${active==='mediavine'?'is-active':''}">${icon('trending_up')}<span><b>Mediavine Eligibility Checker</b><small>Website readiness for Mediavine</small></span></a>
      <a href="/raptive-eligibility-checker" role="menuitem" class="${active==='raptive'?'is-active':''}">${icon('campaign')}<span><b>Raptive Eligibility Checker</b><small>Website readiness for Raptive</small></span></a>
      <a href="/wordpress-theme-detector" role="menuitem" class="${active==='wptheme'?'is-active':''}">${icon('palette')}<span><b>WordPress Theme Detector</b><small>Detect the active WP theme</small></span></a>
      <a href="/domain-information-checker" role="menuitem" class="${active==='domaincheck'?'is-active':''}">${icon('dns')}<span><b>Domain Information Checker</b><small>DNS, WHOIS, SSL &amp; hosting intelligence</small></span></a>
      <a href="/xml-sitemap-generator" role="menuitem" class="${active==='sitemap'?'is-active':''}">${icon('account_tree')}<span><b>XML Sitemap Generator</b><small>Crawl, validate &amp; export XML sitemaps</small></span></a>
    </div></details>`;
}

function layout(title, body, opts) {
  opts = opts || {};
  const active = opts.active || '';
  const scripts = opts.scripts || ['/assets/js/common.js','/assets/js/audit.js'];
  const meta = opts.meta || '';
  const jsonLd = opts.jsonLd ? `<script type="application/ld+json">${JSON.stringify(opts.jsonLd)}</script>` : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">${meta}<title>${esc(title)}</title><link rel="canonical" href="${opts.canonical||'https://huvanti.com/'}"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&family=Material+Icons&display=swap" rel="stylesheet"><style>${criticalCss}</style>${jsonLd}</head><body><a class="skip-link" href="#main">Skip to content</a><div class="app"><header class="appbar"><div class="toolbar"><a class="brand" href="/">${icon('travel_explore')}<span class="brand-name">huvanti</span></a><nav class="desktop-nav" aria-label="Primary"><a href="/">${icon('home')}<span>Home</span></a>${otherToolsMenu(active)}<a href="/about">${icon('info')}<span>About</span></a><a href="/contact">${icon('mail')}<span>Contact</span></a></nav><button type="button" class="icon-button theme-toggle" aria-label="toggle theme" id="theme-toggle"><span class="material-icons">brightness_4</span></button></div></header><main id="main">${body}</main><footer class="footer"><div class="container footer-grid"><div><div class="footer-brand">huvanti</div><p class="footer-tagline">Free, no-account website tools.</p></div><div><div class="footer-heading">Tools</div><div class="footer-links"><a href="/">SEO Audit</a><a href="/adsense-eligibility-checker">AdSense Eligibility Checker</a><a href="/ezoic-eligibility-checker">Ezoic Eligibility Checker</a><a href="/mediavine-eligibility-checker">Mediavine Eligibility Checker</a><a href="/raptive-eligibility-checker">Raptive Eligibility Checker</a><a href="/wordpress-theme-detector">WordPress Theme Detector</a><a href="/domain-information-checker">Domain Information Checker</a><a href="/xml-sitemap-generator">XML Sitemap Generator</a></div></div><div><div class="footer-heading">Pages</div><div class="footer-links"><a href="/about">About</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></div></div></div><div class="container footer-copyright">&copy; 2026 huvanti. All rights reserved. Not affiliated with Google, Ezoic or Mediavine.</div></footer></div>${scripts.map(s=>`<script src="${s}"></script>`).join('')}</body></html>`;
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

function mediavinePage() {
  const meta = `<meta name="description" content="Free Mediavine Eligibility Checker. Enter a URL for an evidence-based Mediavine Website Readiness Score from a deep public crawl — no account, no AI. Official vs Journey applied separately. Not an official Mediavine score."><meta name="robots" content="index,follow">
<meta property="og:title" content="Mediavine Eligibility Checker — huvanti"><meta property="og:description" content="Deep, deterministic Mediavine website readiness check. Official &amp; Journey applied separately. No account required. Final eligibility belongs to Mediavine."><meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">`;
  const jsonLd = {'@context':'https://schema.org','@graph':[
    {'@type':'WebSite',name:'huvanti',url:'https://huvanti.com/'},
    {'@type':'WebApplication',name:'Mediavine Eligibility Checker',applicationCategory:'BusinessApplication',operatingSystem:'Any',browserRequirements:'Requires JavaScript',featureList:'Mediavine Website Readiness score, Official vs Journey requirements, original content audit, duplicate detection, brand-safety screen, reader experience, advertising readiness, technical SEO, trust pages, traffic verification',offers:{'@type':'Offer','price':'0','priceCurrency':'USD'},description:'Free, deterministic Mediavine eligibility checker that scores publicly observable website signals. Not affiliated with Mediavine.'}
  ]};
  const body = `<section class="hero audit-home mediavine-home"><span class="material-icons hero-icon" aria-hidden="true">trending_up</span><h1>Mediavine Eligibility Checker</h1><p class="hero-subtitle">Evidence-based Mediavine website readiness — no account, no AI.</p>
<form id="mediavine-form" class="search-field audit-search" role="search" aria-label="Mediavine eligibility checker"><span class="material-icons" aria-hidden="true">link</span><input id="mediavine-url" type="url" placeholder="https://yourwebsite.com" required aria-label="Website URL"><select id="mediavine-program" class="crawl-select" aria-label="Program focus"><option value="both" selected>Both programs</option><option value="official">Mediavine Official</option><option value="journey">Journey by Mediavine</option></select><select id="mediavine-limit" class="crawl-select" aria-label="Crawl limit"><option value="10">10 pages</option><option value="25">25 pages</option><option value="50" selected>50 pages</option><option value="100">100 pages</option><option value="250">250 pages</option></select><button class="btn" type="submit">Check Eligibility</button></form>
<div class="audit-trust"><span>Official &amp; Journey</span><span>Original content</span><span>Duplicates</span><span>Brand safety</span><span>Reader experience</span><span>Advertising</span><span>Technical</span><span>Trust pages</span></div></section>
<div id="mediavine-results" class="audit-results mediavine-results"></div>
<div class="container section">
  <div class="section-heading-row">${icon('rule_folder')}<h4 style="margin:0;">What this checker actually does</h4></div>
  <div class="grid feature-grid">
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('verified')} Official &amp; Journey, applied separately</h6><p>Mediavine Official requires $5,000+ annual ad revenue; Journey starts at 1,000 sessions. Revenue and sessions are private data, so they are shown as <b>Unable to verify automatically</b> — never guessed. Old 50,000-session advice is not presented as current.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('article')} Original, audience-first content</h6><p>Unique words after boilerplate removal, thin/empty ratios, sentence fingerprints, n-grams, Jaccard, TF-IDF cosine and SimHash near-duplicates, plus a Potential Search-First Content Pattern label (not a definitive Google classification).</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('gpp_bad')} Brand-safety screening</h6><p>Deterministic contextual scanner for adult, drugs, gambling, weapons, hate, extremism, piracy, malware, phishing, fraud, scam and more — with low/medium/high confidence. Isolated keywords are never a high finding.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('smartphone')} Reader experience &amp; ads</h6><p>Viewport, navigation, overlays, popups, autoplay, sticky/fixed elements, horizontal overflow, content obstruction and ad density. Existing ads are not automatically penalized.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('account_tree')} Deep architecture crawl</h6><p>Up to 250 internal pages from homepage, links, sitemap, robots.txt, nav, footer, breadcrumbs, categories and canonicals. Orphans, dead-ends, depth, broken internal links. Default 50 pages.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('verified_user')} Honest about what a URL cannot verify</h6><p>Annual revenue, monthly sessions, traffic sources/countries, demographics and Google account standing are private data. They appear in a dedicated <b>Requires Your Verification</b> panel and are excluded from the score, not invented.</p></div></div></div>
  </div>
</div>
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('help')}<h4 style="margin:0;">FAQ</h4></div><div class="faq-accordion">
<details><summary>Does this guarantee Mediavine approval?</summary><p>No. It produces a transparent internal <b>Mediavine Website Readiness Score</b> from public signals. The final eligibility decision belongs to Mediavine. Status labels are Strong Readiness, Needs Improvement, Significant Issues, or Unable to Determine.</p></details>
<details><summary>Can it verify the $5,000 revenue or 1,000 sessions?</summary><p>No. Annual ad revenue and monthly sessions are private data. They are listed as <b>Unable to verify automatically</b> and never guessed. The Official $5,000+ and Journey 1,000+ thresholds are current (2026) and applied separately.</p></details>
<details><summary>Is the old 50,000-session requirement still used?</summary><p>No. As of 2026, Mediavine Official is revenue-based ($5,000+ annual ad revenue) and Journey starts at 1,000 sessions. This tool uses the current program structure and does not present outdated 50k-session advice as current.</p></details>
<details><summary>Does it use AI or an LLM?</summary><p>No. The engine is a crawler plus HTML parsing, similarity statistics and a weighted rule registry. No paid AI APIs.</p></details>
<details><summary>Are tool or ecommerce sites treated like blogs?</summary><p>No. Pages are classified by type, and article-content rules are not applied to utility, product, tool, or legal pages. Content portfolio balance is weighed site-wide, not page-by-page.</p></details>
<details><summary>Is this affiliated with Mediavine?</summary><p>No. Findings cite Mediavine Help Center sources where a check maps to a documented requirement, and are otherwise labelled Quality Signal or Heuristic.</p></details>
</div></div>`;
  return layout('Mediavine Eligibility Checker — Free Website Readiness Score | huvanti', body, {
    active: 'mediavine', canonical: 'https://huvanti.com/mediavine-eligibility-checker', meta, jsonLd,
    scripts: ['/assets/js/common.js', '/assets/js/mediavine/crawler.js', '/assets/js/mediavine/ui.js']
  });
}

function raptivePage() {
  const meta = `<meta name="description" content="Free Raptive Eligibility Checker. Enter a URL for an evidence-based Raptive Readiness Score from a deep public crawl — no account, no AI. Current 25,000 pageview minimum. Not an official Raptive score."><meta name="robots" content="index,follow">
<meta property="og:title" content="Raptive Eligibility Checker — huvanti"><meta property="og:description" content="Deep, deterministic Raptive website readiness check. 25,000 pageview minimum. No account required. Final eligibility belongs to Raptive."><meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">`;
  const jsonLd = {'@context':'https://schema.org','@graph':[
    {'@type':'WebSite',name:'huvanti',url:'https://huvanti.com/'},
    {'@type':'WebApplication',name:'Raptive Eligibility Checker',applicationCategory:'BusinessApplication',operatingSystem:'Any',browserRequirements:'Requires JavaScript',featureList:'Raptive readiness score, official requirement checks, originality audit, long-form coverage, human-involvement signals, Google Analytics detection, domain age, brand safety, ad readiness, traffic verification',offers:{'@type':'Offer','price':'0','priceCurrency':'USD'},description:'Free, deterministic Raptive eligibility checker that scores publicly observable website signals. Not affiliated with Raptive.'}
  ]};
  const body = `<section class="hero audit-home raptive-home"><span class="material-icons hero-icon" aria-hidden="true">campaign</span><h1>Raptive Eligibility Checker</h1><p class="hero-subtitle">Evidence-based Raptive website readiness — no account, no AI.</p>
<form id="raptive-form" class="search-field audit-search" role="search" aria-label="Raptive eligibility checker"><span class="material-icons" aria-hidden="true">link</span><input id="raptive-url" type="url" placeholder="https://yourwebsite.com" required aria-label="Website URL"><select id="raptive-limit" class="crawl-select" aria-label="Crawl limit"><option value="10">10 pages</option><option value="25">25 pages</option><option value="50" selected>50 pages</option><option value="100">100 pages</option><option value="250">250 pages</option></select><button class="btn" type="submit">Check Eligibility</button></form>
<div class="audit-trust"><span>Official requirements</span><span>Original content</span><span>Long-form</span><span>Human involvement</span><span>Google Analytics</span><span>Domain age</span><span>Brand safety</span><span>Ad readiness</span></div>
<details class="raptive-optional container"><summary>Optional: enter verified Analytics figures (user-provided)</summary>
<div class="raptive-optional-grid">
<label>Monthly pageviews <input id="raptive-pageviews" class="text-input" type="number" min="0" step="1" placeholder="e.g. 32000" inputmode="numeric"></label>
<label>US % <input id="raptive-us" class="text-input" type="number" min="0" max="100" step="0.1" placeholder="%"></label>
<label>UK % <input id="raptive-uk" class="text-input" type="number" min="0" max="100" step="0.1" placeholder="%"></label>
<label>Canada % <input id="raptive-ca" class="text-input" type="number" min="0" max="100" step="0.1" placeholder="%"></label>
<label>Australia % <input id="raptive-au" class="text-input" type="number" min="0" max="100" step="0.1" placeholder="%"></label>
<label>New Zealand % <input id="raptive-nz" class="text-input" type="number" min="0" max="100" step="0.1" placeholder="%"></label>
</div>
<p class="muted">These are labelled <b>User-provided value</b> and are never presented as independently verified. Combined US+UK+CA+AU+NZ is compared with Raptive’s current 50% (25k–99,999 PV) or 40% (100,000+ PV) thresholds. Leave blank if you do not have Analytics access.</p>
</details></section>
<div id="raptive-results" class="audit-results raptive-results"></div>
<div class="container section">
  <div class="section-heading-row">${icon('rule_folder')}<h4 style="margin:0;">What this checker actually does</h4></div>
  <div class="grid feature-grid">
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('verified')} Current Raptive requirements</h6><p>Minimum <b>25,000</b> monthly pageviews (not the old 100,000). 50% key-country traffic at 25k–99,999 PV; 40% at 100,000+. GA4, 6-month domain, original content, human involvement, long-form on the majority of pages (25k–99,999), ad-ready build. Private items are labelled Manual Verification Required — never guessed.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('article')} Originality &amp; long-form</h6><p>Unique body text after boilerplate removal, duplicates, near-duplicates, n-grams, Jaccard, TF-IDF cosine, SimHash. Long-form coverage on eligible content pages — utility pages excluded. Not a copyright or AI-authorship proof.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('person')} Human-involvement signals</h6><p>Author bios, first-hand detail, sources, editorial identity vs. repetitive templates. Never labelled “AI-generated content detected.” Uses <b>Potential low-human-involvement pattern</b> with evidence.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('analytics')} Google Analytics &amp; domain age</h6><p>Detects GA4 Measurement IDs, gtag, GTM, duplicate installs. Distinguishes tracking code detected from configuration verified. RDAP domain age when available; otherwise Unable to Verify.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('gpp_bad')} Brand safety &amp; reader experience</h6><p>Contextual scanner for adult, drugs, gambling, weapons, hate, piracy, malware, scam and more. UX: viewport, overlays, autoplay, sticky chrome, navigation.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('account_tree')} Deep public crawl</h6><p>Up to 250 internal pages from homepage, links, sitemap, robots.txt, nav and footer. Default 50. SSRF-protected. No account, no LLM, no paid SEO API.</p></div></div></div>
  </div>
</div>
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('help')}<h4 style="margin:0;">FAQ</h4></div><div class="faq-accordion">
<details><summary>Does this guarantee Raptive approval?</summary><p>No. It produces a transparent internal <b>Raptive Readiness Score</b> from public signals. Application eligibility is shown separately and is usually <b>Cannot Be Fully Verified</b> until you provide Analytics pageviews and country share. Raptive makes the final decision.</p></details>
<details><summary>Is 100,000 monthly pageviews still the minimum?</summary><p>No. Raptive currently lists a minimum of <b>25,000 monthly pageviews</b> (last 30 days, via Google Analytics). 100,000+ is a higher traffic tier with a 40% key-country requirement, not the general entry bar.</p></details>
<details><summary>Can it verify my pageviews or country mix?</summary><p>No. Those are private Analytics data. The report has a dedicated <b>Manual Verification Required</b> section. You may optionally enter verified figures; they are labelled user-provided and are not independently verified.</p></details>
<details><summary>Does detecting Google Analytics mean it is correctly configured?</summary><p>No. The tool distinguishes <b>tracking code detected</b> from <b>Analytics configuration verified</b>. The latter requires actual Analytics access, which Raptive also requires at application (read-only GA4 authorization).</p></details>
<details><summary>Does it use AI or an LLM?</summary><p>No. The engine is a crawler plus HTML parsing, similarity statistics and a weighted Raptive rule registry. No OpenAI, Gemini, Claude, Semrush, Ahrefs, or Google Analytics API.</p></details>
<details><summary>Is this affiliated with Raptive?</summary><p>No. Findings cite Raptive Support where a check maps to a documented requirement, and are otherwise labelled Quality Signal or Heuristic.</p></details>
</div></div>`;
  return layout('Raptive Eligibility Checker — Free Website Readiness Score | huvanti', body, {
    active: 'raptive', canonical: 'https://huvanti.com/raptive-eligibility-checker', meta, jsonLd,
    scripts: ['/assets/js/common.js', '/assets/js/raptive/crawler.js', '/assets/js/raptive/ui.js']
  });
}

function wpthemePage() {
  const meta = `<meta name="description" content="Free WordPress Theme Detector. Enter a URL to detect the active WordPress theme, version, author, child/parent theme and detection confidence — evidence-based, no account, no AI."><meta name="robots" content="index,follow">
<meta property="og:title" content="WordPress Theme Detector — huvanti"><meta property="og:description" content="Multi-signal WordPress theme detection with transparent evidence and confidence. No account, no AI, no third-party API."><meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">`;
  const jsonLd = {'@context':'https://schema.org','@graph':[
    {'@type':'WebSite',name:'huvanti',url:'https://huvanti.com/'},
    {'@type':'WebApplication',name:'WordPress Theme Detector',applicationCategory:'DeveloperApplication',operatingSystem:'Any',browserRequirements:'Requires JavaScript',featureList:'WordPress detection, active theme detection, theme version, child and parent theme, premium and custom theme signals, fingerprint database, detection evidence, confidence score, public exposure notes',offers:{'@type':'Offer','price':'0','priceCurrency':'USD'},description:'Free, deterministic WordPress theme detector that reads only publicly observable evidence. No login, no account, no API keys, no AI.'}
  ]};
  const body = `<section class="hero audit-home wptheme-home"><span class="material-icons hero-icon" aria-hidden="true">palette</span><h1>WordPress Theme Detector</h1><p class="hero-subtitle">Detect the active WordPress theme from public evidence — no account, no AI.</p>
<form id="wptheme-form" class="search-field audit-search" role="search" aria-label="WordPress theme detector"><span class="material-icons" aria-hidden="true">link</span><input id="wptheme-url" type="text" inputmode="url" autocomplete="url" spellcheck="false" placeholder="Enter website URL — e.g. https://example.com" required aria-label="Website URL"><button class="btn" type="submit">Detect Theme</button></form>
<div class="audit-trust"><span>Theme name &amp; slug</span><span>Version</span><span>Child &amp; parent</span><span>Author</span><span>Fingerprints</span><span>Evidence-based</span><span>No fake results</span></div></section>
<div id="wptheme-results" class="audit-results wptheme-results"></div>
<div class="container section">
  <div class="section-heading-row">${icon('rule_folder')}<h4 style="margin:0;">How detection works — nine methods, one transparent verdict</h4></div>
  <div class="grid feature-grid">
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('verified')} WordPress detection engine</h6><p>Weighted, family-based signals: /wp-content/, /wp-includes/, /wp-json/, generator metadata, REST API, HTML patterns, headers and feeds. One weak signal is never enough — “Detected” needs independent, corroborating evidence.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('search')} Theme path discovery</h6><p>Homepage HTML, CSS URLs, JS URLs, enqueued asset handles, REST content and oEmbed output are all scanned for /wp-content/themes/&lt;slug&gt;/ references before a theme is named.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('description')} style.css analysis</h6><p>The public WordPress theme header is parsed for Theme Name, Version, Author, Author URI, Theme URI, Description, License, Text Domain, Tags and Template — the exact same header WordPress itself reads.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('account_tree')} Child &amp; parent themes</h6><p>A Template: field proves a child theme. The parent’s public style.css is then read for its name, author and version — the parent is never guessed from appearance.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('fingerprint')} Fingerprint database</h6><p>A maintainable local database covers popular free themes (Astra, GeneratePress, Kadence, Neve, OceanWP, Hello Elementor…), premium themes (Divi, Avada, Flatsome, WoodMart, Newspaper…) and frameworks. Naming requires multiple distinct markers.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('history')} Honest version reporting</h6><p>Exact versions are labelled exact, ?ver= estimates are labelled “appears to be”, and hidden versions say “not publicly detectable”. Versions are never invented, and no vulnerability claims are made from a local dataset.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('visibility')} Theme exposure</h6><p>A short informational section showing which theme details are publicly observable (metadata, version, screenshot, readme, source maps, directory listings) — with no exploitation or intrusive testing.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('security')} Safe by design</h6><p>SSRF-protected scanning: private IPs, loopback, cloud metadata and DNS-rebinding targets are refused; every redirect is re-validated; requests, bytes and time are budgeted so a scan can never flood a site.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('block')} Four honest outcomes</h6><p>Every scan ends in Detected, Likely, Unable to Verify or Not Detected. A blocked, challenged or JavaScript-only site is reported as “Unable to determine” — never as “not WordPress”.</p></div></div></div>
  </div>
</div>
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('help')}<h4 style="margin:0;">FAQ</h4></div>
  <div class="faq-accordion">
<details><summary>Is this accurate?</summary><p>Accuracy is prioritised over producing a result for every site. Detection combines nine independent methods, shows every signal and weight, and labels results Detected, Likely, Unable to Verify or Not Detected. It never names a theme it could not evidence.</p></details>
<details><summary>Does it work on any WordPress site?</summary><p>No tool can. Sites can hide or rename theme paths, block scanners, serve assets from rewritten CDNs, or be behind bot protection. In those cases this tool reports exactly what blocked the scan and what partial evidence exists, instead of guessing.</p></details><details><summary>What happens if the scanner server can’t reach a site?</summary><p>The server first tries a direct, SSRF-protected connection. If that is impossible (firewall, TLS reset, blocked egress — for example on this preview sandbox), the same small set of resources is collected through your own browser and analysed by the identical engine. The report always states which transport was used, and a blocked or unreadable site is reported as Unable to determine — never as “not WordPress”.</p></details>
<details><summary>Does it need an account, API key or AI?</summary><p>No. Detection is deterministic: direct HTTP requests, HTML/CSS parsing, WordPress fingerprints and a weighted evidence engine. No OpenAI, Gemini, Claude, or paid third-party detection APIs.</p></details>
<details><summary>Can it detect premium or custom themes?</summary><p>Premium themes are identified when multiple fingerprint markers match a known commercial theme or its marketplace URI. Custom themes are flagged as “Possible custom theme” with confidence from several weak signals — never stated as certainty.</p></details>
<details><summary>Does it check security?</summary><p>It only reports publicly observable theme information (exposure). It does not attempt exploitation, does not test for vulnerabilities, and never claims a version is vulnerable. Version age is compared against a bundled dataset that may lag reality.</p></details>
<details><summary>What about privacy and abuse?</summary><p>The submitted URL is treated as untrusted: private, loopback, internal and cloud-metadata targets are refused; redirects are re-validated against the same rules; and scans are rate-limited and budgeted (a handful of small requests).</p></details>
  </div>
</div>`;
  return layout('WordPress Theme Detector — Detect the Active WP Theme from Evidence | huvanti', body, {
    active: 'wptheme', canonical: 'https://huvanti.com/wordpress-theme-detector', meta, jsonLd,
    scripts: ['/assets/js/common.js', '/assets/js/wptheme/collector.js', '/assets/js/wptheme/ui.js']
  });
}


function domainInfoPage() {
  const meta = `<meta name="description" content="Free Domain Information Checker. Enter a domain or URL for an evidence-based report: registration, WHOIS/RDAP, DNS records, hosting, CDN, SSL/TLS, HTTP, email security, DNSSEC and technology — no account, no AI."><meta name="robots" content="index,follow">
<meta property="og:title" content="Domain Information Checker — huvanti"><meta property="og:description" content="Evidence-based domain intelligence from RDAP, WHOIS, DNS, TLS and HTTP — with sources and confidence for every value. Never fabricates data. No account required."><meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">`;
  const jsonLd = {'@context':'https://schema.org','@graph':[
    {'@type':'WebSite',name:'huvanti',url:'https://huvanti.com/'},
    {'@type':'WebApplication',name:'Domain Information Checker',applicationCategory:'DeveloperApplication',operatingSystem:'Any',browserRequirements:'Requires JavaScript',featureList:'Domain validation, RDAP/WHOIS registration data, domain age, DNS records, DNS health, nameserver analysis, hosting detection, CDN detection, SSL/TLS certificate, HTTP status and redirects, email security, DNSSEC, TLD information, IDN/punycode, technology detection, evidence and confidence',offers:{'@type':'Offer','price':'0','priceCurrency':'USD'},description:'Free, deterministic domain information checker that reports only publicly verifiable data. No login, no account, no AI, no paid SEO API.'}
  ]};
  const body = `<section class="hero audit-home domaincheck-home"><span class="material-icons hero-icon" aria-hidden="true">dns</span><h1>Domain Information Checker</h1><p class="hero-subtitle">Publicly verifiable domain intelligence — RDAP, DNS, hosting, SSL, email &amp; more. No account, no AI.</p>
<form id="domaincheck-form" class="search-field audit-search" role="search" aria-label="Domain information checker"><span class="material-icons" aria-hidden="true">dns</span><input id="domaincheck-url" type="text" inputmode="url" autocomplete="url" spellcheck="false" placeholder="example.com or https://example.com" required aria-label="Domain name or URL"><button class="btn" type="submit">Check Domain</button></form>
<div class="audit-trust"><span>RDAP + WHOIS</span><span>DNS &amp; DNSSEC</span><span>Hosting &amp; ASN</span><span>CDN detection</span><span>SSL / TLS</span><span>HTTP &amp; redirects</span><span>Email security</span><span>Evidence-based</span></div></section>
<div id="domaincheck-results" class="audit-results domaincheck-results"></div>
<div class="container section">
  <div class="section-heading-row">${icon('rule_folder')}<h4 style="margin:0;">What this checker actually does</h4></div>
  <div class="grid feature-grid">
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('assignment')} Registration intelligence (RDAP first)</h6><p>Queries the registry’s official RDAP service, with the IANA-assigned WHOIS server as fallback. Registration/expiration dates, registrar, IANA ID, EPP statuses (explained in plain language) and DNSSEC delegation — only when publicly available.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('storage')} DNS &amp; nameservers</h6><p>A, AAAA, CNAME, MX, NS, TXT, CAA, SOA, SRV, DS and DNSKEY records with a non-alarmist DNS health panel. Nameserver IPs, networks and DNS-provider detection are shown with their signals.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('router')} Hosting vs CDN — kept separate</h6><p>ASN/BGP data, network fingerprints and reverse DNS identify the network. When a CDN proxies the site, the report says <b>CDN/Proxy: Cloudflare</b> and <b>Origin Hosting: Not publicly determinable</b> — the proxy is never claimed as the host.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('lock')} SSL/TLS &amp; HTTP</h6><p>Certificate issuer, validity window, days remaining, SANs, chain status, TLS version and hostname match; HTTP status, response time, redirect chain, HSTS, compression and cache headers. Handshake-only checks — no intrusive testing.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('mail')} Email infrastructure</h6><p>MX servers and provider, SPF and DMARC policies, and DKIM for a small set of common selectors only (never brute-forced). SPF presence is never presented as “fully protected”.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('verified')} Accuracy over completeness</h6><p>Every major value carries its source, confidence and timestamp. Conflicting sources are shown side by side. Anything unavailable is labelled <b>Not publicly available</b> or <b>Unable to Verify</b> — never invented.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('timeline')} Domain age &amp; timeline</h6><p>Age is computed from the official registration date only — years, months, days and total days — with a Registered → Updated → Now → Expires timeline and expiration warnings. No registration date? It says so.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('memory')} Technology fingerprints</h6><p>Heuristic detection of WordPress, Shopify, Wix, Webflow, Drupal, Joomla, Laravel, Next.js, React, Vue, Angular, PHP, Node.js, Google Analytics/GTM and CDNs from public fingerprints — with confidence, never claimed as certain.</p></div></div></div>
    <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('security')} Safe by design</h6><p>Domain input is treated as untrusted: private/loopback/metadata targets are refused, redirects are re-validated, lookups are rate-limited, cached per scan and strictly budgeted. No login, no AI, no paid SEO API.</p></div></div></div>
  </div>
</div>
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('help')}<h4 style="margin:0;">FAQ</h4></div><div class="faq-accordion">
<details><summary>Is this a WHOIS lookup?</summary><p>It is a complete domain intelligence report: RDAP/WHOIS registration data, DNS records and health, nameservers, IP/ASN/hosting, CDN detection, SSL/TLS, HTTP and redirects, email security, DNSSEC, TLD and IDN information, domain age, timeline, and heuristic technology detection.</p></details>
<details><summary>Where does the data come from?</summary><p>Directly from public sources: the registry’s RDAP/WHOIS services, public DNS resolvers, BGP/ASN data, TLS handshakes and HTTP responses, plus a local fingerprint database. Every major result shows its source, confidence and timestamp in the report.</p></details>
<details><summary>Does it guess or use AI?</summary><p>No. Nothing is fabricated and no LLM/API is involved. If a value (registration date, registrar, hosting, IP, ASN, SSL issuer…) cannot be verified, the report says <b>Not publicly available</b> or <b>Unable to Verify</b> — and conflicting sources are shown instead of being merged silently.</p></details>
<details><summary>Why does the report say “Origin Hosting: Not publicly determinable”?</summary><p>When a CDN/reverse proxy (Cloudflare, CloudFront, Fastly…) fronts a domain, public data only reveals the edge network. Claiming the origin host would be a guess, so the tool separates <b>CDN/Proxy</b> from <b>Origin Hosting</b> and says so honestly.</p></details>
<details><summary>Does it show the domain owner?</summary><p>No. Registrant names, addresses, phone numbers and emails are private data. The tool detects whether registrant data is privacy-protected and reports that — it never displays or bypasses WHOIS privacy.</p></details>
<details><summary>Why are some sections unavailable?</summary><p>Some registries have no RDAP and some environments block direct HTTPS/WHOIS connections. Those sections are reported as unavailable with the reason — never filled in with guesses. The DNS-based sections always work.</p></details>
<details><summary>Is availability checking exact?</summary><p>A registry “not found” answer is reported as Available, a registration record as Registered, and anything else as <b>Unable to Verify</b>. Rate limits and registry delays are respected and stated.</p></details>
</div></div>`;
  return layout('Domain Information Checker — DNS, WHOIS, SSL & Hosting Intelligence | huvanti', body, {
    active: 'domaincheck', canonical: 'https://huvanti.com/domain-information-checker', meta, jsonLd,
    scripts: ['/assets/js/common.js', '/assets/js/domaincheck/ui.js']
  });
}

function sitemapPage() {
  const meta = `<meta name="description" content="Free XML Sitemap Generator. Crawl a public website safely, respect robots.txt, analyse existing sitemaps, validate indexable URLs, and download standards-compliant XML."><meta name="robots" content="index,follow">
<meta property="og:title" content="XML Sitemap Generator — huvanti"><meta property="og:description" content="Production-quality sitemap generator and analyzer with robots.txt, canonical, noindex, redirect and XML validation."><meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">`;
  const jsonLd = {'@context':'https://schema.org','@graph':[
    {'@type':'WebSite',name:'huvanti',url:'https://huvanti.com/'},
    {'@type':'WebApplication',name:'XML Sitemap Generator',applicationCategory:'DeveloperApplication',operatingSystem:'Any',browserRequirements:'Requires JavaScript',featureList:'URL validation, SSRF-safe fetching, robots.txt parsing, sitemap discovery, internal crawling, canonical and noindex detection, XML validation, sitemap splitting, existing sitemap analysis',offers:{'@type':'Offer','price':'0','priceCurrency':'USD'},description:'Free deterministic XML sitemap generator and analyzer. No login, account, AI or paid SEO API.'}
  ]};
  const body = `<section class="hero audit-home sitemap-home"><span class="material-icons hero-icon" aria-hidden="true">account_tree</span><h1>XML Sitemap Generator</h1><p class="hero-subtitle">Generate or analyse technically valid XML sitemaps from real crawlable pages.</p>
<form id="sitemap-form" class="sitemap-form" aria-label="XML sitemap generator">
  <div class="mode-tabs" role="radiogroup" aria-label="Mode"><label><input type="radio" name="sitemap-mode" value="generate" checked> Generate New Sitemap</label><label><input type="radio" name="sitemap-mode" value="analyze"> Analyze Existing Sitemap</label></div>
  <div class="search-field audit-search"><span class="material-icons" aria-hidden="true">link</span><input name="url" id="sitemap-url" type="text" inputmode="url" autocomplete="url" spellcheck="false" placeholder="https://example.com" required aria-label="Website or sitemap URL"><button class="btn" type="submit">Generate Sitemap</button></div>
  <details class="sitemap-options sitemap-advanced"><summary>${icon('tune')} Advanced crawl settings</summary>
    <div class="sitemap-option-row"><label>Maximum URLs <select name="maxUrls" class="select"><option value="100">100</option><option value="500" selected>500</option><option value="1000">1,000</option><option value="5000">5,000</option><option value="10000">10,000</option></select></label><label>Crawl Depth <select name="depth" class="select"><option value="unlimited">Unlimited (capped safely)</option><option value="1">1</option><option value="2">2</option><option value="3" selected>3</option><option value="5">5</option><option value="10">10</option></select></label><label>Changefreq <select name="changefreq" class="select"><option value="" selected>Don't include</option><option value="always">Always</option><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="never">Never</option></select></label></div>
    <div class="sitemap-option-row"><label><input type="checkbox" name="includeSubdomains"> Include subdomains</label><label><input type="checkbox" name="includeNoindex"> Include noindex URLs <small>(not recommended)</small></label><label><input type="checkbox" name="includeImages"> Include Images</label></div>
  </details>
</form>
<div class="audit-trust"><span>No account</span><span>No AI API</span><span>Robots.txt respected</span><span>Canonicals checked</span><span>Noindex excluded</span><span>XML validated</span><span>Download ready</span></div></section>
<div id="sitemap-results" class="audit-results sitemap-results"></div>
<div class="container section"><div class="section-heading-row">${icon('verified')}<h4 style="margin:0;">Built for accurate sitemap generation — not link dumping</h4></div><div class="grid feature-grid">
  <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('security')} Safe crawler</h6><p>Only public HTTP/HTTPS URLs are accepted. Private IPs, localhost, metadata endpoints, unsafe redirects, oversized responses and request flooding are blocked.</p></div></div></div>
  <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('rule')} Robots and indexability</h6><p>robots.txt, HTTP status, content type, canonical links, meta robots and X-Robots-Tag are checked before a URL is included.</p></div></div></div>
  <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('fact_check')} Existing sitemap analysis</h6><p>Inspect XML validity, broken URLs, redirects, duplicates, non-canonical pages, non-indexable URLs and structure issues with an internal health score.</p></div></div></div>
  <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('code')} Standards-compliant XML</h6><p>Generated files use the sitemap protocol namespace, properly escaped loc values, reliable lastmod only, automatic splitting and validation.</p></div></div></div>
  <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('image')} Optional image sitemap</h6><p>When enabled, page-associated image URLs from img, picture/srcset and Open Graph are included without tracking pixels or UI icons.</p></div></div></div>
  <div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon('table_view')} Transparent URL explorer</h6><p>Every crawled URL is shown with status, indexability, canonical target, inclusion decision and a precise exclusion reason.</p></div></div></div>
</div></div>
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('help')}<h4 style="margin:0;">FAQ</h4></div><div class="faq-accordion">
<details><summary>Why can a crawl fail?</summary><p>Some sites block datacenter crawlers, require JavaScript challenges, rate-limit requests, have DNS/SSL issues, or disallow crawling in robots.txt. The tool now tries a server crawl first and then a browser/relay fallback, but it still reports a real access failure instead of inventing URLs.</p></details>
<details><summary>Does this include every discovered link?</summary><p>No. A URL must be internal, allowed by robots.txt, return a successful HTML response, be indexable, and pass canonical and duplicate checks before it is included in the generated sitemap.</p></details>
<details><summary>Are lastmod, changefreq and priority fabricated?</summary><p>No. lastmod is only included when reliable data exists. changefreq is optional and user-selected. priority is not generated by default because arbitrary priorities do not guarantee search-engine ranking behavior.</p></details>
<details><summary>What happens if an existing sitemap is detected?</summary><p>The generator shows Existing Sitemap Detected. You can still generate a fresh crawl-based sitemap or switch to Analyze Existing Sitemap mode to inspect broken URLs, redirects, duplicates, canonical problems and non-indexable URLs.</p></details>
<details><summary>Does this work with WordPress and JavaScript sites?</summary><p>It detects common WordPress sitemap structures and crawlable WordPress URLs. For JavaScript-heavy pages, it reports limited crawlability when the server HTML has too little content; it does not fake rendered links.</p></details>
<details><summary>Is this affiliated with Google?</summary><p>No. The sitemap health score is an internal diagnostic score, not an official Google score. A valid sitemap helps discovery but never guarantees indexing.</p></details>
</div></div>`;
  return layout('XML Sitemap Generator — Free Crawl, Validate & Download | huvanti', body, { active:'sitemap', canonical:'https://huvanti.com/xml-sitemap-generator', meta, jsonLd, scripts:['/assets/js/common.js','/assets/js/sitemap/browser.js','/assets/js/sitemap/ui.js'] });
}

function page(name) { return layout(name, `<div class="container page"><h1 class="page-title">${esc(name)}</h1><div class="paper paper-padded"><p>huvanti provides free, no-account website tools including an SEO audit, AdSense/Ezoic/Mediavine/Raptive eligibility checkers, a WordPress theme detector, a domain information checker, and an XML sitemap generator.</p></div></div>`); }

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
  if (p === '/api/mediavine-audit' && req.method === 'POST') {
    const body = await readJson(req);
    await mediavineApi.handle(req, res, body);
    return;
  }
  if (p === '/api/mediavine-analyze' && req.method === 'POST') {
    const body = await readJson(req);
    await mediavineApi.handleAnalyze(req, res, body);
    return;
  }
  if (p === '/api/raptive-audit' && req.method === 'POST') {
    const body = await readJson(req);
    await raptiveApi.handle(req, res, body);
    return;
  }
  if (p === '/api/raptive-analyze' && req.method === 'POST') {
    const body = await readJson(req);
    await raptiveApi.handleAnalyze(req, res, body);
    return;
  }
  if (p === '/api/wptheme-scan' && req.method === 'POST') {
    const body = await readJson(req);
    await wpthemeApi.handle(req, res, body);
    return;
  }
  if (p === '/api/wptheme-analyze' && req.method === 'POST') {
    const body = await readJson(req);
    await wpthemeApi.handleAnalyze(req, res, body);
    return;
  }
  if (p === '/api/sitemap' && req.method === 'POST') {
    const body = await readJson(req);
    await sitemapApi.handle(req, res, body);
    return;
  }
  if (p === '/api/domaincheck' && req.method === 'POST') {
    const body = await readJson(req);
    await domaincheckApi.handle(req, res, body);
    return;
  }
  if (p === '/api/domaincheck-analyze' && req.method === 'POST') {
    const body = await readJson(req);
    await domaincheckApi.handleAnalyze(req, res, body);
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
  else if (p === '/mediavine-eligibility-checker') html = mediavinePage();
  else if (p === '/raptive-eligibility-checker') html = raptivePage();
  else if (p === '/wordpress-theme-detector') html = wpthemePage();
  else if (p === '/domain-information-checker') html = domainInfoPage();
  else if (p === '/xml-sitemap-generator') html = sitemapPage();
  else if (['/about','/contact','/privacy','/terms'].includes(p)) html = page(p.slice(1).replace(/^./,c=>c.toUpperCase()));
  else html = layout('Not found', `<div class="container notfound"><h1>404</h1><p>Page not found.</p><a class="btn" href="/">Back home</a></div>`);
  res.setHeader('content-type','text/html; charset=utf-8'); res.setHeader('cache-control','no-store'); res.end(html);
}).listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('huvanti preview running'));
