'use strict';

/*
 * huvanti WordPress Theme Detector — WordPress platform detection engine.
 *
 * Multi-signal, weighted, family-based. A single weak signal can never mark a
 * site as WordPress: "Detected" requires at least two independent signal
 * families, and strong claims require three or more.
 */

const U = require('./util');
const { pluginFingerprints, platformFingerprints } = require('./fingerprints');

const FAMILY_LABELS = {
  assets: 'WordPress asset paths (wp-content / wp-includes)',
  meta: 'Generator metadata',
  rest: 'WordPress REST API',
  html: 'WordPress HTML patterns',
  headers: 'HTTP headers',
  feeds: 'RSS/Atom feed',
  robots: 'robots.txt',
  login: 'Login / XML-RPC endpoints'
};

function collectClassAttrText(html) {
  const out = [];
  const re = /class\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let m;
  while ((m = re.exec(String(html || '')))) { out.push(m[1] || m[2] || m[3]); if (out.length >= 150) break; }
  return out.join(' ');
}

function generatorMetas(html) {
  const out = [];
  const re = /<meta[^>]+name\s*=\s*(?:"generator"|'generator'|generator\b)[^>]*>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const tag = m[0];
    const c = tag.match(/content\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const val = c ? (c[1] != null ? c[1] : (c[2] != null ? c[2] : c[3])) : '';
    if (val) out.push(U.strip(val, 200));
  }
  return out;
}

/*
 * Analyse one fetched page (usually the homepage) plus optional probe results.
 * `page`: { url, html, headers, status }
 * `probes`: { rest, feed, oembed, robots } — optional fetched probe bodies.
 */
function analyzePage(page, probes) {
  page = page || {};
  probes = probes || {};
  const html = String(page.html || '');
  const headers = page.headers || {};
  const lower = html.toLowerCase();
  const signals = [];
  const add = (family, key, weight, detail) => {
    if (!signals.some(s => s.key === key)) signals.push({ family, key, weight, detail: U.strip(detail, 300) });
  };

  /* ---- Family: WordPress asset paths ---- */
  const assetUrls = U.extractAssetUrls(html, page.finalUrl || page.url || 'https://x.invalid/');
  const allUrlText = assetUrls.join(' ');
  const wpIncludes = assetUrls.filter(u => /\/wp-includes\//.test(u));
  const wpContentTheme = assetUrls.filter(u => /\/wp-content\/themes\//.test(u));
  const wpContentPlugin = assetUrls.filter(u => /\/wp-content\/plugins\//.test(u));
  const wpContentUploads = assetUrls.filter(u => /\/wp-content\/uploads\//.test(u));
  if (wpIncludes.length) add('assets', 'wp_includes', 25, `/wp-includes/ assets detected (${wpIncludes.length} URL${wpIncludes.length === 1 ? '' : 's'}, e.g. ${shortUrl(wpIncludes[0])})`);
  if (wpContentTheme.length) add('assets', 'wp_content_themes', 15, `/wp-content/themes/ assets detected (${wpContentTheme.length}, e.g. ${shortUrl(wpContentTheme[0])})`);
  if (wpContentPlugin.length) add('assets', 'wp_content_plugins', 8, `/wp-content/plugins/ assets detected (${wpContentPlugin.length}, e.g. ${shortUrl(wpContentPlugin[0])})`);
  if (wpContentUploads.length) add('assets', 'wp_content_uploads', 6, `/wp-content/uploads/ media detected (${wpContentUploads.length})`);
  if (/wp-emoji-release\.min\.js/.test(lower)) add('assets', 'wp_emoji', 12, 'WordPress emoji script (wp-emoji-release.min.js) detected');
  if (/\bwp-block-/.test(lower)) add('html', 'wp_block_classes', 10, 'WordPress block-editor markup (wp-block-*) detected');
  if (/\bwp-image-\d|wp-caption\b/.test(lower)) add('html', 'wp_image_classes', 6, 'WordPress image/caption classes (wp-image-*, wp-caption) detected');
  if (/wp-json|wpApiSettings|rest_route=/i.test(html)) add('rest', 'rest_reference', 15, 'REST API reference in HTML (wp-json / wpApiSettings / ?rest_route=)');
  if (/wpautop|wp_footer|wp_body_open/.test(lower)) add('html', 'wp_hooks', 6, 'WordPress template hooks markup detected');

  /* ---- Family: generator metadata ---- */
  const gens = generatorMetas(html);
  const wpGen = gens.find(g => /\bwordpress\b/i.test(g));
  if (wpGen) add('meta', 'generator', 30, `Generator meta: "${wpGen}"`);

  /* ---- Family: HTTP headers ---- */
  if (headers['x-pingback'] || headers['pingback']) add('headers', 'pingback', 8, 'X-Pingback / Pingback header present (XML-RPC based)');
  if (/rel\s*=\s*["']?shortlink/i.test(html) && /\?p=\d+/.test(html)) add('headers', 'shortlink', 6, 'WordPress shortlink (rel=shortlink ?p=…) detected');

  /* ---- Family: feeds ---- */
  const feed = String((probes.feed && probes.feed.text) || '');
  if (feed) {
    const gm = feed.match(/<generator[^>]*>([^<]*)<\/generator>/i) || feed.match(/<!--\s*generator="([^"]+)"/i);
    if (gm && /wordpress/i.test(gm[1])) add('feeds', 'feed_generator', 15, `Feed generator identifies WordPress ("${U.strip(gm[1], 120)}")`);
  }

  /* ---- Family: robots.txt ---- */
  const robots = String((probes.robots && probes.robots.text) || '');
  if (robots) {
    const wpPaths = [/wp-admin/i, /wp-content/i, /wp-includes/i, /wp-login\.php/i].filter(re => re.test(robots)).length;
    if (wpPaths >= 2) add('robots', 'robots_wp_paths', 6, `robots.txt references WordPress paths (${wpPaths} distinct)`);
  }

  /* ---- Family: login / xmlrpc ---- */
  if (/wp-login\.php/.test(lower)) add('login', 'wp_login_ref', 6, 'wp-login.php link detected in HTML');
  if (/xmlrpc\.php/.test(lower)) add('login', 'xmlrpc_ref', 4, 'xmlrpc.php reference detected');

  /* ---- Family: direct browser asset load (CORS-free probe) ---- */
  const rp = probes.resourceProbe;
  if (rp && Array.isArray(rp.loaded) && rp.loaded.length) {
    add('assets', 'browser_asset_load', 30, 'WordPress core asset loaded directly in the visitor’s browser (' + U.strip(rp.loaded[0], 160) + ') — only WordPress serves this file.');
  }

  /* ---- Family: REST probe (active request) ---- */
  const rest = probes.rest;
  if (rest && rest.ok) {
    let namespaces = [];
    try { const j = JSON.parse(rest.text.slice(0, 200000)); namespaces = Array.isArray(j.namespaces) ? j.namespaces : []; } catch (e) {}
    if (namespaces.includes('wp/v2')) add('rest', 'rest_probe', 30, 'WordPress REST API endpoint /wp-json/ responded with the wp/v2 namespace');
    else if (rest.text && /"namespaces"\s*:/.test(rest.text)) add('rest', 'rest_probe_generic', 12, 'REST-style JSON with namespaces found at /wp-json/');
  }

  /* ---- Plugin fingerprints (supporting context, not theme evidence) ---- */
  const classText = collectClassAttrText(html);
  const plugins = pluginFingerprints.map(fp => {
    const hits = [];
    if ((fp.assetPaths || []).some(p => allUrlText.toLowerCase().includes(p.toLowerCase()))) hits.push('asset');
    if ((fp.bodyClasses || []).some(c => classText.includes(c))) hits.push('class');
    if ((fp.jsSignatures || []).some(j => allUrlText.toLowerCase().includes(j.toLowerCase()))) hits.push('js');
    return hits.length ? { slug: fp.slug, name: fp.name, hits } : null;
  }).filter(Boolean);

  /* ---- Confidence & decision ---- */
  const score = signals.reduce((n, s) => n + s.weight, 0);
  const families = U.uniq(signals.map(s => s.family));
  /*
   * Strong single signals: the site itself answering /wp-json/ with the wp/v2
   * namespace, or declaring WordPress in its generator meta, are definitive
   * self-identifications. Every other single family (e.g. one wp-content path)
   * stays at "Likely" and can never produce a "Detected" verdict alone.
   */
  const STRONG_SINGLES = new Set(['rest_probe', 'generator', 'browser_asset_load']);
  const strongSingle = signals.some(s => STRONG_SINGLES.has(s.key));
  let status, confidence, note;
  if (families.length >= 3 && score >= 60) {
    status = 'detected';
    confidence = U.clamp(Math.round(55 + score * 0.42), 85, 99);
    note = 'Multiple independent WordPress signal families matched.';
  } else if (families.length >= 2 && score >= 30) {
    status = 'detected';
    confidence = U.clamp(Math.round(45 + score * 0.5), 70, 88);
    note = 'At least two independent WordPress signal families matched.';
  } else if (families.length === 1 && strongSingle && score >= 30) {
    status = 'detected';
    confidence = signals.some(s => s.key === 'rest_probe') ? 88 : 83;
    note = 'A definitive WordPress self-identification signal was observed (REST API namespaces or generator metadata).';
  } else if (families.length >= 1 && score >= 15) {
    status = 'likely';
    confidence = U.clamp(Math.round(38 + score * 0.4), 40, 68);
    note = 'WordPress signals found, but not enough independent families for a confident “Detected” verdict.';
  } else if (score > 0) {
    status = 'not_detected';
    confidence = 92;
    note = 'Only isolated weak signals were found — not enough to call the site WordPress.';
  } else {
    status = 'not_detected';
    confidence = 98;
    note = 'No WordPress signals were found in the readable page.';
  }

  /* ---- Other-platform suggestions (never a full CMS detector) ---- */
  const haystack = (html + ' ' + allUrlText + ' ' + Object.values(headers).join(' ')).toLowerCase();
  const platforms = platformFingerprints.map(pf => {
    const matched = U.uniq(pf.markers.map(m => m.toLowerCase()).filter(m => haystack.includes(m)));
    if (!matched.length) return null;
    const strong = matched.length >= 2 || (pf.weight >= 22 && matched.length >= 1 && matched[0].length > 10);
    return {
      key: pf.key, name: pf.name, matched,
      confidence: U.clamp(Math.round(pf.weight * (matched.length >= 2 ? 1.6 : 0.8)), 10, 95),
      strength: strong ? 'strong' : 'weak'
    };
  }).filter(Boolean).sort((a, b) => b.confidence - a.confidence);

  return {
    signals, score, families: families.map(f => ({ key: f, label: FAMILY_LABELS[f] || f })),
    status, confidence, note,
    plugins,
    platforms,
    assetUrls, classText, generators: gens,
    counts: { wpIncludes: wpIncludes.length, themeAssets: wpContentTheme.length, pluginAssets: wpContentPlugin.length }
  };
}

function shortUrl(u) {
  try { const x = new URL(u); return x.pathname.slice(0, 90); } catch (e) { return String(u).slice(0, 90); }
}

module.exports = { analyzePage, collectClassAttrText, generatorMetas, FAMILY_LABELS };
