'use strict';

/*
 * LLMs.txt Generator, deterministic page classifier.
 * Classifies pages into categories using URL structure, breadcrumbs, headings,
 * navigation labels, sitemap location and structured-data metadata.
 * No AI: weighted keyword/pattern voting only.
 */

const { segmentsOf, pathOf } = require('./urlNormalizer');

// Ordered URL-segment keyword rules. First segment match wins ties by weight.
const SEGMENT_RULES = [
  { cat: 'Documentation', segs: ['docs', 'documentation', 'reference', 'api', 'api-reference', 'developers', 'developer', 'learn'] },
  { cat: 'Knowledge Base', segs: ['knowledge-base', 'knowledgebase', 'kb', 'help-center', 'helpcentre', 'support', 'help'] },
  { cat: 'Guides', segs: ['guide', 'guides', 'how-to', 'howto'] },
  { cat: 'Tutorials', segs: ['tutorial', 'tutorials'] },
  { cat: 'FAQ', segs: ['faq', 'faqs', 'frequently-asked-questions'] },
  { cat: 'Blog', segs: ['blog', 'news', 'articles', 'posts', 'updates', 'insights', 'journal'] },
  { cat: 'Products', segs: ['product', 'products', 'item', 'items', 'shop', 'store', 'collection', 'collections', 'pricing', 'plans'] },
  { cat: 'Services', segs: ['services', 'service', 'solutions', 'consulting', 'packages'] },
  { cat: 'Resources', segs: ['resources', 'resource', 'library', 'downloads', 'whitepapers', 'white-papers', 'case-studies', 'ebooks', 'glossary', 'reports', 'webinars'] },
  { cat: 'Tools', segs: ['tools', 'tool', 'calculator', 'calculators', 'generator', 'generators', 'checker', 'checkers'] },
  { cat: 'About', segs: ['about', 'about-us', 'team', 'company', 'who-we-are', 'history', 'careers', 'jobs'] },
  { cat: 'Contact', segs: ['contact', 'contact-us', 'get-in-touch', 'reach-us'] }
];

const BREADCRUMB_RULES = [
  { cat: 'Documentation', keys: ['docs', 'documentation', 'reference', 'api', 'developer'] },
  { cat: 'Knowledge Base', keys: ['knowledge base', 'help center', 'helpcentre', 'support'] },
  { cat: 'Guides', keys: ['guide', 'guides'] },
  { cat: 'Tutorials', keys: ['tutorial', 'tutorials'] },
  { cat: 'FAQ', keys: ['faq', 'frequently asked'] },
  { cat: 'Blog', keys: ['blog', 'news', 'articles', 'posts'] },
  { cat: 'Products', keys: ['product', 'products', 'shop', 'store'] },
  { cat: 'Services', keys: ['services', 'service', 'solutions'] },
  { cat: 'Resources', keys: ['resources', 'library', 'downloads'] },
  { cat: 'Tools', keys: ['tools', 'calculator', 'generator', 'checker'] },
  { cat: 'About', keys: ['about', 'team', 'company'] },
  { cat: 'Contact', keys: ['contact'] }
];

const TITLE_RULES = [
  { cat: 'Documentation', re: /\b(documentation|docs|api reference|developer|reference)\b/i },
  { cat: 'Knowledge Base', re: /\b(knowledge base|help center|help centre)\b/i },
  { cat: 'Guides', re: /\b(guide|how to|how-to)\b/i },
  { cat: 'Tutorials', re: /\btutorial\b/i },
  { cat: 'FAQ', re: /\b(faq|frequently asked questions)\b/i },
  { cat: 'Blog', re: /\b(blog|news|articles?|posts?)\b/i },
  { cat: 'Products', re: /\b(product|shop|store|pricing)\b/i },
  { cat: 'Services', re: /\b(services?|solutions)\b/i },
  { cat: 'Resources', re: /\b(resources?|library|downloads?)\b/i },
  { cat: 'Tools', re: /\b(tools?|calculator|generator|checker)\b/i },
  { cat: 'About', re: /\babout us\b/i },
  { cat: 'Contact', re: /\bcontact us\b/i }
];

const STRUCTURED_TYPE_MAP = {
  product: 'Products',
  service: 'Services',
  article: 'Blog',
  newsarticle: 'Blog',
  blogposting: 'Blog',
  techarticle: 'Blog',
  faqpage: 'FAQ',
  howto: 'Guides',
  softwareapplication: 'Tools',
  webapplication: 'Tools'
};

function navLabelCategory(navLabels) {
  const labels = (navLabels || []).map(s => String(s || '').toLowerCase());
  const text = labels.join(' | ');
  const rules = [
    { cat: 'Documentation', re: /\b(documentation|docs|developer|reference|api)\b/i },
    { cat: 'Knowledge Base', re: /\b(knowledge base|help center|support|help)\b/i },
    { cat: 'Guides', re: /\bguides?\b/i },
    { cat: 'Tutorials', re: /\btutorials?\b/i },
    { cat: 'FAQ', re: /\bfaq\b/i },
    { cat: 'Blog', re: /\b(blog|news|articles?|posts?)\b/i },
    { cat: 'Products', re: /\b(products?|shop|store)\b/i },
    { cat: 'Services', re: /\bservices?\b/i },
    { cat: 'Resources', re: /\bresources?\b/i },
    { cat: 'Tools', re: /\btools?\b/i },
    { cat: 'About', re: /\babout\b/i },
    { cat: 'Contact', re: /\bcontact\b/i }
  ];
  for (const r of rules) if (r.re.test(text)) return r.cat;
  return null;
}

function classify(page, site) {
  const path = pathOf(page.url);
  const segs = segmentsOf(page.url);
  const votes = new Map();
  const add = (cat, w) => votes.set(cat, (votes.get(cat) || 0) + w);

  // Homepage.
  const isHome = site && (site.root && pathOf(site.root) === path && page.url.replace(/\/$/, '') === site.root.replace(/\/$/, ''));
  if (isHome || path === '/') return { category: 'Home', signals: ['homepage'] };

  // URL segments (weight 4, strongest textual signal).
  for (const seg of segs) {
    for (const r of SEGMENT_RULES) {
      if (r.segs.includes(seg)) { add(r.cat, 4); break; }
    }
  }

  // Breadcrumbs (weight 3).
  const crumbs = (page.breadcrumbs || []).map(s => String(s || '').toLowerCase());
  if (crumbs.length) {
    for (const r of BREADCRUMB_RULES) {
      if (crumbs.some(c => r.keys.some(k => c.includes(k)))) add(r.cat, 3);
    }
  }

  // Structured data types (weight 5).
  for (const t of (page.types || [])) {
    const mapped = STRUCTURED_TYPE_MAP[t];
    if (mapped) add(mapped, 5);
  }

  // og:type (weight 3).
  if (/^article$/i.test(page.ogType || '')) add('Blog', 3);
  if (/^product/i.test(page.ogType || '')) add('Products', 3);

  // Headings (weight 2).
  const headings = [page.h1, ...(page.h2 || [])].filter(Boolean).join(' | ');
  for (const r of TITLE_RULES) if (r.re.test(headings)) add(r.cat, 2);

  // Title (weight 2).
  for (const r of TITLE_RULES) if (r.re.test(page.title || '')) add(r.cat, 2);

  // Navigation labels pointing at this page (weight 4).
  const navCat = navLabelCategory(page.navLabels);
  if (navCat) add(navCat, 4);

  if (!votes.size) return { category: 'Other', signals: [] };

  let best = null;
  for (const [cat, w] of votes) {
    if (!best || w > best.w || (w === best.w && cat === 'Documentation')) best = { cat, w };
  }
  return { category: best.cat, signals: [...votes.keys()] };
}

module.exports = { classify, SEGMENT_RULES, STRUCTURED_TYPE_MAP, navLabelCategory };
