const http = require('http');
const fs = require('fs');
const path = require('path');

const criticalCss = fs.readFileSync('assets/css/style.css', 'utf8');
const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const icon = name => `<span class="material-icons" aria-hidden="true">${esc(name)}</span>`;

function layout(title, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(title)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&family=Material+Icons&display=swap" rel="stylesheet"><style>${criticalCss}</style></head><body><a class="skip-link" href="#main">Skip to content</a><div class="app"><header class="appbar"><div class="toolbar"><a class="brand" href="/">${icon('travel_explore')}<span class="brand-name">huvanti</span></a><nav class="desktop-nav"><a href="/">${icon('home')}<span>Home</span></a><a href="/about">${icon('info')}<span>About</span></a><a href="/contact">${icon('mail')}<span>Contact</span></a></nav><button type="button" class="icon-button theme-toggle" aria-label="toggle theme" id="theme-toggle"><span class="material-icons">brightness_4</span></button></div></header><main id="main">${body}</main><footer class="footer"><div class="container footer-grid"><div><div class="footer-brand">huvanti</div><p class="footer-tagline">SEO audit tool</p></div><div><div class="footer-heading">Pages</div><div class="footer-links"><a href="/about">About</a><a href="/contact">Contact</a></div></div></div><div class="container footer-copyright">&copy; 2026 huvanti. All rights reserved.</div></footer></div><script src="/assets/js/common.js"></script><script src="/assets/js/audit.js"></script></body></html>`;
}

function home() {
  return layout('huvanti SEO Audit', `<section class="hero audit-home"><span class="material-icons hero-icon" aria-hidden="true">travel_explore</span><h1>huvanti</h1><p class="hero-subtitle">Technical SEO audit for any public website</p><form id="audit-form" class="search-field audit-search" role="search"><span class="material-icons" aria-hidden="true">link</span><input id="audit-url" type="url" placeholder="https://yourwebsite.com" required><select id="crawl-limit" class="crawl-select" aria-label="Crawl limit"><option value="3">3 pages</option><option value="6" selected>6 pages</option><option value="12">12 pages</option></select><button class="btn" type="submit">Audit</button></form><div class="audit-trust"><span>Crawl</span><span>Robots</span><span>Sitemap</span><span>Titles</span><span>Links</span><span>Images</span><span>AI bots</span></div></section><div id="audit-results" class="audit-results"></div><div class="container section"><div class="section-heading-row">${icon('verified')}<h4 style="margin:0;">What this audit checks</h4></div><div class="grid"><div class="cell w-xs-12 w-md-4"><div class="card card-hover"><div class="card-content"><h6>Technical SEO</h6><p>HTTPS, robots.txt, sitemap discovery, URL structure, indexability signals, and crawl sample.</p></div></div></div><div class="cell w-xs-12 w-md-4"><div class="card card-hover"><div class="card-content"><h6>On-page SEO</h6><p>Titles, headings, content depth, keyword themes, internal links, weak anchors, and duplicate signals.</p></div></div></div><div class="cell w-xs-12 w-md-4"><div class="card card-hover"><div class="card-content"><h6>Media & AI Search</h6><p>Image alt coverage, modern image formats, AI crawler access, and structured data follow-up checks.</p></div></div></div></div></div><div class="container section" style="padding-top:0"><div class="section-heading-row">${icon('help')}<h4 style="margin:0;">FAQ</h4></div><div class="faq-accordion"><details><summary>Does this require an account?</summary><p>No. Paste a URL and run the audit.</p></details><details><summary>Is every metric measurable here?</summary><p>The tool measures crawlable page data directly. Browser field metrics like LCP, INP and CLS need PageSpeed/CrUX access, so they are marked as informational, not fake-scored.</p></details><details><summary>Why use crawl limits?</summary><p>A quick audit samples key pages. Increase the limit to crawl more discovered internal URLs.</p></details></div></div>`);
}

function page(name) { return layout(name, `<div class="container page"><h1 class="page-title">${esc(name)}</h1><div class="paper paper-padded"><p>huvanti provides a simple URL-based SEO audit without accounts.</p></div></div>`); }

async function readJson(req){ return new Promise(resolve=>{let b=''; req.on('data',d=>b+=d); req.on('end',()=>{try{resolve(JSON.parse(b||'{}'))}catch{resolve({})}});}); }

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
  if (p.startsWith('/assets/')) {
    const safe = path.normalize(p).replace(/^([.][.][/\\])+/, '');
    const f = path.join(process.cwd(), safe);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ext = path.extname(f).toLowerCase();
      const type = {'.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'}[ext] || 'application/octet-stream';
      res.setHeader('content-type', type); res.setHeader('cache-control','no-store'); res.end(fs.readFileSync(f)); return;
    }
    res.statusCode=404; res.end('Not found'); return;
  }
  let html = p==='/' ? home() : ['/about','/contact','/privacy','/terms'].includes(p) ? page(p.slice(1).replace(/^./,c=>c.toUpperCase())) : layout('Not found', `<div class="container notfound"><h1>404</h1><p>Page not found.</p></div>`);
  res.setHeader('content-type','text/html; charset=utf-8'); res.setHeader('cache-control','no-store'); res.end(html);
}).listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('huvanti preview running'));
