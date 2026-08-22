'use strict';

/*
 * huvanti WordPress Theme Detector, active theme detection engine.
 *
 * Combines nine independent methods before naming a theme:
 *   1 HTML source analysis          6 WordPress REST API (where public)
 *   2 CSS URLs                      7 Theme-specific fingerprints
 *   3 JavaScript URLs               8 HTML class patterns
 *   4 Enqueued assets (link/script) 9 Public source maps / resource refs
 *   5 style.css theme header
 *
 * Confidence weights (sum capped at 99):
 *   theme style.css header 40 · theme asset path 20 · REST evidence 10 ·
 *   HTML fingerprints 10 · CSS fingerprints 10 · theme-specific JS 5 ·
 *   other metadata 5. A single weak fingerprint can never reach 100%.
 */

const U = require('./util');
const FP = require('./fingerprints');

/* ---------- Candidate discovery ---------- */

function attrVal(tag, name) {
  const m = tag.match(new RegExp(name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  if (!m) return '';
  return m[1] != null ? m[1] : (m[2] != null ? m[2] : (m[3] || ''));
}

function stylesheetLinks(html) {
  const out = [];
  const re = /<link\b[^>]*rel\s*=\s*(?:"stylesheet"|'stylesheet'|stylesheet\b)[^>]*>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const tag = m[0];
    const href = attrVal(tag, 'href');
    const id = attrVal(tag, 'id');
    if (href) out.push({ href, id, tag, index: m.index });
    if (out.length >= 120) break;
  }
  return out;
}

function scriptSrcs(html) {
  const out = [];
  const re = /<script\b[^>]*src\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let m;
  while ((m = re.exec(String(html || '')))) { out.push(m[1] || m[2] || m[3]); if (out.length >= 120) break; }
  return out;
}

/*
 * Rank theme slug candidates referenced by the page.
 * Returns candidates sorted by evidence strength.
 */
function rankCandidates(html, extraTexts) {
  const base = String(html || '');
  const links = stylesheetLinks(base);
  const scripts = scriptSrcs(base);
  const map = new Map(); // slug -> candidate
  const get = slug => {
    if (!map.has(slug)) map.set(slug, { slug, htmlRefs: 0, stylesheetRef: false, styleCssRef: false, jsRef: false, restRef: 0, cssFileRef: false, firstIndex: Infinity, examples: [] });
    return map.get(slug);
  };
  const bump = (slug, patch, example) => {
    const c = get(slug);
    Object.keys(patch).forEach(k => { c[k] = patch[k] === true ? true : (c[k] || 0) + patch[k]; });
    if (example && c.examples.length < 4 && !c.examples.includes(example)) c.examples.push(example);
  };

  // Every /wp-content/themes/<slug>/ reference anywhere in the HTML (incl. inline JS/JSON)
  U.themeSlugRefs(base).forEach(ref => {
    const c = get(ref.slug);
    c.htmlRefs += 1;
    c.firstIndex = Math.min(c.firstIndex, base.indexOf(ref.matched));
    if (c.examples.length < 4 && !c.examples.includes(ref.matched)) c.examples.push(ref.matched);
  });

  // Enqueued stylesheets, the classic active-theme signal
  links.forEach(l => {
    const m = l.href.match(/\/wp-content\/themes\/([A-Za-z0-9_.-]+)\//);
    if (!m) return;
    const slug = U.sanitizeSlug(m[1]);
    if (!slug) return;
    const isStyleCss = /\/style\.css(\?|$)/i.test(l.href);
    const handleLooksActive = new RegExp('(^|-)' + escapeRe(slug) + '(-css|-style-css|-css-css)$', 'i').test(l.id);
    bump(slug, { stylesheetRef: true, styleCssRef: isStyleCss || undefined }, l.href);
    const c = get(slug);
    if (handleLooksActive) bump(slug, { styleCssRef: true }, 'link id="' + l.id + '"');
    c.firstIndex = Math.min(c.firstIndex, l.index);
    const vp = U.verParam(l.href);
    if (vp && (isStyleCss || !c.styleCssHrefVer)) c.styleCssHrefVer = vp;
  });

  // JS assets from the theme folder
  scripts.forEach(s => {
    const m = String(s).match(/\/wp-content\/themes\/([A-Za-z0-9_.-]+)\//);
    if (!m) return;
    const slug = U.sanitizeSlug(m[1]);
    if (slug) bump(slug, { jsRef: true }, String(s));
  });

  // Probe texts (REST content, oEmbed HTML) can reveal the slug on JS-heavy sites
  (extraTexts || []).forEach(txt => {
    U.themeSlugRefs(txt).forEach(ref => {
      const c = get(ref.slug);
      c.restRef += 1;
      if (c.examples.length < 4 && !c.examples.includes(ref.matched)) c.examples.push(ref.matched);
    });
  });

  const arr = Array.from(map.values());
  arr.forEach(c => {
    let score = 0;
    if (c.styleCssRef) score += 45;
    if (c.stylesheetRef) score += 15;
    if (c.jsRef) score += 6;
    score += Math.min(c.htmlRefs, 12) * 2;
    score += Math.min(c.restRef, 6) * 2;
    c.score = score;
  });
  arr.sort((a, b) => (b.score - a.score) || (a.firstIndex - b.firstIndex));
  return arr;
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* ---------- Fingerprint matching ---------- */

/*
 * Match every known fingerprint against the observed bundle (slug may be null).
 * A fingerprint "match" requires at least two distinct marker kinds so a single
 * filename similarity can never name a premium theme.
 */
function matchFingerprints(bundle) {
  const assetText = (bundle.assetUrls || []).join(' ').toLowerCase();
  const cssText = String(bundle.cssText || '').toLowerCase();
  const classText = String(bundle.classText || '').toLowerCase();
  const genText = (bundle.generators || []).join(' ').toLowerCase();
  const results = [];
  for (const fp of FP.themeFingerprints) {
    if (fp.hidden || fp.weight <= 0) continue;
    const matches = [];
    const hit = (kind, marker, where) => matches.push({ kind, marker, where });
    for (const p of (fp.assetPaths || [])) {
      const pl = p.toLowerCase();
      if (assetText.includes(pl)) hit('assetPath', p, 'asset URL');
      else if (cssText.includes(pl)) hit('assetPath', p, 'CSS text');
    }
    for (const c of (fp.bodyClasses || [])) if (classText.includes(c.toLowerCase())) hit('bodyClass', c, 'HTML class attribute');
    for (const s of (fp.cssSelectors || [])) if (cssText.includes(s.toLowerCase())) hit('cssSelector', s, 'theme stylesheet');
    for (const j of (fp.jsSignatures || [])) if (assetText.includes(j.toLowerCase())) hit('jsSignature', j, 'JS asset URL');
    for (const g of (fp.generators || [])) if (new RegExp(g, 'i').test(genText)) hit('generator', g, 'generator meta');
    if (!matches.length) continue;
    const kinds = U.uniq(matches.map(m => m.kind));
    // slug equality itself is direct path evidence, not a "fingerprint kind"
    const slugMatch = bundle.slug && fp.slug.toLowerCase() === String(bundle.slug).toLowerCase();
    results.push({ fp, matches, kinds, slugMatch, strength: kinds.length + (slugMatch ? 1 : 0) });
  }
  results.sort((a, b) => b.strength - a.strength || b.fp.weight - a.fp.weight);
  return results;
}

/* ---------- Theme analysis ---------- */

const WEIGHTS = {
  styleHeader: 40,
  themeAssetPath: 20,
  restEvidence: 10,
  htmlFingerprint: 10,
  cssFingerprint: 10,
  themeJs: 5,
  otherMetadata: 5
};

/*
 * Build the theme result from collected evidence.
 *  cand     , chosen slug candidate { slug, …, sources }
 *  headerRes, parseThemeHeader() result for <slug>/style.css (or null when blocked)
 *  parentRes, { header, slug } for the parent theme when a child theme is found
 *  bundle   , { assetUrls, classText, cssText, generators, html }
 *  probes   , { rest, oembed } fetched probe texts
 *  opts     , { styleCssStatus, mainCssUrl, mainCssVer, screenshot, wpVersion }
 */
function analyzeTheme(cand, headerRes, parentRes, bundle, probes, opts) {
  opts = opts || {};
  const evidence = [];
  const methods = [];
  const addEvidence = (method, label, detail, weight) => {
    evidence.push({ method, label: U.strip(label, 160), detail: U.strip(detail, 400), weight });
    if (!methods.includes(method)) methods.push(method);
  };

  const slug = cand ? cand.slug : null;
  let name = null;
  let fields = {};
  const headerOk = !!(headerRes && headerRes.found && headerRes.fields['Theme Name']);

  /* Method 5, style.css header (strongest) */
  if (headerOk) {
    fields = headerRes.fields;
    name = fields['Theme Name'];
    addEvidence('style.css header', 'Theme metadata read from style.css', '/wp-content/themes/' + slug + '/style.css WordPress theme header parsed (Theme Name, Author, Version…)', WEIGHTS.styleHeader);
  } else if (headerRes && headerRes.attempted) {
    addEvidence('style.css header', 'style.css not readable', 'The theme folder exists but style.css was not readable (' + (headerRes.reason || 'blocked or missing') + '). Theme identity is based on asset paths only.', 0);
  }

  /* Method 1+2+4: HTML source & enqueued assets */
  if (cand) {
    const bits = [];
    if (cand.styleCssRef) bits.push('enqueued stylesheet link for themes/' + slug + '/style.css');
    if (cand.stylesheetRef) bits.push('theme stylesheet references');
    if (cand.jsRef) bits.push('theme JavaScript assets');
    if (cand.htmlRefs) bits.push(cand.htmlRefs + ' HTML reference' + (cand.htmlRefs === 1 ? '' : 's'));
    if (cand.restRef) bits.push('REST/embed content references');
    addEvidence('HTML source analysis', 'Theme asset path detected', '/wp-content/themes/' + slug + '/ referenced (' + bits.join(', ') + ')' + (cand.examples[0] ? ', e.g. ' + cand.examples[0] : ''), WEIGHTS.themeAssetPath);
    if (cand.styleCssRef) addEvidence('Enqueued assets', 'Active stylesheet handle', 'WordPress enqueues the active theme stylesheet at themes/' + slug + '/style.css', 0);
  }

  /* Methods 6: REST */
  const restText = String((probes && (probes.restText || (probes.rest && probes.rest.text))) || '')
    + String((probes && probes.postsText) || '')
    + String((probes && probes.oembedText) || '');
  if (slug && restText.includes('/wp-content/themes/' + slug + '/')) {
    addEvidence('WordPress REST API', 'REST/embed content references the theme', 'Public REST or oEmbed output contains /wp-content/themes/' + slug + '/ asset URLs', WEIGHTS.restEvidence);
  }

  /* Method 7+8, fingerprints & class patterns */
  const fps = matchFingerprints(Object.assign({}, bundle, { slug }));
  const best = fps[0] || null;
  let fpName = null;
  if (best) {
    const kindLabels = { assetPath: 'asset path', bodyClass: 'HTML class pattern', cssSelector: 'CSS signature', jsSignature: 'JS signature', generator: 'generator meta' };
    const shown = best.matches.slice(0, 6).map(m => kindLabels[m.kind] + ' “' + m.marker + '” (' + m.where + ')');
    if (best.fp.slug.toLowerCase() === String(slug || '').toLowerCase() && (best.slugMatch || best.kinds.length)) {
      fpName = best.fp.name;
      addEvidence('Theme fingerprints', 'Fingerprint database match: ' + best.fp.name, 'Fingerprint “' + best.fp.slug + '” matched on ' + best.kinds.length + ' marker kind(s): ' + shown.join(', '), Math.min(WEIGHTS.htmlFingerprint, 6 + best.kinds.length * 2));
    } else if (best.kinds.length >= 2 && !slug) {
      // Renamed folder: only claim with multiple distinct kinds
      fpName = best.fp.name;
      addEvidence('Theme fingerprints', 'Likely ' + best.fp.name + ' (renamed folder)', 'Fingerprint matched on ' + best.kinds.length + ' marker kinds without a slug match: ' + shown.join(', '), WEIGHTS.htmlFingerprint - 3);
    } else if (best.kinds.length >= 1 && !slug) {
      addEvidence('Theme fingerprints', 'Partial fingerprint hint: ' + best.fp.name, 'Only one marker kind matched, not enough to identify the theme: ' + shown.join(', '), 0);
    }
    // HTML class patterns evidence
    const classHits = best.matches.filter(m => m.kind === 'bodyClass');
    if (classHits.length) addEvidence('HTML class patterns', 'Theme-specific body classes', 'HTML class attributes contain ' + classHits.map(h => '“' + h.marker + '”').join(', '), WEIGHTS.htmlFingerprint - 3);
    // CSS fingerprints
    const cssHits = best.matches.filter(m => m.kind === 'cssSelector');
    if (cssHits.length && bundle.cssText) addEvidence('CSS analysis', 'Theme CSS signatures', 'Theme stylesheet contains ' + cssHits.map(h => '“' + h.marker + '”').join(', ') + ' selectors', WEIGHTS.cssFingerprint);
    // JS
    const jsHits = best.matches.filter(m => m.kind === 'jsSignature');
    if (jsHits.length) addEvidence('JavaScript analysis', 'Theme JS signatures', 'JS asset URLs contain ' + jsHits.map(h => '“' + h.marker + '”').join(', '), WEIGHTS.themeJs);
  }

  /* Method 9, source maps (informational) */
  if (opts.sourceMapFound) addEvidence('Source maps', 'Public source map found', 'A .css.map / .js.map file is publicly reachable for a theme asset (see Technical Exposure).', WEIGHTS.otherMetadata);

  /* Screenshot, other metadata */
  if (opts.screenshot && opts.screenshot.available) addEvidence('Other metadata', 'Theme screenshot present', '/wp-content/themes/' + slug + '/screenshot.png is publicly reachable', WEIGHTS.otherMetadata);

  /* ---- WordPress.org public directory (optional enrichment, never a version source) ---- */
  const wporg = opts.wporg || null;
  if (wporg && wporg.slug && slug && wporg.slug.toLowerCase() === String(slug).toLowerCase()) {
    addEvidence('WordPress.org directory', 'Slug found in the WordPress.org theme directory',
      '"' + slug + '" is published in the free WordPress.org theme directory as "' + wporg.name + '"' + (wporg.author ? ' by ' + wporg.author : '') + '. Directory metadata supplements the scan; the directory version is the latest release, not necessarily the installed one.', 10);
  }

  /* ---- Final name ---- */
  const themeName = name || fpName || (wporg && slug && wporg.slug.toLowerCase() === String(slug).toLowerCase() ? wporg.name : null) || (slug ? slug : null);

  /* ---- Version detection ---- */
  const version = detectVersion(fields, cand, opts, bundle);

  /* ---- Child / parent ---- */
  const templateField = fields['Template'] ? U.sanitizeSlug(fields['Template']) : null;
  const isChild = !!templateField;
  const parent = buildParent(parentRes, templateField);

  /* ---- Source / premium / custom ---- */
  const fp = (best && best.slugMatch) ? best.fp : FP.findBySlug(slug);
  const source = detectSource(fp, fields, bundle.siteOrigin, wporg);
  const premium = detectPremium(fp, best, fields);
  const custom = detectCustom(slug, fields, fp, best, bundle.siteOrigin);

  /* ---- Confidence ---- */
  let points = evidence.reduce((n, e) => n + (e.weight || 0), 0);
  let cappedAt = 99;
  let confidenceLabel = 'Detected';
  if (!headerOk) {
    // Without the theme header we cap confidence, identity relies on paths only
    cappedAt = 72;
    if (points > cappedAt) points = cappedAt;
    confidenceLabel = 'Likely';
  } else if (!themeName) {
    cappedAt = 55;
    confidenceLabel = 'Partial';
  }
  const confidence = U.clamp(Math.round(points), 0, cappedAt);

  return {
    found: !!themeName,
    name: themeName,
    slug: slug || null,
    slugLabel: slug ? 'Detected' : 'Not detected',
    version,
    author: fields['Author'] || (fp && fp.author) || (wporg && wporg.author) || null,
    authorUri: fields['Author URI'] || (fp && fp.authorUri) || (wporg && wporg.authorUrl) || null,
    themeUri: fields['Theme URI'] || (fp && fp.themeUri) || (wporg && wporg.homepage) || null,
    description: fields['Description'] || null,
    license: fields['License'] || null,
    licenseUri: fields['License URI'] || null,
    textDomain: fields['Text Domain'] || null,
    tags: fields['Tags'] ? fields['Tags'].split(',').map(t => t.trim()).filter(Boolean).slice(0, 14) : [],
    type: isChild ? 'child' : 'standard',
    template: templateField,
    isChild,
    parent,
    preview: opts.screenshot && opts.screenshot.available
      ? opts.screenshot
      : (wporg && wporg.screenshotUrl ? { available: true, url: wporg.screenshotUrl, fromDirectory: true } : (opts.screenshot || { available: false })),
    styleCssAccess: headerOk ? 'public' : (headerRes && headerRes.attempted ? (headerRes.reason || 'blocked') : 'not attempted'),
    source,
    premium,
    custom,
    confidence,
    confidenceLabel: confidence >= 85 ? 'Detected' : confidence >= 55 ? 'Likely' : (confidence > 0 ? 'Partial' : 'Unable to determine'),
    evidence,
    methods: methods.concat(evidence.map(e => e.method)).filter((v, i, a) => a.indexOf(v) === i),
    fingerprint: best && best.slugMatch ? { slug: best.fp.slug, name: best.fp.name, kinds: best.kinds, matches: best.matches.slice(0, 10) } : null,
    extraSlugs: (opts.otherCandidates || []).slice(0, 4)
  };
}

function detectVersion(fields, cand, opts, bundle) {
  // 1) Exact, style.css header
  const hv = fields['Version'];
  if (hv && U.looksLikeVersion(hv)) {
    return { value: hv, source: 'style.css header (Version:)', label: 'exact', detail: 'Read directly from /wp-content/themes/' + (cand ? cand.slug : '') + '/style.css, exact.' };
  }
  // 2) Asset ?ver= parameter, reliable when it is not the WordPress core version
  const wpCoreVer = opts.wpVersion || null;
  const qv = cand && cand.styleCssHrefVer;
  if (qv && U.looksLikeVersion(qv) && (!wpCoreVer || qv !== wpCoreVer)) {
    return { value: qv, source: 'asset ?ver= parameter', label: 'appears', detail: 'The theme stylesheet is enqueued with ?ver=' + qv + '. WordPress normally uses the theme version here, but it is not authoritative, version appears to be ' + qv + '.' };
  }
  // 3) Not detectable
  const wv = (opts.wporg && opts.wporg.version) ? ' The public WordPress.org directory currently lists version ' + opts.wporg.version + ', that is the newest release, not evidence of the installed one.' : '';
  return { value: null, source: null, label: 'none', detail: 'Version not publicly detectable, no Version header was readable and no usable asset version parameter was found.' + wv };
}

function buildParent(parentRes, templateField) {
  if (!templateField) return null;
  const head = parentRes && parentRes.header ? parentRes.header : null;
  const fp = FP.findBySlug(templateField);
  const f = (head && head.fields) || {};
  const parent = {
    slug: templateField,
    name: f['Theme Name'] || (fp && fp.name) || templateField,
    version: f['Version'] && U.looksLikeVersion(f['Version']) ? { value: f['Version'], label: 'exact', source: 'parent style.css header' } : { value: null, label: 'none', source: null },
    author: f['Author'] || (fp && fp.author) || null,
    styleCssAccess: head ? 'public' : (parentRes ? (parentRes.reason || 'blocked') : 'not attempted'),
    themeUri: f['Theme URI'] || (fp && fp.themeUri) || null,
    source: null,
    evidence: []
  };
  if (head && head.found) parent.evidence.push('Parent theme header read from /wp-content/themes/' + templateField + '/style.css');
  if (fp) parent.evidence.push('Fingerprint database lists "' + fp.name + '" for slug ' + templateField);
  parent.evidence.push('Child theme header field Template: ' + templateField);
  return parent;
}

function detectSource(fp, fields, siteOrigin, wporg) {
  const uri = (fields && fields['Theme URI']) || (fp && fp.themeUri) || (wporg && wporg.homepage) || null;
  if (!fp && wporg && wporg.slug) {
    return { label: 'WordPress.org', detail: 'The slug is published in the free WordPress.org theme directory.', evidence: wporg.homepage || null };
  }
  const byUri = FP.sourceFromUri(uri);
  if (fp && !fp.premium && fp.source === 'wordpress.org') {
    return { label: 'WordPress.org', detail: byUri ? 'Listed in the WordPress.org theme directory (' + byUri + ').' : 'Listed in the WordPress.org theme directory.', evidence: uri || fp.themeUri };
  }
  if (fp && fp.source === 'marketplace') {
    return { label: fp.vendor || 'Theme marketplace', detail: 'Commercial theme distributed via ' + (fp.vendor || 'a marketplace') + '.', evidence: uri || fp.themeUri };
  }
  if (fp && fp.source === 'developer') {
    return { label: 'Theme developer', detail: 'Distributed by the theme developer' + (fp.vendor ? ' (' + fp.vendor + ')' : '') + '.', evidence: uri || fp.themeUri };
  }
  if (fp && fp.source === 'github') {
    return { label: 'Open-source project', detail: 'Starter/framework distributed as open source.', evidence: uri || fp.themeUri };
  }
  if (byUri) return { label: byUri, detail: 'Detected from the theme URI in the public theme header.', evidence: uri };
  const uriHost = uri ? U.hostOf(uri) : '';
  if (uri && siteOrigin && U.sameSite(uri, siteOrigin)) {
    return { label: 'Custom / self-hosted', detail: 'The Theme URI points at the scanned website itself, which is common for bespoke themes.', evidence: uri };
  }
  if (uri && uriHost) return { label: 'Theme developer', detail: 'Theme URI points at ' + uriHost + '.', evidence: uri };
  return { label: 'Unknown', detail: 'Theme origin could not be determined from public evidence.', evidence: null };
}

function detectPremium(fp, best, fields) {
  const kinds = best ? best.kinds.length : 0;
  if (fp && fp.premium && (best ? best.slugMatch || kinds >= 2 : false)) {
    return { label: 'Premium (commercial)', confidence: 92, detail: 'Fingerprint database classifies ' + fp.name + ' as a commercial theme and multiple markers matched.' };
  }
  const uri = (fields && fields['Theme URI']) || (fp && fp.themeUri) || '';
  if (/themeforest\.net|envato\.com|mojo-marketplace\.com|templatemonster\.com/i.test(uri)) {
    return { label: 'Premium (marketplace)', confidence: 85, detail: 'Theme URI points to a theme marketplace (' + U.hostOf(uri) + ').' };
  }
  if (fp && !fp.premium) {
    return { label: fp.bundled ? 'Free, bundled with WordPress' : 'Free: WordPress.org', confidence: 80, detail: 'Fingerprint database lists this slug as a free theme.' };
  }
  return { label: 'Unknown', confidence: 0, detail: 'Not enough evidence to classify the theme as free or premium.' };
}

function detectCustom(slug, fields, fp, best, siteOrigin) {
  if (!slug) return { flag: false, confidence: 0, signals: [], label: null };
  const signals = [];
  if (!fp) signals.push({ text: 'Theme slug "' + slug + '" is not in the fingerprint database', weight: 30 });
  if (!best || best.kinds.length === 0) signals.push({ text: 'No theme fingerprint matched any asset, class or signature', weight: 25 });
  const author = (fields['Author'] || '').toLowerCase();
  const host = siteOrigin ? U.hostOf(siteOrigin).replace(/^www\./, '') : '';
  const brand = host.split('.')[0];
  if (author) {
    if (host && (author.includes(host) || (brand.length > 3 && author.includes(brand)))) {
      signals.push({ text: 'Author (“' + fields['Author'] + '”) appears to be the site itself', weight: 20 });
    }
    if (/^(admin|webmaster|site admin|the (site|team))$/i.test(author.trim())) {
      signals.push({ text: 'Generic author (“' + fields['Author'] + '”)', weight: 15 });
    }
  } else if (Object.keys(fields).length) {
    signals.push({ text: 'No author listed in the public theme header', weight: 15 });
  }
  const uri = fields['Theme URI'] || '';
  if (uri && host && U.sameSite(uri, siteOrigin)) signals.push({ text: 'Theme URI points at the scanned site itself', weight: 15 });
  if (!uri && Object.keys(fields).length) signals.push({ text: 'No public Theme URI', weight: 10 });
  const name = (fields['Theme Name'] || '').toLowerCase();
  if (/custom|bespoke|client|in[- ]house/.test(name)) signals.push({ text: 'Theme name contains “custom”-style wording', weight: 15 });
  const score = signals.reduce((n, s) => n + s.weight, 0);
  const flag = score >= 40;
  return {
    flag,
    confidence: flag ? U.clamp(score, 40, 88) : 0,
    signals: signals.map(s => s.text),
    label: flag ? (score >= 70 ? 'Possible custom theme (strong signals)' : 'Possible custom theme') : null
  };
}

module.exports = { rankCandidates, matchFingerprints, analyzeTheme, stylesheetLinks, scriptSrcs, WEIGHTS };
