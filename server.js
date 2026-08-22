const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ezoicApi = require('./lib/ezoic/api');
const mediavineApi = require('./lib/mediavine/api');
const raptiveApi = require('./lib/raptive/api');
const wpthemeApi = require('./lib/wptheme/api');
const sitemapApi = require('./lib/sitemap/api');
const domaincheckApi = require('./lib/domaincheck/api');
const brokenlinkApi = require('./lib/brokenlink/api');
const llmstxtApi = require('./lib/llmstxt/api');
const botblockerApi = require('./lib/botblocker/api');
const cwvApi = require('./lib/cwv/api');
const rssApi = require('./lib/rss/api');

const crypto = require('crypto');
const criticalCss = fs.readFileSync(path.join(__dirname, 'assets/css/style.css'), 'utf8');
/* Content hashed asset URLs: browsers can cache assets forever, and every
   deploy instantly invalidates the cache because the URL changes. */
const ASSET_VER = new Map();
function verOf(p) {
  if (ASSET_VER.has(p)) return ASSET_VER.get(p);
  let v = '0';
  try { v = crypto.createHash('sha1').update(fs.readFileSync(path.join(__dirname, p))).digest('hex').slice(0, 8); } catch (e) {}
  ASSET_VER.set(p, v);
  return v;
}
const ver = p => p + '?v=' + verOf(p.startsWith('/') ? p.slice(1) : p);
const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const icon = name => `<span class="material-icons" aria-hidden="true">${esc(name)}</span>`;
const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%231976d2'/%3E%3Ccircle cx='27' cy='27' r='13' fill='none' stroke='white' stroke-width='6'/%3E%3Cpath d='M37 37L51 51' stroke='white' stroke-width='8' stroke-linecap='round'/%3E%3C/svg%3E";

/* Central registry of tools: powers the Other Tools menu, related links,
   the footer and the XML sitemap from one source of truth. */
const TOOLS = {
  seo:        { name:'Deep SEO Auditor', icon:'travel_explore', path:'/', short:'Deep technical, content and performance audit' },
  adsense:    { name:'AdSense Eligibility Checker', icon:'monetization_on', path:'/adsense-eligibility-checker', short:'Website readiness for AdSense' },
  ezoic:      { name:'Ezoic Eligibility Checker', icon:'paid', path:'/ezoic-eligibility-checker', short:'Website readiness for Ezoic' },
  mediavine:  { name:'Mediavine Eligibility Checker', icon:'savings', path:'/mediavine-eligibility-checker', short:'Website readiness for Mediavine' },
  raptive:    { name:'Raptive Eligibility Checker', icon:'campaign', path:'/raptive-eligibility-checker', short:'Website readiness for Raptive' },
  wptheme:    { name:'WordPress Theme Detector', icon:'palette', path:'/wordpress-theme-detector', short:'Detect the active WP theme' },
  domaincheck:{ name:'Domain Information Checker', icon:'dns', path:'/domain-information-checker', short:'DNS, WHOIS, SSL and hosting intelligence' },
  sitemap:    { name:'XML Sitemap Generator', icon:'account_tree', path:'/xml-sitemap-generator', short:'Crawl, validate and export XML sitemaps' },
  brokenlink: { name:'Broken Link Checker', icon:'search_off', path:'/broken-link-checker', short:'Find and classify broken links accurately' },
  llmstxt:    { name:'LLMs.txt Generator', icon:'auto_stories', path:'/llms-txt-generator', short:'Generate and validate an llms.txt file' },
  botblocker: { name:'AI Crawler &amp; LLM Bot Blocker', icon:'security', path:'/ai-crawler-blocker', short:'Control AI bots via robots.txt and server rules' },
  cwv:        { name:'Core Web Vitals &amp; INP Auditor', icon:'speed', path:'/core-web-vitals-auditor', short:'Real LCP, INP, CLS, FCP and TTFB measurement' },
  rss:        { name:'RSS Feed Generator', icon:'rss_feed', path:'/rss-feed-generator', short:'Discover content and generate valid RSS' }
};

/* Tool categories: drive the Tools menu and the homepage directory. */
const CATEGORIES = [
  { key:'seo', icon:'travel_explore', name:'SEO and Site Health', desc:'Crawl deep, fix what search engines see first.', tools:['seo','sitemap','brokenlink','cwv'] },
  { key:'ads', icon:'monetization_on', name:'Ad Network Readiness', desc:'Check a site against the requirements of each major ad network.', tools:['adsense','ezoic','mediavine','raptive'] },
  { key:'intel', icon:'dns', name:'Domain and Platform Intelligence', desc:'Look behind a site: the stack, the host and the domain record.', tools:['domaincheck','wptheme'] },
  { key:'content', icon:'rss_feed', name:'Content and AI Discovery', desc:'Feeds, AI readable files and control over AI crawlers.', tools:['rss','llmstxt','botblocker'] }
];

function otherToolsMenu(active) {
  const col = cat => '<div class="tools-cat">' +
    '<div class="tools-cat-head">' + icon(cat.icon) + esc(cat.name) + '</div>' +
    cat.tools.map(k => { const t = TOOLS[k];
      return `<a href="${t.path}" role="menuitem" class="${active===k?'is-active':''}">${icon(t.icon)}<b>${t.name}</b></a>`; }).join('') + '</div>';
  return `<details class="tools-menu"><summary>${icon('category')}<span>Tools</span>${icon('arrow_drop_down')}</summary>
    <div class="tools-menu-panel" role="menu">${CATEGORIES.map(col).join('')}</div></details>`;
}

function relatedTools(active) {
  const rel = {
    seo: ['cwv','brokenlink','sitemap','botblocker'],
    adsense: ['ezoic','mediavine','raptive','seo'],
    ezoic: ['mediavine','raptive','adsense'],
    mediavine: ['raptive','adsense','ezoic'],
    raptive: ['mediavine','adsense','ezoic'],
    wptheme: ['domaincheck','sitemap'],
    domaincheck: ['wptheme','cwv'],
    sitemap: ['brokenlink','llmstxt','rss'],
    brokenlink: ['sitemap','seo','cwv'],
    llmstxt: ['botblocker','sitemap','rss'],
    botblocker: ['llmstxt','seo'],
    cwv: ['seo','brokenlink','sitemap'],
    rss: ['sitemap','llmstxt']
  };
  const list = rel[active];
  if (!list) return '';
  return `<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('hub')}<h4 style="margin:0;">Related tools</h4></div><div class="alltools-grid">${list.map(k => { const t = TOOLS[k]; return `<a class="alltools-item" href="${t.path}"><span class="material-icons" aria-hidden="true">${t.icon}</span>${t.name}</a>`; }).join('')}</div></div>`;
}

/* ---------- content helpers ---------- */
const chip = (ic, label) => `<span>${icon(ic)}${label}</span>`;
const chips = list => `<div class="audit-trust">${list.map(([ic, l]) => chip(ic, l)).join('')}</div>`;
const lede = text => `<p class="section-lede">${text}</p>`;
const guideGrid = items => `<div class="guide-grid">${items.map(([ic, title, html]) =>
  `<div class="guide-item"><h5>${icon(ic)}${title}</h5>${html}</div>`).join('')}</div>`;
const cards = (heading, headingIcon, cells) =>
  `<div class="container section"><div class="section-heading-row">${icon(headingIcon)}<h4 style="margin:0;">${heading}</h4></div>` +
  `<div class="grid feature-grid">${cells.map(([ic, title, text]) =>
    `<div class="cell w-xs-12 w-sm-6 w-md-4"><div class="card card-hover"><div class="card-content"><h6>${icon(ic)}${title}</h6><p>${text}</p></div></div></div>`).join('')}</div></div>`;
const faqSection = (items, heading = 'Common FAQs', ic = 'live_help') =>
  `<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon(ic)}<h4 style="margin:0;">${heading}</h4></div>` +
  `<div class="faq-accordion">${items.map(([q, a]) => `<details><summary><b>${q}</b></summary><p>${a}</p></details>`).join('')}</div></div>`;
const faqLd = items => ({ '@context':'https://schema.org', '@type':'FAQPage', mainEntity: items.map(([q, a]) =>
  ({ '@type':'Question', name:q, acceptedAnswer:{ '@type':'Answer', text:String(a).replace(/<[^>]+>/g, '') } })) });

const searchForm = (id, { inputId, placeholder = 'https://yourwebsite.com', button = 'Audit', extra = '' }) =>
  `<form id="${id}" class="search-field audit-search" role="search">` +
  `<input id="${inputId}" name="url" type="url" placeholder="${placeholder}" required aria-label="Website URL">${extra}` +
  `<button class="btn" type="submit">${button}</button></form>`;

const crawlSelect = (id, label, opts, sel) =>
  `<select id="${id}" class="crawl-select" aria-label="${label}">${opts.map(v => `<option value="${v}"${v==sel?' selected':''}>${v} page${v==='1'?'':'s'}</option>`).join('')}</select>`;

const section = (cls, inner) => `<div class="container section">${inner}</div>`;

function layout(title, body, opts) {
  opts = opts || {};
  const active = opts.active || '';
  const scripts = opts.scripts || ['/assets/js/progress.js','/assets/js/common.js','/assets/js/audit.js'];
  const desc = opts.description || 'Free website tools that run in your browser with no account: SEO audit, ad network readiness checks, sitemap and RSS generators, domain intelligence and more.';
  const meta = (opts.meta || '') +
    `<meta name="description" content="${esc(desc)}"><meta name="robots" content="index,follow">` +
    `<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website"><meta name="twitter:card" content="summary">`;
  const jsonLd = opts.jsonLd ? `<script type="application/ld+json">${JSON.stringify(opts.jsonLd)}</script>` : '';
  const toolLd = { '@context':'https://schema.org', '@type':'WebSite', name:'Huvanti', url:'https://huvanti.com/' };
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light dark"><meta name="theme-color" content="#1976d2" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#121212" media="(prefers-color-scheme: dark)">${meta}<title>${esc(title)}</title><link rel="canonical" href="${opts.canonical||'https://huvanti.com/'}"><link rel="icon" href="${FAVICON}"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><script>try{var t=localStorage.getItem('theme-mode');if(t==='dark'||(!t&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}</script><link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&family=Material+Icons&display=swap" rel="stylesheet"><style>${criticalCss}</style>${jsonLd}<script type="application/ld+json">${JSON.stringify(toolLd)}</script></head><body><a class="skip-link" href="#main">Skip to content</a><div class="app"><header class="appbar"><div class="toolbar"><a class="brand" href="/"><span class="brand-logo">${icon('rocket_launch')}</span><span class="brand-name">Huvanti.com</span></a><nav class="desktop-nav" aria-label="Primary"><a href="/">${icon('home')}<span>Home</span></a>${otherToolsMenu(active)}<a href="/about">${icon('info')}<span>About</span></a><a href="/contact">${icon('mail')}<span>Contact</span></a></nav><button type="button" class="icon-button theme-toggle" aria-label="Switch to dark mode" id="theme-toggle"><span class="material-icons">dark_mode</span></button></div></header><main id="main">${body}${relatedTools(active)}</main><footer class="footer"><div class="container footer-grid"><div><div class="footer-brand">Huvanti</div><p class="footer-about">Free browser based tools for website owners: SEO auditing, ad network readiness, sitemaps, feeds, domain intelligence and bot control. No account, nothing to install.</p></div><div><div class="footer-heading">Tools</div><div class="footer-links">${Object.values(TOOLS).map(t => `<a href="${t.path}">${t.name}</a>`).join('')}</div></div><div><div class="footer-heading">Pages</div><div class="footer-links"><a href="/about">About</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></div></div></div><div class="footer-bottom"><div class="container footer-copyright" style="margin:0;padding:0;text-align:left">&copy; 2026 Huvanti</div><p class="footer-note">Huvanti is an independent project. It is not affiliated with Google, AdSense, Ezoic, Mediavine or Raptive, and approval decisions always belong to those platforms.</p></div></footer></div>${scripts.map(s=>`<script src="${ver(s)}" defer></script>`).join('')}</body></html>`;
}

/* gzip aware response helper with sensible caching */
function send(req, res, status, type, body, cache) {
  res.statusCode = status;
  res.setHeader('content-type', type);
  res.setHeader('vary', 'accept-encoding');
  if (cache) res.setHeader('cache-control', cache); else res.setHeader('cache-control', 'no-store');
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (buf.length > 900 && /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) {
    zlib.gzip(buf, (e, z) => {
      if (e) { res.end(buf); return; }
      res.setHeader('content-encoding', 'gzip');
      res.setHeader('content-length', z.length);
      res.end(z);
    });
  } else {
    res.setHeader('content-length', buf.length);
    res.end(buf);
  }
}
/* ============================== HOME: SEO AUDIT ============================== */
function home() {
  const faqs = [
    ['What is an SEO audit?', 'An SEO audit reviews a website the way a search engine sees it. It checks technical fundamentals such as redirects, canonical tags and indexability, plus on page elements like titles and headings, content quality, images, linking and security headers. The goal is to find the specific issues that hold a site back and to put them in an order you can actually fix.'],
    ['Is this SEO audit tool really free?', 'Yes. There is no account, no trial and no credit card. Paste a URL, run the audit and read the report. The tool supports itself with ads, the same model most free web tools use.'],
    ['How does the audit crawl my site?', 'It starts from the URL you enter, reads robots.txt and any sitemaps it finds, then follows internal links page by page. Each page is parsed in your browser, so nothing is uploaded to a server you do not control. A live progress panel shows exactly which page is being read at any moment.'],
    ['How many pages can the audit check at once?', 'You choose the crawl size when you start, from a single page up to a 200 page deep crawl. For very large sites, run the auditor on one section or subfolder at a time and compare the reports.'],
    ['What is a good SEO audit score?', 'Scores of 90 and above mean the measured checks are clean. Between 75 and 89 the site is in good shape with room to improve. Below that, the priority list will usually contain a handful of fixes that move the needle quickly. Treat the score as a progress tracker for your own site rather than a comparison against others.'],
    ['How often should I run an SEO audit?', 'Most site owners audit once a quarter, and after any big change such as a redesign, a migration or a new theme. The compare feature stores your recent audits in your own browser, so you can see whether scores move up or down between runs.'],
    ['Why does the audit show fewer pages than my website has?', 'The crawl stops at the page limit you set, and it only follows links it can actually read. Pages hidden behind JavaScript menus, blocked by robots.txt or linked only from pages outside the crawl will not appear. This is also useful information: if an important page cannot be reached by a simple crawl, search engines may struggle with it too.'],
    ['Does the audit work with WordPress, Shopify and other platforms?', 'Yes. The audit reads public HTML, so it works on any platform that serves normal web pages, including WordPress, Shopify, Wix, Squarespace, Webflow and static site generators. The report also identifies the detected platform so you can prioritise fixes that suit your stack.'],
    ['Can I audit a website I do not own?', 'You can audit any publicly reachable page, which is the same information a browser shows any visitor. It is a common way to study what competitors do well. Respect each site terms where they apply.'],
    ['Will fixing the reported issues improve my rankings?', 'Fixing errors removes obstacles, it does not guarantee positions. Technical fixes tend to help most when a site has real problems, such as noindex tags on key pages or duplicate content. Rankings still depend on content quality, competition and links.'],
    ['Is the data I submit stored anywhere?', 'No. The audit runs in your browser. Recent audit summaries are kept in your own browser storage for the compare feature, and you can clear them at any time through your browser settings.'],
    ['What is the difference between technical SEO and on page SEO?', 'Technical SEO covers how a site is built and served: HTTPS, redirects, canonical tags, sitemaps, response codes and page speed. On page SEO covers what is on each page: the title, the description, headings, text and internal links. Both matter, and the audit scores them separately so you can see where the work is.']
  ];
  const cardsList = [
    ['settings_input_component','Technical SEO','HTTPS and redirects, response codes, canonical tags, noindex directives, robots.txt, sitemap references, URL structure and duplicate URLs.'],
    ['description','On page SEO','Title and description length and uniqueness, one H1 per page, heading order and keyword placement in the places that carry weight.'],
    ['article','Content quality','Word count, thin or empty pages, readability scoring, duplicate and near duplicate pages, and keyword cannibalisation between pages.'],
    ['image','Images','Missing alt text, modern formats such as WebP and AVIF, lazy loading, width and height attributes, and oversized or broken images.'],
    ['speed','Performance','Render blocking scripts, third party scripts, compression, caching headers, server response time and a direct link to PageSpeed Insights for lab metrics.'],
    ['smartphone','Mobile','The viewport tag every mobile browser needs, responsive styling signals and guidance on tap targets and horizontal overflow.'],
    ['account_tree','Structured data','JSON-LD detection and validation, recognised schema types and suggestions for the types a page could qualify for.'],
    ['hub','Internal linking','Internal link counts, orphan pages found through the sitemap, click depth, empty anchors and links that point at redirects.'],
    ['translate','International','Hreflang annotations, language codes and conflicts between canonical tags and alternate language versions.'],
    ['security','Security headers','Mixed content plus HSTS, content security policy and the other headers that harden a site against common attacks.'],
    ['smart_toy','AI search','Which AI crawlers such as GPTBot and ClaudeBot are allowed or blocked in robots.txt, and whether your content is easy for AI systems to parse.'],
    ['grading','Score and reports','One overall score, twelve category scores, a priority fix list, CSV export, print to PDF, a shareable link and comparison with your earlier audits.']
  ];
  const howItWorks = [
    ['travel_explore','It starts with a real crawl','Your site is read the way a search engine reads it: robots.txt first, then sitemaps, then internal links from page to page. Nothing is simulated and no guesses are made about pages the crawl cannot reach.'],
    ['manage_search','Every page is analysed in detail','Each crawled page passes through more than two hundred checks covering technology, on page elements, content, images, linking, security and AI visibility. Anything that cannot be measured honestly is labelled as such instead of being invented.'],
    ['grading','Scoring you can inspect','The overall score and the twelve category scores are weighted by how much each issue matters. Open any category to see every individual check, why it matters and how to fix it, so nothing in the score is hidden from you.'],
    ['low_priority','A fix list in priority order','The report leads with the small number of changes that matter most, ordered by severity and impact. Work down that list and rerun the audit to confirm the score moves.']
  ];
  const fixFirst = [
    ['error','Start with critical errors','A noindex tag on an important page, a blocked robots.txt or server errors will cost you far more than any fine tuning. The critical list at the top of the report is where the fastest wins usually are.'],
    ['title','Then clean up titles and headings','Unique titles between 30 and 60 characters, one clear H1 and a logical heading order help both rankings and the way your listing reads in search results.'],
    ['content_paste','Remove thin and duplicate content','Pages with little text, or several pages covering the same topic, split your authority. Merge them, expand them or set a clear canonical, then let the audit confirm the duplicates are gone.'],
    ['image','Speed up images','Missing alt text, oversized files and unsized images appear in most first audits. They are quick to fix and they help accessibility, loading speed and layout stability at the same time.']
  ];
  const body = `<section class="hero audit-home"><span class="material-icons hero-icon" aria-hidden="true">travel_explore</span><h1>Deep SEO Auditor</h1><p class="hero-subtitle">A free deep SEO audit for any public website, up to 200 pages</p>
<form id="audit-form" class="search-field audit-search" role="search" aria-label="Deep SEO audit"><input id="audit-url" type="url" placeholder="https://yourwebsite.com" required aria-label="Website URL">${crawlSelect('crawl-limit','Crawl limit',['1','6','15','30','50','100','200'],'15')}<button class="btn" type="submit">Audit</button></form>
${chips([['person_outline','No account'],['settings_input_component','Technical'],['description','On page'],['article','Content'],['image','Images'],['speed','Performance']])}</section>
<div id="audit-results" class="audit-results"></div>
${cards('What does the audit check?', 'verified', cardsList)}
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('route')}<h4 style="margin:0;">How does the audit work?</h4></div>${lede('One honest pipeline, run the same way every time: a real crawl, measurable checks, transparent scoring and a fix list in priority order.')}${guideGrid(howItWorks)}</div>
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('checklist')}<h4 style="margin:0;">What to fix first?</h4></div>${lede('A long report is only useful if you know where to start. This is the order experienced auditors usually work in, and it maps directly to the priority list in your report.')}${guideGrid(fixFirst)}
<p class="prose-block">Once the technical layer is clean, go deeper: the <a href="/core-web-vitals-auditor">Core Web Vitals auditor</a> measures real loading and interaction speed, and the <a href="/broken-link-checker">broken link checker</a> verifies every link on the site.</p></div>
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('apps')}<h4 style="margin:0;">Explore the full toolkit</h4></div>${lede('Thirteen focused tools in four categories, all free, all without an account.')}<div class="toolcats">${CATEGORIES.map(cat => `<div class="toolcat"><div class="toolcat-head">${icon(cat.icon)}<h5>${cat.name}</h5></div><div class="toolcat-links">${cat.tools.map(k => { const t = TOOLS[k]; return `<a href="${t.path}"><span class="material-icons" aria-hidden="true">${t.icon}</span><span>${t.name}</span></a>`; }).join('')}</div></div>`).join('')}</div></div>
${faqSection(faqs)}`;
  return layout('Deep SEO Auditor | Free Technical SEO Audit | Huvanti', body, {
    active:'seo', canonical:'https://huvanti.com/',
    description:'Free deep SEO auditor for any public website. Crawl up to 200 pages and check technical SEO, on page elements, content, images, links and security, with a prioritised fix list. No account.',
    jsonLd:[{'@context':'https://schema.org','@type':'WebApplication',name:'Huvanti Deep SEO Auditor',applicationCategory:'SEOApplication',operatingSystem:'Any',browserRequirements:'Requires JavaScript',offers:{'@type':'Offer','price':'0','priceCurrency':'USD'},description:'Free deep technical SEO audit with content, image, performance, mobile, schema, link and security checks, up to 200 pages.'}, faqLd(faqs)]
  });
}

/* ============================== ADSENSE ============================== */
function adsensePage() {
  const faqs = [
    ['How do I know if my site is ready for AdSense?', 'Readiness comes down to a handful of things Google checks during review: enough original content, a clear purpose, the required policy pages, easy navigation and no policy risks. This checker crawls your site and scores exactly those areas, so you can fix problems before a reviewer ever sees the site.'],
    ['How many pages or posts do I need for AdSense approval?', 'There is no official minimum. In practice most approvals happen once a site has around fifteen to thirty solid pages that would satisfy a real reader. Ten thin posts are a common rejection reason, while one genuinely useful article is worth more than ten filler pages.'],
    ['How much traffic do I need for AdSense?', 'None. AdSense has no traffic requirement, which is why it is usually the first network new sites join. Traffic matters for earnings, not for approval.'],
    ['How long does AdSense approval take?', 'Usually a few days, and in busy periods up to two weeks. Google reviews the whole site, not just the homepage, which is why every page needs to be in reasonable shape before you apply.'],
    ['Why does AdSense reject sites for low value content?', 'Low value content is the most common rejection. It means the reviewer found pages with little original material: scraped or rewritten text, very short posts, pages that exist only to show ads, or topics with no clear purpose. The fix is to remove or rewrite weak pages rather than to add more of them.'],
    ['Do I need a privacy policy page for AdSense?', 'Yes. AdSense requires a privacy policy that explains how cookies and advertising are used, and it must be easy to find from anywhere on the site. An about page and a contact method are equally expected, and this checker looks for all three.'],
    ['Can a brand new site get AdSense approval?', 'Yes, though new domains face more scrutiny. Give the site a few weeks of real content first, make sure the basic pages exist, and expect that applying the day after launch rarely goes well.'],
    ['What content is not allowed on AdSense?', 'Adult content, gambling without licence, illegal downloads, hacking material, misleading claims and violent or hateful content are the headline exclusions. The policy risk screen in this checker flags the common patterns, but Google policies are the final word.'],
    ['Can I apply for AdSense with a free site or a subdomain?', 'It is possible on platforms that are AdSense partners, such as Blogspot, and you can use a subdomain of a domain you control. In both cases the same content rules apply, and a custom domain usually reviews more smoothly.'],
    ['Does this checker connect to my AdSense account?', 'No. It never asks for a login and has no way to see your account. It reads only what is public on your site and scores that evidence.'],
    ['Can I reapply to AdSense after a rejection?', 'Yes, and there is no fixed limit on retries. Fix the stated reason first, remove weak content, then reapply. Many successful publishers were rejected once or twice before approval.'],
    ['Does Google allow AI written content on AdSense sites?', 'Google evaluates usefulness, not production method. Content that is thin, unedited or mass generated tends to fail review regardless of how it was written, while clearly useful material generally passes. Editing and adding genuine value matters more than the tool used to draft.']
  ];
  const cardsList = [
    ['article','Content quality','Unique word counts after navigation and boilerplate are removed, thin or empty pages, readability and repeated phrases, judged with page type in mind.'],
    ['verified_user','Trust and transparency','Whether About, Contact, Privacy and Terms pages exist, are linked and are substantive rather than empty shells.'],
    ['gpp_maybe','Policy risk screening','Weighted checks for adult, gambling, piracy, malware and scam patterns, always shown with the matching context and never labelled as an official violation.'],
    ['touch_app','User experience','Mobile viewport, responsive styling, navigation clarity, intrusive popups, autoplay media and detectable ad density.'],
    ['build','Technical quality','HTTPS, response codes, redirects, canonical tags, robots rules, sitemap presence, titles, descriptions and broken images.'],
    ['speed','Performance signals','Response time where it can be measured, page weight, render blocking scripts, compression, cache headers and third party requests.']
  ];
  const guides = [
    ['edit_note','Build the content layer first','Approvals live and die on content. Aim for a body of work that answers real questions in your niche, written by someone who clearly knows the subject. Fifteen strong pages beat fifty rushed ones, and every page should survive the question: would a reader bookmark this?'],
    ['badge','Publish the pages reviewers expect','About, Contact and Privacy pages are not optional extras. They tell both reviewers and readers that a real person stands behind the site. Link them in the footer so they are one click from anywhere, and keep the contact page functional rather than a form that goes nowhere.'],
    ['format_paint','Make navigation boring and predictable','Reviewers land on random pages, not just the homepage. A clear menu, readable text without popup walls and a consistent layout across pages signal a cared for site. Save the creative layouts for after approval.'],
    ['block','Remove anything that looks like a shortcut','Copied articles, AI text published without editing, pages stuffed with affiliate links and downloadable content you do not own are the fastest route to a low value rejection. Delete or rewrite them before applying, not after.'],
    ['fact_check','Read the policies once, properly','Most rejections cite a policy the publisher never read. The AdSense program policies take twenty minutes and answer most questions about what is allowed, from ad placement to content restrictions.'],
    ['loop','Treat the score as a pre flight check','Run the checker, fix what it finds, then apply. If the verdict still says Needs Improvement, the report shows which category is holding you back, so you know exactly what to work on before a human reviewer arrives.']
  ];
  const body = `<section class="hero audit-home adsense-home"><span class="material-icons hero-icon" aria-hidden="true">monetization_on</span><h1>AdSense Eligibility Checker</h1><p class="hero-subtitle">See how ready your site is before Google reviews it</p>
<form id="adsense-form" class="search-field audit-search" role="search" aria-label="AdSense eligibility check"><input id="adsense-url" type="url" placeholder="https://yourwebsite.com" required aria-label="Website URL">${crawlSelect('adsense-limit','Crawl limit',['10','25','50','100','250'],'50')}<button class="btn" type="submit">Check Eligibility</button></form>
${chips([['article','Content quality'],['verified_user','Trust pages'],['gpp_maybe','Policy risk'],['touch_app','User experience'],['build','Technical'],['speed','Performance']])}</section>
<div id="adsense-results" class="audit-results adsense-results"></div>
${cards('What does the checker measure?', 'rule_folder', cardsList)}
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('tips_and_updates')}<h4 style="margin:0;">How do you get a site ready for AdSense?</h4></div>${lede('Most AdSense rejections are avoidable. These are the steps publishers who get approved on the first or second attempt tend to follow.')}${guideGrid(guides)}
<p class="prose-block">If AdSense feels like the wrong fit for your traffic level, the sister tools check the requirements of the larger networks: <a href="/ezoic-eligibility-checker">Ezoic</a>, <a href="/mediavine-eligibility-checker">Mediavine</a> and <a href="/raptive-eligibility-checker">Raptive</a>. A full <a href="/">Deep SEO audit</a> is also a sensible base before any network application.</p></div>
${faqSection(faqs)}`;
  return layout('AdSense Eligibility Checker | Free Website Readiness Score | Huvanti', body, {
    active:'adsense', canonical:'https://huvanti.com/adsense-eligibility-checker',
    description:'Free AdSense eligibility checker. Enter a URL and get a readiness score across content quality, trust pages, policy risk, user experience and technical health before you apply. No account.',
    scripts:['/assets/js/progress.js','/assets/js/common.js','/assets/js/adsense/01-util.js','/assets/js/adsense/02-crawler.js','/assets/js/adsense/03-parser.js','/assets/js/adsense/04-rules.js','/assets/js/adsense/05-analyzers.js','/assets/js/adsense/09-siteanalysis.js','/assets/js/adsense/06-scoring.js','/assets/js/adsense/07-orchestrate.js','/assets/js/adsense/08-ui.js'],
    jsonLd:[{'@context':'https://schema.org','@type':'WebApplication',name:'AdSense Eligibility Checker',applicationCategory:'BusinessApplication',operatingSystem:'Any',browserRequirements:'Requires JavaScript',offers:{'@type':'Offer','price':'0','priceCurrency':'USD'},description:'Free AdSense readiness checker that scores publicly observable website signals.'}, faqLd(faqs)]
  });
}

/* ============================== EZOIC ============================== */
function ezoicPage() {
  const faqs = [
    ['What are the requirements to join Ezoic?', 'Ezoic looks for original content, a working site with the usual policy pages, and a documented general expectation of around 250,000 monthly active users verified through Google Analytics. Requirements beyond that are about site quality rather than hard thresholds.'],
    ['Is Ezoic free to join?', 'Yes. Ezoic has a free plan where they take a share of ad revenue, plus paid tiers with lower revenue shares. Most small publishers start on the free plan and let the numbers decide later.'],
    ['Does Ezoic require a minimum traffic level?', 'Ezoic documents a general expectation of 250,000 monthly active users, checked through Analytics during application. That figure cannot be read from public pages, so this checker lists it as manual verification instead of guessing.'],
    ['How long does Ezoic approval take?', 'Typically a few days to two weeks. Applications stall most often when Analytics access is missing, so grant read access when asked and expect a quicker review.'],
    ['Can I use Ezoic with WordPress?', 'Yes, and with most other platforms. Integration happens through Cloudflare, name servers or a WordPress plugin, and the tool works the same way whichever route your host supports.'],
    ['Can I run Ezoic and AdSense together?', 'Yes, during the transition. Ezoic can mediate AdSense inventory while you test, and many publishers keep both linked for months before deciding.'],
    ['Why do Ezoic applications get rejected?', 'The usual reasons are thin or duplicated content, missing policy pages, sites that are mostly images or videos with little text, and traffic that cannot be verified. Fixing content depth and the trust pages resolves most cases.'],
    ['Does Ezoic need access to my analytics?', 'Yes, read only access to Google Analytics. They use it to verify audience size and later to report earnings against sessions. The checker flags whether a tracking install is detected, but only Ezoic can confirm it is wired correctly.'],
    ['What happens after Ezoic approves my site?', 'You integrate through Cloudflare or name servers, Ezoic tests ad placements automatically, and earnings usually start within days. Expect a testing period where revenue dips before placements learn.'],
    ['Is this checker connected to Ezoic?', 'No. It reads public signals from your site and maps them to Ezoic published guidance. The final decision always belongs to Ezoic.']
  ];
  const cardsList = [
    ['verified','Documented requirements','Each check maps to Ezoic support guidance where one exists, and anything a public crawl cannot see is listed as manual verification rather than scored.'],
    ['article','Content and uniqueness','Unique words after boilerplate removal, thin or empty page ratios, image only articles and near duplicate detection across pages.'],
    ['account_tree','Architecture crawl','Up to 250 internal pages through links, sitemaps, navigation and canonical tags, with click depth, orphans and dead ends mapped.'],
    ['verified_user','Trust and transparency','About, Contact, Privacy and Terms pages detected from URLs, titles, headings, menus and footers, then checked for substance.'],
    ['gpp_maybe','Policy risk screening','Context aware checks for adult, gambling, piracy, malware and scam signals. An isolated word is never treated as a high risk finding.'],
    ['ads_click','Monetization signals','Existing ad scripts, ads.txt presence and ad heavy thin layouts, noted as facts about the site rather than automatic rejections.']
  ];
  const guides = [
    ['insights','Where Ezoic fits','Ezoic sits between AdSense and the premium networks. It suits publishers who have outgrown manual ad management but do not yet meet the revenue or session floors of Mediavine and Raptive. If Analytics already shows solid monthly users, the fit is usually good.'],
    ['query_stats','Verify the audience question first','The one requirement public tools cannot check is monthly active users. Look at your Analytics before anything else: if the number is far below the documented expectation, spend the next quarter on growth and revisit the application later.'],
    ['edit_note','Deepen content before applying','Ezoic reviewers read the site like any other network. Pages that exist only to host ads, recycled introductions and image galleries without text are the common culprits. Rewrite the weakest pages instead of publishing new weak ones.'],
    ['link','Connect the standard pages','About, Contact and Privacy pages with real information, plus a working ads.txt once you are integrated. These are small jobs that remove easy objections.'],
    ['monitoring','Keep analytics healthy','A clean GA4 install is part of the application, not an afterthought. Check that the tag fires on every page, that key events are configured, and grant read access promptly when Ezoic asks.'],
    ['compare','Compare the networks with real numbers','Run the same site through the <a href="/mediavine-eligibility-checker">Mediavine</a>, <a href="/raptive-eligibility-checker">Raptive</a> and <a href="/adsense-eligibility-checker">AdSense</a> checkers. Seeing all four readiness reports side by side makes the sensible next step obvious.']
  ];
  const body = `<section class="hero audit-home ezoic-home"><span class="material-icons hero-icon" aria-hidden="true">paid</span><h1>Ezoic Eligibility Checker</h1><p class="hero-subtitle">Check how your site lines up with Ezoic before you apply</p>
<form id="ezoic-form" class="search-field audit-search" role="search" aria-label="Ezoic eligibility check"><input id="ezoic-url" type="url" placeholder="https://yourwebsite.com" required aria-label="Website URL">${crawlSelect('ezoic-limit','Crawl limit',['10','25','50','100','250'],'50')}<button class="btn" type="submit">Check Eligibility</button></form>
${chips([['verified','Official requirements'],['article','Content quality'],['merge_type','Duplicates'],['verified_user','Trust pages'],['gpp_maybe','Policy risk'],['ads_click','Monetization']])}</section>
<div id="ezoic-results" class="audit-results ezoic-results"></div>
${cards('What does the checker measure?', 'rule_folder', cardsList)}
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('tips_and_updates')}<h4 style="margin:0;">Getting ready for Ezoic</h4></div>${lede('Ezoic approval is mostly a content and verification exercise. This is the short version of what works.')}${guideGrid(guides)}
<p class="prose-block">A clean technical base helps every application. The <a href="/">SEO audit</a> catches the indexing and content problems that slow reviews, and the <a href="/core-web-vitals-auditor">Core Web Vitals auditor</a> confirms the site is pleasant to use, which Ezoic testing also measures indirectly.</p></div>
${faqSection(faqs)}`;
  return layout('Ezoic Eligibility Checker | Free Website Readiness Score | Huvanti', body, {
    active:'ezoic', canonical:'https://huvanti.com/ezoic-eligibility-checker',
    description:'Free Ezoic eligibility checker. See how your site scores against Ezoic requirements across content, trust pages, policy risk and technical health before you apply. No account.',
    scripts:['/assets/js/progress.js','/assets/js/common.js','/assets/js/ezoic/crawler.js','/assets/js/ezoic/ui.js'],
    jsonLd:[{'@context':'https://schema.org','@type':'WebApplication',name:'Ezoic Eligibility Checker',applicationCategory:'BusinessApplication',operatingSystem:'Any',browserRequirements:'Requires JavaScript',offers:{'@type':'Offer','price':'0','priceCurrency':'USD'},description:'Free Ezoic readiness checker that scores publicly observable website signals.'}, faqLd(faqs)]
  });
}

/* ============================== MEDIAVINE ============================== */
function mediavinePage() {
  const faqs = [
    ['What are the current Mediavine requirements?', 'Mediavine Official requires at least 5,000 US dollars in annual ad revenue, which usually means an established, traffic heavy site. Journey by Mediavine is the entry program and starts at 1,000 monthly sessions. Both programs expect original content, a good reader experience and the standard policy pages.'],
    ['What is Journey by Mediavine?', 'Journey is Mediavine program for newer and smaller sites. It opened the door to publishers far below the old traffic floor, using the same ad infrastructure and team. Many publishers treat it as the on ramp to the Official program.'],
    ['How much traffic do I need for Mediavine?', 'For Journey, 1,000 sessions a month is the documented floor. For Mediavine Official the bar is revenue based rather than session based: 5,000 dollars in annual ad revenue. The old 50,000 sessions figure is outdated and no longer the requirement.'],
    ['How long does Mediavine approval take?', 'Usually one to three weeks. Applications are reviewed by people who visit the site, so content quality and reader experience genuinely matter, not just numbers.'],
    ['Does Mediavine require a privacy policy?', 'Yes, along with an about page and a way to contact you. Like all major networks, Mediavine expects clear disclosure pages, and GDPR and CCPA compliance come with the territory once you run their ads.'],
    ['Which platforms does Mediavine support?', 'WordPress is the comfortable default and most publishers run it, but Mediavine also works with other platforms that allow script insertion. If you cannot add scripts to your template, integration becomes the blocker.'],
    ['What content does Mediavine not accept?', 'Mediavine is brand safety focused. Adult content, unlicensed medical or financial advice, misinformation, harmful niches and scraped or spun content are out. Recipe and lifestyle publishers make up much of the network, but any people first content niche can fit.'],
    ['Does Mediavine accept AI generated content?', 'Mediavine asks for content created with human involvement and first hand experience. Mass generated, unedited articles fail that bar, while AI assisted drafts that a knowledgeable author substantially shapes generally do not.'],
    ['How much can a site earn with Mediavine?', 'Earnings scale with sessions, geography and niche. Food and home publishers often quote RPMs in the ten to thirty dollar range in strong seasons, though numbers swing by month and by site. Mediavine publishes no earnings guarantee, and neither does this tool.'],
    ['Mediavine or AdSense, which should a smaller site use?', 'Below Journey levels, AdSense is the natural choice. Once a site clears roughly 1,000 sessions a month, Journey usually pays better for the same traffic thanks to programmatic demand. Many publishers run AdSense until they qualify, then switch.'],
    ['Is this checker affiliated with Mediavine?', 'No. It scores your site against Mediavine published requirements and reports what a public crawl can verify. Mediavine makes every actual decision.']
  ];
  const cardsList = [
    ['verified','Two programs, scored separately','The report applies the Official and Journey requirements independently, so you see which program your site is closest to.'],
    ['article','Original content analysis','Unique text after boilerplate removal, thin and empty ratios, and near duplicate detection with the evidence shown per pair.'],
    ['gpp_maybe','Brand safety screening','Context aware checks across adult, drugs, gambling, weapons, hate, piracy and fraud categories, scored with confidence levels.'],
    ['touch_app','Reader experience','Viewport and responsiveness, navigation clarity, intrusive overlays, sticky elements, horizontal overflow and content obstruction.'],
    ['account_tree','Deep architecture crawl','Up to 250 internal pages discovered through links, sitemaps, menus, breadcrumbs and canonicals, with depth and orphan reporting.'],
    ['fact_check','Honest about private data','Revenue and session counts are private, so they appear in a dedicated verification panel and are excluded from the score rather than estimated.']
  ];
  const guides = [
    ['route','Pick the right track','If your analytics show around a thousand sessions a month, aim at Journey. If you already earn near five thousand dollars a year from ads, aim at Official. The checker asks which program you care about and scores against it, because the preparation differs.'],
    ['edit_note','Write for readers first','Mediavine reviewers are editors at heart. First hand experience, original photos, clear structure and answers that leave the reader satisfied are what get sites in. Content written to rank rather than to help is the most common weakness they see.'],
    ['smartphone','Fix the reading experience','Mobile sessions dominate lifestyle traffic. Kill intrusive popups, keep paragraphs readable, ensure tap targets are comfortable and check that nothing shifts while the page loads.'],
    ['speed','Get speed respectable','Ad scripts slow every site, so the base has to be fast before ads land. Compress images, enable caching and remove abandoned plugins. The <a href="/core-web-vitals-auditor">Core Web Vitals auditor</a> gives exact numbers if you want them.'],
    ['badge','Prepare the paperwork','About, Contact, Privacy and affiliate disclosure pages, plus a clean GDPR and CCPA setup once accepted. Reviewers check these, and so does the checker.'],
    ['trending_up','Grow sessions deliberately','Journey starts at 1,000 sessions but earnings feel real closer to 10,000. Double down on the posts that already earn traffic, refresh the rest, and let internal links from strong pages lift the weak ones. The <a href="/">SEO audit</a> shows which pages have that untapped potential.']
  ];
  const body = `<section class="hero audit-home mediavine-home"><span class="material-icons hero-icon" aria-hidden="true">savings</span><h1>Mediavine Eligibility Checker</h1><p class="hero-subtitle">Score your site against Mediavine Official and Journey</p>
<form id="mediavine-form" class="search-field audit-search" role="search" aria-label="Mediavine eligibility check"><input id="mediavine-url" type="url" placeholder="https://yourwebsite.com" required aria-label="Website URL"><select id="mediavine-program" class="crawl-select" aria-label="Program"><option value="both" selected>Both programs</option><option value="official">Mediavine Official</option><option value="journey">Journey by Mediavine</option></select>${crawlSelect('mediavine-limit','Crawl limit',['10','25','50','100','250'],'50')}<button class="btn" type="submit">Check Eligibility</button></form>
${chips([['verified','Official and Journey'],['article','Original content'],['gpp_maybe','Brand safety'],['touch_app','Reader experience'],['build','Technical'],['verified_user','Trust pages']])}</section>
<div id="mediavine-results" class="audit-results mediavine-results"></div>
${cards('What does the checker measure?', 'rule_folder', cardsList)}
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('tips_and_updates')}<h4 style="margin:0;">Preparing a site for Mediavine</h4></div>${lede('Mediavine reviews sites the way a magazine editor would. These are the areas that decide most applications.')}${guideGrid(guides)}
<p class="prose-block">Not sure which network fits your stage? Compare with the <a href="/adsense-eligibility-checker">AdSense</a>, <a href="/ezoic-eligibility-checker">Ezoic</a> and <a href="/raptive-eligibility-checker">Raptive</a> checkers, and run a full <a href="/">SEO audit</a> first so technical issues never reach a reviewer.</p></div>
${faqSection(faqs)}`;
  return layout('Mediavine Eligibility Checker | Free Website Readiness Score | Huvanti', body, {
    active:'mediavine', canonical:'https://huvanti.com/mediavine-eligibility-checker',
    description:'Free Mediavine eligibility checker. Score your site against Journey and Mediavine Official requirements across content, brand safety, reader experience and technical health. No account.',
    scripts:['/assets/js/progress.js','/assets/js/common.js','/assets/js/mediavine/crawler.js','/assets/js/mediavine/ui.js'],
    jsonLd:[{'@context':'https://schema.org','@type':'WebApplication',name:'Mediavine Eligibility Checker',applicationCategory:'BusinessApplication',operatingSystem:'Any',browserRequirements:'Requires JavaScript',offers:{'@type':'Offer','price':'0','priceCurrency':'USD'},description:'Free Mediavine readiness checker that scores publicly observable website signals.'}, faqLd(faqs)]
  });
}

/* ============================== RAPTIVE ============================== */
function raptivePage() {
  const faqs = [
    ['What are the requirements to join Raptive?', 'The published bar is at least 25,000 monthly pageviews measured over the last 30 days in Google Analytics, a domain at least six months old, a GA4 install with read access granted, original content with clear human involvement and a site that is ready to show ads. Geography also matters.'],
    ['How many pageviews do you need for Raptive?', 'The documented minimum is 25,000 pageviews a month. It replaced the old 100,000 pageview requirement, which is now just a higher tier with a lower key country share.'],
    ['Which countries does Raptive accept traffic from?', 'Raptive requires most traffic to come from its key markets: the United States, the United Kingdom, Canada, Australia and New Zealand. At 25,000 to 99,999 pageviews the combined share from those countries must be at least half. At 100,000 pageviews or more it must be at least forty percent.'],
    ['Is Raptive the same company as AdThrive?', 'Yes. AdThrive rebranded to Raptive in 2023. Same team, same standards, new name.'],
    ['How long does Raptive approval take?', 'Usually one to two weeks after you grant Analytics access. Applications move faster when the GA4 property is clean and the site clearly meets the pageview floor.'],
    ['Does Raptive require Google Analytics?', 'Yes. GA4 with read only access granted to Raptive is part of the application, because pageviews and geography are verified from your Analytics rather than self reported.'],
    ['Does Raptive accept AI generated content?', 'Raptive looks for human involvement and demonstrable expertise. Content that is mass produced without editing or first hand knowledge fails that expectation, while drafts a real author shapes with experience and original insight are viewed on their merits.'],
    ['Can a new site join Raptive?', 'Rarely. The six month domain age rule and the 25,000 pageview floor both push brand new sites toward AdSense, Ezoic or Journey first, with Raptive as the destination once traffic and content depth arrive.'],
    ['Raptive or Mediavine, which should I aim for?', 'They compete for the same premium tier. Raptive uses a pageview floor of 25,000, while Mediavine Official is revenue based at 5,000 dollars a year and Journey starts at 1,000 sessions. Publishers often apply to whichever threshold they already cross, and both reviews reward the same fundamentals.'],
    ['Does this checker submit anything to Raptive?', 'No. It reads your site and, only if you type them in, compares numbers you supply against the published thresholds. Raptive sees nothing until you apply yourself.']
  ];
  const cardsList = [
    ['verified','Current requirements','The 25,000 pageview minimum, the key country share rules, the six month domain age and the GA4 expectation, each scored against what a public crawl can honestly verify.'],
    ['article','Originality analysis','Unique text after boilerplate removal, duplicate and near duplicate pairs, and content depth on the pages where long form material belongs.'],
    ['person','Human involvement signals','Author presence, first hand detail, sourcing and editorial identity, reported as patterns with evidence rather than verdicts.'],
    ['analytics','Analytics and domain age','Whether a GA4 or tag manager install is detected, kept strictly separate from whether the configuration is verified, plus RDAP domain age where the registry exposes it.'],
    ['gpp_maybe','Brand safety','The same context aware screening used across our network checkers: adult, drugs, gambling, weapons, hate, piracy and fraud categories with confidence levels.'],
    ['campaign','Ad readiness','Existing ad scripts, ads.txt, layout density and whether the build can host premium placements without wrecking the reader experience.']
  ];
  const guides = [
    ['query_stats','Verify pageviews and geography first','Open GA4 and check two numbers before anything else: pageviews for the last 30 days, and the combined share of US, UK, Canadian, Australian and New Zealand sessions. If either is below the bar, that is the work, and no amount of site polish changes it.'],
    ['edit_note','Show who made the content','Raptive cares about human involvement. Named authors, short bios with real credentials, original photos and first hand notes inside articles are the signals. Remove anything that reads like it was stamped out by a template.'],
    ['history','Mind the six month clock','Domain age is checked from registration records. If your domain is young, use the waiting months to deepen content: it is the most productive waiting list there is.'],
    ['speed','Prepare a premium layout','Premium ads need a stable, quick site. Fix layout shift and slow images before applying, because the same page will carry heavier ad code afterwards. The <a href="/core-web-vitals-auditor">Core Web Vitals auditor</a> measures exactly this.'],
    ['link','Build internal authority','Large sites live on internal links. Make sure money pages are reachable within a few clicks and that older strong posts link forward to newer work. The <a href="/">SEO audit</a> maps click depth and orphan pages for you.'],
    ['compare','Benchmark against the alternatives','Run the <a href="/mediavine-eligibility-checker">Mediavine</a> and <a href="/ezoic-eligibility-checker">Ezoic</a> checkers on the same crawl. The overlap in their reports is the genuine work list, whichever network you choose.']
  ];
  const body = `<section class="hero audit-home raptive-home"><span class="material-icons hero-icon" aria-hidden="true">campaign</span><h1>Raptive Eligibility Checker</h1><p class="hero-subtitle">See how your site scores against current Raptive requirements</p>
<form id="raptive-form" class="search-field audit-search" role="search" aria-label="Raptive eligibility check"><input id="raptive-url" type="url" placeholder="https://yourwebsite.com" required aria-label="Website URL">${crawlSelect('raptive-limit','Crawl limit',['10','25','50','100','250'],'50')}<button class="btn" type="submit">Check Eligibility</button></form>
<details class="raptive-optional container"><summary>Optional: add verified Analytics figures</summary>
<div class="raptive-optional-grid">
<label>Monthly pageviews <input id="raptive-pageviews" class="text-input" type="number" min="0" step="1" placeholder="32000" inputmode="numeric"></label>
<label>US % <input id="raptive-us" class="text-input" type="number" min="0" max="100" step="0.1" placeholder="%"></label>
<label>UK % <input id="raptive-uk" class="text-input" type="number" min="0" max="100" step="0.1" placeholder="%"></label>
<label>Canada % <input id="raptive-ca" class="text-input" type="number" min="0" max="100" step="0.1" placeholder="%"></label>
<label>Australia % <input id="raptive-au" class="text-input" type="number" min="0" max="100" step="0.1" placeholder="%"></label>
<label>New Zealand % <input id="raptive-nz" class="text-input" type="number" min="0" max="100" step="0.1" placeholder="%"></label>
</div>
<p class="muted">Figures you enter are labelled as user provided and compared with the published thresholds: half of traffic from the US, UK, Canada, Australia and New Zealand at 25,000 to 99,999 pageviews, or forty percent at 100,000 and above. Leave blank if you prefer.</p>
</details>
${chips([['verified','Official requirements'],['article','Original content'],['person','Human involvement'],['analytics','Analytics'],['history','Domain age'],['gpp_maybe','Brand safety']])}</section>
<div id="raptive-results" class="audit-results raptive-results"></div>
${cards('What does the checker measure?', 'rule_folder', cardsList)}
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('tips_and_updates')}<h4 style="margin:0;">Preparing a site for Raptive</h4></div>${lede('Raptive is a premium network, and the review reflects that. Here is what actually moves applications.')}${guideGrid(guides)}
<p class="prose-block">Every network checker on Huvanti uses the same crawl engine, so results are comparable. See also the <a href="/adsense-eligibility-checker">AdSense</a> and <a href="/ezoic-eligibility-checker">Ezoic</a> checkers, or start with a full <a href="/">SEO audit</a>.</p></div>
${faqSection(faqs)}`;
  return layout('Raptive Eligibility Checker | Free Website Readiness Score | Huvanti', body, {
    active:'raptive', canonical:'https://huvanti.com/raptive-eligibility-checker',
    description:'Free Raptive eligibility checker. Score your site against the current 25,000 pageview requirement, key country rules, content and human involvement signals. No account.',
    scripts:['/assets/js/progress.js','/assets/js/common.js','/assets/js/raptive/crawler.js','/assets/js/raptive/ui.js'],
    jsonLd:[{'@context':'https://schema.org','@type':'WebApplication',name:'Raptive Eligibility Checker',applicationCategory:'BusinessApplication',operatingSystem:'Any',browserRequirements:'Requires JavaScript',offers:{'@type':'Offer','price':'0','priceCurrency':'USD'},description:'Free Raptive readiness checker that scores publicly observable website signals.'}, faqLd(faqs)]
  });
}
/* ============================== WORDPRESS THEME DETECTOR ============================== */
function wpthemePage() {
  const faqs = [
    ['How do I find out what theme a website is using?', 'The fastest honest way is to look at the page source and search for wp-content/themes, because WordPress loads every theme file from that folder. This detector does the same automatically and then verifies the theme by reading its style.css header, so the answer comes with evidence rather than a guess.'],
    ['Why can the detector not read some sites?', 'Caching layers can rename asset paths, CDNs can rewrite URLs, and security layers can block automated readers entirely. When that happens the tool says so instead of inventing a name, and it reports whatever partial evidence it could collect.'],
    ['Can I also detect which plugins a site uses?', 'Sometimes, incidentally, from script and asset paths, but reliable plugin detection is a different problem and this tool does not claim it. The report focuses on the theme because that is what the public evidence supports.'],
    ['What is a child theme?', 'A child theme inherits everything from a parent theme and overrides selected files, which is the safe way to customise a design without losing changes on updates. The detector identifies child themes from the Template field and then resolves the parent by name.'],
    ['How do I find the theme on my own WordPress site?', 'In the dashboard open Appearance and then Themes, where the active theme is highlighted. The detector is mainly useful for sites you do not manage, or to check what the public can see about your own install.'],
    ['Does it work on block themes and newer WordPress versions?', 'Yes. Block themes still ship a style.css with the standard header, so name, author and version detection works the same way.'],
    ['Can I download a premium theme the detector finds?', 'No. Premium themes such as Divi or Avada are licensed, and copies circulating for free are both illegal and a common malware vector. The detector links to the official marketplace instead.'],
    ['Why does the version sometimes say appears to be?', 'Exact versions come from the theme header. When the only clue is a version query string on an asset URL, the tool reports it as an estimate, and when the header hides the version it says the version is not publicly detectable. No number is invented.'],
    ['Is knowing another site theme actually useful?', 'It is one input among many. Seeing which theme a successful site in your niche runs tells you what performance and layout baselines are proven there, but design success comes from content and customisation, not from the theme name alone.'],
    ['Are the URLs I check recorded anywhere?', 'No. Scans run from your browser and nothing is stored on a server. See the privacy page for the full picture.']
  ];
  const cardsList = [
    ['verified','WordPress detection','Weighted signals from asset paths, generator tags, REST endpoints and headers. A single weak clue is never enough on its own.'],
    ['search','Theme path discovery','Homepage markup, stylesheets, scripts and feeds are scanned for the theme folder path before any theme is named.'],
    ['description','style.css verification','The theme header that WordPress itself reads is parsed for name, version, author, licence and template fields.'],
    ['account_tree','Child and parent themes','A Template field proves a child theme, and the parent is then read directly rather than guessed from looks.'],
    ['fingerprint','Fingerprint database','Popular free and premium themes such as Astra, GeneratePress, Kadence, Divi and Avada are recognised from multiple distinct markers.'],
    ['history','Honest version reporting','Exact versions, estimated versions and hidden versions are labelled as exactly what they are, with no vulnerability claims attached.']
  ];
  const guides = [
    ['travel_explore','How to read the report','Every claim links to the evidence that produced it: the stylesheet URL, the header fields, the matching fingerprints. If the evidence is thin, the verdict says Likely rather than Detected, and that distinction is the whole point of the tool.'],
    ['palette','Use themes as research, not recipes','A theme that carries a leading publication is proven to scale, which is useful knowledge. The same site also invested in photography, layout and speed, so copy the standards rather than the product.'],
    ['lock','What your own theme reveals','Run the detector on your own site to see what the public can learn: theme name, version, author. Site owners who want a quieter footprint can remove version strings or rename asset paths, and this report shows exactly what is exposed today.'],
    ['speed','Theme choice and speed','Lightweight themes such as Astra, GeneratePress and Kadence dominate performance comparisons for a reason. If a candidate theme feels heavy in demo form, it will feel heavier with your content. Pair any choice with a run of the <a href="/core-web-vitals-auditor">Core Web Vitals auditor</a>.'],
    ['dns','Dig further with the other tools','Once you know the stack, the <a href="/domain-information-checker">domain information checker</a> shows hosting, DNS and certificates behind the site, and the <a href="/">SEO audit</a> scores the content itself.']
  ];
  const body = `<section class="hero audit-home wptheme-home"><span class="material-icons hero-icon" aria-hidden="true">palette</span><h1>WordPress Theme Detector</h1><p class="hero-subtitle">Find the active WordPress theme behind any public site</p>
<form id="wptheme-form" class="search-field audit-search" role="search" aria-label="WordPress theme detection"><input id="wptheme-url" type="text" inputmode="url" autocomplete="url" spellcheck="false" placeholder="https://example.com" required aria-label="Website URL"><button class="btn" type="submit">Detect Theme</button></form>
${chips([['wordpress','Theme name and slug'],['history','Version'],['account_tree','Child and parent'],['fingerprint','Fingerprints'],['verified','Evidence based']])}</section>
<div id="wptheme-results" class="audit-results wptheme-results"></div>
${cards('How does detection work?', 'rule_folder', cardsList)}
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('tips_and_updates')}<h4 style="margin:0;">Getting value from theme detection</h4></div>${lede('A theme name is a starting point, not an answer. Here is how experienced builders use that information.')}${guideGrid(guides)}
<p class="prose-block">Detection is one page of the picture. A full <a href="/">Deep SEO audit</a> of the same site shows how well the theme is actually configured, and the <a href="/broken-link-checker">broken link checker</a> confirms the maintenance discipline behind it.</p></div>
${faqSection(faqs)}`;
  return layout('WordPress Theme Detector | Find the Theme Behind Any Site | Huvanti', body, {
    active:'wptheme', canonical:'https://huvanti.com/wordpress-theme-detector',
    description:'Free WordPress theme detector. Enter a URL to identify the active theme, version, author and parent theme from public evidence, with confidence shown for every claim. No account.',
    scripts:['/assets/js/progress.js','/assets/js/common.js','/assets/js/wptheme/collector.js','/assets/js/wptheme/ui.js'],
    jsonLd:[{'@context':'https://schema.org','@type':'WebApplication',name:'WordPress Theme Detector',applicationCategory:'DeveloperApplication',operatingSystem:'Any',browserRequirements:'Requires JavaScript',offers:{'@type':'Offer','price':'0','priceCurrency':'USD'},description:'Free WordPress theme detector that reads only publicly observable evidence.'}, faqLd(faqs)]
  });
}

/* ============================== DOMAIN INFO ============================== */
function domainInfoPage() {
  const faqs = [
    ['How can I find out who hosts a website?', 'Look up the A record to get the IP address, then resolve which network owns that IP range through BGP data. The catch is CDNs: when a site sits behind Cloudflare or similar, the visible network is the CDN, not the host, and this tool reports both facts separately instead of presenting the CDN as the host.'],
    ['How do I find out where a domain is registered?', 'The registry record, fetched through RDAP or WHOIS, lists the registrar of record. The report shows the registrar name, the IANA identifier when published, and the registration and expiry dates that come with it.'],
    ['How can I tell if a domain name is available?', 'A registry answer of no record found means the domain is not registered and is likely available. A registration record means it is taken. Anything ambiguous, such as a rate limit or a registry delay, is reported as unverifiable rather than guessed.'],
    ['How do I check the age of a domain?', 'Age is calculated from the official registration date in the registry record, shown in years, months and days with a timeline. If privacy rules or the TLD hide the date, the report says the age is not publicly available rather than estimating it.'],
    ['Why is so much WHOIS information hidden?', 'Privacy rules such as GDPR led registrars to redact registrant names, addresses and emails by default. The checker reports whether a domain uses privacy protection and nothing more, because the hidden details are private by design.'],
    ['What is RDAP and how is it different from WHOIS?', 'RDAP is the modern registry protocol that returns structured data over HTTPS, and it is gradually replacing the old WHOIS service. This tool tries RDAP first and falls back to WHOIS where a registry has not adopted it yet.'],
    ['What is DNSSEC and should I enable it?', 'DNSSEC adds cryptographic signatures to DNS answers so a resolver can prove the response is genuine. It protects against DNS spoofing. Enabling it is a one time setting at your registrar and DNS provider, and the report shows whether your domain currently has it.'],
    ['How do I check my SSL certificate expiry?', 'The certificate panel shows the issuer, the validity window and the days remaining before expiry. If you run a site, renewals belong in a calendar with margin, because an expired certificate takes a site offline for most visitors.'],
    ['What are MX, SPF and DMARC records?', 'MX records say which servers receive mail for the domain. SPF lists which servers may send its mail, and DMARC tells receiving providers what to do when a message fails those checks. Together they are the baseline of email deliverability and spoofing protection, and the report reads all three.'],
    ['Why does my site show Cloudflare instead of my host?', 'Because a CDN answers requests first and hides the origin. Public data genuinely cannot see behind it. The report separates CDN from origin hosting and labels the origin as not publicly determinable when that is the truth.'],
    ['Can someone find my personal details through this tool?', 'No. The tool reads registry and DNS data and never displays redacted personal data, even where some legacy WHOIS servers still expose it.'],
    ['Is the data from this checker live?', 'Yes. Lookups run at query time against registry, DNS and certificate sources, with the source and a timestamp shown beside each value. Nothing is served from a stale database.']
  ];
  const cardsList = [
    ['assignment','Registration data','Registrar, dates, EPP statuses explained in plain language and registry source shown for every value.'],
    ['storage','DNS records','A, AAAA, CNAME, MX, NS, TXT, CAA, SOA, SRV, DS and DNSKEY records with a calm health summary.'],
    ['router','Hosting and network','IP, network owner from BGP data and reverse DNS, with CDN and origin hosting kept clearly separate.'],
    ['lock','SSL and HTTP','Certificate issuer, validity and hostname match, plus response status, redirects, HSTS and cache headers.'],
    ['mail','Email infrastructure','MX servers and provider, SPF and DMARC policies, and DKIM checks for common selectors only.'],
    ['memory','Technology fingerprints','Heuristic detection of WordPress, Shopify, Wix, Next.js, React, Laravel and more, always with confidence attached.']
  ];
  const guides = [
    ['timeline','Read the timeline first','Registration, last update, today and expiry in one line tells a story: a domain registered last month behind a corporate claim deserves different trust than one renewed steadily for a decade. Age is not virtue by itself, but it is context.'],
    ['verified_user','Use it before you buy or partner','Checking a domain before a purchase or a partnership answers quiet questions: who runs it, how long has it existed, is the certificate healthy, is email properly configured. Five minutes here prevents expensive lessons later.'],
    ['dns','Audit your own DNS setup','The DNS panel is a free configuration review. Missing AAAA is fine, but a broken SPF, a missing DMARC record or DNSSEC left off are small fixes with real security value.'],
    ['lock','Watch certificate expiry','Certificates expire at the least convenient time. When the report shows under three weeks of validity, put the renewal in your calendar today, and check whether your host auto renews at all.'],
    ['mail','Fix email deliverability at the source','If your newsletter lands in spam, the email panel shows the usual suspects: no SPF, no DMARC, or mail servers that do not match. Fix the DNS side before blaming the content.'],
    ['hub','Pair it with the site level tools','The domain report covers infrastructure. For the site itself, run the <a href="/">SEO audit</a>, the <a href="/wordpress-theme-detector">theme detector</a> and the <a href="/core-web-vitals-auditor">performance auditor</a> to review what visitors actually experience.']
  ];
  const body = `<section class="hero audit-home domaincheck-home"><span class="material-icons hero-icon" aria-hidden="true">dns</span><h1>Domain Information Checker</h1><p class="hero-subtitle">Registration, DNS, hosting, SSL and email records in one report</p>
<form id="domaincheck-form" class="search-field audit-search" role="search" aria-label="Domain information check"><input id="domaincheck-url" type="text" inputmode="url" autocomplete="url" spellcheck="false" placeholder="example.com or https://example.com" required aria-label="Domain name or URL"><button class="btn" type="submit">Check Domain</button></form>
${chips([['assignment','RDAP and WHOIS'],['storage','DNS and DNSSEC'],['router','Hosting and ASN'],['lock','SSL and TLS'],['mail','Email security'],['verified','Evidence based']])}</section>
<div id="domaincheck-results" class="audit-results domaincheck-results"></div>
${cards('What does the report cover?', 'rule_folder', cardsList)}
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('tips_and_updates')}<h4 style="margin:0;">Reading a domain report well</h4></div>${lede('Domain data answers questions that a website deliberately or accidentally leaves open. These habits get the most out of it.')}${guideGrid(guides)}
<p class="prose-block">Curious what a full site review covers beyond infrastructure? Start with the <a href="/">SEO audit</a>, then check accessibility of every link with the <a href="/broken-link-checker">broken link checker</a>.</p></div>
${faqSection(faqs)}`;
  return layout('Domain Information Checker | DNS, WHOIS, SSL and Hosting | Huvanti', body, {
    active:'domaincheck', canonical:'https://huvanti.com/domain-information-checker',
    description:'Free domain information checker. Registration and WHOIS data, DNS records, hosting and CDN detection, SSL certificate, email security and domain age in one report. No account.',
    scripts:['/assets/js/progress.js','/assets/js/common.js','/assets/js/domaincheck/ui.js'],
    jsonLd:[{'@context':'https://schema.org','@type':'WebApplication',name:'Domain Information Checker',applicationCategory:'DeveloperApplication',operatingSystem:'Any',browserRequirements:'Requires JavaScript',offers:{'@type':'Offer','price':'0','priceCurrency':'USD'},description:'Free domain intelligence tool reporting only publicly verifiable data.'}, faqLd(faqs)]
  });
}

/* ============================== XML SITEMAP GENERATOR ============================== */
function sitemapPage() {
  const faqs = [
    ['What is an XML sitemap?', 'It is a file that lists the URLs you want search engines to know about, in a fixed XML format that crawlers understand. Think of it as a table of contents for robots: it does not force indexing, but it makes discovery easier, especially for new or large sites.'],
    ['Does my website need a sitemap?', 'Google recommends one for large sites, new sites with few external links, sites with poorly linked pages and sites with rich media. A small blog with clean navigation can rank fine without one, but since a sitemap costs nothing, most sites keep one anyway.'],
    ['Where do I put the sitemap file?', 'At the root of your domain, so its address is yoursite.com/sitemap.xml. That is where crawlers look first. Reference the same address in robots.txt so every engine finds it.'],
    ['How do I submit a sitemap to Google?', 'Add your property in Google Search Console, open the Sitemaps section, enter the file name and press Submit. Submission is a hint that speeds discovery; Google still decides what to index.'],
    ['How many URLs can one sitemap contain?', 'The protocol limit is 50,000 URLs or 50 megabytes per file, whichever comes first. Larger sites split the list across several sitemaps tied together by a sitemap index file, which this generator can produce automatically.'],
    ['Should noindex pages be in a sitemap?', 'No. A sitemap should contain pages you want indexed, and listing a noindex page sends mixed signals. The generator excludes noindex URLs, redirects and non canonical pages by default and tells you why each URL was excluded.'],
    ['Does a sitemap improve rankings?', 'Not directly. It helps search engines find and recrawl your pages, which indirectly helps new content get indexed faster. Rankings still depend on content quality, relevance and links.'],
    ['What is the difference between sitemap.xml and robots.txt?', 'robots.txt tells crawlers what they may not access and points to your sitemap. The sitemap lists what you want discovered. You need the sitemap reference inside robots.txt, but the files do different jobs.'],
    ['How often should I update my sitemap?', 'Whenever you publish or remove pages. WordPress does this automatically. For static sites, regenerate after meaningful changes, or schedule it, and keep lastmod values truthful because Google discounts stale or fake dates.'],
    ['Does Google use the lastmod date?', 'Google has said it uses lastmod for recrawl scheduling when the value is consistently accurate. Faking fresh dates to trigger crawls is detected and ignored, so only publish real modification times.'],
    ['Does WordPress create a sitemap automatically?', 'Yes, since version 5.5 WordPress ships a basic sitemap at wp-sitemap.xml. Plugins extend it with better exclusion controls. You can also generate a fresh one here to audit what your current sitemap actually exposes.'],
    ['What does Analyze Existing Sitemap mode do?', 'Point it at your current sitemap file and it checks every listed URL: broken ones, redirects, duplicates, non canonical and noindex entries that should not be there, then scores the file health.']
  ];
  const cardsList = [
    ['security','Safe crawler','Public URLs only, with private addresses, unsafe redirects and oversized responses refused, and robots.txt respected.'],
    ['rule','Indexability rules','Response codes, canonical tags, noindex directives and robots rules are checked before any URL is included.'],
    ['fact_check','Existing sitemap analysis','A health score for your current file: broken URLs, redirects, duplicates, non canonical pages and structural XML problems.'],
    ['code','Standards compliant XML','The sitemap protocol namespace, correctly escaped locations, reliable lastmod values only, and automatic splitting with an index for large sites.'],
    ['image','Optional image sitemap','Image URLs associated with each page can be included, filtered to real content images rather than icons and trackers.'],
    ['table_view','Transparent URL explorer','Every crawled URL with its status, canonical target, inclusion decision and the exact reason for any exclusion.']
  ];
  const guides = [
    ['rule','Include what deserves indexing','A good sitemap is a curated list, not a dump. Product pages, posts, categories and key landing pages belong in it. Tag archives, search result pages, filtered faceted URLs and thin utility pages dilute it and are better excluded, which this generator does by default.'],
    ['content_cut','One URL, one canonical entry','Each page should appear once, in its canonical form, without parameters and duplicate trailing slash variants. The generator normalises and deduplicates before writing the file, so you ship one clean list.'],
    ['event_repeat','Keep it honest and current','An outdated sitemap wastes crawler attention on dead URLs. Regenerate after removing pages, and when you analyse your existing file here, fix every broken and redirected entry it reports before resubmitting.'],
    ['anchor','Connect it to robots.txt','One line, Sitemap: https://yoursite.com/sitemap.xml, makes the file discoverable to every major crawler, not only the one where you submitted it. The generator reminds you of the exact line to add.'],
    ['monitoring','Submit, then verify coverage','After submitting in Search Console, watch the Pages report for coverage. If indexed counts sit far below submitted counts, the URL explorer shows which entries were excluded and why, which is usually the whole story.'],
    ['hub','Pair with the related generators','Many sites publish a feed alongside a sitemap. The <a href="/rss-feed-generator">RSS feed generator</a> and the <a href="/llms-txt-generator">LLMs.txt generator</a> cover the other discovery formats from the same crawl, and the <a href="/broken-link-checker">broken link checker</a> verifies what the sitemap points at.']
  ];
  const body = `<section class="hero audit-home sitemap-home"><span class="material-icons hero-icon" aria-hidden="true">account_tree</span><h1>XML Sitemap Generator</h1><p class="hero-subtitle">Generate a clean sitemap or audit the one you already have</p>
<form id="sitemap-form" class="sitemap-form" aria-label="XML sitemap generator">
  <div class="mode-tabs" role="radiogroup" aria-label="Mode"><label><input type="radio" name="sitemap-mode" value="generate" checked> Generate New Sitemap</label><label><input type="radio" name="sitemap-mode" value="analyze"> Analyze Existing Sitemap</label></div>
  <div class="search-field audit-search"><input name="url" id="sitemap-url" type="text" inputmode="url" autocomplete="url" spellcheck="false" placeholder="https://example.com" required aria-label="Website or sitemap URL"><button class="btn" type="submit">Generate Sitemap</button></div>
  <details class="sitemap-options sitemap-advanced"><summary>${icon('tune')} Advanced crawl settings</summary>
    <div class="sitemap-option-row"><label>Maximum URLs <select name="maxUrls" class="select"><option value="100">100</option><option value="500" selected>500</option><option value="1000">1,000</option><option value="5000">5,000</option></select></label><label>Crawl depth <select name="depth" class="select"><option value="1">1</option><option value="2">2</option><option value="3" selected>3</option><option value="5">5</option></select></label><label><input type="checkbox" name="includeImages"> Include images</label></div>
  </details>
</form>
${chips([['rule','Robots respected'],['link','Canonicals checked'],['do_not_disturb_on','Noindex excluded'],['code','XML validated'],['download','Download ready']])}</section>
<div id="sitemap-results" class="audit-results sitemap-results"></div>
${cards('What does the generator do?', 'verified', cardsList)}
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('tips_and_updates')}<h4 style="margin:0;">Building a sitemap that helps</h4></div>${lede('A sitemap is easy to generate and easy to get wrong. These are the practices that separate a useful file from a noisy one.')}${guideGrid(guides)}
<p class="prose-block">Before generating, a quick <a href="/">SEO audit</a> will surface the redirect and canonical problems that decide which URLs belong in the file at all.</p></div>
${faqSection(faqs)}`;
  return layout('XML Sitemap Generator | Free Crawl, Validate and Download | Huvanti', body, {
    active:'sitemap', canonical:'https://huvanti.com/xml-sitemap-generator',
    description:'Free XML sitemap generator. Crawl a public website, respect robots.txt, exclude noindex and non canonical URLs, validate the XML and download a standards compliant sitemap. No account.',
    scripts:['/assets/js/progress.js','/assets/js/common.js','/assets/js/sitemap/browser.js','/assets/js/sitemap/ui.js'],
    jsonLd:[{'@context':'https://schema.org','@type':'WebApplication',name:'XML Sitemap Generator',applicationCategory:'DeveloperApplication',operatingSystem:'Any',browserRequirements:'Requires JavaScript',offers:{'@type':'Offer','price':'0','priceCurrency':'USD'},description:'Free XML sitemap generator and analyzer.'}, faqLd(faqs)]
  });
}

/* ============================== BROKEN LINK CHECKER ============================== */
function brokenlinkPage() {
  const faqs = [
    ['How do I find broken links on my website?', 'Use a crawler that follows every link and records the response. This checker crawls your pages, verifies each destination, retries uncertain answers and classifies every link, so you get a confirmed list rather than a pile of timeouts.'],
    ['Do broken links hurt SEO?', 'Indirectly but really. Broken internal links waste crawl budget and block authority from flowing, and broken outbound links frustrate readers, which shows up in engagement. Google does not run a specific broken link penalty, but the effects compound.'],
    ['What is the difference between a 404 and a soft 404?', 'A hard 404 returns the proper status code. A soft 404 returns a 200 with a not found page, which crawlers must guess at from content. Soft 404s are worse for crawlers because the status code lies, and they usually come from rewrite rules that catch everything.'],
    ['Should I redirect or fix a broken link?', 'If the target moved, redirect it with a 301 to the closest equivalent page. If the target is gone for good, update the linking page to point somewhere genuinely useful, or remove the link. Redirecting everything to the homepage is the classic mistake to avoid.'],
    ['How many broken links are acceptable?', 'There is no fixed threshold, but the honest answer is fewer every quarter. A handful of rotting outbound links on a large blog is normal life on the web. Hundreds of internal 404s point at a migration that was never finished.'],
    ['Why do external links break so often?', 'Link rot is structural: sites move, reorganise, delete old content and expire domains. Studies of citation links regularly find a quarter or more dead within a few years, which is why periodic link audits are maintenance, not failure.'],
    ['What causes 500 errors in link checks?', 'Server side failures: crashing code, overloaded databases, bad deployments or aggressive rate limiting. Because 5xx answers can be transient, this checker retries them and only reports persistent failures as broken.'],
    ['What is a redirect chain and why does it matter?', 'A chain is when a URL redirects to another redirect, sometimes several times. Each hop adds latency, loses a little equity and increases the chance of a future break. Update links and redirects so every hop lands in one step.'],
    ['Why are some links marked Restricted or Bot Protection instead of broken?', 'Because a 401, 403, 429 or a CAPTCHA page proves only that our reader was refused, not that the page is gone. Calling those broken would be a false positive, so they are classified separately with the evidence shown.'],
    ['Does the checker respect robots.txt?', 'Yes, by default. Pages and paths a site disallows are reported as blocked rather than fetched, and you can see them listed with the reason.'],
    ['How often should I check for broken links?', 'Quarterly suits most sites, monthly for large or constantly edited ones, and always immediately after a migration, redesign or platform change.']
  ];
  const cardsList = [
    ['security','Safe and polite crawling','Private addresses refused, redirects validated, response sizes capped, robots.txt respected and concurrency kept at polite levels.'],
    ['fact_check','Accurate classification','Confirmed broken only with real evidence. Restricted, rate limited, bot protection and timeout answers are labelled as exactly what they are.'],
    ['loop','Retries and redirect analysis','Uncertain answers retried with backoff, full redirect chains recorded and loops detected across hops.'],
    ['dns','DNS and TLS diagnostics','Expired certificates, hostname mismatches and failed lookups reported as their own failure classes, not generic errors.'],
    ['image_search','Images and documents too','Optional checks for images, PDFs and other file links, plus anchor validation for links that point to page sections.'],
    ['grading','A health score that forgives life','Normal 301 redirects and politely refused external endpoints do not sink the score. Confirmed internal failures do.']
  ];
  const guides = [
    ['format_list_numbered','Work the confirmed list top down','Start with internal 404s, because those are fully under your control and they block authority from reaching live pages. External rot comes second, and restricted or protected endpoints last, since those are often just policy, not breakage.'],
    ['redirect','Fix causes, not symptoms','If an internal URL 404s, decide whether to restore the page, redirect it to the nearest real equivalent, or remove links to it. The right answer is usually the redirect map you wish you had made during the migration.'],
    ['link','Tidy anchors while you are in there','Links to page sections break silently when someone renames an id. The anchor check lists every heading target that no longer exists, which takes minutes to fix and improves navigation for everyone.'],
    ['map','Keep the redirect map short','After a big cleanup, chains tend to accumulate: old URL to new URL to newer URL. Collapse each chain to a single hop and update internal links to point at the final destination.'],
    ['event_repeat','Make it a routine, not a rescue','Link rot returns. A quarterly scan catches rot while it is small, keeps crawl budget on real pages, and gives you a health score trend instead of an annual archaeology project.'],
    ['hub','Combine with the structure tools','Run the <a href="/xml-sitemap-generator">sitemap generator</a> in analyze mode afterwards to confirm the file lists no dead URLs, and a full <a href="/">SEO audit</a> to catch the duplicate and canonical issues that usually travel with link problems.']
  ];
  const body = `<section class="hero audit-home brokenlink-home"><span class="material-icons hero-icon" aria-hidden="true">search_off</span><h1>Broken Link Checker</h1><p class="hero-subtitle">Crawl a site and verify every link, with no false alarms</p>
<form id="brokenlink-form" class="brokenlink-form" aria-label="Broken link checker">
  <div class="search-field audit-search" style="flex-wrap:wrap;gap:8px;padding:10px;max-width:900px">
    <input id="bl-url" type="text" inputmode="url" autocomplete="url" spellcheck="false" placeholder="https://example.com" required aria-label="Website URL" style="flex:1;min-width:200px">
    <button class="btn" type="submit">Start Scan</button>
  </div>
  <details class="sitemap-options sitemap-advanced" style="max-width:900px;margin:18px auto 0"><summary>${icon('tune')} Scan settings</summary>
    <div class="sitemap-option-row" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
      <label>Maximum pages
        <select id="bl-max-pages" class="select"><option value="100">100</option><option value="500" selected>500</option><option value="1000">1,000</option><option value="5000">5,000</option></select>
      </label>
      <label>Maximum crawl depth
        <select id="bl-max-depth" class="select"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="5" selected>5</option><option value="10">10</option></select>
      </label>
      <label>Scan scope
        <select id="bl-scan-scope" class="select"><option value="internal+external" selected>Internal and external</option><option value="internal">Internal only</option></select>
      </label>
    </div>
    <div class="sitemap-option-row" style="display:flex;flex-wrap:wrap;gap:16px;margin-top:12px">
      <label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="bl-check-external" checked> Check external links</label>
      <label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="bl-check-images"> Check images</label>
      <label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="bl-check-docs"> Check documents</label>
      <label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="bl-check-anchors"> Check section anchors</label>
      <label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="bl-respect-robots" checked> Respect robots.txt</label>
    </div>
  </details>
</form>
${chips([['fact_check','Accurate classes'],['security','SSRF safe'],['rule','Robots respected'],['loop','Redirect chains'],['retry','Retry verification'],['grading','Health score']])}</section>
<div id="brokenlink-results" class="audit-results brokenlink-results"></div>
${cards('What does the scan cover?', 'verified', cardsList)}
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('tips_and_updates')}<h4 style="margin:0;">Fixing links the professional way</h4></div>${lede('A link report is only as good as the fixes that follow. This is the order that returns the most value for the effort.')}${guideGrid(guides)}
<p class="prose-block">Link problems rarely travel alone. After the cleanup, a <a href="/">SEO audit</a> confirms the technical side is clean and the <a href="/xml-sitemap-generator">sitemap generator</a> rebuilds a file with only live URLs.</p></div>
${faqSection(faqs)}`;
  return layout('Broken Link Checker | Accurate Scan with No False Positives | Huvanti', body, {
    active:'brokenlink', canonical:'https://huvanti.com/broken-link-checker',
    description:'Free broken link checker. Crawl any public site, find confirmed broken links, redirect chains and loops, with careful classification and no false positives. No account.',
    scripts:['/assets/js/progress.js','/assets/js/common.js','/assets/js/brokenlink/crawler.js','/assets/js/brokenlink/ui.js'],
    jsonLd:[{'@context':'https://schema.org','@type':'WebApplication',name:'Broken Link Checker',applicationCategory:'DeveloperApplication',operatingSystem:'Any',browserRequirements:'Requires JavaScript',offers:{'@type':'Offer','price':'0','priceCurrency':'USD'},description:'Free broken link checker with multi stage verification and accurate classification.'}, faqLd(faqs)]
  });
}
/* ============================== LLMS.TXT GENERATOR ============================== */
function llmstxtPage() {
  const faqs = [
    ['What is llms.txt?', 'It is a proposed standard file, placed at the root of a domain, that gives AI systems and language models a curated map of a site. It is written in simple Markdown: a title, a short description, then sections of links to the content that best represents the site, each with a one line note.'],
    ['Do I need an llms.txt file?', 'Nobody needs one yet. Adoption is early: some AI tools read it, many ignore it, and the format is still a proposal rather than a standard. Publishing one is a low effort bet that costs ten minutes and makes your key content easier for any compliant system to find.'],
    ['Does Google use llms.txt for search?', 'Google has said Search does not use llms.txt, and that robots.txt plus normal crawling cover its needs. The file is aimed at AI assistants and answer engines, where a curated content map has more obvious value.'],
    ['Where do I put the llms.txt file?', 'At https://yoursite.com/llms.txt, the same way robots.txt sits at the root. Nothing needs to be registered anywhere: the file is simply there for tools that look for it.'],
    ['Is llms.txt the same as robots.txt?', 'No. robots.txt tells crawlers what they may not access. llms.txt describes what your site is about and which pages matter most. They work side by side and control different things.'],
    ['Will an llms.txt file get my site cited in AI answers?', 'No file guarantees that. Answers depend on relevance, quality and each platform own ranking. What a good llms.txt does is remove friction: clear descriptions, clean URLs and an honest map of your best material.'],
    ['What pages should go into llms.txt?', 'Your genuinely strongest material: cornerstone guides, definitive documentation, key tools and popular posts. A short curated file beats an exhaustive dump, because the entire point is telling models where the real substance lives.'],
    ['How is llms.txt different from a sitemap?', 'A sitemap lists every indexable URL for search engines, usually without context. llms.txt lists a small curated selection with descriptions that explain why each link matters. One is breadth for crawlers, the other is guidance for models.'],
    ['Does this generator use AI to write the file?', 'No. It crawls your site, scores pages by measurable signals such as depth, links and content, and writes descriptions from your own meta data and page text. The process is deterministic and reproducible.'],
    ['Can I edit the file before downloading?', 'Yes. The page table lets you exclude pages, rewrite titles and descriptions, reorder entries and add custom URLs, and the preview updates as you go. The download is exactly what the preview shows.']
  ];
  const cardsList = [
    ['security','Safe public crawling','Public URLs only, robots.txt respected, redirects validated and response sizes capped, with a bounded crawl budget.'],
    ['auto_awesome','Deterministic selection','Pages are scored on measurable signals like proximity to the homepage, links, sitemap presence and content depth. No model, no guessing.'],
    ['description','Real descriptions','Every entry is described using your own meta description, Open Graph text or introductory paragraph, never generated filler.'],
    ['fact_check','Quality filtering','Duplicates, noindex pages, non canonical URLs, tracking parameters and login or cart pages are excluded with the reason shown.'],
    ['edit','Full manual control','Include, exclude, recategorise, rewrite and reorder every entry, add custom URLs, then regenerate instantly.'],
    ['code','Validated output','The file is checked against the llms.txt structure before download, and the quality score explains any deductions.']
  ];
  const guides = [
    ['auto_stories','Curate like an editor','Imagine a new colleague asking where the real knowledge on your site lives. The handful of links you would hand them is your llms.txt. Depth beats completeness: fifty well chosen entries outperform five thousand undifferentiated ones.'],
    ['description','Write descriptions that carry information','The note beside each link is what a model actually reads. Explain what the page covers and who it serves, in one specific sentence. A note that could apply to any page on the internet helps no one.'],
    ['category','Group with the standard sections','The format expects an H1 title, an optional summary, then file list sections, with Optional for secondary material. Keep the structure recognizable so every tool that reads the format can parse your file.'],
    ['link','Keep URLs clean and canonical','One address per page, the canonical one, no parameters or fragments. The generator normalises and deduplicates automatically, but it is worth knowing why: duplicates make models unsure which version represents the content.'],
    ['update','Refresh it like a sitemap','When cornerstone content moves or new definitive pages ship, regenerate. A stale llms.txt quietly points models at pages that no longer exist, which is worse than no file at all.'],
    ['hub','Cover the other discovery channels','Pair it with the <a href="/xml-sitemap-generator">XML sitemap generator</a> for search engines and the <a href="/rss-feed-generator">RSS feed generator</a> for feed readers. If you also want to control which AI bots may crawl you at all, the <a href="/ai-crawler-blocker">bot blocker</a> generates those rules.']
  ];
  const body = `<section class="hero audit-home llmstxt-home"><span class="material-icons hero-icon" aria-hidden="true">auto_stories</span><h1>LLMs.txt Generator</h1><p class="hero-subtitle">Turn your best pages into a clean llms.txt for AI tools</p>
<form id="llmstxt-form" class="llmstxt-form" aria-label="LLMs.txt generator">
  <div class="search-field audit-search"><input name="url" id="llmstxt-url" type="text" inputmode="url" autocomplete="url" spellcheck="false" placeholder="https://example.com" required aria-label="Website URL"><button class="btn" type="submit">Generate llms.txt</button></div>
  <details class="sitemap-options sitemap-advanced"><summary>${icon('tune')} Crawl settings</summary>
    <div class="sitemap-option-row"><label>Maximum pages <select name="maxPages" class="select"><option value="100">100</option><option value="500" selected>500</option><option value="1000">1,000</option><option value="5000">5,000</option></select></label><label>Crawl depth <select name="maxDepth" class="select"><option value="1">1</option><option value="2">2</option><option value="3" selected>3</option><option value="5">5</option></select></label></div>
    <input type="hidden" name="includePdfs" value="1"><input type="hidden" name="includeBlog" value="1"><input type="hidden" name="includeDocs" value="1">
  </details>
</form>
${chips([['rule','Robots respected'],['auto_awesome','Deterministic scoring'],['link','Canonicals handled'],['code','Output validated'],['download','Download ready']])}</section>
<div id="llmstxt-results" class="audit-results llmstxt-results"></div>
${cards('What does the generator do?', 'verified', cardsList)}
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('tips_and_updates')}<h4 style="margin:0;">Writing an llms.txt worth reading</h4></div>${lede('The format is simple, which puts all the weight on what you choose to include. These habits produce files that actually help.')}${guideGrid(guides)}
<p class="prose-block">Visibility in AI answers starts with content that answers questions well. The <a href="/">SEO audit</a> shows whether your pages are structured for humans and crawlers alike.</p></div>
${faqSection(faqs)}`;
  return layout('LLMs.txt Generator | Free Crawl, Validate and Download | Huvanti', body, {
    active:'llmstxt', canonical:'https://huvanti.com/llms-txt-generator',
    description:'Free llms.txt generator. Crawl a public site, select the pages that matter, generate descriptions from your own content and download a validated llms.txt file. No account.',
    scripts:['/assets/js/progress.js','/assets/js/common.js','/assets/js/llmstxt/browser.js','/assets/js/llmstxt/ui.js'],
    jsonLd:[{'@context':'https://schema.org','@type':'WebApplication',name:'LLMs.txt Generator',applicationCategory:'DeveloperApplication',operatingSystem:'Any',browserRequirements:'Requires JavaScript',offers:{'@type':'Offer','price':'0','priceCurrency':'USD'},description:'Free deterministic llms.txt generator and validator.'}, faqLd(faqs)]
  });
}

/* ============================== AI CRAWLER & LLM BOT BLOCKER ============================== */
function botblockerPage() {
  const faqs = [
    ['Should I block GPTBot and other AI crawlers?', 'It depends on your goals. Blocking protects your content from being used to train models you do not control, and saves bandwidth. Allowing it keeps your material eligible to appear in AI answers, which some publishers treat as traffic and others as free riding. There is no single right answer, only the one that matches your strategy.'],
    ['Does robots.txt actually stop AI bots?', 'For compliant crawlers, yes in practice. OpenAI, Anthropic, Google and other major operators document that their bots honor robots.txt. A scraper that wants to ignore it can, which is why the tool also generates server level rules for real enforcement.'],
    ['What is Google Extended in robots.txt?', 'Google Extended is a usage control token. Blocking it does not stop Googlebot from crawling for search. It stops Google from using your crawled content for training its AI models. Publishing a rule for it is a decision about training, not about search visibility.'],
    ['How do I block AI bots in robots.txt?', 'Add a group for each crawler with a Disallow rule for the paths you want closed. The generator writes the file for you from the mode you choose, and the simulator shows exactly which rule wins for any bot and path combination before you upload anything.'],
    ['How do I block AI crawlers at the server level?', 'Filter the User Agent in Nginx, Apache, Cloudflare or application middleware and return 403. The generator produces ready to paste configurations for each, using exact product tokens with boundaries so innocent browsers never get caught.'],
    ['Can I allow AI search but block AI training?', 'Yes, and it is a popular middle path. Training crawlers such as GPTBot and ClaudeBot are disallowed while search and retrieval crawlers such as OAI-SearchBot and PerplexityBot are explicitly allowed, so your pages can still surface in AI answers.'],
    ['Can AI bots just ignore my blocking?', 'A determined scraper can always change its User Agent or ignore robots.txt entirely. Exact token matching stops the well behaved majority, and IP verification against published operator ranges, where available, raises the bar further. Perfect enforcement does not exist on the open web.'],
    ['Will blocking AI crawlers hurt my Google rankings?', 'No. Blocking AI training bots does not affect Googlebot, and Google has been clear that it crawls as Googlebot regardless of Google Extended rules. Your search visibility and your training opt out are separate dials.'],
    ['What is Bytespider and why do sites block it?', 'Bytespider is ByteDance crawler, one of the most aggressive on the web in volume, and it is a frequent target of blocking. It typically does not honor robots.txt requests, which makes the server level rules the practical answer for it.'],
    ['How do I test my robots.txt rules before publishing?', 'Paste your current file into the analyzer, or use the simulator: pick any bot and any path and see which rule wins and why, including the precedence rules from the robots specification.'],
    ['Is my configuration sent to a server?', 'No. Generation and simulation run entirely in your browser, and saved profiles stay in your browser storage. The only network calls are the two you trigger yourself: fetching an existing robots.txt and the live site check.']
  ];
  const cardsList = [
    ['smart_toy','Bot knowledge base','Around thirty documented AI crawlers with operator, purpose, category, official documentation and robots.txt support, classified by behaviour rather than name.'],
    ['rule','Generation for every layer','robots.txt plus Nginx, Apache, Cloudflare, Node, PHP and Laravel configurations, all validated after generation for syntax and conflicts.'],
    ['science','Access simulator','Pick a bot and a path and see exactly which rule wins, with the matching logic explained, before anything is deployed.'],
    ['balance','Advisory versus enforced','The tool keeps the distinction front and centre: robots.txt is a request, server rules are enforcement, and it never claims the first is the second.'],
    ['security','False positive protection','Only exact product tokens with boundaries are matched, so a browser named MyAIBrowser is never blocked for containing the letters AI.'],
    ['lock','Runs in your browser','No account and no server side storage. Profiles live in your browser, and the two optional network checks are clearly labelled.']
  ];
  const guides = [
    ['flag','Decide what you actually want','Before touching any rules, answer three questions. Do you want your content training models? Do you want it appearing in AI answers? Do specific paths such as paid archives need different rules from the rest of the site? The mode picker maps directly to these answers.'],
    ['alt_route','Consider the middle path','Full blocking removes you from AI answers that increasingly cite sources. Training only blocking keeps you citable while opting out of the training corpus, and many publishers land there after watching referral traffic from AI services grow.'],
    ['rule','Get robots.txt right first','It is respected by the major operators and it is one file. Use exact group blocks per crawler, validate there are no contradictions, and reference your sitemap while you are in the file. The generator handles all of it, including the precedence traps.'],
    ['dns','Add server rules for the stubborn ones','For crawlers that ignore robots.txt, enforcement happens at the edge. Paste the generated Nginx, Apache or Cloudflare rules, then verify with the live site check that a spoofed User Agent gets the treatment you expect.'],
    ['verified_user','Protect your search visibility while you block','Never block Googlebot by accident. The database marks which tokens are usage controls rather than crawlers, so a Google Extended rule never mutates into a search disaster, and the simulator proves it per path.'],
    ['update','Revisit the setup quarterly','The crawler landscape changes fast: new bots appear, operators publish new ranges, policies shift. The versioned database here gets updated, and a quarterly recheck keeps your rules aligned with reality. Related: the <a href="/llms-txt-generator">llms.txt generator</a> handles the opposite problem, telling compliant AI tools what to read.']
  ];
  const body = `<section class="hero audit-home botblocker-home"><span class="material-icons hero-icon" aria-hidden="true">security</span><h1>AI Crawler &amp; LLM Bot Blocker</h1><p class="hero-subtitle">Choose which AI bots may access your site, then generate the rules</p>
<form id="botblocker-form" class="botblocker-form" aria-label="AI Crawler and LLM Bot Blocker">
  <div class="search-field audit-search"><input id="botblocker-url" type="text" inputmode="url" autocomplete="url" spellcheck="false" placeholder="https://example.com" aria-label="Website URL"><button class="btn" type="submit">Generate Protection Rules</button></div>
  <div class="botblocker-formrow">
    <label class="botblocker-modelabel" for="botblocker-mode">Protection mode</label>
    <select id="botblocker-mode" class="select botblocker-modeselect" aria-label="Protection mode">
      <option value="block-all">Block all known AI crawlers</option>
      <option value="block-training">Block AI training crawlers only</option>
      <option value="block-search">Block AI search crawlers only</option>
      <option value="block-extraction">Block content extraction crawlers</option>
      <option value="allow-all">Allow all AI crawlers</option>
      <option value="allow-selected">Allow selected crawlers, block the rest</option>
      <option value="custom">Custom per crawler rules</option>
      <option value="advanced">Advanced configuration</option>
    </select>
    <small class="muted botblocker-mode-desc" id="botblocker-mode-desc"></small>
  </div>
  <details class="botblocker-advanced-sub"><summary>${icon('tune')} Advanced options: paths, exceptions, formats</summary>
    <div class="botblocker-optgroup">
      <fieldset class="botblocker-fieldset"><legend>Apply rules to</legend>
        <label class="botblocker-radio"><input type="radio" name="botblocker-scope" id="botblocker-scope-entire" value="entire" checked> Entire website <code>/</code></label>
        <label class="botblocker-radio"><input type="radio" name="botblocker-scope" id="botblocker-scope-specific" value="specific"> Specific paths</label>
        <div id="botblocker-pathchips" class="botblocker-chiprow" aria-label="Blocked paths"></div>
        <div class="botblocker-addrow"><input type="text" id="botblocker-path-input" class="text-input" placeholder="Add custom path, such as /private-content/"><button type="button" class="btn" id="botblocker-path-add">${icon('add')} Add</button></div>
      </fieldset>
      <fieldset class="botblocker-fieldset"><legend>Block everywhere except these paths</legend>
        <label class="botblocker-radio"><input type="checkbox" id="botblocker-exceptions-on"> Enable exception paths</label>
        <div id="botblocker-exceptionchips" class="botblocker-chiprow" aria-label="Allowed exception paths"></div>
        <div class="botblocker-addrow"><input type="text" id="botblocker-exc-input" class="text-input" placeholder="Add allow path, such as /public/"><button type="button" class="btn" id="botblocker-exc-add">${icon('add')} Add</button></div>
      </fieldset>
    </div>
    <div class="botblocker-optgroup">
      <fieldset class="botblocker-fieldset"><legend>Default group, for all other crawlers</legend>
        <select id="botblocker-default-group" class="select" aria-label="Default wildcard group">
          <option value="allow" selected>Allow everything</option>
          <option value="none">No wildcard group</option>
          <option value="mirror">Apply the same path rules to all other crawlers</option>
          <option value="block-others">Block all other crawlers, high impact</option>
        </select>
      </fieldset>
      <fieldset class="botblocker-fieldset"><legend>Sitemap, optional</legend>
        <input type="text" id="botblocker-sitemap" class="text-input" placeholder="https://example.com/sitemap.xml" spellcheck="false">
      </fieldset>
    </div>
    <div class="botblocker-optgroup">
      <fieldset class="botblocker-fieldset"><legend>Output formats, robots.txt is always generated</legend>
        <div class="botblocker-checkrow">
          <label><input type="checkbox" id="botblocker-out-nginx" checked> Nginx</label>
          <label><input type="checkbox" id="botblocker-out-apache"> Apache</label>
          <label><input type="checkbox" id="botblocker-out-cloudflare"> Cloudflare</label>
          <label><input type="checkbox" id="botblocker-out-node"> Node.js</label>
          <label><input type="checkbox" id="botblocker-out-php"> PHP</label>
          <label><input type="checkbox" id="botblocker-out-laravel"> Laravel</label>
        </div>
      </fieldset>
    </div>
  </details>
</form>
${chips([['smart_toy','Documented bots'],['rule','robots.txt and server rules'],['science','Access simulator'],['lock','Runs in your browser']])}</section>
<div id="botblocker-results" class="audit-results botblocker-results"></div>
${cards('What does the tool do?', 'verified', cardsList)}
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('tips_and_updates')}<h4 style="margin:0;">Choosing an AI crawler policy</h4></div>${lede('Blocking is a business decision with technical execution. This is how to think about the decision, then ship it safely.')}${guideGrid(guides)}
<p class="prose-block">Once access rules are in place, make sure compliant AI tools can find your best work: generate an <a href="/llms-txt-generator">llms.txt</a> and keep your <a href="/xml-sitemap-generator">XML sitemap</a> current.</p></div>
${faqSection(faqs)}`;
  const scripts = ['/assets/js/progress.js','/assets/js/common.js',
    '/lib/botblocker/botDatabase.js', '/lib/botblocker/botClassifier.js', '/lib/botblocker/botPatternMatcher.js',
    '/lib/botblocker/robotsParser.js', '/lib/botblocker/robotsSimulator.js', '/lib/botblocker/robotsGenerator.js',
    '/lib/botblocker/ruleConflictDetector.js', '/lib/botblocker/userAgentAnalyzer.js',
    '/lib/botblocker/nginxGenerator.js', '/lib/botblocker/apacheGenerator.js', '/lib/botblocker/cloudflareGenerator.js',
    '/lib/botblocker/middlewareGenerator.js', '/lib/botblocker/configurationValidator.js', '/lib/botblocker/protectionScore.js',
    '/lib/botblocker/coverageAnalyzer.js', '/lib/botblocker/securityChecker.js', '/lib/botblocker/index.js',
    '/assets/js/botblocker/ui.js'];
  return layout('AI Crawler and LLM Bot Blocker | robots.txt, Nginx, Cloudflare Rules | Huvanti', body, {
    active:'botblocker', canonical:'https://huvanti.com/ai-crawler-blocker',
    description:'Free AI crawler and LLM bot blocker. Generate robots.txt plus Nginx, Apache, Cloudflare and middleware rules for GPTBot, ClaudeBot, Bytespider and more, with a bot access simulator. No account.',
    scripts,
    jsonLd:[{'@context':'https://schema.org','@type':'WebApplication',name:'AI Crawler and LLM Bot Blocker',applicationCategory:'DeveloperApplication',operatingSystem:'Any',browserRequirements:'Requires JavaScript',offers:{'@type':'Offer','price':'0','priceCurrency':'USD'},description:'Free AI crawler management and configuration generator.'}, faqLd(faqs)]
  });
}

/* ============================== CORE WEB VITALS ============================== */
function cwvPage() {
  const faqs = [
    ['What are Core Web Vitals?', 'Three user experience metrics Google uses in its page experience signals: Largest Contentful Paint for loading, Interaction to Next Paint for responsiveness and Cumulative Layout Shift for visual stability. First Contentful Paint and Time to First Byte are reported alongside them as supporting metrics.'],
    ['What is a good LCP score?', '2.5 seconds or faster is good, up to 4 seconds needs improvement and beyond 4 seconds is poor, measured at the 75th percentile of loads. The report shows your measured value, the band it lands in and the phases that made up the time.'],
    ['What is INP and why did it replace FID?', 'Interaction to Next Paint measures how quickly a page responds to any interaction: clicks, taps and key presses, across the whole visit. It replaced First Input Delay in March 2024 because FID only measured the first interaction and missed everything after it.'],
    ['What is a good INP score?', '200 milliseconds or faster is good, up to 500 milliseconds needs improvement and beyond that is poor. The report breaks every tested interaction into input delay, processing time and presentation delay, so you can see which part is slow.'],
    ['What causes layout shift and how do I fix CLS?', 'Images and embeds without reserved space, web fonts swapping in late, banners injected above content and animations that move elements. Fixes are mechanical: always set width and height, reserve space for ads and embeds, and preload the fonts you actually render with.'],
    ['How do I improve LCP?', 'Find the largest element in the report, then attack its four phases: faster server response, earlier resource discovery with preload hints, smaller image payload with modern formats and less render blocking in front of the element. The phase breakdown tells you which one dominates.'],
    ['How do I improve INP?', 'Long tasks on the main thread are the usual cause: heavy scripts, large event handlers and third party code. The report attributes long tasks to scripts, lists the slowest interactions and points at the code responsible.'],
    ['Does Core Web Vitals affect Google rankings?', 'Yes, as part of page experience signals, alongside mobile friendliness, HTTPS and intrusive interstitial rules. It is a tiebreaker among otherwise similar pages rather than a dominant factor, so a great score rescues weak content far less often than people hope.'],
    ['What is the difference between lab and field data?', 'Lab data comes from a controlled test, this tool in your browser, and is available for any page instantly. Field data comes from real visitors through the Chrome UX Report and reflects real devices and networks. This tool measures lab values and labels them as lab, always.'],
    ['Why is my PageSpeed score different from real user data?', 'Lab runs use simulated devices and networks, while real users span everything from flagship phones on fibre to old devices on weak connections. Differences are normal. Watch the field data in Search Console for the truth, and lab data for diagnosis.'],
    ['What is TTFB and what makes it slow?', 'Time to First Byte is how long the server takes to start answering: DNS, connection, TLS handshake and server processing. Slow generation without caching, cheap shared hosting far from your visitors and cold serverless starts are the usual suspects.'],
    ['How often should I test Core Web Vitals?', 'After any meaningful release that touches templates, scripts or images, and on a slow monthly rhythm otherwise. Scores wander with network conditions and third party behaviour, so trends matter more than any single run.']
  ];
  const cardsList = [
    ['touch_app','INP in detail','Synthetic but safe interactions on real page elements, with input delay, processing and presentation delay broken out per interaction.'],
    ['image','LCP element analysis','The actual largest element with its size and resource, plus the four phases of its timing and image specific checks such as priority hints.'],
    ['swap_vert','CLS session windows','Every layout shift with the elements that moved, grouped by the session window model used in the real metric.'],
    ['timer','TTFB phases','DNS, connection, TLS and server response time separated, so a slow handshake is never confused with slow code.'],
    ['waterfall_chart','Waterfall and dependencies','Every request with timing, size and type, plus reconstructed dependency chains that show what actually blocked what.'],
    ['code','Code and caching audits','Long tasks with script attribution, render blocking resources, image and font issues, and cache headers read from live responses.']
  ];
  const guides = [
    ['speed','Read the score, then ignore it','The number is a door, not a destination. Open the metric that is worst, look at the evidence attached, and fix the specific element or script named there. Ten targeted fixes beat a hundred generic optimisations.'],
    ['image','Start with the largest element','LCP is usually one hero image or one heading block. Serve it in a modern format, give it priority, size it correctly and remove whatever renders in front of it. That single element often decides the whole loading grade.'],
    ['touch_app','Then hunt long tasks','INP problems live in the main thread. The long task list attributes each one to a script, and the fix is usually deferring, splitting or removing code rather than tuning your own logic, since third party scripts own much of the timeline.'],
    ['straighten','Reserve space for everything','Layout shift is almost always missing dimensions: images, ads, embeds and late fonts. Setting width and height everywhere and preloading the primary font removes the entire class of problems in an afternoon.'],
    ['storage','Check what the server does first','A slow first byte delays everything downstream. The phase breakdown separates connection cost from server processing, and if processing dominates, caching and a CDN do more than any front end work.'],
    ['hub','Pair the measurement with a full audit','Performance sits inside a bigger picture. Run the <a href="/">SEO audit</a> for content and technical health, and the <a href="/broken-link-checker">broken link checker</a> to catch the maintenance issues that quietly drag speed and trust down.']
  ];
  const body = `<section class="hero audit-home cwv-home"><span class="material-icons hero-icon" aria-hidden="true">speed</span><h1>Core Web Vitals &amp; INP Auditor</h1><p class="hero-subtitle">Real browser measurement of LCP, INP, CLS, FCP and TTFB</p>
<form id="cwv-form" class="cwv-form" aria-label="Core Web Vitals and INP auditor">
  <div class="search-field audit-search"><input id="cwv-url" type="text" inputmode="url" autocomplete="url" spellcheck="false" placeholder="https://example.com" required aria-label="Website URL"><button class="btn" type="submit">Analyze Website</button></div>
  <div class="cwv-formrow">
    <label for="cwv-profile">Device profile
      <select id="cwv-profile" class="select"><option value="mobile" selected>Mobile, 412 by 823, slow 4G</option><option value="desktop">Desktop, 1350 by 940, no throttle</option><option value="custom">Custom</option></select>
    </label>
    <label class="cwv-check"><input type="checkbox" id="cwv-both" checked> Also measure the other device profile</label>
  </div>
  <div id="cwv-custom-fields" hidden class="cwv-formrow">
    <label>Viewport width <input id="cwv-cw" class="cwv-num" type="number" min="320" max="2560" value="1280"></label>
    <label>Viewport height <input id="cwv-ch" class="cwv-num" type="number" min="320" max="1800" value="800"></label>
    <label>Network
      <select id="cwv-net" class="select"><option value="none" selected>No throttle</option><option value="slow4g">Slow 4G</option><option value="fast3g">Fast 3G</option></select>
    </label>
  </div>
</form>
${chips([['speed','Real measurements'],['touch_app','INP interactions'],['image','LCP phases'],['swap_vert','CLS windows'],['waterfall_chart','Waterfall'],['key_off','No API keys']])}</section>
<div id="cwv-results" class="audit-results cwv-results"></div>
${cards('What does the auditor measure?', 'rule_folder', cardsList)}
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('tips_and_updates')}<h4 style="margin:0;">Making pages genuinely fast</h4></div>${lede('Most performance work fails from fixing the wrong thing first. This is the order that pays off.')}${guideGrid(guides)}
<p class="prose-block">Speed is one signal among many. Balance it with a full <a href="/">SEO audit</a>, and remember that healthy internal linking, which the audit maps, is what spreads fast pages across a site.</p></div>
${faqSection(faqs)}`;
  return layout('Core Web Vitals and INP Auditor | Free Performance Measurement | Huvanti', body, {
    active:'cwv', canonical:'https://huvanti.com/core-web-vitals-auditor',
    description:'Free Core Web Vitals auditor. Real lab measurement of LCP, INP, CLS, FCP and TTFB with element attribution, long tasks, a request waterfall and evidence based fixes. No API key.',
    scripts:['/assets/js/progress.js','/assets/js/common.js','/lib/cwv/rewriter.js','/assets/js/cwv/report.js','/assets/js/cwv/ui.js'],
    jsonLd:[{'@context':'https://schema.org','@type':'WebApplication',name:'Core Web Vitals and INP Auditor',applicationCategory:'DeveloperApplication',operatingSystem:'Any',browserRequirements:'Requires JavaScript',offers:{'@type':'Offer','price':'0','priceCurrency':'USD'},description:'Free Core Web Vitals and interaction performance auditor with real browser measurements.'}, faqLd(faqs)]
  });
}

/* ============================== RSS FEED GENERATOR ============================== */
function rssPage() {
  const faqs = [
    ['How do I create an RSS feed for my website?', 'If you run WordPress or most blog platforms, a feed already exists at yoursite.com/feed. For static sites and unusual platforms, enter your URL here: the tool discovers your content, extracts titles, dates and descriptions, and produces a validated feed file you download and upload to your root folder.'],
    ['Do people still use RSS feeds?', 'Yes, though differently from the 2010s. News aggregators, podcast apps, newsletter tools, monitoring services and automation pipelines all consume feeds quietly. Feed readers remain popular among developers and researchers. For a publisher, a feed is infrastructure that other systems build on.'],
    ['Does my WordPress site have a feed already?', 'Yes, at /feed with versions for categories and comments. The checker detects existing feeds and offers a comparison, so before generating anything you know whether the built in feed already does the job.'],
    ['Where do I put the RSS feed file?', 'At a stable address, usually yoursite.com/feed.xml or yoursite.com/rss.xml. Then add one link tag in your page head so browsers and readers can auto discover it.'],
    ['What is the difference between RSS and Atom?', 'Both are feed formats doing the same job. RSS 2.0 is older and more widespread. Atom is the cleaner standard with stricter rules. Every major reader supports both, so RSS 2.0 remains the practical default, and this tool can output Atom as well.'],
    ['How many items should a feed contain?', 'Ten to fifty covers most purposes. Full content feeds trend larger, excerpt feeds smaller. What matters more is that the feed updates reliably when you publish, because silent staleness is what kills subscribers.'],
    ['Should a feed contain full content or excerpts?', 'Full content serves readers who want everything in their reader and drives fewer site visits. Excerpts bring readers to the site but annoy full content devotees. Both are legitimate: pick deliberately, and say so publicly.'],
    ['Can I use this feed for a podcast?', 'A podcast feed is RSS with audio enclosures and iTunes style tags. This tool detects audio in pages and can produce a standard feed with enclosures, but podcast directories have additional requirements, so treat it as a starting point rather than a full podcast host replacement.'],
    ['How do I let people subscribe to my feed?', 'Publish the auto discovery link in your head, mention the feed address on your site, and use a button or icon readers recognise. Feed usage is invisible in standard analytics, so expect measurement to be approximate.'],
    ['Does an RSS feed help SEO?', 'Indirectly at most. Search engines discover content through crawling and sitemaps, not your feed. The value is distribution: aggregators, readers and automation republishing or surfacing your work, which can earn visits and links that do help.']
  ];
  const cardsList = [
    ['search','Content discovery','Homepage, sitemaps, robots.txt declarations, navigation links and existing feeds are all used to find real articles rather than every URL.'],
    ['data_object','Accurate metadata','Titles, descriptions, dates, authors and images extracted in a documented priority order, with nothing invented when a value is missing.'],
    ['rss_feed','Existing feed detection','Standard feed locations and auto discovery links are checked first, and an existing feed is offered for use, comparison or replacement.'],
    ['link','Canonical handling','Tracking parameters stripped, canonical URLs preferred and duplicates removed by address, canonical and title.'],
    ['code','Validated XML','Correct escaping, RFC dates, unique identifiers and only the namespaces actually used, verified before the file is offered.'],
    ['edit','Manual control','An editable item table, manual additions, visual and XML previews, quality scoring and downloads in RSS, Atom and JSON.']
  ];
  const guides = [
    ['rss_feed','Confirm the feed you already have','Before generating, let the tool look for an existing feed. Many platforms ship one that nobody configured, and fixing descriptions inside the platform beats maintaining a second generated file forever.'],
    ['category','Feed what you publish, consistently','A feed is a promise: when something appears, subscribers see it. Feed your best regular output, not every page on the site, and keep the item count stable so old entries roll off gracefully.'],
    ['event','Get dates right','Publication dates drive sort order in every reader. The extractor prefers structured data and visible dates and marks undated items honestly, because a feed with invented dates quietly scrambles reader timelines.'],
    ['description','Write descriptions that work alone','In a reader, your description is the whole pitch. One or two specific sentences beat a truncated first paragraph, and they are what aggregation partners display too.'],
    ['code','Validate before you ship','One unescaped ampersand can make a feed unreadable for every subscriber at once. The validator here checks structure, escaping and dates on every generation, and the download is exactly the validated file.'],
    ['hub','Round out your distribution','Pair the feed with an <a href="/xml-sitemap-generator">XML sitemap</a> for search engines and an <a href="/llms-txt-generator">llms.txt</a> for AI tools. Together they cover the discovery channels that matter today.']
  ];
  const body = `<section class="hero audit-home rss-home"><span class="material-icons hero-icon" aria-hidden="true">rss_feed</span><h1>RSS Feed Generator</h1><p class="hero-subtitle">Turn your published content into a validated RSS feed</p>
<form id="rss-form" class="rss-form" aria-label="RSS feed generator">
  <div class="mode-tabs" role="radiogroup" aria-label="Mode"><label><input type="radio" name="mode" value="website" checked> Generate from website</label><label><input type="radio" name="mode" value="sitemap"> Generate from sitemap</label></div>
  <div class="search-field audit-search"><input id="rss-url" name="url" type="text" inputmode="url" autocomplete="url" spellcheck="false" placeholder="https://example.com" required aria-label="Website URL or sitemap URL"><button class="btn" type="submit">Generate RSS Feed</button></div>
  <details class="sitemap-options rss-options"><summary>${icon('tune')} Feed settings</summary>
    <div class="sitemap-option-row"><label>Number of items <select name="maxItems" class="select"><option value="10">10</option><option value="20" selected>20</option><option value="50">50</option><option value="100">100</option></select></label><label>Item content <select name="contentMode" class="select"><option value="excerpt" selected>Excerpt</option><option value="full">Full content</option><option value="description">Description only</option></select></label><label>Feed format <select name="feedMode" class="select"><option value="standard" selected>Standard RSS 2.0</option><option value="news">News feed</option><option value="podcast">Podcast mode</option></select></label></div>
    <div class="sitemap-option-row"><label><input type="checkbox" name="incImages" checked> Include images</label><label><input type="checkbox" name="incAuthors" checked> Include authors</label><label><input type="checkbox" name="incCategories" checked> Include categories</label><label><input type="checkbox" name="incDates" checked> Include dates</label></div>
    <input type="hidden" name="excUndated" value="1"><input type="hidden" name="sortOrder" value="newest">
  </details>
</form>
${chips([['rss_feed','Existing feed detection'],['data_object','Accurate metadata'],['link','Canonical URLs'],['code','XML validated'],['download','Download ready']])}</section>
<div id="rss-results" class="audit-results rss-results"></div>
${cards('What does the generator do?', 'verified', cardsList)}
<div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('tips_and_updates')}<h4 style="margin:0;">Running a feed worth subscribing to</h4></div>${lede('A feed is a quiet contract with your most committed readers. These are the practices that keep it healthy.')}${guideGrid(guides)}
<p class="prose-block">Feeds, sitemaps and llms.txt are three faces of the same job. Generate the <a href="/xml-sitemap-generator">sitemap</a> and the <a href="/llms-txt-generator">llms.txt</a> from the same crawl, and check overall site health with the <a href="/">SEO audit</a>.</p></div>
${faqSection(faqs)}`;
  return layout('RSS Feed Generator | Free Website to RSS Tool | Huvanti', body, {
    active:'rss', canonical:'https://huvanti.com/rss-feed-generator',
    description:'Free RSS feed generator. Discover a website real content, extract accurate article metadata and download a validated RSS 2.0 or Atom feed. No account.',
    scripts:['/assets/js/progress.js','/assets/js/common.js','/assets/js/rss/browser.js','/assets/js/rss/ui.js'],
    jsonLd:[{'@context':'https://schema.org','@type':'WebApplication',name:'RSS Feed Generator',applicationCategory:'DeveloperApplication',operatingSystem:'Any',browserRequirements:'Requires JavaScript',offers:{'@type':'Offer','price':'0','priceCurrency':'USD'},description:'Free RSS and Atom feed generator with metadata extraction and XML validation.'}, faqLd(faqs)]
  });
}

/* ============================== STATIC PAGES ============================== */
function page(name) {
  const pages = {
    About: {
      title: 'About Huvanti',
      heading: 'About Huvanti',
      description: 'Huvanti.com builds free, no account website tools: deep SEO auditing, ad network readiness, sitemaps, feeds, domain intelligence and AI bot control.',
      html: `<p>Huvanti started with a familiar frustration. You want to check something about a website, you find a tool that promises to do it, and then it asks you to create an account before it shows you anything. Or it hands you a score with no explanation of where the score came from.</p>
<p>We built the opposite of that. Every tool on this site does its work first and explains itself after. You paste a URL, the tool crawls and measures, and the report shows the evidence behind every finding. If something cannot be verified, the report says so plainly.</p>
<h2>What you will find here</h2>
<p>The <a href="/">Deep SEO Auditor</a> is the centerpiece: it reviews up to 200 pages on any public site and scores twelve categories, from indexability and content quality to images, linking and security headers. Around it sit twelve focused tools. Four of them check ad network readiness for <a href="/adsense-eligibility-checker">AdSense</a>, <a href="/ezoic-eligibility-checker">Ezoic</a>, <a href="/mediavine-eligibility-checker">Mediavine</a> and <a href="/raptive-eligibility-checker">Raptive</a>, so you can fix problems before a human reviewer ever sees your site. The <a href="/wordpress-theme-detector">theme detector</a> and the <a href="/domain-information-checker">domain checker</a> look at how a site is built, hosted and registered. The <a href="/xml-sitemap-generator">sitemap</a>, <a href="/rss-feed-generator">RSS</a> and <a href="/llms-txt-generator">llms.txt</a> generators cover the formats that help people and machines discover your work, while the <a href="/broken-link-checker">broken link checker</a>, the <a href="/core-web-vitals-auditor">Core Web Vitals auditor</a> and the <a href="/ai-crawler-blocker">AI bot blocker</a> keep the day to day maintenance honest.</p>
<h2>How the tools work</h2>
<p>Everything runs from your browser against public pages, exactly the way any visitor's browser would. When a server side fetch is genuinely needed, it requests only the URL you entered and keeps nothing afterwards. The analysis itself is deterministic: real rules, real measurements and statistics you can inspect, not a language model asked for an opinion. That is why two runs on the same site produce the same report.</p>
<h2>Who it is for</h2>
<p>Website owners who do their own maintenance, freelancers checking client sites before a handover, publishers preparing ad network applications, and the simply curious. If a result ever looks wrong, tell us through the <a href="/contact">contact page</a> with the URL you checked, and we will take a look.</p>`
    },
    Contact: {
      title: 'Contact',
      heading: 'Contact',
      description: 'Contact the Huvanti team about a bug, a feature request or a question about the free website tools.',
      html: `<div class="contact-wrap"><div>
<h2>Say hello</h2>
<p>Questions, bug reports and feature ideas are all welcome. Write to <a href="mailto:hello@huvanti.com">hello@huvanti.com</a> or use the form, and we will read every word.</p>
<h2>What makes a good bug report?</h2>
<p>Three details get a much faster answer: the tool you were using, the URL you were checking, and what you expected versus what happened. If the tool showed an error message, copy the exact text into your email.</p>
<h2>What we do not do</h2>
<p>We do not offer paid placement, link exchanges, guest posts or sponsored reviews, and we cannot intercede with Google or any ad network on your behalf. Questions about eligibility requirements are answered by the checkers themselves.</p>
</div>
<form class="contact-form" id="contact-form" novalidate>
  <label>Your name <input type="text" id="contact-name" autocomplete="name" placeholder="Jane Doe" required></label>
  <label>Your email <input type="email" id="contact-email" autocomplete="email" placeholder="jane@example.com" required></label>
  <label>Topic
    <select id="contact-topic">
      <option>Bug report</option>
      <option>Feature idea</option>
      <option>Question about a tool</option>
      <option>Something else</option>
    </select>
  </label>
  <label>Message <textarea id="contact-message" placeholder="Tell us what happened, and include the URL you were checking." required></textarea></label>
  <button class="btn" type="submit"><span class="material-icons" aria-hidden="true">send</span>Send message</button>
  <p class="contact-note" id="contact-note">The form opens your email app with the message ready to send. Nothing is stored on our servers.</p>
</form></div>`
    },
    Privacy: {
      title: 'Privacy Policy',
      heading: 'Privacy Policy',
      description: 'How Huvanti handles data: the tools run in your browser, no account is required, and nothing you submit is stored on our servers.',
      html: `<p>This policy covers every page on huvanti.com. The short version: the tools run in your browser, we do not ask for an account, and we do not build profiles.</p>
<h2>What the tools process</h2>
<p>Most tools analyse the URL or text you submit directly in your browser. When a server side request is genuinely required, the request contains only what the tool needs, typically the URL you entered, and the result is not retained after your report is delivered.</p>
<h2>What stays on your device</h2>
<p>Saved settings, the dark mode preference and recent audit summaries for the compare feature live in your browser local storage. They never leave your device and you can remove them at any time by clearing site data in your browser.</p>
<h2>Third parties</h2>
<p>Pages load the Roboto and Material Icons font families from Google Fonts, which sees the requests any web server logs. When a tool cannot reach a site directly, it may fetch the public page through a public relay service so the analysis can proceed; those services see the requested URL, not anything about you. If the site is later supported by advertising, ads will be served by a network that sets its own cookies, and this policy will be updated to say so plainly.</p>
<h2>What we do not do</h2>
<p>We do not sell data, we do not run third party trackers of our own, and we do not ask for credentials to your analytics, ad networks or hosting. Any tool that offers optional extras, such as entering your own traffic figures, labels them clearly and sends them nowhere except into the report you see.</p>
<h2>Your choices and questions</h2>
<p>Clear your browser data to remove everything stored locally. For any privacy question, write to <a href="mailto:hello@huvanti.com">hello@huvanti.com</a> and you will get a straight answer.</p>`
    },
    Terms: {
      title: 'Terms of Use',
      heading: 'Terms of Use',
      description: 'The terms for using the free Huvanti website tools, including fair use, no guarantee and responsibility limits.',
      html: `<p>These terms apply to every tool on huvanti.com. By using the site you accept them.</p>
<h2>Free to use, within reason</h2>
<p>The tools are free for personal and commercial use. Check sites you own or have permission to analyse, keep usage reasonable, and do not use the tools to probe, pressure or attack any system. We may rate limit or block usage that harms the service or other sites.</p>
<h2>Results and their limits</h2>
<p>Reports are informational. Scores and status labels are this project own diagnostics, produced from evidence a public check can see. They are not official results from Google, AdSense, Ezoic, Mediavine, Raptive or any other platform, and they do not guarantee approval, ranking, traffic or earnings. Eligibility and approval decisions always belong to the platform you are applying to.</p>
<h2>Acceptance of output</h2>
<p>You are responsible for changes you make to your website based on a report, including configuration the bot blocker generates. Test server and CDN configuration changes before relying on them, and keep backups before editing robots.txt or server rules.</p>
<h2>Availability and changes</h2>
<p>We aim to keep the tools available and accurate, but we do not promise uninterrupted access, and features may change or be withdrawn. The content on the site is provided as is, without warranties of any kind.</p>
<h2>Contact</h2>
<p>Questions about these terms are welcome at <a href="mailto:hello@huvanti.com">hello@huvanti.com</a>.</p>`
    }
  };
  const p = pages[name];
  if (!p) return layout('Page not found | Huvanti', '<div class="container notfound"><h1>404</h1><p>The page you were looking for could not be found.</p><a class="btn" href="/">Back to the SEO audit</a></div>', { description: 'Page not found.' });
  const faqs = [
    ['Who is behind Huvanti?', 'Huvanti is an independent project building free browser based tools for website owners. See the <a href="/about">about page</a> for the full story.'],
    ['Are the tools really free?', 'Yes, every tool on the site is free to use with no account.'],
    ['Where can I ask a question?', 'Email <a href="mailto:hello@huvanti.com">hello@huvanti.com</a>. Bug reports that include the tool name, the URL checked and what happened get the fastest replies.']
  ];
  return layout(p.title, `<div class="container page"><h1 class="page-title">${esc(p.heading)}</h1><div class="paper paper-padded page-copy" style="max-width:860px">${p.html}</div></div>${faqSection(faqs)}`, {
    canonical: 'https://huvanti.com/' + name.toLowerCase(),
    description: p.description,
    scripts: ['/assets/js/progress.js','/assets/js/common.js'],
    jsonLd: faqLd(faqs)
  });
}
function readJson(req){ return new Promise(resolve=>{let b=''; req.on('data',d=>b+=d); req.on('end',()=>{try{resolve(JSON.parse(b||'{}'))}catch{resolve({})}});}); }

/* Safety net: one bad request must never take the whole server down. */
process.on('unhandledRejection', (e) => { console.error('unhandledRejection:', e && e.message); });
process.on('uncaughtException', (e) => { console.error('uncaughtException:', e && e.message); });

const PAGES = {
  '/': home,
  '/adsense-eligibility-checker': adsensePage,
  '/ezoic-eligibility-checker': ezoicPage,
  '/mediavine-eligibility-checker': mediavinePage,
  '/raptive-eligibility-checker': raptivePage,
  '/wordpress-theme-detector': wpthemePage,
  '/domain-information-checker': domainInfoPage,
  '/xml-sitemap-generator': sitemapPage,
  '/broken-link-checker': brokenlinkPage,
  '/llms-txt-generator': llmstxtPage,
  '/ai-crawler-blocker': botblockerPage,
  '/core-web-vitals-auditor': cwvPage,
  '/rss-feed-generator': rssPage
};

const SITE_MAP = Object.values(TOOLS).map(t => 'https://huvanti.com' + (t.path === '/' ? '/' : t.path))
  .concat(['https://huvanti.com/about','https://huvanti.com/contact','https://huvanti.com/privacy','https://huvanti.com/terms']);

http.createServer(async (req,res)=>{
  const u = new URL(req.url, 'http://local');
  const p = decodeURIComponent(u.pathname).replace(/\/$/, '') || '/';
  try {
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
  if (p === '/api/brokenlink' && req.method === 'POST') {
    const body = await readJson(req);
    await brokenlinkApi.handle(req, res, body);
    return;
  }
  if (p === '/api/llmstxt' && req.method === 'POST') {
    const body = await readJson(req);
    await llmstxtApi.handle(req, res, body);
    return;
  }
  if (p === '/api/llmstxt-finalize' && req.method === 'POST') {
    const body = await readJson(req);
    await llmstxtApi.handleFinalize(req, res, body);
    return;
  }
  if (p === '/api/llmstxt-browser' && req.method === 'POST') {
    const body = await readJson(req);
    await llmstxtApi.handleBrowser(req, res, body);
    return;
  }
  if (p === '/api/botblocker-inspect' && req.method === 'POST') {
    const body = await readJson(req);
    await botblockerApi.handle(req, res, body);
    return;
  }
  if (p === '/api/rss' && req.method === 'POST') {
    const body = await readJson(req);
    await rssApi.handle(req, res, body);
    return;
  }
  if (p === '/api/rss-finalize' && req.method === 'POST') {
    const body = await readJson(req);
    await rssApi.handleFinalize(req, res, body);
    return;
  }
  if (p === '/api/rss-browser' && req.method === 'POST') {
    const body = await readJson(req);
    await rssApi.handleBrowser(req, res, body);
    return;
  }
  if (p === '/api/cwv-fetch' && req.method === 'POST') {
    const body = await readJson(req);
    await cwvApi.handleFetch(req, res, body);
    return;
  }
  if (p === '/api/cwv-page' && req.method === 'GET') {
    cwvApi.handlePage(req, res, u.searchParams);
    return;
  }
  if (p === '/api/cwv-proxy' && req.method === 'GET') {
    await cwvApi.handleProxy(req, res, u.searchParams);
    return;
  }
  if (p === '/api/cwv-meta' && req.method === 'GET') {
    cwvApi.handleMeta(req, res, u.searchParams);
    return;
  }
  if (p === '/api/cwv-analyze' && req.method === 'POST') {
    const body = await readJson(req);
    await cwvApi.handleAnalyze(req, res, body);
    return;
  }
  if (p === '/robots.txt') {
    send(req, res, 200, 'text/plain; charset=utf-8',
      'User-agent: *\nAllow: /\n\nSitemap: https://huvanti.com/sitemap.xml\n', 'public, max-age=86400');
    return;
  }
  if (p === '/sitemap.xml') {
    const today = new Date().toISOString().slice(0, 10);
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      SITE_MAP.map(url => '  <url><loc>' + url + '</loc><lastmod>' + today + '</lastmod></url>').join('\n') + '\n</urlset>\n';
    send(req, res, 200, 'application/xml; charset=utf-8', xml, 'public, max-age=3600');
    return;
  }
  if (p === '/favicon.ico') { res.statusCode = 204; res.end(); return; }
  if (p.startsWith('/assets/') || p.startsWith('/lib/botblocker/') || p.startsWith('/lib/cwv/')) {
    // Only expose the browser engine modules, not server-only or test files.
    if (p.startsWith('/lib/botblocker/') && /(selftest|uitest|api)\.js$/.test(p)) { res.statusCode = 404; res.end('Not found'); return; }
    if (p.startsWith('/lib/cwv/') && p !== '/lib/cwv/rewriter.js') { res.statusCode = 404; res.end('Not found'); return; }
    const base = u.pathname;
    const safe = path.normalize(base).replace(/^([.][.][/\\])+/, '');
    const f = path.join(process.cwd(), safe);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ext = path.extname(f).toLowerCase();
      const type = {'.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.svg':'image/svg+xml'}[ext] || 'application/octet-stream';
      send(req, res, 200, type, fs.readFileSync(f), 'public, max-age=31536000, immutable');
      return;
    }
    res.statusCode=404; res.end('Not found'); return;
  }
  let html; let status = 200;
  if (PAGES[p]) html = PAGES[p]();
  else if (['/about','/contact','/privacy','/terms'].includes(p)) html = page(p.slice(1).replace(/^./,c=>c.toUpperCase()));
  else { html = layout('Page not found | Huvanti', `<div class="container notfound"><h1>404</h1><p>The page you were looking for could not be found.</p><a class="btn" href="/">Back to the SEO audit</a></div>`, { description: 'Page not found.' }); status = 404; }
  send(req, res, status, 'text/html; charset=utf-8', html);
  } catch (e) {
    console.error('request error:', p, e && e.message);
    try {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ code: 'error', message: 'Internal error.' }));
      } else { try { res.end(); } catch {} }
    } catch {}
  }
}).listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Huvanti running'));
