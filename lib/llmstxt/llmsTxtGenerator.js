'use strict';

/*
 * LLMs.txt Generator, markdown generation (selection + rendering).
 *
 * Produces the simplest valid llms.txt structure per the current llmstxt.org
 * spec: an H1, a blockquote summary, then H2 "file list" sections whose items
 * are `- [name](url): optional notes`. The "## Optional" section holds
 * secondary resources. No unsupported fields are added.
 */

const { clean } = require('./descriptionGenerator');

const SECTION_ORDER = ['Important Pages', 'Documentation', 'Products', 'Services', 'Blog', 'Guides', 'Tools', 'FAQ', 'Resources', 'Optional'];

function linkTitle(page) {
  if (page.userTitle) return clean(page.userTitle);
  if (page.category === 'Home') return 'Homepage';
  const t = clean(page.title || page.h1 || '');
  if (t) return t;
  try {
    const p = new URL(page.url).pathname.replace(/\/+$/, '');
    const last = p.split('/').filter(Boolean).pop() || new URL(page.url).hostname;
    return clean(last.replace(/[-_]+/g, ' ')) || 'Page';
  } catch { return 'Page'; }
}

function mdLink(url, title, desc) {
  let dest = url;
  if (/[\s()<>]/.test(url)) dest = '<' + url.replace(/</g, '%3C').replace(/>/g, '%3E') + '>';
  const name = clean(title || '');
  const note = clean(desc || '');
  return '- [' + (name || dest) + '](' + dest + ')' + (note ? ': ' + note : '');
}

function isDocCategory(cat) { return cat === 'Documentation' || cat === 'Knowledge Base'; }
function isGuideCategory(cat) { return cat === 'Guides' || cat === 'Tutorials'; }

/* Choose pages for each section. Returns { sections, used } and marks pages. */
/* Sort pages within a section: explicit user order first, then score. */
function orderSection(list) {
  return list.slice().sort((a, b) => {
    const ao = a.order != null ? a.order : a.userOrder != null ? a.userOrder : null;
    const bo = b.order != null ? b.order : b.userOrder != null ? b.userOrder : null;
    if (ao != null && bo != null && ao !== bo) return ao - bo;
    if (ao != null && bo == null) return -1;
    if (bo != null && ao == null) return 1;
    return (b.score || 0) - (a.score || 0);
  });
}

function selectPages(pages, site, options) {
  const eligible = pages.filter(p => p.included);
  const sorted = eligible.slice().sort((a, b) => (b.score || 0) - (a.score || 0));

  const used = new Set();
  const sections = {}; // name -> array of pages

  const home = sorted.find(p => p.category === 'Home');
  const about = sorted.filter(p => p.category === 'About').slice(0, 1);
  const contact = sorted.filter(p => p.category === 'Contact').slice(0, 1);

  const important = [];
  const pushImp = p => { if (p && !used.has(p.url)) { important.push(p); used.add(p.url); } };
  pushImp(home);
  about.forEach(pushImp);
  contact.forEach(pushImp);

  // Key landing pages: high-score pages that won't get a dedicated section.
  const dedicated = new Set(['Documentation', 'Knowledge Base', 'Products', 'Services', 'Blog', 'Guides', 'Tutorials', 'Tools', 'FAQ']);
  for (const p of sorted) {
    if (important.length >= 8) break;
    if (used.has(p.url)) continue;
    if (dedicated.has(p.category)) continue;
    if (p.kind === 'category' || p.kind === 'author' || p.kind === 'pdf') continue;
    if ((p.score || 0) < 55) continue;
    pushImp(p);
  }
  if (important.length) sections['Important Pages'] = important;

  // Documentation (+ Knowledge Base).
  if (options.includeDocs !== false) {
    const docs = sorted.filter(p => isDocCategory(p.category) && !used.has(p.url) && p.kind !== 'pdf').slice(0, 40);
    if (docs.length) { sections['Documentation'] = docs; docs.forEach(p => used.add(p.url)); }
  }

  // Products.
  const maxProducts = options.maxProducts === 'all' ? 250 : (Number(options.maxProducts) || 50);
  const products = sorted.filter(p => p.category === 'Products' && !used.has(p.url)).slice(0, maxProducts);
  if (products.length) { sections['Products'] = products; products.forEach(p => used.add(p.url)); }

  // Services.
  const services = sorted.filter(p => p.category === 'Services' && !used.has(p.url)).slice(0, 40);
  if (services.length) { sections['Services'] = services; services.forEach(p => used.add(p.url)); }

  // Blog.
  if (options.includeBlog !== false) {
    const maxBlog = options.maxBlogUrls === 'all' ? 250 : (Number(options.maxBlogUrls) || 25);
    const blog = sorted.filter(p => (p.category === 'Blog' || p.kind === 'article') && !used.has(p.url)).slice(0, maxBlog);
    if (blog.length) { sections['Blog'] = blog; blog.forEach(p => used.add(p.url)); }
  }

  // Guides + Tutorials.
  const guides = sorted.filter(p => isGuideCategory(p.category) && !used.has(p.url)).slice(0, 40);
  if (guides.length) { sections['Guides'] = guides; guides.forEach(p => used.add(p.url)); }

  // Tools.
  const tools = sorted.filter(p => p.category === 'Tools' && !used.has(p.url)).slice(0, 40);
  if (tools.length) { sections['Tools'] = tools; tools.forEach(p => used.add(p.url)); }

  // FAQ.
  const faq = sorted.filter(p => p.category === 'FAQ' && !used.has(p.url)).slice(0, 20);
  if (faq.length) { sections['FAQ'] = faq; faq.forEach(p => used.add(p.url)); }

  // Resources (own section only when there are several; otherwise Optional).
  const resources = sorted.filter(p => p.category === 'Resources' && !used.has(p.url)).slice(0, 40);
  if (resources.length >= 2) { sections['Resources'] = resources; resources.forEach(p => used.add(p.url)); }

  // Optional: everything else still eligible (lower priority, PDFs, author pages, remaining resources).
  const optional = [];
  for (const p of sorted) {
    if (used.has(p.url)) continue;
    if (p.kind === 'pdf' && options.includePdfs === false) continue;
    if (p.kind === 'author' && options.includeAuthors === false) continue;
    if (p.kind === 'category' && options.includeCategories === false) continue;
    optional.push(p);
    used.add(p.url);
    if (optional.length >= 200) break;
  }
  if (optional.length) sections['Optional'] = optional;

  // Mark placement on each page for the UI/table.
  for (const p of eligible) p.section = Object.keys(sections).find(name => (sections[name] || []).includes(p)) || null;
  for (const p of eligible) p.inFile = !!p.section;

  const ordered = {};
  for (const name of SECTION_ORDER) if (sections[name]) ordered[name] = orderSection(sections[name]);
  return { sections: ordered, count: [...used].length };
}

function renderSections(sections, site) {
  const lines = [];
  const siteName = clean(site.name || site.title || site.host || 'Website');
  lines.push('# ' + siteName);
  lines.push('');
  const desc = clean(site.description || '');
  if (desc) { lines.push('> ' + desc); lines.push(''); }

  const names = Object.keys(sections);
  names.forEach((name, i) => {
    lines.push('## ' + name);
    lines.push('');
    for (const p of sections[name]) {
      lines.push(mdLink(p.canonical || p.url, linkTitle(p), p.userDescription != null ? p.userDescription : p.description));
    }
    if (i < names.length - 1) lines.push('');
  });

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function render(pages, site, options) {
  const { sections } = selectPages(pages, site, options);
  return renderSections(sections, site);
}

module.exports = { render, renderSections, selectPages, mdLink, linkTitle, SECTION_ORDER };
