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
 * Two transports feed the SAME deterministic analyzer:
 *   - collectServer(): pinned direct HTTP from the server (preferred)
 *   - browser relay:   the page collects resources with the visitor's browser
 *                      (free CORS relays as fallback) and POSTs the bundle to
 *                      /api/wptheme-analyze → analyzeCollected()
 *
 * Early stop: once WordPress confidence is high AND the theme header is parsed
 * AND a fingerprint matched, optional probes are skipped.
 */

const U = require('./util');
const { assertPublicUrl } = require('./ssrf');
const { createFetcher } = require('./fetcher');
const { analyzePage } = require('./wpDetect');
const { rankCandidates, analyzeTheme, stylesheetLinks } = require('./themeDetect');
const { buildProbes, classifyProbe, analyzeExposure } = require('./exposure');
const FP = require('./fingerprints');

const SCAN_TIMEOUT_MS = 45000;

/* ------------------------------------------------------------------ */
/* Server-side collection (pinned requests, injectable transport)      */
/* ------------------------------------------------------------------ */

async function collectServer(rawUrl, opt) {
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
    throw (e.code === 'invalid_url' || e.code === 'ssrf') ? e : U.makeError('invalid_url', e.message);
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
  const via = 'server';

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
  } catch (e) { if (['cancelled', 'budget'].includes(e.code)) throw e; /* robots is optional */ }

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
    throw finishError(U.makeError('challenge', 'The site is protected by ' + (home.guard || 'a bot challenge') + ' and could not be read.'), scanInfo, started, fetcher);
  }
  if (home.status === 404) throw finishError(U.makeError('not_found', 'The page returned 404 Not Found — check the URL.'), scanInfo, started, fetcher);
  if (unverifiedCodes[home.status]) {
    const code = unverifiedCodes[home.status];
    const msg = {
      blocked: 'The website blocked this scanner (HTTP ' + home.status + ') — WordPress status cannot be determined.',
      rate_limited_target: 'The website rate-limited this scanner (HTTP 429).',
      server_error: 'The website returned a server error (HTTP ' + home.status + ').'
    }[code];
    throw finishError(U.makeError(code, msg), scanInfo, started, fetcher);
  }
  if (home.status >= 300) throw finishError(U.makeError('unreachable', 'Unexpected HTTP status ' + home.status + '.'), scanInfo, started, fetcher);

  const ct = (home.headers['content-type'] || '').toLowerCase();
  const html = home.text || '';
  if (ct && /json|image\/|font|application\/pdf/i.test(ct) && !/html/i.test(ct)) {
    throw finishError(U.makeError('empty', 'The URL returned ' + ct + ' instead of an HTML page.'), scanInfo, started, fetcher);
  }

  /* ---------- WordPress detection (which probes are still needed?) ---------- */
  onProgress({ stage: 'wordpress', message: 'Analysing WordPress signals…' });
  const wp = analyzePage({ url: urlObj.href, finalUrl: home.finalUrl, html, headers: home.headers }, { robots: robotsRes });
  wp.families.forEach(() => methodsUsed.add('WordPress fingerprints'));

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
    } catch (e) { if (['cancelled', 'budget'].includes(e.code)) throw e; }
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
    } catch (e) { if (['cancelled', 'budget'].includes(e.code)) throw e; }
    candidates = rankCandidates(html, [posts2text(probes.posts)]);
    if (!candidates.length) {
      try {
        onProgress({ stage: 'theme', message: 'Trying oEmbed for theme paths…' });
        const oe = await get(origin + '/wp-json/oembed/1.0/embed?url=' + encodeURIComponent(home.finalUrl), { maxBytes: 128 * 1024, accept: 'application/json,*/*;q=0.5' });
        if (oe.status === 200) { probes.oembed = oe; methodsUsed.add('WordPress REST API'); }
      } catch (e) { if (['cancelled', 'budget'].includes(e.code)) throw e; }
      candidates = rankCandidates(html, [posts2text(probes.posts), oe2text(probes.oembed)]);
    }
  }

  const cand = candidates[0] || null;
  if (!cand) {
    scanInfo.requests = fetcher.state.requests; scanInfo.bytes = fetcher.state.bytes;
    return { kind: 'unknown-theme', bundle: makeBundle({ via, scanInfo, methodsUsed, home, probes, candidates, robotsRes, origin, started, fetcher }) };
  }

  /* ---------- style.css ---------- */
  onProgress({ stage: 'stylesheet', message: 'Reading the theme stylesheet header…' });
  const styleUrl = origin + '/wp-content/themes/' + cand.slug + '/style.css';
  let themeCssRes = null;
  try {
    themeCssRes = await get(styleUrl, { maxBytes: 256 * 1024, accept: 'text/css,*/*;q=0.1' });
    methodsUsed.add('style.css header');
  } catch (e) {
    if (['cancelled', 'budget'].includes(e.code)) throw e;
    themeCssRes = { status: 0, headers: {}, text: '', error: e.code };
  }

  /* ---------- Child → parent ---------- */
  let parentCssRes = null;
  const templateProbe = probeTemplate(themeCssRes);
  if (templateProbe) {
    onProgress({ stage: 'parent', message: 'Child theme found — reading the parent theme…' });
    try {
      parentCssRes = await get(origin + '/wp-content/themes/' + templateProbe + '/style.css', { maxBytes: 256 * 1024, accept: 'text/css,*/*;q=0.1' });
      methodsUsed.add('style.css header');
    } catch (e) {
      if (['cancelled', 'budget'].includes(e.code)) throw e;
      parentCssRes = { status: 0, headers: {}, text: '', error: e.code };
    }
  }

  /* ---------- Extra CSS for fingerprints (main enqueued stylesheet) ---------- */
  const mainLink = pickMainCssLink(html, cand.slug);
  let mainCss = null;
  if (mainLink && mainLink.href !== styleUrl) {
    try {
      onProgress({ stage: 'fingerprints', message: 'Matching theme fingerprints…' });
      const res = await get(mainLink.href, { maxBytes: 400 * 1024, accept: 'text/css,*/*;q=0.1' });
      if (res.status === 200 && /css|text\/plain|\*/i.test(res.headers['content-type'] || 'css')) {
        mainCss = { url: mainLink.href, status: res.status, text: res.text, headers: res.headers };
        methodsUsed.add('CSS analysis');
      }
    } catch (e) { if (['cancelled', 'budget'].includes(e.code)) throw e; }
  }

  /* ---------- Screenshot ---------- */
  onProgress({ stage: 'fingerprints', message: 'Checking the theme screenshot…' });
  let screenshot = { attempted: true, available: false, url: null };
  try {
    const shotUrl = origin + '/wp-content/themes/' + cand.slug + '/screenshot.png';
    const shot = await get(shotUrl, { maxBytes: 600 * 1024, accept: 'image/*,*/*;q=0.1' });
    if (shot.status === 200 && /image\/(png|jpe?g|webp)/i.test(shot.headers['content-type'] || '') && shot.bytes > 500) {
      screenshot = { attempted: true, available: true, url: shotUrl, bytes: shot.bytes };
    } else if (templateProbe) {
      const pShotUrl = origin + '/wp-content/themes/' + templateProbe + '/screenshot.png';
      const pshot = await get(pShotUrl, { maxBytes: 600 * 1024, accept: 'image/*,*/*;q=0.1' });
      if (pshot.status === 200 && /image\/(png|jpe?g|webp)/i.test(pshot.headers['content-type'] || '') && pshot.bytes > 500) {
        screenshot = { attempted: true, available: true, url: pShotUrl, bytes: pshot.bytes, fromParent: true };
      }
    }
  } catch (e) { if (['cancelled', 'budget'].includes(e.code)) throw e; }

  /* ---------- Exposure probes ---------- */
  onProgress({ stage: 'exposure', message: 'Checking public theme exposure…' });
  const probeDefs = buildProbes(origin, cand.slug, mainCss ? mainCss.url : null);
  const exposureRaw = [];
  for (const pd of probeDefs) {
    try {
      guard();
      const res = await get(pd.url, { maxBytes: 96 * 1024 });
      exposureRaw.push({ key: pd.key, label: pd.label, note: pd.note, url: pd.url, status: res.status, ct: res.headers['content-type'] || '', text: res.text.slice(0, 2048) });
    } catch (e) {
      exposureRaw.push({ key: pd.key, label: pd.label, note: pd.note, url: pd.url, status: 0, ct: '', text: '', error: e.code || 'error' });
    }
  }

  scanInfo.requests = fetcher.state.requests;
  scanInfo.bytes = fetcher.state.bytes;
  scanInfo.durationMs = Date.now() - started;

  return {
    kind: 'full',
    bundle: makeBundle({ via, scanInfo, methodsUsed, home, probes, candidates, robotsRes, origin, themeCssRes, parentCssRes, mainCss, screenshot, exposureRaw, started })
  };
}

function probeTemplate(cssRes) {
  if (!cssRes || cssRes.status !== 200 || !cssRes.text) return null;
  const h = U.parseThemeHeader(cssRes.text);
  if (h.found && h.fields['Template']) return U.sanitizeSlug(h.fields['Template']);
  return null;
}

function makeBundle(x) {
  return {
    via: x.via || 'server',
    startUrl: x.scanInfo.url,
    finalUrl: x.scanInfo.finalUrl,
    origin: x.origin || (x.scanInfo.finalUrl ? U.originOf(x.scanInfo.finalUrl) : ''),
    status: x.scanInfo.status,
    headers: x.home ? x.home.headers : {},
    headersAvailable: x.via !== 'browser',
    homeHtml: x.home ? x.home.text : '',
    robotsText: (x.robotsRes && x.robotsRes.status === 200 && !/^\s*</.test(x.robotsRes.text || '')) ? x.robotsRes.text : '',
    probes: {
      rest: x.probes && x.probes.rest ? { status: x.probes.rest.status, text: x.probes.rest.text } : null,
      posts: x.probes && x.probes.posts ? { status: x.probes.posts.status, text: x.probes.posts.text } : null,
      oembed: x.probes && x.probes.oembed ? { status: x.probes.oembed.status, text: x.probes.oembed.text } : null
    },
    candidates: x.candidates || [],
    themeCssRes: x.themeCssRes || null,   // { status, text }
    parentCssRes: x.parentCssRes || null,
    mainCss: x.mainCss || null,
    screenshot: x.screenshot || { attempted: false, available: false },
    exposureRaw: x.exposureRaw || null,
    scanInfo: x.scanInfo,
    methodsUsed: Array.from(x.methodsUsed || [])
  };
}

/* ------------------------------------------------------------------ */
/* Analysis (pure — same engine for server and browser-relayed data)  */
/* ------------------------------------------------------------------ */

function analyzeCollected(bundle) {
  bundle = sanitizeBundle(bundle);
  const via = bundle.via === 'browser' ? 'browser' : 'server';
  const scanInfo = bundle.scanInfo;
  scanInfo.methods = U.uniq((bundle.methodsUsed || []).concat(scanInfo.methods || []));
  if (via === 'browser') scanInfo.notes.push('Collected through the visitor’s browser (the scanner server could not reach the site directly). HTTP response headers were not available, so header-based signals were skipped.');
  const html = bundle.homeHtml || '';
  const probesFull = {};
  if (bundle.probes.rest) probesFull.rest = { text: bundle.probes.rest.text, status: bundle.probes.rest.status, ok: bundle.probes.rest.status === 200 };

  const wp = analyzePage({ url: bundle.startUrl, finalUrl: bundle.finalUrl, html, headers: via === 'browser' ? {} : bundle.headers }, { robots: { text: bundle.robotsText }, rest: probesFull.rest });
  let wpVerMatch = (wp.generators.find(g => /wordpress\s+([\d.]+)/i.test(g)) || '').match(/wordpress\s+([\d.]+)/i);
  let wpVersion = wpVerMatch ? wpVerMatch[1] : null;
  const mass = U.textMass(html);

  if (wp.score === 0 && mass.chars < 300 && html.length > 0) {
    throw U.makeError('js_only', 'The page rendered almost no readable HTML — it is likely a JavaScript-only application, so WordPress cannot be verified from the initial response.');
  }
  if (wp.score === 0 && !html.length) {
    throw U.makeError('empty', 'The server returned an empty page.');
  }

  if (wp.status === 'not_detected') {
    const platforms = wp.platforms.filter(p => p.strength === 'strong').slice(0, 2);
    const weak = wp.platforms.filter(p => p.strength === 'weak').slice(0, 2);
    return buildNotDetectedReport({ scanInfo, wp, mass, platforms, weakPlatforms: weak, via });
  }

  /* Theme — candidates were ranked by the collector with the same rules */
  let candidates = bundle.candidates && bundle.candidates.length ? bundle.candidates : rankCandidates(html, [posts2text(bundle.probes.posts), oe2text(bundle.probes.oembed)]);
  const cand = candidates[0] || null;
  if (!cand) {
    return buildUnknownThemeReport({ scanInfo, wp, probes: { rest: bundle.probes.rest, posts: bundle.probes.posts, oembed: bundle.probes.oembed }, mass, via });
  }

  /* style.css header */
  const themeCssRes = bundle.themeCssRes || { status: 0, text: '' };
  const headerRes = { attempted: false, found: false, fields: {} };
  if (themeCssRes.status === 200 && themeCssRes.text) {
    headerRes.attempted = true;
    Object.assign(headerRes, U.parseThemeHeader(themeCssRes.text));
    if (!headerRes.found) headerRes.reason = 'no WordPress theme header inside the file';
  } else if (themeCssRes.attempted === true || themeCssRes.error || themeCssRes.status || themeCssRes.text) {
    headerRes.attempted = true;
    if (themeCssRes.error) headerRes.reason = themeCssRes.error === 'timeout' ? 'request timed out' : 'not reachable (' + themeCssRes.error + ')';
    else headerRes.reason = 'HTTP ' + (themeCssRes.status || 0);
  }

  /* Parent */
  let parentRes = null;
  if (headerRes.found && headerRes.fields['Template']) {
    const pSlug = U.sanitizeSlug(headerRes.fields['Template']);
    if (pSlug) {
      const pres = bundle.parentCssRes || { status: 0, text: '' };
      parentRes = { slug: pSlug, header: { attempted: true, found: false, fields: {}, reason: null } };
      if (pres.status === 200 && pres.text) {
        Object.assign(parentRes.header, U.parseThemeHeader(pres.text));
        if (!parentRes.header.found) parentRes.header.reason = 'no theme header found';
      } else {
        parentRes.header.reason = 'HTTP ' + (pres.status || 0) + (pres.error ? ' (' + pres.error + ')' : '');
      }
    }
  }

  /* Fingerprints + evidence */
  let cssText = themeCssRes.status === 200 ? (themeCssRes.text || '') : '';
  if (bundle.mainCss && bundle.mainCss.status === 200 && bundle.mainCss.text) cssText += '\n' + bundle.mainCss.text;
  const restBundle = {
    slug: cand.slug,
    assetUrls: wp.assetUrls,
    classText: wp.classText,
    cssText: cssText.slice(0, 500000),
    generators: wp.generators,
    html: html.slice(0, 500000),
    siteOrigin: bundle.origin
  };
  const theme = analyzeTheme(cand, headerRes, parentRes, restBundle, {
    restText: bundle.probes.rest ? bundle.probes.rest.text : '',
    postsText: posts2text(bundle.probes.posts),
    oembedText: oe2text(bundle.probes.oembed)
  }, {
    screenshot: bundle.screenshot || { available: false },
    wpVersion,
    otherCandidates: candidates.slice(1).map(c => c.slug)
  });

  /* Exposure */
  let exposure = null;
  if (bundle.exposureRaw && bundle.exposureRaw.length) {
    const probeResults = bundle.exposureRaw.map(raw => classifyProbe(
      { key: raw.key, label: raw.label, note: raw.note },
      { status: raw.status, headers: { 'content-type': raw.ct || '' }, text: raw.text || '', challenge: false },
      cand.slug
    ));
    exposure = analyzeExposure(theme, probeResults, bundle.mainCss);
  } else if (!cand) {
    exposure = null;
  }

  const versionStatus = buildVersionStatus(theme);

  scanInfo.signals = wp.signals.length + theme.evidence.length;
  scanInfo.methods = U.uniq(scanInfo.methods.concat(theme.methods.map(m => m)));

  const statusLabel = wp.status === 'detected' ? 'Detected' : 'Likely WordPress';
  const report = {
    status: wp.status === 'detected' ? 'detected' : 'likely',
    statusLabel,
    via,
    scannedAt: new Date().toISOString(),
    wordpress: {
      detected: wp.status === 'detected',
      confidence: wp.confidence,
      note: wp.note,
      version: wpVersion,
      signals: wp.signals,
      families: wp.families,
      plugins: wp.plugins
    },
    theme,
    exposure,
    versionStatus,
    scan: scanInfo,
    copyText: buildCopyText(wp, theme)
  };
  return report;
}

/* Never trust oversized browser-submitted payloads. */
function sanitizeBundle(bundle) {
  const capTxt = (s, n) => String(s == null ? '' : s).slice(0, n == null ? 400000 : n);
  const out = Object.assign({}, bundle);
  out.homeHtml = capTxt(out.homeHtml);
  out.robotsText = capTxt(out.robotsText, 64000);
  out.probes = out.probes || {};
  ['rest', 'posts', 'oembed'].forEach(k => {
    if (out.probes[k]) out.probes[k] = { status: Number(out.probes[k].status) || 0, text: capTxt(out.probes[k].text, 400000) };
    else out.probes[k] = null;
  });
  ['themeCssRes', 'parentCssRes'].forEach(k => {
    if (out[k]) out[k] = { status: Number(out[k].status) || 0, text: capTxt(out[k].text, 400000), error: out[k].error, attempted: out[k].attempted };
  });
  if (out.mainCss) out.mainCss = { url: String(out.mainCss.url || '').slice(0, 500), status: Number(out.mainCss.status) || 0, text: capTxt(out.mainCss.text, 400000) };
  if (Array.isArray(out.exposureRaw)) {
    out.exposureRaw = out.exposureRaw.slice(0, 6).map(p => ({ key: String(p.key || '').slice(0, 30), label: String(p.label || '').slice(0, 60), note: String(p.note || '').slice(0, 200), url: String(p.url || '').slice(0, 500), status: Number(p.status) || 0, ct: String(p.ct || '').slice(0, 100), text: capTxt(p.text, 2048) }));
  }
  if (!Array.isArray(out.candidates)) out.candidates = [];
  out.candidates = out.candidates.slice(0, 6).map(c => ({
    slug: U.sanitizeSlug(c.slug) || '', htmlRefs: Number(c.htmlRefs) || 0, stylesheetRef: !!c.stylesheetRef,
    styleCssRef: !!c.styleCssRef, jsRef: !!c.jsRef, restRef: Number(c.restRef) || 0,
    firstIndex: Number(c.firstIndex) || 0, examples: (Array.isArray(c.examples) ? c.examples : []).slice(0, 4).map(e => String(e).slice(0, 300)),
    styleCssHrefVer: c.styleCssHrefVer ? String(c.styleCssHrefVer).slice(0, 40) : null,
    score: Number(c.score) || 0
  })).filter(c => c.slug);
  out.scanInfo = out.scanInfo || {};
  out.scanInfo.notes = (Array.isArray(out.scanInfo.notes) ? out.scanInfo.notes : []).slice(0, 12).map(n => String(n).slice(0, 300));
  out.scanInfo.robots = out.scanInfo.robots && typeof out.scanInfo.robots === 'object' ? out.scanInfo.robots : { checked: false, notes: [] };
  out.scanInfo.methods = Array.isArray(out.scanInfo.methods) ? out.scanInfo.methods.map(m => String(m).slice(0, 60)) : [];
  return out;
}

/* ---------------- runScan (server path end-to-end) ---------------- */

async function runScan(rawUrl, opt) {
  opt = opt || {};
  const onProgress = opt.onProgress || function () {};
  const r = await collectServer(rawUrl, opt);
  const b = r.bundle;
  b.scanInfo.methods = Array.from(new Set(b.methodsUsed.concat(b.scanInfo.methods || [])));
  if (r.kind === 'unknown-theme') {
    // No theme slug anywhere — either an honest "Not Detected" report (no
    // WordPress evidence at all) or "WordPress detected, theme unknown".
    const wp = analyzePage({ url: b.startUrl, finalUrl: b.finalUrl, html: b.homeHtml, headers: b.headers }, { robots: { text: b.robotsText }, rest: b.probes.rest ? { text: b.probes.rest.text, status: b.probes.rest.status, ok: b.probes.rest.status === 200 } : null });
    if (wp.status === 'not_detected') {
      const platforms = wp.platforms.filter(p => p.strength === 'strong').slice(0, 2);
      const weak = wp.platforms.filter(p => p.strength === 'weak').slice(0, 2);
      return buildNotDetectedReport({ scanInfo: b.scanInfo, wp, mass: U.textMass(b.homeHtml), platforms, weakPlatforms: weak, via: 'server' });
    }
    return buildUnknownThemeReport({ scanInfo: b.scanInfo, wp, probes: b.probes, mass: U.textMass(b.homeHtml), via: 'server' });
  }
  onProgress({ stage: 'report', message: 'Building the transparent report…' });
  return analyzeCollected(b);
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

function buildNotDetectedReport(ctx) {
  const scanInfo = ctx.scanInfo;
  scanInfo.durationMs = scanInfo.durationMs || 0;
  scanInfo.signals = ctx.wp.signals.length;
  const strongPlat = ctx.platforms || [];
  return {
    status: 'not_detected',
    statusLabel: 'WordPress Not Detected',
    via: ctx.via || 'server',
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
  const scanInfo = ctx.scanInfo;
  scanInfo.durationMs = scanInfo.durationMs || 0;
  scanInfo.signals = ctx.wp.signals.length;
  const attempts = [
    'Homepage HTML scanned for /wp-content/themes/ paths',
    'All stylesheet and script URLs checked',
    ctx.probes.rest ? 'REST API /wp-json/ checked for theme references' : 'REST API /wp-json/ not reachable or skipped',
    ctx.probes.posts ? 'Public post content fetched via REST for theme asset paths' : 'Public REST content was not available',
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
    via: ctx.via || 'server',
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

module.exports = { runScan, collectServer, analyzeCollected, buildVersionStatus, posts2text, oe2text };
