'use strict';

/*
 * RSS Feed Generator — crawl pipeline + analysis.
 *
 * `crawlSite`      : website mode — URL validation → robots.txt → sitemap
 *                    discovery (with lastmod) → existing-feed detection →
 *                    bounded concurrent crawl → metadata extraction →
 *                    classification → dedup → broken-URL verification →
 *                    selection → RSS/Atom generation → validation → score.
 * `crawlSitemap`   : sitemap mode — parse a user-supplied sitemap, fetch its
 *                    URLs, run the identical analysis.
 * `analyzeAndReport`: deterministic analysis + generation over collected
 *                    pages (shared by the server crawl and the browser
 *                    fallback, so both produce identical output).
 * `finalize`       : regenerate the feed from the user's edited page list
 *                    (manual include/exclude, title/date/category/URL edits,
 *                    added items) without re-crawling.
 *
 * SSRF-safe, bounded concurrency, no AI, no paid APIs, no fabricated data.
 */

const { validateUrl } = require('../llmstxt/urlValidator');
const { safeFetch } = require('../llmstxt/safeFetcher');
const { fetchRobots } = require('../llmstxt/robotsParser');
const { normalizeUrl, isInternal, canonicalKey, hostOf, isAssetUrl, isBinaryUrl } = require('../llmstxt/urlNormalizer');
const { parsePage } = require('../llmstxt/pageParser');
const { makeError } = require('../wptheme/util');

const { discoverSitemaps, readSitemap, parseSitemapXml } = require('./sitemapParser');
const { detectExistingFeed } = require('./feedDetector');
const { extractArticle, pickTitle, pickDescription, pickDate } = require('./articleExtractor');
const { classify, isFeedable } = require('./pageClassifier');
const { dedupeItems } = require('./duplicateDetector');
const { sanitizeHtml, cleanDescription } = require('./contentSanitizer');
const { generateRss } = require('./rssGenerator');
const { generateAtom } = require('./atomGenerator');
const { validateRss } = require('./xmlValidator');
const { scoreFeed } = require('./feedQualityScorer');
const { compareFeeds } = require('./feedComparator');
const { parseDate, toRfc822 } = require('./dateExtractor');

const MAX_ARTICLE_HTML = 60 * 1024;

function detectPlatform(homeBody, headers) {
  const b = String(homeBody || '').slice(0, 200000);
  const h = headers || {};
  const found = [];
  if (/wp-content\/|\/wp-includes\/|<meta[^>]+generator[^>]+WordPress/i.test(b)) found.push('WordPress');
  if (/wp-content\/themes\/[^/]*\/woocommerce|woocommerce/i.test(b)) found.push('WooCommerce');
  if (/cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i.test(b)) found.push('Shopify');
  if (/__NEXT_DATA__|_next\/static/i.test(b)) found.push('Next.js');
  if (/data-reactroot|react-root/i.test(b)) found.push('React');
  if (/drupal|Drupal\.settings/i.test(b)) found.push('Drupal');
  if (/joomla|Joomla!/i.test(b)) found.push('Joomla');
  if (/webflow|data-wf-site/i.test(b)) found.push('Webflow');
  if (/laravel_session|XSRF-TOKEN/i.test((h['set-cookie'] || '') + ' ' + b)) found.push('Laravel');
  return found;
}

function parseOptions(options) {
  const num = (v, d, min, max) => Math.min(Math.max(Number(v) || d, min), max);
  return {
    mode: options.mode === 'sitemap' ? 'sitemap' : 'website',
    maxPages: num(options.maxPages, 60, 5, 400),
    maxDepth: num(options.maxDepth, 3, 1, 10),
    maxItems: num(options.maxItems, 20, 1, 250),
    includeSubdomains: !!options.includeSubdomains,
    contentMode: ['full', 'excerpt', 'description'].includes(options.contentMode) ? options.contentMode : 'excerpt',
    feedMode: ['standard', 'news', 'podcast'].includes(options.feedMode) ? options.feedMode : 'standard',
    includeImages: options.includeImages !== false,
    includeAuthors: options.includeAuthors !== false,
    includeCategories: options.includeCategories !== false,
    includePubDate: options.includePubDate !== false,
    excludeUndated: options.excludeUndated !== false,
    sortOrder: ['newest', 'oldest', 'manual'].includes(options.sortOrder) ? options.sortOrder : 'newest',
    channelTitle: String(options.channelTitle || '').trim(),
    channelDescription: String(options.channelDescription || '').trim(),
    channelLink: String(options.channelLink || '').trim(),
    concurrency: num(options.concurrency, 4, 1, 6)
  };
}

/* ------------------------------------------------------------------ */
/* Shared page analysis                                                */
/* ------------------------------------------------------------------ */

function analyzePageMeta(page, siteName) {
  const x = page._article;
  if (!x) return null;
  const title = pickTitle(x, siteName);
  const description = pickDescription(x, { maxLength: 300 });
  const lastmod = page._lastmod || null;
  const date = pickDate(x, lastmod);
  return {
    title: title || (page.base && page.base.title) || '',
    description,
    rawDescription: (x.metaDescription || x.ogDescription || x.firstParagraph || '').slice(0, 400),
    date,
    author: x.author || null,
    image: x.image || null,
    articleSection: x.articleSection || null,
    breadcrumbs: x.breadcrumbs || [],
    articleHtml: x.articleHtml || '',
    audioUrl: x.audioUrl || null,
    wordCount: (page.base && page.base.wordCount) || 0
  };
}

/* Categories come only from real metadata (articleSection, breadcrumbs).
 * Path slugs are NOT guessed as categories. */
function categoryOf(meta, page) {
  const cats = [];
  if (meta.articleSection) cats.push(meta.articleSection);
  const crumbs = (meta.breadcrumbs || []).map(s => String(s || '').trim()).filter(Boolean);
  if (crumbs.length >= 2) {
    const c = crumbs[crumbs.length - 2];
    if (c && !/^(home|homepage|blog|news|category|categories|tag|tags|search)\.?$/i.test(c) && c.length <= 40 && !cats.includes(c)) cats.push(c);
  }
  return cats.slice(0, 2);
}

/*
 * Deterministic analysis + generation over collected pages.
 * ctx: { input, root, host, siteName, siteDescription, platform, robots,
 *        sitemaps, lastmodMap, existingFeed, discovered, started,
 *        options, progress, mode }
 */
function analyzeAndReport(pages, ctx) {
  const o = ctx.options;
  const progress = ctx.progress || (() => {});
  const siteName = ctx.siteName || ctx.host;
  const started = ctx.started || Date.now();

  progress({ stage: 'metadata', message: 'Extracting article metadata…' });

  const rows = [];      // table rows for every page
  const candidates = []; // feedable pages
  const lastmodMap = ctx.lastmodMap || new Map();

  const stats = {
    pagesDiscovered: ctx.discovered || pages.length,
    pagesCrawled: 0,
    contentPagesFound: 0,
    itemsSelected: 0,
    duplicatesRemoved: 0,
    brokenExcluded: 0,
    missingDates: 0,
    undatedExcluded: 0,
    robotsBlocked: 0,
    challenge: 0,
    noindex: 0,
    nonHtml: 0,
    mediaWithoutLength: 0,
    generationTimeMs: 0
  };

  for (const page of pages) {
    const row = {
      url: page.url || page.requestedUrl,
      requestedUrl: page.requestedUrl || page.url,
      depth: page.depth || 0,
      status: page.status || 0,
      type: 'Other',
      feedable: false,
      title: (page.base && page.base.title) || '',
      description: '',
      date: null,
      dateSource: null,
      dateReliable: null,
      author: null,
      category: '',
      image: null,
      canonical: page.canonical || (page.base && page.base.canonical) || null,
      noindex: !!(page.noindex || (page.base && page.base.noindex)),
      blocked: !!page.blocked,
      challenge: !!(page.challenge && (page.challenge === true || page.challenge.detected)),
      redirected: !!page.redirected,
      jsHeavy: !!(page.jsHeavy || (page.base && page.base.jsHeavy)),
      wordCount: (page.base && page.base.wordCount) || 0,
      fromSitemap: !!page.fromSitemap,
      inSitemap: !!page.inSitemap,
      hasArticleTag: !!page.hasArticleTag,
      audioUrl: null,
      articleHtml: '',
      breadcrumbs: [],
      audioLength: page._audioLength != null ? page._audioLength : null,
      included: false,
      reason: '',
      excludeReason: null,
      dupReason: null,
      duplicateOf: null,
      added: false,
      existing: false
    };
    rows.push(row);

    if (page.blocked) {
      stats.robotsBlocked++;
      row.excludeReason = 'Robots';
      row.reason = 'Excluded: robots.txt restriction';
      continue;
    }
    if (page.status === 0) {
      stats.brokenExcluded++;
      row.excludeReason = 'Unreachable';
      row.reason = 'Excluded: ' + (page.error || 'request failed');
      continue;
    }
    if (row.challenge) {
      stats.challenge++;
      row.excludeReason = 'Bot protection';
      row.reason = 'Excluded: page is behind bot protection (could not be verified)';
      continue;
    }
    if (page.status < 200 || page.status >= 300) {
      if (page.status >= 400) {
        stats.brokenExcluded++;
        row.excludeReason = 'Broken';
        row.reason = 'Excluded: HTTP ' + page.status;
      } else {
        row.excludeReason = 'Redirect';
        row.reason = 'Excluded: HTTP ' + page.status;
      }
      continue;
    }
    const ct = String(page.contentType || '').toLowerCase();
    if (ct && !ct.includes('text/html') && !ct.includes('application/xhtml') && !ct.includes('text/markdown')) {
      stats.nonHtml++;
      row.excludeReason = 'Not HTML';
      row.reason = 'Excluded: not an HTML page (' + ct.split(';')[0] + ')';
      continue;
    }
    stats.pagesCrawled++;

    // Sitemap lastmod is only a labelled fallback date source.
    if (!page._lastmod && lastmodMap.has(row.url)) page._lastmod = lastmodMap.get(row.url);

    const meta = page._meta || analyzePageMeta(page, siteName);
    if (!meta) {
      row.excludeReason = 'No metadata';
      row.reason = 'Excluded: page metadata could not be extracted';
      continue;
    }

    // After a user edits the list, their explicit selection wins over
    // re-classification (word counts etc. are not re-fetched).
    const cls = page._forcedFeedable
      ? { type: page._forcedType || 'Article', feedable: true, signals: ['user-selection'] }
      : classify({
      url: row.url,
      types: (page.base && page.base.types) || [],
      ogType: (page.base && page.base.ogType) || '',
      breadcrumbs: meta.breadcrumbs,
      wordCount: meta.wordCount,
      dateSource: meta.date ? meta.date.source : null,
      hasArticleTag: row.hasArticleTag,
      linkCount: (page.base && page.base.links ? page.base.links.length : 0)
    });
    row.type = cls.type;
    row.feedable = isFeedable(cls.type);
    row.title = meta.title || row.title;
    row.description = meta.description;
    row.articleHtml = meta.articleHtml || '';
    row.breadcrumbs = meta.breadcrumbs || [];
    row.date = meta.date ? meta.date.iso : null;
    row.dateSource = meta.date ? meta.date.source : null;
    row.dateReliable = meta.date ? meta.date.reliable : null;
    row.author = meta.author;
    row.category = (categoryOf(meta, page) || []).join(', ');
    row.image = meta.image;
    row.audioUrl = meta.audioUrl;
    if (meta.date && meta.date.source === 'sitemap-lastmod') row.dateSource = 'sitemap-lastmod';
    if (row.noindex) stats.noindex++;

    if (!row.feedable) {
      row.excludeReason = 'Not content';
      row.reason = 'Not included: classified as ' + cls.type;
      continue;
    }
    stats.contentPagesFound++;

    candidates.push({
      row,
      url: row.url,
      requestedUrl: row.requestedUrl,
      title: meta.title,
      description: meta.description,
      rawDescription: meta.rawDescription,
      articleHtml: meta.articleHtml,
      date: meta.date,
      author: meta.author,
      image: meta.image,
      audioUrl: meta.audioUrl,
      canonical: row.canonical && isInternal(row.canonical, ctx.root, o.includeSubdomains) ? row.canonical : null,
      categories: categoryOf(meta, page),
      noindex: row.noindex,
      wordCount: meta.wordCount
    });
  }

  /* --- broken-URL verification for candidates (status already known) --- */
  const validCandidates = candidates.filter(c => c.row.status === 200);

  progress({ stage: 'verify', message: 'Checking URL status and duplicates…' });
  const dedup = dedupeItems(validCandidates);
  stats.duplicatesRemoved = dedup.removed + (ctx.duplicatesPreRemoved || 0);
  for (const c of candidates) {
    if (c._removed) {
      c.row.excludeReason = 'Duplicate';
      c.row.reason = 'Excluded: ' + (c.dupReason || 'Duplicate URL');
      c.row.duplicateOf = c.duplicateOf || null;
    }
  }

  const active = validCandidates.filter(c => !c._removed);

  /* --- selection + dates --- */
  progress({ stage: 'select', message: 'Selecting items and resolving dates…' });
  for (const c of active) {
    c.link = (c.canonical || c.row.url).replace(/#.*$/, '');
    c.guid = c.link;
    c.canonicalUsed = !!c.canonical;
    c.feedableType = c.row.type;
    c.hasContent = c.articleHtml.length > 0 || c.description.length > 0;
  }

  const undated = active.filter(c => !c.date);
  stats.missingDates = undated.length;

  let selected = active.slice();
  // News mode always requires dates; standard mode honours the toggle (default on).
  const effExcludeUndated = o.feedMode === 'news' ? true : o.excludeUndated;
  if (effExcludeUndated) {
    stats.undatedExcluded = undated.length;
    for (const c of undated) {
      c.row.excludeReason = 'No date';
      c.row.reason = o.feedMode === 'news'
        ? 'Excluded: news mode requires a publication date (assign one manually to include)'
        : 'Excluded: no reliable publication date (toggle off "Exclude items without dates" or assign a date manually)';
    }
    selected = selected.filter(c => c.date);
  }

  // Sort (never by crawl order).
  const cmpDate = (a, b) => (a.date ? new Date(a.date.iso).getTime() : 0) - (b.date ? new Date(b.date.iso).getTime() : 0);
  if (o.sortOrder === 'oldest') selected.sort((a, b) => cmpDate(a, b));
  else if (o.sortOrder === 'newest') selected.sort((a, b) => cmpDate(b, a));
  else selected.sort((a, b) => (a.row.manualOrder || 0) - (b.row.manualOrder || 0) || cmpDate(b, a));
  selected = selected.slice(0, o.maxItems);
  stats.itemsSelected = selected.length;

  for (const c of selected) c.row.included = true;

  /* --- channel --- */
  const channel = {
    title: o.channelTitle || ctx.siteName || ctx.host,
    link: o.channelLink || ctx.root,
    description: o.channelDescription || ctx.siteDescription || ''
  };

  /* --- items for the feed --- */
  const items = selected.map(c => {
    let descMode = o.contentMode;
    let descriptionHtml = '';
    let excerptHtml = '';
    const plain = c.description || c.title;
    if (c.articleHtml) excerptHtml = '<p>' + plain + '</p>';
    if (descMode === 'full') descriptionHtml = c.articleHtml || excerptHtml;
    if (descMode === 'excerpt') descriptionHtml = excerptHtml;
    return {
      title: c.title || c.row.url,
      link: c.link,
      guid: c.guid,
      description: plain,
      descriptionHtml,
      excerptHtml,
      descriptionMode: descMode === 'full' ? (c.articleHtml ? 'full' : 'excerpt') : descMode,
      pubDate: c.date ? new Date(c.date.iso) : null,
      dateReliable: c.date ? c.date.reliable : null,
      dateSource: c.date ? c.date.source : null,
      author: c.author,
      categories: c.categories,
      image: c.image,
      canonical: c.canonical || c.link,
      type: c.feedableType,
      feedable: true,
      hasContent: c.hasContent,
      audioUrl: c.audioUrl,
      audioLength: c.row.audioLength != null ? c.row.audioLength : null,
      enclosure: null
    };
  });

  // Podcast mode: enclosures only from detected media (never invented).
  if (o.feedMode === 'podcast') {
    for (const it of items) {
      if (!it.audioUrl) continue;
      const type = mimeForAudio(it.audioUrl);
      if (it.audioLength != null && type) it.enclosure = { url: it.audioUrl, type, length: it.audioLength };
      else stats.mediaWithoutLength++;
    }
  }

  progress({ stage: 'generate', message: 'Generating RSS XML…' });
  const genOpts = {
    includeImages: o.includeImages,
    includeAuthors: o.includeAuthors,
    includeCategories: o.includeCategories,
    includePubDate: o.includePubDate,
    podcast: o.feedMode === 'podcast'
  };
  const rssXml = generateRss(channel, items, genOpts);
  const atomXml = generateAtom(channel, items, genOpts);

  progress({ stage: 'validate', message: 'Validating XML…' });
  const validation = validateRss(rssXml);

  const quality = scoreFeed({
    validation,
    items: items.map(it => ({
      link: it.link, title: it.title, description: it.description,
      pubDate: it.pubDate, dateReliable: it.dateReliable,
      canonical: it.canonical, feedable: true, hasContent: it.hasContent
    })),
    stats
  });

  const comparison = ctx.existingFeed && ctx.existingFeed.items
    ? compareFeeds(ctx.existingFeed.items, items.map(it => ({ link: it.link, guid: it.guid, title: it.title, description: it.description, pubDate: it.pubDate ? toRfc822(it.pubDate) : '' })))
    : null;

  const exclusionReasons = groupReasons(rows);
  stats.generationTimeMs = Date.now() - started;

  return {
    mode: ctx.mode || 'website',
    input: ctx.input,
    finalUrl: ctx.root,
    host: ctx.host,
    site: {
      name: channel.title, description: channel.description,
      descriptionAuto: !o.channelDescription, platform: ctx.platform || [], wordpress: !!(ctx.existingFeed && ctx.existingFeed.wordpress)
    },
    channel,
    robots: ctx.robots ? {
      exists: ctx.robots.exists, url: ctx.robots.url, sitemaps: ctx.robots.sitemaps,
      restrictedCount: stats.robotsBlocked
    } : { exists: false, url: null, sitemaps: [], restrictedCount: 0 },
    sitemaps: (ctx.sitemaps && ctx.sitemaps.sitemaps ? ctx.sitemaps.sitemaps : []).map(s => ({ url: s.url, isIndex: s.isIndex, count: s.count })),
    existingFeed: ctx.existingFeed ? {
      url: ctx.existingFeed.url, format: ctx.existingFeed.format, title: ctx.existingFeed.title,
      itemCount: ctx.existingFeed.itemCount, wordpress: ctx.existingFeed.wordpress,
      candidates: ctx.existingFeed.candidates
    } : null,
    existingItems: ctx.existingFeed && ctx.existingFeed.items ? ctx.existingFeed.items : [],
    existingFeedCheck: ctx.existingFeedCheck || null,
    pages: rows.slice(0, 1200).map(r => ({
      url: r.url, requestedUrl: r.requestedUrl, title: r.title, type: r.type, feedable: r.feedable,
      status: r.status, date: r.date, dateSource: r.dateSource, dateReliable: r.dateReliable,
      author: r.author, category: r.category, image: r.image, canonical: r.canonical,
      noindex: r.noindex, blocked: r.blocked, challenge: r.challenge, redirected: r.redirected,
      jsHeavy: r.jsHeavy, wordCount: r.wordCount, fromSitemap: r.fromSitemap,
      hasArticleTag: r.hasArticleTag, included: r.included, reason: r.reason,
      excludeReason: r.excludeReason, duplicateOf: r.duplicateOf, added: r.added, existing: r.existing,
      description: r.included ? (r.description || '').slice(0, 400) : '',
      articleHtml: r.included ? r.articleHtml.slice(0, MAX_ARTICLE_HTML) : '',
      audioUrl: r.audioUrl || null,
      breadcrumbs: r.breadcrumbs || []
    })),
    items: items.map(it => ({
      title: it.title, link: it.link, guid: it.guid, description: it.description,
      descriptionHtml: it.descriptionHtml, excerptHtml: it.excerptHtml, descriptionMode: it.descriptionMode,
      pubDate: it.pubDate ? it.pubDate.toISOString() : null, dateSource: it.dateSource, dateReliable: it.dateReliable,
      author: it.author, categories: it.categories, image: it.image, canonical: it.canonical,
      type: it.type, hasContent: it.hasContent, audioUrl: it.audioUrl, audioLength: it.audioLength
    })),
    rssXml,
    atomXml,
    validation,
    quality,
    stats,
    exclusionReasons,
    comparison,
    warnings: {
      robotsRestricted: stats.robotsBlocked > 0,
      jsHeavy: rows.some(r => r.jsHeavy),
      challenge: stats.challenge > 0,
      noContent: stats.contentPagesFound === 0,
      undatedExcluded: stats.undatedExcluded,
      mediaWithoutLength: stats.mediaWithoutLength
    },
    options: o
  };
}

function groupReasons(rows) {
  const map = new Map();
  for (const r of rows) {
    if (r.included || !r.excludeReason) continue;
    const key = r.excludeReason;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

function mimeForAudio(url) {
  const p = String(url || '').split(/[?#]/)[0].toLowerCase();
  if (p.endsWith('.mp3')) return 'audio/mpeg';
  if (p.endsWith('.m4a')) return 'audio/mp4';
  if (p.endsWith('.aac')) return 'audio/aac';
  if (p.endsWith('.ogg')) return 'audio/ogg';
  if (p.endsWith('.oga')) return 'audio/ogg';
  if (p.endsWith('.wav')) return 'audio/wav';
  return null;
}

/* Spot-check up to 15 unique links from a detected existing feed (HEAD,
 * short timeout). Reports reachability only — never modifies anything. */
async function spotCheckFeedLinks(existingFeed, opts) {
  if (!existingFeed || !existingFeed.items || !existingFeed.items.length) return null;
  const seen = new Set();
  const links = [];
  for (const it of existingFeed.items) {
    let u = null;
    try { u = new URL(it.link || ''); if (!/^https?:$/.test(u.protocol)) continue; } catch { continue; }
    if (seen.has(u.toString())) continue;
    seen.add(u.toString());
    links.push(u.toString());
    if (links.length >= 15) break;
  }
  if (!links.length) return null;
  const out = [];
  let i = 0;
  async function w() {
    while (i < links.length) {
      const u = links[i++];
      let status = 0;
      try {
        const r = await safeFetch(u, { ...opts, method: 'HEAD', maxBytes: 0, accept: '*/*', timeout: 6000 });
        status = r.status;
        if (status === 405 || status === 501) {
          try {
            const g = await safeFetch(u, { ...opts, maxBytes: 8192, accept: '*/*', timeout: 6000 });
            status = g.status;
          } catch { status = 0; }
        }
      } catch (e) { status = 0; }
      out.push({ url: u, status, ok: status >= 200 && status < 400 });
    }
  }
  await Promise.all(Array.from({ length: 4 }, w));
  return out;
}

async function probeMediaLength(url, opts) {
  try {
    const r = await safeFetch(url, { ...opts, method: 'HEAD', maxBytes: 0, accept: '*/*', timeout: 8000 });
    const len = parseInt(r.headers && r.headers['content-length'], 10);
    return (r.status === 200 && Number.isFinite(len) && len > 0) ? len : null;
  } catch { return null; }
}

/* ------------------------------------------------------------------ */
/* Server crawl — website mode                                         */
/* ------------------------------------------------------------------ */

async function crawlSite(raw, options = {}) {
  const started = Date.now();
  const progress = options.onProgress || (() => {});
  const o = parseOptions(options);

  progress({ stage: 'validate', message: 'Validating URL…' });
  const input = await validateUrl(raw);
  progress({ stage: 'connect', message: 'Connecting…' });

  let home;
  try {
    home = await safeFetch(input.toString(), { ...options, timeout: 15000 });
  } catch (e) {
    throw e;
  }
  if (home.challenge && home.challenge.detected && home.status !== 200) {
    const e = new Error('The website is behind bot protection (' + home.challenge.provider + ') and could not be crawled.');
    e.code = 'challenge';
    throw e;
  }
  if (home.status === 401 || home.status === 403) {
    const e = new Error('The website returned HTTP ' + home.status + ' and refused the crawl.');
    e.code = 'restricted';
    throw e;
  }
  const root = home.finalUrl;
  const origin = new URL(root).origin;
  const host = hostOf(root);

  progress({ stage: 'robots', message: 'Checking robots.txt…' });
  const robots = await fetchRobots(origin, options);
  if (!robots.allowed(root)) {
    const e = new Error('Crawling is restricted by robots.txt for this site.');
    e.code = 'robots';
    throw e;
  }

  progress({ stage: 'feeds', message: 'Checking for an existing RSS/Atom feed…' });
  const homeHtml = String(home.body || '');
  const existingFeed = await detectExistingFeed(origin, homeHtml, root, options);
  const existingFeedCheck = await spotCheckFeedLinks(existingFeed, options);

  progress({ stage: 'sitemaps', message: 'Discovering sitemaps…' });
  const sitemaps = await discoverSitemaps(origin, robots, options);
  const lastmodMap = sitemaps.lastmodMap || new Map();

  const homeParsed = parsePage(homeHtml, root, home.headers);
  const siteName = (homeParsed.ogSiteName || homeParsed.ogTitle || homeParsed.title || host).trim();
  const siteDescription = cleanDescription(homeParsed.metaDescription || homeParsed.ogDescription || (homeParsed.paragraphs || [])[0], { maxLength: 300 });
  const platform = detectPlatform(homeHtml, home.headers);

  progress({ stage: 'crawl', message: 'Discovering content pages…', discovered: 1, crawled: 0 });

  const queue = [{ url: root, depth: 0, fromSitemap: false }];
  const qSeen = new Set([canonicalKey(root)]);
  let discovered = 1;
  for (const u of sitemaps.pageUrls) {
    if (queue.length >= o.maxPages) break;
    if (!isInternal(u.loc, root, o.includeSubdomains)) continue;
    const k = canonicalKey(u.loc);
    if (!qSeen.has(k)) { qSeen.add(k); queue.push({ url: u.loc, depth: 1, fromSitemap: true, lastmod: u.lastmod }); discovered++; }
  }
  const sitemapKeys = new Set(sitemaps.pageUrls.map(u => canonicalKey(u.loc)));

  const pages = [];
  let idx = 0;

  async function worker() {
    while (idx < queue.length && pages.length < o.maxPages) {
      const item = queue[idx++];
      if (!robots.allowed(item.url)) {
        pages.push({ url: item.url, requestedUrl: item.url, depth: item.depth, blocked: true, fromSitemap: item.fromSitemap, inSitemap: sitemapKeys.has(canonicalKey(item.url)) });
        continue;
      }
      const page = { url: item.url, requestedUrl: item.url, depth: item.depth, fromSitemap: item.fromSitemap, inSitemap: sitemapKeys.has(canonicalKey(item.url)), _lastmod: item.lastmod || (lastmodMap.get(item.url) || null) };
      try {
        const r = await safeFetch(item.url, { ...options, maxBytes: 900 * 1024 });
        page.url = r.finalUrl;
        page.status = r.status;
        page.headers = r.headers;
        page.contentType = r.contentType;
        page.redirected = r.redirects.length > 0;
        page.redirects = r.redirects;
        page.challenge = r.challenge;
        const ct = String(r.contentType || '').toLowerCase();
        if (ct.includes('text/html') || ct.includes('application/xhtml')) {
          const base = parsePage(r.body, r.finalUrl, r.headers);
          page.base = base;
          page.canonical = base.canonical;
          page.noindex = base.noindex;
          page.jsHeavy = base.jsHeavy;
          page.hasArticleTag = /<article\b/i.test(r.body);
          // Full article metadata only for plausible content pages (keeps memory bounded).
          if (page.hasArticleTag || /published|posted/i.test(r.body.slice(0, 40000)) || (base.wordCount || 0) >= 60) {
            const x = extractArticle(r.body, r.finalUrl, base);
            page._article = x;
            x.articleHtml = x.articleHtml.slice(0, MAX_ARTICLE_HTML);
          }
          // Enqueue internal links.
          if (item.depth < o.maxDepth) {
            for (const link of (base.links || [])) {
              if (queue.length >= o.maxPages) break;
              if (!isInternal(link, root, o.includeSubdomains)) continue;
              if (!robots.allowed(link)) continue;
              if (isAssetUrl(link) || isBinaryUrl(link) || /\.xml([?#]|$)/i.test(link)) continue;
              const k = canonicalKey(link);
              if (!qSeen.has(k)) { qSeen.add(k); queue.push({ url: link, depth: item.depth + 1, fromSitemap: false, lastmod: lastmodMap.get(link) || null }); discovered++; }
            }
          }
        } else {
          page.status = r.status; // non-HTML: recorded for the table only
        }
      } catch (e) {
        if (e.code === 'cancelled') throw e;
        page.status = 0;
        page.error = e.message;
        page.errorCode = e.code;
      }
      pages.push(page);
      progress({ stage: 'crawl', message: pages.length + ' pages analyzed', discovered, crawled: pages.length });
    }
  }

  await Promise.all(Array.from({ length: o.concurrency }, worker));

  /* Podcast mode: probe detected media for real Content-Length (never guessed). */
  if (o.feedMode === 'podcast') {
    const media = new Set();
    for (const p of pages) {
      if (p._article && p._article.audioUrl) media.add(p._article.audioUrl);
    }
    let i = 0;
    for (const m of media) {
      if (i++ >= 25) break;
      const len = await probeMediaLength(m, options);
      if (len != null) {
        for (const p of pages) if (p._article && p._article.audioUrl === m) p._audioLength = len;
      }
    }
  }

  return analyzeAndReport(pages, {
    mode: 'website', input: input.toString(), root, host, siteName, siteDescription,
    platform, robots, sitemaps, lastmodMap, existingFeed, existingFeedCheck,
    discovered, started, options: o, progress
  });
}

/* ------------------------------------------------------------------ */
/* Server crawl — sitemap mode                                         */
/* ------------------------------------------------------------------ */

async function crawlSitemap(sitemapUrlRaw, options = {}) {
  const started = Date.now();
  const progress = options.onProgress || (() => {});
  const o = parseOptions({ ...options, mode: 'sitemap' });
  o.maxPages = Math.min(o.maxPages, 250);

  progress({ stage: 'validate', message: 'Validating sitemap URL…' });
  let smUrl;
  try { smUrl = await validateUrl(sitemapUrlRaw); } catch (e) {
    throw makeError(e.code === 'dns' || e.code === 'unreachable' ? e.code : 'invalid_url',
      e.code === 'dns' ? 'Could not resolve the sitemap host.' : 'Please enter a valid sitemap URL (e.g. https://example.com/sitemap.xml).');
  }
  if (!/\.xml([?#]|$)/i.test(smUrl.pathname) && !/<sitemap/i.test('')) {
    // Not obviously a sitemap — still try; readSitemap validates the content.
  }

  progress({ stage: 'sitemaps', message: 'Parsing sitemap…' });
  const sm = await readSitemap(smUrl.toString(), options);
  if (!sm.valid) {
    const e = new Error(sm.status === 0
      ? 'The sitemap could not be reached (' + (sm.error || 'network error') + ').'
      : 'The sitemap could not be read as an XML sitemap (HTTP ' + sm.status + ').');
    e.code = sm.status === 0 ? (sm.code || 'unreachable') : 'sitemap_invalid';
    throw e;
  }

  let urls = sm.urls;
  const indexes = sm.indexes;
  if (sm.isIndex || indexes.length) {
    progress({ stage: 'sitemaps', message: 'Following sitemap index…' });
    const found = [];
    const seen = new Set();
    let total = 0;
    for (const child of indexes.slice(0, 12)) {
      if (seen.has(child)) continue;
      seen.add(child);
      if (total >= o.maxPages) break;
      const c = await readSitemap(child, options);
      if (!c.valid) continue;
      const limited = c.urls.slice(0, o.maxPages - total);
      total += limited.length;
      found.push({ url: c.url, isIndex: false, count: limited.length, urls: limited });
      urls = urls.concat(limited);
    }
    sm = { url: sm.url, status: sm.status, valid: true, isIndex: sm.isIndex, urls, sitemaps: found };
  }

  const root = new URL('/', new URL(smUrl.origin + '/')).toString();
  const origin = smUrl.origin;
  const host = hostOf(root);

  progress({ stage: 'connect', message: 'Loading homepage for site metadata…' });
  let homeParsed = { ogSiteName: '', ogTitle: '', title: '', metaDescription: '', ogDescription: '', paragraphs: [] };
  let siteName = host, siteDescription = '', platform = [];
  try {
    const home = await safeFetch(origin + '/', { ...options, timeout: 15000 });
    if (home.status === 200) {
      homeParsed = parsePage(String(home.body || ''), home.finalUrl, home.headers);
      siteName = (homeParsed.ogSiteName || homeParsed.ogTitle || homeParsed.title || host).trim();
      siteDescription = cleanDescription(homeParsed.metaDescription || homeParsed.ogDescription || (homeParsed.paragraphs || [])[0], { maxLength: 300 });
      platform = detectPlatform(home.body, home.headers);
    }
  } catch {}

  const robots = await fetchRobots(origin, options);
  const existingFeed = await detectExistingFeed(origin, String(home.body || ''), root, options);
  const lastmodMap = new Map(urls.map(u => [u.loc, u.lastmod]).filter(([, v]) => v));

  const pageUrls = urls.slice(0, o.maxPages);
  progress({ stage: 'crawl', message: 'Fetching ' + pageUrls.length + ' sitemap URLs…', discovered: pageUrls.length, crawled: 0 });

  const pages = [];
  let i = 0;
  async function worker() {
    while (i < pageUrls.length && pages.length < o.maxPages) {
      const u = pageUrls[i++];
      if (!robots.allowed(u.loc)) {
        pages.push({ url: u.loc, requestedUrl: u.loc, depth: 1, blocked: true, fromSitemap: true, _lastmod: u.lastmod || null });
        continue;
      }
      const page = { url: u.loc, requestedUrl: u.loc, depth: 1, fromSitemap: true, inSitemap: true, _lastmod: u.lastmod || null };
      try {
        const r = await safeFetch(u.loc, { ...options, maxBytes: 900 * 1024 });
        page.url = r.finalUrl;
        page.status = r.status;
        page.headers = r.headers;
        page.contentType = r.contentType;
        page.redirected = r.redirects.length > 0;
        page.redirects = r.redirects;
        page.challenge = r.challenge;
        const ct = String(r.contentType || '').toLowerCase();
        if (ct.includes('text/html') || ct.includes('application/xhtml')) {
          const base = parsePage(r.body, r.finalUrl, r.headers);
          page.base = base;
          page.canonical = base.canonical;
          page.noindex = base.noindex;
          page.jsHeavy = base.jsHeavy;
          page.hasArticleTag = /<article\b/i.test(r.body);
          if (page.hasArticleTag || (base.wordCount || 0) >= 60 || /published|posted/i.test(r.body.slice(0, 40000))) {
            const x = extractArticle(r.body, r.finalUrl, base);
            page._article = x;
            x.articleHtml = x.articleHtml.slice(0, MAX_ARTICLE_HTML);
          }
        }
      } catch (e) {
        if (e.code === 'cancelled') throw e;
        page.status = 0;
        page.error = e.message;
        page.errorCode = e.code;
      }
      pages.push(page);
      progress({ stage: 'crawl', message: pages.length + '/' + pageUrls.length + ' sitemap URLs fetched', discovered: pageUrls.length, crawled: pages.length });
    }
  }
  await Promise.all(Array.from({ length: o.concurrency }, worker));

  if (o.feedMode === 'podcast') {
    const media = new Set();
    for (const p of pages) if (p._article && p._article.audioUrl) media.add(p._article.audioUrl);
    let j = 0;
    for (const m of media) {
      if (j++ >= 25) break;
      const len = await probeMediaLength(m, options);
      if (len != null) for (const p of pages) if (p._article && p._article.audioUrl === m) p._audioLength = len;
    }
  }

  return analyzeAndReport(pages, {
    mode: 'sitemap', input: smUrl.toString(), root, host, siteName, siteDescription,
    platform, robots, sitemaps: { sitemaps: (sm.sitemaps || []).concat(sm.isIndex ? [] : [{ url: sm.url, isIndex: false, count: sm.urls.length }]) },
    lastmodMap, existingFeed, discovered: pageUrls.length, started, options: o, progress
  });
}

/* ------------------------------------------------------------------ */
/* Finalize — regenerate from the edited page list (no re-crawl)       */
/* ------------------------------------------------------------------ */

async function finalize(body = {}) {
  const url = String(body.url || '').trim();
  if (!url || !Array.isArray(body.pages)) throw makeError('invalid_input', 'Missing URL or page list.');
  const o = parseOptions(body.options || {});
  o.channelTitle = (body.channel && body.channel.title) || o.channelTitle || '';
  o.channelDescription = (body.channel && body.channel.description) || o.channelDescription || '';
  o.channelLink = (body.channel && body.channel.link) || o.channelLink || '';

  let root;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url);
    root = o.channelLink && absUrl(o.channelLink) ? o.channelLink : (o.channelLink || (u.pathname === '/' ? u.origin + '/' : new URL('/', u.origin + '/').toString()));
  } catch { throw makeError('invalid_url', 'Invalid website URL.'); }

  const host = hostOf(root);
  const siteName = (body.channel && body.channel.title) || host;
  const siteDescription = (body.channel && body.channel.description) || '';

  // Rebuild page records with user edits applied.
  const pages = (body.pages || []).slice(0, 2500).map((p, i) => {
    const row = {
      url: p.url, requestedUrl: p.url, depth: p.depth || 0, status: p.status || 200,
      type: p.type || 'Other', feedable: p.feedable !== false,
      blocked: !!p.blocked, challenge: !!p.challenge, redirected: !!p.redirected,
      jsHeavy: !!p.jsHeavy, noindex: !!p.noindex, wordCount: p.wordCount || 0,
      fromSitemap: !!p.fromSitemap, hasArticleTag: !!p.hasArticleTag,
      existing: !!p.existing, added: !!p.added
    };
    const page = {
      url: p.url, requestedUrl: p.url, depth: p.depth || 0, status: p.status || 200,
      contentType: p.status >= 400 ? 'text/html' : 'text/html',
      blocked: !!p.blocked, challenge: { detected: !!p.challenge },
      redirected: !!p.redirected, _meta: null,
      _forcedFeedable: !!(p.feedable || p.added || p.existing),
      _forcedType: p.type || null,
      base: {
        title: p.title || '', metaDescription: p.description || '', ogTitle: '', ogDescription: '',
        ogType: '', ogSiteName: '', canonical: p.canonical || null, noindex: !!p.noindex,
        h1: '', h2: [], types: [], breadcrumbs: [], text: '', wordCount: p.wordCount || 0,
        paragraphs: [], links: [], linkObjects: [], jsHeavy: !!p.jsHeavy
      }
    };
    page._meta = {
      title: (p.userTitle || p.title || ''),
      description: (p.userDescription != null && p.userDescription !== '') ? cleanDescription(p.userDescription, { maxLength: 300 }) : (p.description || ''),
      rawDescription: p.description || '',
      date: p.userDate ? (() => { const d = parseDate(p.userDate, 'manual'); return d ? { date: d.date, iso: d.iso, source: 'manual', reliable: true } : null; })()
        : (p.date ? (() => { const d = parseDate(p.date, p.dateSource || 'manual'); return d ? { date: d.date, iso: d.iso, source: p.dateSource === 'sitemap-lastmod' ? 'sitemap-lastmod' : 'manual', reliable: p.dateReliable !== false } : null; })() : null),
      author: (p.userAuthor != null && p.userAuthor !== '') ? p.userAuthor : (p.author || null),
      image: (p.userImage != null && p.userImage !== '') ? p.userImage : (p.image || null),
      articleSection: null,
      breadcrumbs: p.breadcrumbs || [],
      articleHtml: p.articleHtml || '',
      audioUrl: p.audioUrl || null,
      wordCount: p.wordCount || 0
    };
    return { page, row, userUrl: p.userUrl || null, included: p.included !== false, removed: !!p.removed, manualOrder: p.order != null ? p.order : i, categories: Array.isArray(p.categories) ? p.categories : (p.category ? String(p.category).split(',').map(s => s.trim()).filter(Boolean) : []) };
  }).filter(x => !x.removed && x.included);

  // Apply user URL edits + dedup (proxy objects so dedupeItems can mutate in place).
  for (const x of pages) {
    if (x.userUrl) {
      const u = normalizeUrl(x.userUrl, root);
      if (!u) throw makeError('invalid_url', 'The edited URL is not valid: ' + x.userUrl);
      x.page.url = u;
      x.page.requestedUrl = u;
      x.row.url = u;
      x.row.canonical = u;
    }
  }
  const proxies = pages.map(x => ({ url: x.row.url, requestedUrl: x.row.requestedUrl, canonical: x.row.canonical || x.row.url, title: x.page._meta.title }));
  const dedup = dedupeItems(proxies);
  for (let i = 0; i < pages.length; i++) {
    if (proxies[i]._removed) {
      pages[i].row.excludeReason = 'Duplicate';
      pages[i].row.reason = 'Excluded: ' + (proxies[i].dupReason || 'Duplicate URL');
    }
  }

  const active = pages.filter(x => !x.row.excludeReason);

  return analyzeAndReport(
    active.map(x => Object.assign({}, x.page, { _meta: x.page._meta, _lastmod: null })),
    {
      mode: body.mode || 'website', input: url, root, host, siteName, siteDescription,
      platform: body.platform || [], robots: { exists: false, url: null, sitemaps: [], allowed: () => true },
      sitemaps: { sitemaps: [] }, lastmodMap: new Map(),
      existingFeed: body.existingFeed ? { url: body.existingFeed.url, format: body.existingFeed.format, title: body.existingFeed.title, itemCount: body.existingFeed.itemCount, items: body.existingFeed.items || [] } : null,
      duplicatesPreRemoved: dedup.removed,
      discovered: pages.length, started: Date.now(), options: o,
      progress: () => {}
    }
  );
}

function absUrl(u) {
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) && x.hostname; } catch { return false; }
}

module.exports = { crawlSite, crawlSitemap, analyzeAndReport, finalize, parseOptions, detectPlatform };
