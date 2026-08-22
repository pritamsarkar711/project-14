'use strict';

const U = require('./util');

const IMPORTANT = [
  { key: 'about', label: 'About', patterns: [/about/, /who[- ]we[- ]are/, /our[- ]story/, /\bcompany\b/, /\bteam\b/] },
  { key: 'contact', label: 'Contact', patterns: [/contact/, /get[- ]in[- ]touch/, /reach[- ]us/, /support/] },
  { key: 'privacy', label: 'Privacy Policy', patterns: [/privacy/] },
  { key: 'terms', label: 'Terms', patterns: [/terms/, /conditions/, /\btos\b/, /legal/] },
  { key: 'disclaimer', label: 'Disclaimer', patterns: [/disclaimer/] },
  { key: 'cookie', label: 'Cookie Policy', patterns: [/cookie/] },
  { key: 'author', label: 'Author', patterns: [/\/author\b/, /\/writers?\b/, /our[- ]authors/] },
  { key: 'blog', label: 'Blog', patterns: [/^\/blog\/?$/, /\/articles\/?$/, /\/news\/?$/] },
  { key: 'editorial', label: 'Editorial Policy', patterns: [/editorial/, /editorial[- ]policy/] },
  { key: 'resources', label: 'Resources', patterns: [/resources/, /guides/, /learn/] },
  { key: 'sitemap', label: 'HTML Sitemap', patterns: [/sitemap/] }
];

function classifyPage(p, importantKeyByUrl) {
  const path = U.pathOf(p.url);
  if (!p.parse) return 'other';
  const ek = importantKeyByUrl && importantKeyByUrl.get && importantKeyByUrl.get(p.url);
  if (ek) {
    return {
      about: 'about', contact: 'contact', privacy: 'privacy', terms: 'terms',
      disclaimer: 'disclaimer', cookie: 'privacy', author: 'author',
      blog: 'blog', editorial: 'editorial', resources: 'blog', sitemap: 'other'
    }[ek] || 'other';
  }
  const t = ((p.parse.title || '') + ' ' + (p.parse.h1 || []).join(' ') + ' ' + path).toLowerCase();
  if (/\/(login|signin|sign-in|log-in|register|signup|account|auth)(\/|$)/i.test(path)) return 'login';
  if (/[?&]s=|\/search|\/find/i.test(path)) return 'search';
  if (/\/(author|user|profile|members)\//i.test(path) || (p.parse.schemaTypes || []).indexOf('Person') >= 0) return 'author';
  if (path === '/' || path === '') return 'homepage';
  if (/privacy/i.test(t)) return 'privacy';
  if (/terms|conditions/i.test(t) && /terms|legal/i.test(path)) return 'terms';
  if (/disclaimer/i.test(t)) return 'disclaimer';
  if (/cookie/i.test(t) && /cookie/i.test(path)) return 'privacy';
  if (/editorial/i.test(t) && /editorial|policy/i.test(path)) return 'editorial';
  if (/contact/i.test(t) && /contact/i.test(path + t)) return 'contact';
  if (/\babout\b/i.test(t) && /about/i.test(path)) return 'about';
  if ((p.parse.schemaTypes || []).indexOf('Article') >= 0 || (p.parse.schemaTypes || []).indexOf('BlogPosting') >= 0 || /\/(blog|news|article|post|story|guide|tutorial)\//i.test(path)) return 'article';
  if (/\/(blog|news|articles|posts)\/?$/i.test(path)) return 'blog';
  if (/\/(product|item|shop|buy|pricing|plan)/i.test(path) || (p.parse.schemaTypes || []).indexOf('Product') >= 0) return 'product';
  if (/\/(category|collection|tag|topics)\b/i.test(path) || (p.parse.schemaTypes || []).indexOf('CollectionPage') >= 0) return 'category';
  if (/\/(tag|topic)\b/i.test(path)) return 'tag';
  if (/\/(tool|calculator|converter|generator|checker|app)\b/i.test(path)) return 'tool';
  if (/\/(directory|listings?|sites)\//i.test(path)) return 'directory';
  if (/\/(docs?|documentation|api|reference)\b/i.test(path)) return 'docs';
  if (/\/(forum|thread|topic)\b/i.test(path)) return 'forum';
  if (/\/(about|our-?company|who-we-are)\b/i.test(t)) return 'about';
  // business vs content fallback
  const blob = t + ' ' + String(p.parse.visibleText || '').slice(0, 300).toLowerCase();
  if (/\b(services|solutions|consulting|enterprise|pricing|book a|quote|contact us)\b/.test(blob) && /\b(services|solutions|consulting|enterprise|llc|inc|company|firm)\b/.test(blob)) return 'business';
  if (p.parse.wordCount >= 280 && p.parse.headingsCount >= 2) return 'article';
  if (p.parse.wordCount >= 80) return 'content';
  return 'other';
}

// 'blog' (a blog/archive listing page) is a utility page, article-content rules must not
// apply to it. Individual blog posts are classified 'article' via their path.
const CONTENT_TYPES = { content: 1, article: 1, 'blog post': 1 };
const UTILITY_TYPES = {
  about: 1, contact: 1, privacy: 1, terms: 1, disclaimer: 1, login: 1, editorial: 1,
  search: 1, author: 1, homepage: 1, tool: 1, category: 1, tag: 1, product: 1,
  directory: 1, docs: 1, forum: 1, blog: 1
};

function detectImportant(pages) {
  const inlinkCount = {};
  const linkedFromHome = {};
  const home = pages[0] && pages[0].url;
  const anchors = [];
  pages.forEach(p => {
    (p.parse && p.parse.links || []).forEach(l => {
      if (!l.internal) return;
      inlinkCount[l.href] = (inlinkCount[l.href] || 0) + 1;
      if (home && p.url === home) linkedFromHome[l.href] = true;
      anchors.push({ text: l.text, href: l.href, from: p.url });
    });
  });
  const found = [];
  IMPORTANT.forEach(def => {
    let best = null;
    pages.forEach(p => {
      if (!p.parse) return;
      const path = U.pathOf(p.url);
      const strong = [path, p.parse.title, (p.parse.h1 || []).join(' ')].join(' ').toLowerCase();
      const weak = String(p.parse.visibleText || '').slice(0, 1800).toLowerCase();
      let score = 0;
      def.patterns.forEach(pat => { if (pat.test(strong)) score += 4; else if (pat.test(weak)) score += 1; });
      anchors.filter(a => a.href === p.url).forEach(a => { def.patterns.forEach(pat => { if (pat.test(String(a.text || '').toLowerCase())) score += 3; }); });
      if (score >= 3) {
        const conf = U.clamp(0.42 + score * 0.1, 0.42, 0.99);
        if (!best || conf > best.confidence) best = { page: p, url: p.url, confidence: Math.round(conf * 100), score };
      }
    });
    if (best) {
      const linked = !!(linkedFromHome[best.url] || (inlinkCount[best.url] || 0) >= Math.max(2, Math.round(pages.length * 0.35)));
      found.push(Object.assign({}, def, best, { linkedFromNav: linked, inlinks: inlinkCount[best.url] || 0 }));
    }
  });
  return found;
}

function detectSiteType(pages) {
  const parsed = pages.filter(p => p.parse);
  const blob = parsed.map(p => [p.parse.title, (p.parse.h1 || []).join(' '), U.pathOf(p.url), (p.parse.visibleText || '').slice(0, 400)].join(' ')).join(' ').toLowerCase();
  const s = { blog: 0, news: 0, saas: 0, tools: 0, directory: 0, ecommerce: 0, business: 0, portfolio: 0, educational: 0, documentation: 0, forum: 0, other: 0 };
  if (/blog|article|posted on|leave a comment|byline/.test(blob)) s.blog += 3;
  if (/news|breaking|headline|press release/.test(blob)) s.news += 3;
  if (/add to cart|woocommerce|shopify|checkout|sku|product price/.test(blob)) s.ecommerce += 5;
  if (/pricing|free trial|sign up|saas|dashboard|subscribe/.test(blob)) s.saas += 3;
  if (/calculator|converter|generator|checker|\btool\b/.test(blob)) s.tools += 4;
  if (/directory|submit (your )?site|listings/.test(blob)) s.directory += 3;
  if (/portfolio|selected work|case study|my work/.test(blob)) s.portfolio += 2;
  if (/forum|thread|replies|community/.test(blob)) s.forum += 3;
  if (/course|lesson|curriculum|university|academy/.test(blob)) s.educational += 3;
  if (/documentation|api reference|getting started|sdk/.test(blob)) s.documentation += 3;
  if (/services|solutions|consulting|enterprise|\bllc\b|\binc\b/.test(blob)) s.business += 2;
  let best = ['other', 0];
  Object.keys(s).forEach(k => { if (s[k] > best[1]) best = [k, s[k]]; });
  const articleish = parsed.filter(p => CONTENT_TYPES[classifyPage(p)]).length;
  if (best[0] === 'ecommerce' && articleish >= 8) return 'ecommerce';
  if (best[1] <= 1) {
    if (articleish >= Math.max(3, parsed.length * 0.4)) return 'blog';
    return 'business';
  }
  return best[0];
}

function isContentPage(type, siteType) {
  if (CONTENT_TYPES[type]) return true;
  if (type === 'docs' && siteType === 'documentation') return true;
  if (type === 'other' && siteType === 'blog') return true;
  if (type === 'business' && siteType === 'business') return true;
  return false;
}

function skipThinRules(type, siteType) {
  if (UTILITY_TYPES[type] && type !== 'homepage' && type !== 'blog') return true;
  if (type === 'tool' || siteType === 'tools') return type === 'tool' || type === 'homepage';
  return false;
}

module.exports = {
  IMPORTANT, CONTENT_TYPES, UTILITY_TYPES,
  classifyPage, detectImportant, detectSiteType, isContentPage, skipThinRules
};
