'use strict';

/*
 * huvanti WordPress Theme Detector — scan orchestration.
 *
 * Pipeline:
 *   URL validation → safe crawl → WordPress detection → theme path discovery →
 *   stylesheet analysis → metadata extraction → child/parent detection →
 *   fingerprint matching → version detection → evidence collection →
 *   confidence calculation → transparent result.
 *
 * Early stop: once WordPress confidence is high AND the theme header is parsed
 * AND a fingerprint matched, optional probes are skipped.
 */

const U = require('./util');
const { assertPublicUrl } = require('./ssrf');
const { createFetcher } = require('./fetcher');
const { analyzePage } = require('./wpDetect');
const { rankCandidates, analyzeTheme } = require('./themeDetect');
const { buildProbes, classifyProbe, analyzeExposure } = require('./exposure');
const FP = require('./fingerprints');

const SCAN_TIMEOUT_MS = 45000;

/*
 * Run a full scan. `opt.transport` (async (urlObj, pin, reqOpt) => response)
 * lets the offline self-test drive the identical pipeline with fixtures.
 */
async function runScan(rawUrl, opt) {
  opt = opt || {};
  const started = Date.now();
  const onProgress = opt.onProgress || function () {};
  const signal = opt.signal;

  const guard = () => {
    if (signal && signal.aborted) throw U.makeError('cancelled', 'Scan cancelled.');
    if (Date.now() - started > SCAN_TIMEOUT_MS) throw U.makeError('timeout', 'Scan exceeded the time limit.');
  };

  onProgress({ stage: 'validate', message: 'Validating and normalizing the URL…' });
  let urlObj;
  try {
    urlObj = U.normalizeInputUrl(rawUrl);   // syntax + scheme normalisation
    assertPublicUrl(urlObj.href);           // SSRF guard (private/loopback/metadata)
  } catch (e) {
    throw e.code === 'invalid_url' || e.code === 'ssrf' ? e : U.makeError('invalid_url', e.message);
  }

  const fetcher = createFetcher({ transport: opt.transport, maxRequests: opt.maxRequests, maxTotalBytes: opt.maxTotalBytes });
  const get = (u, fo) => { guard(); return fetcher.fetchFollow(u, Object.assign({ signal }, fo || {})); };

  const scanInfo = {
    url: urlObj.href,
    finalUrl: null, status: 0, ip: null, durationMs: 0,
    requests: 0, bytes: 0, methods: [], signals: 0,
    robots: { checked: false, notes: [] },
    redirects: [], notes: []
  };
  const methodsUsed = new Set(['URL validation', 'Safe crawl']);

  /* ---------- robots.txt (informational — noted, not blocking a single-page scan) ---------- */
  let robotsRes = null;
  try {
    onProgress({ stage: 'connect', message: 'Checking robots.txt…' });
    robotsRes = await get(urlObj.origin + '/robots.txt', { maxBytes: 64 * 1024 });
    scanInfo.robots.checked = true;
    if (robotsRes.status === 200 && robotsRes.text && !/^\s*</.test(robotsRes.text)) {
      const t = robotsRes.text;
      const wpPaths = [/wp-admin/i, /wp-content/i, /wp-includes/i].filter(re => re.test(t)).length;
      if (wpPaths) scanInfo.robots.notes.push('robots.txt references WordPress paths (' + wpPaths + ' distinct) — supporting signal.');
      if (/Disallow:\s*\/\s*$/im.test(t)) scanInfo.robots.notes.push('robots.txt contains a broad Disallow rule — some resources may be restricted for crawlers.');
    }
  } catch (e) { /* robots is optional */ }

  /* ---------- Homepage ---------- */
  onProgress({ stage: 'connect', message: 'Fetching the homepage…' });
  let home;
  try {
    home = await get(urlObj.href);
  } catch (e) {
    throw finishError(e, scanInfo, started, fetcher);
  }
  scanInfo.finalUrl = home.finalUrl;
  scanInfo.status = home.status;
  scanInfo.ip = home.ip;
  scanInfo.redirects = home.hops.map(h => ({ url: h.url, status: h.status }));
  if (home.redirected) scanInfo.notes.push('Redirected to ' + home.finalUrl);
  const origin = new URL(home.finalUrl).origin;

  /* ---------- Access failures → Unable to Verify (never "not WordPress") ---------- */
  const unverifiedCodes = { 401: 'blocked', 403: 'blocked', 429: 'rate_limited_target', 502: 'server_error', 503: 'server_error', 504: 'server_error', 500: 'server_error', 404: 'not_found' };
  if (home.challenge) {
    scanInfo.requests = fetcher.state.requests; scanInfo.bytes = fetcher.state.bytes;
    throw finishError(U.makeError('challenge', 'The site is protected by ' + (home.guard || 'a bot challenge') + ' and could not be read.'), scanInfo, started, fetcher);
  }
  if (home.status === 404) throw finishError(U.makeError('not_found', 'The page returned 404 Not Found — check the URL.'), scanInfo, started, fetcher);
  if (unverifiedCodes[home.status]) {
    const code = unverifiedCodes[home.status];
    const msg = { blocked: 'The website blocked this scanner (HTTP ' + home.status + ') — WordPress status cannot be determined.', rate_limited_target: 'The website rate-limited this scanner (HTTP 429).', server_error: 'The website returned a server error (HTTP ' + home.status + ').' }[code];
    throw finishError(U.makeError(code, msg), scanInfo, started, fetcher);
  }
  if (home.status >= 300) throw finishError(U.makeError('unreachable', 'Unexpected HTTP status ' + home.status + '.'), scanInfo, started, fetcher);

  const ct = (home.headers['content-type'] || '').toLowerCase();
  const html = home.text || '';
  if (ct && /json|image\/|font|application\/pdf/i.test(ct) && !/html/i.test(ct)) {
    throw finishError(U.makeError('empty', 'The URL returned ' + ct + ' instead of an HTML page.'), scanInfo, started, fetcher);
  }
  const mass = U.textMass(html);

  /* ---------- WordPress detection ---------- */
  onProgress({ stage: 'wordpress', message: 'Analysing WordPress signals…' });
  const wp = analyzePage({ url: urlObj.href, finalUrl: home.finalUrl, html, headers: home.headers }, { robots: robotsRes });
  let wpVerMatch = (wp.generators.find(g => /wordpress\s+([\d.]+)/i.test(g)) || '').match(/wordpress\s+([\d.]+)/i);
  let wpVersion = wpVerMatch ? wpVerMatch[1] : null;
  wp.families.forEach(() => methodsUsed.add('WordPress fingerprints'));

  /* ---------- Optional probes when evidence is still thin ---------- */
  const probes = {};
  const needRest = wp.status !== 'detected' || wp.confidence < 85;
  const themeCands0 = rankCandidates(html, []);
  const needSlugHelp = !themeCands0.length;

  if ((needRest || needSlugHelp) && !(signal && signal.aborted)) {
    onProgress({ stage: 'wordpress', message: 'Probing the WordPress REST API…' });
    try {
      const rest = await get(origin + '/wp-json/', { maxBytes: 256 * 1024, accept: 'application/json,*/*;q=0.5' });
      probes.rest = rest;
      if (rest.status === 200 && /"namespaces"/.test(rest.text)) methodsUsed.add('WordPress REST API');
    } catch (e) { if (e.code === 'cancelled' || e.code === 'budget') throw e; }
  }
  // Re-evaluate with REST evidence included
  let wpFinal = wp.status === 'detected' && wp.confidence >= 85 && !needRest
    ? wp
    : analyzePage({ url: urlObj.href, finalUrl: home.finalUrl, html, headers: home.headers }, { robots: robotsRes, rest: probes.rest });
  wpVersion = wpVersion || (() => {
    const m = (wpFinal.generators.find(g => /wordpress\s+([\d.]+)/i.test(g)) || '').match(/wordpress\s+([\d.]+)/i);
    return m ? m[1] : null;
  })();

  /* ---------- JS-only / empty page guard ---------- */
  if (wpFinal.score === 0 && mass.chars < 300 && html.length > 0) {
    scanInfo.requests = fetcher.state.requests; scanInfo.bytes = fetcher.state.bytes;
    throw finishError(U.makeError('js_only', 'The page rendered almost no readable HTML — it is likely a JavaScript-only application, so WordPress cannot be verified from the initial response.'), scanInfo, started, fetcher);
  }
  if (wpFinal.score === 0 && !html.length) {
    throw finishError(U.makeError('empty', 'The server returned an empty page.'), scanInfo, started, fetcher);
  }

  /* ---------- Not WordPress path ---------- */
  if (wpFinal.status === 'not_detected') {
    scanInfo.requests = fetcher.state.requests; scanInfo.bytes = fetcher.state.bytes;
    const platforms = wpFinal.platforms.filter(p => p.strength === 'strong').slice(0, 2);
    const weak = wpFinal.platforms.filter(p => p.strength === 'weak').slice(0, 2);
    return buildNotDetectedReport({ url: urlObj.href, finalUrl: home.finalUrl, status: home.status, started, fetcher, scanInfo, wp: wpFinal, mass, platforms, weakPlatforms: weak });
  }

  /* ---------- Theme discovery ---------- */
  onProgress({ stage: 'theme', message: 'Locating the active theme…' });
  let candidates = rankCandidates(html, []);
  methodsUsed.add('HTML source analysis');
  methodsUsed.add('CSS URLs');
  methodsUsed.add('JavaScript URLs');
  methodsUsed.add('Enqueued assets');

  // Secondary discovery via REST content / oEmbed when the homepage hides the theme
  if (!candidates.length) {
    scanInfo.notes.push('No /wp-content/themes/ path in the homepage HTML.');
    try {
      onProgress({ stage: 'theme', message: 'Trying REST content for theme paths…' });
      const posts = await get(origin + '/wp-json/wp/v2/posts?per_page=5&_fields=content,link', { maxBytes: 512 * 1024, accept: 'application/json,*/*;q=0.5' });
      if (posts.status === 200 && /"content"/.test(posts.text.slice(0, 400))) {
        probes.posts = posts;
        methodsUsed.add('WordPress REST API');
      }
    } catch (e) { if (e.code === 'cancelled' || e.code === 'budget') throw e; }
    candidates = rankCandidates(html, [posts2text(probes.posts)]);
    if (!candidates.length) {
      try {
        onProgress({ stage: 'theme', message: 'Trying oEmbed for theme paths…' });
        const oe = await get(origin + '/wp-json/oembed/1.0/embed?url=' + encodeURIComponent(home.finalUrl), { maxBytes: 128 * 1024, accept: 'application/json,*/*;q=0.5' });
        if (oe.status === 200) { probes.oembed = oe; methodsUsed.add('WordPress REST API'); }
      } catch (e) { if (e.code === 'cancelled' || e.code === 'budget') throw e; }
      candidates = rankCandidates(html, [posts2text(probes.posts), oe2text(probes.oembed)]);
    }
  }

  const cand = candidates[0] || null;

  /* ---------- Not able to name a theme ---------- */
  if (!cand) {
    scanInfo.requests = fetcher.state.requests; scanInfo.bytes = fetcher.state.bytes;
    return buildUnknownThemeReport({ url: urlObj.href, finalUrl: home.finalUrl, status: home.status, started, fetcher, scanInfo, wp: wpFinal, methodsUsed, probes, mass });
  }

  /* ---------- style.css ---------- */
  onProgress({ stage: 'stylesheet', message: 'Reading the theme stylesheet header…' });
  const styleUrl = origin + '/wp-content/themes/' + cand.slug + '/style.css';
  let styleRes = null;
  const headerRes = { attempted: false, found: false, fields: {} };
  try {
    styleRes = await get(styleUrl, { maxBytes: 256 * 1024, accept: 'text/css,*/*;q=0.1' });
    headerRes.attempted = true;
    if (styleRes.status === 200 && styleRes.text) {
      Object.assign(headerRes, U.parseThemeHeader(styleRes.text));
      if (headerRes.found) methodsUsed.add('style.css header');
      else headerRes.reason = 'no WordPress theme header inside the file';
    } else {
      headerRes.reason = 'HTTP ' + styleRes.status;
    }
  } catch (e) {
    if (e.code === 'cancelled' || e.code === 'budget') throw e;
    headerRes.attempted = true;
    headerRes.reason = e.code === 'timeout' ? 'request timed out' : 'not reachable';
  }

  /* ---------- Child → parent ---------- */
  let parentRes = null;
  if (headerRes.found && headerRes.fields['Template']) {
    const pSlug = U.sanitizeSlug(headerRes.fields['Template']);
    if (pSlug) {
      onProgress({ stage: 'parent', message: 'Child theme found — reading the parent theme…' });
      parentRes = { slug: pSlug, header: { attempted: false, found: false, fields: {} } };
      try {
        const pres = await get(origin + '/wp-content/themes/' + pSlug + '/style.css', { maxBytes: 256 * 1024, accept: 'text/css,*/*;q=0.1' });
        parentRes.header.attempted = true;
        if (pres.status === 200) Object.assign(parentRes.header, U.parseThemeHeader(pres.text));
        else parentRes.header.reason = 'HTTP ' + pres.status;
        if (parentRes.header.found) methodsUsed.add('style.css header');
      } catch (e) {
        if (e.code === 'cancelled' || e.code === 'budget') throw e;
        parentRes.header.attempted = true;
        parentRes.header.reason = 'not reachable';
      }
    }
  }

  /* ---------- Extra CSS for fingerprints (main enqueued stylesheet) ---------- */
  let cssText = styleRes && styleRes.status === 200 ? styleRes.text : '';
  const mainLink = pickMainCssLink(html, cand.slug);
  let mainCssUrl = null, mainCssRes = null;
  if (mainLink && mainLink.href !== styleUrl) {
    try {
      onProgress({ stage: 'fingerprints', message: 'Matching theme fingerprints…' });
      mainCssRes = await get(mainLink.href, { maxBytes: 400 * 1024, accept: 'text/css,*/*;q=0.1' });
      if (mainCssRes.status === 200 && /css|text\/plain|\*/i.test(mainCssRes.headers['content-type'] || 'css')) {
        cssText += '\n' + mainCssRes.text;
        mainCssUrl = mainLink.href;
        methodsUsed.add('CSS analysis');
      }
    } catch (e) { if (e.code === 'cancelled' || e.code === 'budget') throw e; }
  }

  /* ---------- Screenshot ---------- */
  let screenshot = { available: false, url: null };
  try {
    onProgress({ stage: 'fingerprints', message: 'Checking the theme screenshot…' });
    const shotUrl = origin + '/wp-content/themes/' + cand.slug + '/screenshot.png';
    const shot = await get(shotUrl, { maxBytes: 600 * 1024, accept: 'image/*,*/*;q=0.1' });
    if (shot.status === 200 && /image\/(png|jpe?g|webp)/i.test(shot.headers['content-type'] || '') && shot.bytes > 500) {
      screenshot = { available: true, url: shotUrl, bytes: shot.bytes };
    } else if (parentRes && parentRes.slug) {
      const pShotUrl = origin + '/wp-content/themes/' + parentRes.slug + '/screenshot.png';
      const pshot = await get(pShotUrl, { maxBytes: 600 * 1024, accept: 'image/*,*/*;q=0.1' });
      if (pshot.status === 200 && /image\/(png|jpe?g|webp)/i.test(pshot.headers['content-type'] || '') && pshot.bytes > 500) {
        screenshot = { available: true, url: pShotUrl, bytes: pshot.bytes, fromParent: true };
      }
    }
  } catch (e) { if (e.code === 'cancelled' || e.code === 'budget') throw e; }

  /* ---------- Theme analysis ---------- */
  const bundle = {
    slug: cand.slug,
    assetUrls: wp.assetUrls,
    classText: wp.classText,
    cssText: cssText.slice(0, 500000),
    generators: wp.generators,
    html: html.slice(0, 500000),
    siteOrigin: origin
  };
  const theme = analyzeTheme(cand, headerRes, parentRes, bundle, {
    restText: probes.rest && probes.rest.status === 200 ? probes.rest.text : '',
    postsText: posts2text(probes.posts),
    oembedText: oe2text(probes.oembed)
  }, {
    styleCssStatus: headerRes.attempted ? styleRes && styleRes.status : null,
    mainCssUrl,
    screenshot,
    wpVersion,
    otherCandidates: candidates.slice(1).map(c => c.slug),
    sourceMapFound: false // filled by exposure probe below
  });
  theme.methods.forEach(m => methodsUsed.add(m));

  /* ---------- Exposure probes ---------- */
  onProgress({ stage: 'exposure', message: 'Checking public theme exposure…' });
  const probeDefs = buildProbes(origin, cand.slug, mainCssUrl);
  const probeResults = [];
  for (const pd of probeDefs) {
    try {
      guard();
      const res = await get(pd.url, { maxBytes: 96 * 1024 });
      probeResults.push(classifyProbe(pd, res, cand.slug));
    } catch (e) {
      if (e.code === 'cancelled' || e.code === 'budget') { probeResults.push({ key: pd.key, label: pd.label, status: 'unknown', detail: pd.note + ' Not probed (' + e.code + ').' }); continue; }
      probeResults.push({ key: pd.key, label: pd.label, status: 'unknown', detail: pd.note + ' Request failed (' + e.code + ').' });
    }
  }
  const exposure = analyzeExposure(theme, probeResults, mainCssRes);

  /* ---------- Version status (local dataset, honest labelling) ---------- */
  const versionStatus = buildVersionStatus(theme);

  scanInfo.requests = fetcher.state.requests;
  scanInfo.bytes = fetcher.state.bytes;
  scanInfo.durationMs = Date.now() - started;
  scanInfo.methods = Array.from(methodsUsed);
  scanInfo.signals = wpFinal.signals.length + theme.evidence.length;

  onProgress({ stage: 'report', message: 'Building the transparent report…' });

  const statusLabel = wpFinal.status === 'detected' ? 'Detected' : 'Likely WordPress';
  const report = {
    status: wpFinal.status === 'detected' ? 'detected' : 'likely',
    statusLabel,
    scannedAt: new Date().toISOString(),
    wordpress: {
      detected: wpFinal.status === 'detected',
      confidence: wpFinal.confidence,
      note: wpFinal.note,
      version: wpVersion,
      signals: wpFinal.signals,
      families: wpFinal.families,
      plugins: wpFinal.plugins
    },
    theme,
    exposure,
    versionStatus,
    scan: scanInfo,
    copyText: buildCopyText(wpFinal, theme)
  };
  return report;
}

/* ---------------- helpers ---------------- */

function posts2text(posts) {
  if (!posts || posts.status !== 200 || !posts.text) return '';
  try {
    const j = JSON.parse(posts.text.slice(0, 1000000));
    if (Array.isArray(j)) return j.map(p => (p.content && p.content.rendered) || '').join(' ');
    if (j && j.content && j.content.rendered) return j.content.rendered;
  } catch (e) {}
  return posts.text;
}
function oe2text(oe) {
  if (!oe || oe.status !== 200 || !oe.text) return '';
  try { const j = JSON.parse(oe.text); return j.html || ''; } catch (e) { return ''; }
}

function pickMainCssLink(html, slug) {
  const { stylesheetLinks } = require('./themeDetect');
  const links = stylesheetLinks(html);
  const slugRe = new RegExp('/wp-content/themes/' + slug.replace(/[^a-z0-9_.-]/gi, '') + '/', 'i');
  return links.find(l => slugRe.test(l.href) && /\/style\.css/i.test(l.href)) ||
         links.find(l => slugRe.test(l.href)) || null;
}

function buildVersionStatus(theme) {
  if (!theme || !theme.version || !theme.version.value) {
    return { label: 'Unknown', detail: 'No theme version was detected, so version age could not be assessed.' };
  }
  const fp = FP.findBySlug(theme.slug);
  if (!fp || !fp.latestKnown) {
    return { label: 'Could not be independently verified', detail: 'A version was detected, but the bundled fingerprint dataset has no release history for this theme. Version age could not be independently verified.' };
  }
  const c = U.cmpVersion(theme.version.value, fp.latestKnown.version);
  const ds = 'Bundled dataset (newest recorded release ' + fp.latestKnown.version + ', as of ' + fp.latestKnown.asOf + '). This local dataset may lag behind reality — verify with the vendor.';
  if (c === 0) return { label: 'Current according to the available dataset', detail: 'The detected version matches the newest release in the bundled dataset. ' + ds };
  if (c < 0) return { label: 'Older version detected', detail: 'The detected version (' + theme.version.value + ') is older than the newest release in the bundled dataset (' + fp.latestKnown.version + '). ' + ds + ' No vulnerability claims are made from this comparison.' };
  return { label: 'Newer than the dataset', detail: 'The detected version (' + theme.version.value + ') is newer than the bundled dataset (' + fp.latestKnown.version + ') — the dataset is likely stale. ' + ds };
}

function buildCopyText(wp, theme) {
  const lines = [];
  if (theme && theme.name) lines.push('Theme: ' + theme.name);
  if (theme && theme.slug) lines.push('Slug: ' + theme.slug);
  if (theme && theme.version && theme.version.value) lines.push('Version: ' + theme.version.value + ' (' + theme.version.label + ')');
  if (theme && theme.author) lines.push('Author: ' + theme.author);
  if (theme && theme.isChild && theme.parent) lines.push('Parent theme: ' + theme.parent.name + ' (' + theme.parent.slug + ')');
  if (wp) lines.push('WordPress: ' + (wp.detected ? 'Detected' : 'Likely') + ' (confidence ' + wp.confidence + '%)');
  return lines.join('\n');
}

function finishError(e, scanInfo, started, fetcher) {
  scanInfo.requests = fetcher.state.requests;
  scanInfo.bytes = fetcher.state.bytes;
  scanInfo.durationMs = Date.now() - started;
  e.scan = scanInfo;
  return e;
}

function baseScanBlock(scanInfo, methodsUsed, fetcher) {
  scanInfo.requests = fetcher.state.requests;
  scanInfo.bytes = fetcher.state.bytes;
  scanInfo.methods = Array.from(methodsUsed);
  return scanInfo;
}

function buildNotDetectedReport(ctx) {
  const scanInfo = baseScanBlock(ctx.scanInfo, ctx.methodsUsed || new Set(['URL validation', 'Safe crawl']), ctx.fetcher);
  scanInfo.durationMs = Date.now() - ctx.started;
  scanInfo.signals = ctx.wp.signals.length;
  const strongPlat = ctx.platforms || [];
  return {
    status: 'not_detected',
    statusLabel: 'WordPress Not Detected',
    scannedAt: new Date().toISOString(),
    wordpress: {
      detected: false,
      confidence: ctx.wp.confidence,
      note: ctx.wp.note,
      signals: ctx.wp.signals,
      families: ctx.wp.families,
      plugins: []
    },
    theme: null,
    possiblePlatform: strongPlat.length
      ? { name: strongPlat[0].name, confidence: strongPlat[0].confidence, matched: strongPlat[0].matched, others: strongPlat.slice(1).map(p => p.name) }
      : (ctx.weakPlatforms && ctx.weakPlatforms.length ? { name: ctx.weakPlatforms[0].name, confidence: ctx.weakPlatforms[0].confidence, matched: ctx.weakPlatforms[0].matched, others: [], weak: true } : null),
    scan: scanInfo,
    copyText: 'WordPress: Not Detected (confidence ' + ctx.wp.confidence + '%)'
      + (strongPlat.length ? '\nPossible platform: ' + strongPlat[0].name : '')
  };
}

function buildUnknownThemeReport(ctx) {
  const scanInfo = baseScanBlock(ctx.scanInfo, ctx.methodsUsed, ctx.fetcher);
  scanInfo.durationMs = Date.now() - ctx.started;
  scanInfo.signals = ctx.wp.signals.length;
  const attempts = [
    'Homepage HTML scanned for /wp-content/themes/ paths',
    'All stylesheet and script URLs checked',
    ctx.probes.rest ? 'REST API /wp-json/ checked for theme references' : 'REST API /wp-json/ not reachable or skipped',
    ctx.probes.posts ? 'Public post content fetched via REST for theme asset paths' : 'REST post content not available',
    ctx.probes.oembed ? 'oEmbed output checked for theme asset paths' : 'oEmbed not available'
  ];
  const why = [];
  if (ctx.wp.score < 40) why.push('WordPress evidence is itself limited — the site may hide or rename core asset paths.');
  if (ctx.probes.rest && ctx.probes.rest.status !== 200) why.push('The WordPress REST API is disabled, filtered, or blocked (HTTP ' + ctx.probes.rest.status + ').');
  if (!ctx.probes.posts) why.push('Public REST content was not available to expose theme asset URLs.');
  if (ctx.mass && ctx.mass.chars < 800) why.push('The page contains little readable HTML — assets may be injected client-side by JavaScript.');
  why.push('Theme assets may be bundled, CDN-rewritten, or served from renamed paths.');
  return {
    status: ctx.wp.status === 'detected' ? 'detected' : 'likely',
    statusLabel: ctx.wp.status === 'detected' ? 'Detected' : 'Likely WordPress',
    scannedAt: new Date().toISOString(),
    wordpress: {
      detected: ctx.wp.status === 'detected',
      confidence: ctx.wp.confidence,
      note: ctx.wp.note,
      version: null,
      signals: ctx.wp.signals,
      families: ctx.wp.families,
      plugins: ctx.wp.plugins
    },
    theme: {
      found: false,
      name: null, slug: null,
      confidence: 0,
      confidenceLabel: 'Unable to determine',
      attempts, why,
      evidence: ctx.wp.signals,
      methods: scanInfo.methods
    },
    exposure: null,
    versionStatus: null,
    scan: scanInfo,
    copyText: 'WordPress: ' + (ctx.wp.status === 'detected' ? 'Detected' : 'Likely') + ' (confidence ' + ctx.wp.confidence + '%)\nActive theme: Unable to determine'
  };
}

module.exports = { runScan, buildVersionStatus, posts2text, oe2text };
