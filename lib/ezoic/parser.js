'use strict';

const U = require('./util');

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const c = Number(n);
      return c ? String.fromCharCode(c) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const c = parseInt(n, 16);
      return c ? String.fromCharCode(c) : _;
    });
}

function parseAttrs(str) {
  const attrs = {};
  const re = /([:@\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(str || ''))) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] != null ? m[2] : (m[3] != null ? m[3] : m[4]));
  }
  return attrs;
}

function stripNoise(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/<template\b[\s\S]*?<\/template>/gi, '');
}

function innerOf(html, tag) {
  const re = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'i');
  const m = String(html || '').match(re);
  return m ? m[1] : '';
}

function allTags(html, tag) {
  const out = [];
  const re = new RegExp('<' + tag + '\\b([^>]*)>([\\s\\S]*?)</' + tag + '>', 'gi');
  let m;
  while ((m = re.exec(html))) out.push({ attrs: parseAttrs(m[1]), inner: m[2] });
  return out;
}

function voidTags(html, tag) {
  const out = [];
  const re = new RegExp('<' + tag + '\\b([^>]*)/?>', 'gi');
  let m;
  while ((m = re.exec(html))) out.push(parseAttrs(m[1]));
  return out;
}

function textOf(html) {
  return decodeEntities(String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}

function hasLandmark(html, names) {
  const h = String(html || '');
  return names.some(n => n.test(h));
}

const AD_NETWORKS = [
  ['Google AdSense', /pagead2\.googlesyndication\.com|adsbygoogle|data-ad-client/i],
  ['Google Ad Manager', /googletagservices\.com|gpt\.js|securepubads\.g\.doubleclick\.net|doubleclick\.net/i],
  ['Amazon Ads', /amazon-adsystem\.com/i],
  ['Ezoic', /ezoic\.(net|com)|ezstandalone|ezoiccdn/i],
  ['Mediavine', /mediavine\.com/i],
  ['Raptive/AdThrive', /raptive\.com|adthrive\.com/i],
  ['Monumetric', /monumetric\.com/i],
  ['Media.net', /contextual\.media\.net/i],
  ['PropellerAds', /propellerads\.com/i],
  ['Taboola', /taboola\.com/i],
  ['Outbrain', /outbrain\.com/i],
  ['MGID', /mgid\.com/i],
  ['RevContent', /revcontent\.com/i]
];

function detectAdNetworks(html) {
  const out = [];
  AD_NETWORKS.forEach(p => { if (p[1].test(html)) out.push(p[0]); });
  return out;
}

function bodyMainHtml(html) {
  let clone = stripNoise(html);
  clone = clone
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form\b[\s\S]*?<\/form>/gi, ' ')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<(div|section|ul)[^>]*(id|class)\s*=\s*["'][^"']*(nav|menu|footer|header|sidebar|breadcrumb|comment|widget|cookie|popup|modal)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const main = clone.match(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i);
  if (main) return main[2];
  const entry = clone.match(/<(div|section)[^>]*(class|id)\s*=\s*["'][^"']*(entry-content|post-content|article-content|post-body|td-post-content|content-area)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i);
  if (entry) return entry[4] || entry[0];
  return innerOf(clone, 'body') || clone;
}

function parsePage(result) {
  if (!result || result.error || result.skipped) return result;
  const html = result.html || '';
  const base = result.finalUrl || result.url;
  const head = innerOf(html, 'head');
  const body = innerOf(html, 'body') || html;

  const metas = voidTags(html, 'meta');
  const meta = {};
  metas.forEach(a => {
    const k = (a.name || a.property || a['http-equiv'] || a.itemprop || '').toLowerCase();
    if (k) meta[k] = meta[k] ? meta[k] + ', ' + (a.content || '') : (a.content || '');
    if (a.charset) meta.charset = a.charset;
  });
  function mc(k) { return meta[String(k).toLowerCase()] || ''; }

  const title = textOf(innerOf(html, 'title'));
  const desc = mc('description');
  const linksRel = voidTags(html, 'link');
  const canonicalEl = linksRel.find(a => /\bcanonical\b/i.test(a.rel || ''));
  const canonical = canonicalEl ? U.normalizeUrl(canonicalEl.href || '', base) || (canonicalEl.href || '') : '';
  const robotsMeta = mc('robots');
  const xRobots = (result.headers && (result.headers['x-robots-tag'] || '')) || '';
  const viewport = mc('viewport');
  const htmlLang = ((html.match(/<html\b[^>]*>/i) || [''])[0].match(/\blang\s*=\s*["']([^"']+)/i) || [])[1] || '';
  const charset = meta.charset || mc('charset') || ((html.match(/charset\s*=\s*["']?([\w-]+)/i) || [])[1] || '');
  const generator = mc('generator');

  const headings = [];
  for (let i = 1; i <= 6; i++) {
    allTags(html, 'h' + i).forEach(t => {
      headings.push({ tag: 'H' + i, text: textOf(t.inner).slice(0, 180) });
    });
  }
  const h1 = headings.filter(h => h.tag === 'H1').map(h => h.text);
  const h2 = headings.filter(h => h.tag === 'H2').map(h => h.text);
  const h3 = headings.filter(h => h.tag === 'H3').map(h => h.text);

  const mainHtml = bodyMainHtml(html);
  const mainText = textOf(mainHtml).slice(0, 80000);
  const visibleText = textOf(stripNoise(body)).slice(0, 100000);
  const w = U.words(mainText);
  const allWords = U.words(visibleText);
  const sents = U.sentences(mainText);

  const paragraphs = allTags(mainHtml, 'p').map(t => textOf(t.inner)).filter(t => t.length > 0);
  const emptyHeadings = [];
  headings.forEach((h, idx) => {
    const next = headings[idx + 1];
    // approximate: heading with no following paragraph of substance is flagged later via word windows
    if (!h.text) emptyHeadings.push(h);
  });

  const images = voidTags(html, 'img').map(a => {
    const src = U.normalizeUrl(a.src || a['data-src'] || a['data-lazy-src'] || '', base);
    let fmt = '';
    try { fmt = (new URL(src || '', base).pathname.split('.').pop() || '').toLowerCase().split('?')[0]; } catch (e) {}
    return {
      src, alt: Object.prototype.hasOwnProperty.call(a, 'alt') ? a.alt : null,
      width: a.width, height: a.height, loading: (a.loading || '').toLowerCase(),
      srcset: a.srcset || '', format: fmt
    };
  }).filter(i => i.src);

  const anchors = allTags(html, 'a').concat(
    (function () {
      // also catch empty <a href> without inner via void-like
      const extra = [];
      const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
      // already covered by allTags
      return extra;
    })()
  );
  const links = anchors.map(t => {
    const raw = t.attrs.href || '';
    const href = U.normalizeUrl(raw, base);
    const text = textOf(t.inner).slice(0, 120);
    const rel = (t.attrs.rel || '').toLowerCase();
    let internal = false;
    try { internal = !!href && U.sameSite(href, base); } catch (e) {}
    return {
      href, text, rel, target: t.attrs.target || '',
      internal, external: !!href && !internal && /^https?:/.test(href || ''),
      empty: !text || text.length < 2,
      isAnchor: raw.charAt(0) === '#',
      isMail: /^(mailto|tel):/i.test(raw),
      isJs: /^javascript:/i.test(raw),
      nofollow: /nofollow/.test(rel)
    };
  }).filter(l => l.href && !l.isAnchor && !l.isMail && !l.isJs);

  const scriptTags = voidTags(html, 'script').concat(
    (html.match(/<script\b([^>]*)>/gi) || []).map(s => parseAttrs(s.replace(/^<script\b/i, '').replace(/>$/, '')))
  );
  const scripts = scriptTags.map(a => U.normalizeUrl(a.src || '', base)).filter(Boolean);
  const uniqueScripts = [...new Set(scripts)];
  const externalScripts = uniqueScripts.filter(s => { try { return !U.sameSite(s, base); } catch (e) { return false; } });
  const inlineScripts = (html.match(/<script\b(?![^>]*\bsrc=)[^>]*>/gi) || []).length;
  const stylesheets = linksRel.filter(a => /\bstylesheet\b/i.test(a.rel || '')).map(a => U.normalizeUrl(a.href || '', base)).filter(Boolean);
  const blockingHeadScripts = (head.match(/<script\b[^>]*\bsrc=/gi) || []).filter(s => !/\basync\b/i.test(s) && !/\bdefer\b/i.test(s)).length;
  const mediaQueries = (html.match(/@media[^{]*/g) || []).length;

  const jsonLd = [];
  const invalidLd = [];
  const ldRe = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let lm;
  while ((lm = ldRe.exec(html))) {
    try {
      const j = JSON.parse(lm[1]);
      (Array.isArray(j) ? j : [j]).forEach(x => { if (x) jsonLd.push(x); });
    } catch (e) { invalidLd.push(e.message); }
  }
  const schemaTypes = [];
  jsonLd.forEach(j => {
    if (j && typeof j === 'object') {
      const t = j['@type'];
      if (Array.isArray(t)) t.forEach(x => schemaTypes.push(x));
      else if (t) schemaTypes.push(t);
    }
  });
  const seenT = {};
  const uniqueTypes = schemaTypes.filter(t => { if (seenT[t]) return false; seenT[t] = 1; return true; });

  const authorCandidates = [
    mc('author'), mc('article:author'),
    textOf((html.match(/rel\s*=\s*["']author["'][^>]*>([\s\S]*?)<\//i) || [])[1] || ''),
    textOf((html.match(/class\s*=\s*["'][^"']*(author|byline)[^"']*["'][^>]*>([\s\S]*?)<\//i) || [])[2] || '')
  ].filter(Boolean);
  const author = String(authorCandidates[0] || '').trim().slice(0, 120);
  let published = mc('article:published_time') || mc('date') || mc('pubdate') || '';
  let modified = mc('article:modified_time') || mc('og:updated_time') || '';
  jsonLd.forEach(j => {
    if (j.datePublished && !published) published = String(j.datePublished);
    if (j.dateModified && !modified) modified = String(j.dateModified);
  });
  if (!published) {
    const t = html.match(/datetime\s*=\s*["']([^"']+)["']/i);
    if (t) published = t[1];
  }

  const hasNav = hasLandmark(html, [
    /<nav\b/i, /role\s*=\s*["']navigation["']/i, /class\s*=\s*["'][^"']*\b(nav|navbar|menu|main-nav)\b/i
  ]);
  const hasFooter = hasLandmark(html, [
    /<footer\b/i, /role\s*=\s*["']contentinfo["']/i, /id\s*=\s*["']footer["']/i, /class\s*=\s*["'][^"']*\bfooter\b/i
  ]);
  const popups = (html.match(/class\s*=\s*["'][^"']*\b(popup|modal|overlay|interstitial)\b/gi) || []).length
    + (html.match(/id\s*=\s*["'][^"']*(popup|modal|overlay)[^"']*["']/gi) || []).length;
  const autoplay = (html.match(/<(video|audio)\b[^>]*\bautoplay\b/gi) || []).length
    + (html.match(/<iframe\b[^>]*src=["'][^"']*autoplay/gi) || []).length;
  const hreflangs = linksRel.filter(a => /\balternate\b/i.test(a.rel || '') && a.hreflang).map(a => ({
    lang: a.hreflang, href: U.normalizeUrl(a.href || '', base)
  })).filter(x => x.href);

  const isHttps = /^https:/.test(base);
  const mixedResources = [];
  if (isHttps) {
    const re = /(?:src|href)\s*=\s*["'](http:\/\/[^"']+)["']/gi;
    let mm;
    while ((mm = re.exec(html))) mixedResources.push(mm[1]);
  }

  const emptyLinks = links.filter(l => l.internal && l.empty).length;
  const buttons = allTags(html, 'button').concat(
    (html.match(/<input\b[^>]*type\s*=\s*["'](submit|button)["'][^>]*>/gi) || []).map(s => ({ attrs: parseAttrs(s), inner: '' }))
  );
  const emptyButtons = buttons.filter(b => {
    const t = (textOf(b.inner) + (b.attrs.value || '') + (b.attrs['aria-label'] || '')).trim();
    return t.length === 0;
  }).length;
  const metaRefresh = metas.filter(a => /refresh/i.test(a['http-equiv'] || '')).length;
  const navHtml = (html.match(/<nav\b[\s\S]*?<\/nav>/i) || [''])[0];
  const footerHtml = (html.match(/<footer\b[\s\S]*?<\/footer>/i) || [''])[0];
  const navLinks = (navHtml.match(/<a\b/gi) || []).length;
  const footerLinks = (footerHtml.match(/<a\b/gi) || []).length;

  const iframes = voidTags(html, 'iframe').concat(
    (html.match(/<iframe\b([^>]*)>/gi) || []).map(s => parseAttrs(s.replace(/^<iframe\b/i, '').replace(/>$/, '')))
  );
  const adNetworks = detectAdNetworks(html);
  const adScripts = uniqueScripts.filter(s => /pagead|googlesyndication|doubleclick|adsystem|adservice|media\.net|ezoic|monumetric|raptive|adthrive|mediavine|buysellads|propellerads|taboola|outbrain/i.test(s)).length;
  const adIframes = iframes.filter(f => /pagead|googlesyndication|doubleclick|adsystem|adservice|amazon-adsystem|\/ads\//i.test(f.src || '')).length;
  const adSlots = (html.match(/ins class=["'][^"']*adsbygoogle|data-ad-client|data-ad-slot|id=["']div-gpt-ad|class=["'][^"']*(adslot|ad-slot|advertisement)/gi) || []).length;

  const emailMatch = visibleText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const phoneMatch = visibleText.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}/);
  const loremIpsum = /\blorem ipsum\b|\bplaceholder text\b|\bdolor sit amet\b|\bcoming soon\b|\binsert (text|content) here\b|\btodo:\s*add/i.test(mainText);
  const contactForm = /<form\b[\s\S]*?(type=["']email|name=["']email|textarea)[\s\S]*?<\/form>/i.test(html);

  const downloadLinks = links.filter(l => /\.(zip|pdf|exe|dmg|apk|rar|7z|mp4|mp3|iso)(\?|$)/i.test(l.href || '') || /\/download\b/i.test(l.href || '') || /download/i.test(l.text || '')).length;
  const jsHeavy = w.length < 40 && html.length > 25000 && (uniqueScripts.length >= 8 || inlineScripts >= 6);

  result.parse = {
    title, titleLen: title.length, desc, descLen: desc.length, canonical,
    robotsMeta, xRobots, viewport, lang: htmlLang, charset, generator,
    headings, h1, h2, h3, headingsCount: headings.length,
    mainText, visibleText, wordCount: w.length, allWordCount: allWords.length,
    sentenceCount: sents.length, paragraphCount: paragraphs.length,
    paragraphs: paragraphs.slice(0, 50),
    listCount: (html.match(/<(ul|ol)\b/gi) || []).length,
    textRatio: html.length ? Math.round(visibleText.length / html.length * 100) : 0,
    avgSentenceLength: sents.length ? Math.round(w.length / sents.length) : 0,
    keywords: U.keywordFreq(mainText, 30),
    images, imageCount: images.length,
    missingAlt: images.filter(i => i.alt == null || i.alt === '').length,
    links, internalLinks: links.filter(l => l.internal).length,
    externalLinks: links.filter(l => l.external).length,
    scripts: uniqueScripts, externalScripts, inlineScripts, stylesheets,
    blockingHeadScripts, mediaQueries,
    jsonLd, invalidLd, schemaTypes: uniqueTypes,
    author, published, modified,
    hasNav, hasFooter, popups, autoplay, hreflangs, mixedResources,
    emptyLinks, emptyButtons, metaRefresh, navLinks, footerLinks,
    contactEmail: emailMatch ? emailMatch[0] : '',
    contactPhone: phoneMatch ? phoneMatch[0].trim() : '',
    contactForm, loremIpsum,
    adNetworks, adScripts, adIframes, adSlots,
    downloadLinks, jsHeavy, emptyHeadings: emptyHeadings.length,
    noindex: /noindex/i.test(robotsMeta + ' ' + xRobots),
    nofollow: /nofollow/i.test(robotsMeta + ' ' + xRobots),
    ogTitle: mc('og:title'), ogType: mc('og:type'),
    htmlBytes: result.bytes || html.length
  };
  return result;
}

function buildBoilerplateVocab(pages) {
  const parsed = pages.filter(p => p.parse && !p.error);
  if (parsed.length < 2) return new Set();
  const docCounts = new Map();
  parsed.forEach(p => {
    const seen = new Set();
    String(p.parse.visibleText || '').toLowerCase().split(/[^a-z0-9']+/).forEach(w => {
      if (w.length >= 3 && !seen.has(w)) { seen.add(w); docCounts.set(w, (docCounts.get(w) || 0) + 1); }
    });
  });
  const thr = Math.ceil(parsed.length * 0.6);
  const s = new Set();
  docCounts.forEach((n, w) => { if (n >= thr) s.add(w); });
  return s;
}

module.exports = { parsePage, buildBoilerplateVocab, decodeEntities, textOf, detectAdNetworks };
