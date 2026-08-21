'use strict';

/*
 * huvanti WordPress Theme Detector — Theme Exposure analysis.
 *
 * Only publicly observable information. No exploitation, no intrusive testing:
 * a handful of ordinary GET requests for files a theme ships by default,
 * each answered as exposed / not found / unknown.
 */

const U = require('./util');

/*
 * Build the list of probe URLs for a detected theme (max 5 small requests).
 */
function buildProbes(origin, slug, mainCssUrl) {
  const base = origin + '/wp-content/themes/' + slug + '/';
  const probes = [
    { key: 'readme', label: 'Theme readme.txt', url: base + 'readme.txt', note: 'Development/readme file inside the theme folder.' },
    { key: 'sourcemap', label: 'CSS source map', url: (mainCssUrl ? mainCssUrl : base + 'style.css') + '.map', note: 'Source map for the main theme stylesheet.' },
    { key: 'dirindex', label: 'Theme directory listing', url: base, note: 'Whether the web server returns an auto-index of the theme folder.' },
    { key: 'devfile', label: 'Development file exposure (.git)', url: base + '.git/HEAD', note: 'A leftover VCS folder inside the theme directory.' },
    { key: 'changelog', label: 'Changelog file', url: base + 'changelog.txt', note: 'Changelog that may reveal precise versions.' }
  ];
  return probes;
}

function classifyProbe(probe, res, slug) {
  if (!res) return { key: probe.key, label: probe.label, status: 'unknown', detail: probe.note + ' Not probed (budget).' };
  const ct = (res.headers['content-type'] || '').toLowerCase();
  if (res.challenge || res.status === 403 || res.status === 401 || res.status === 429 || res.status >= 500) {
    return { key: probe.key, label: probe.label, status: 'unknown', detail: probe.note + ' Server returned ' + res.status + (res.guard ? ' (' + res.guard + ')' : '') + ' — cannot determine.' };
  }
  if (res.status === 200) {
    const textHead = String(res.text || '').slice(0, 400);
    if (probe.key === 'dirindex') {
      const isIndex = /<title>index of \/|<h1>index of \//i.test(textHead);
      if (isIndex) return { key: probe.key, label: probe.label, status: 'exposed', detail: 'The server returns an open directory index for /wp-content/themes/' + slug + '/ — theme file names become public.' };
      if (ct.includes('html') && /wp-content|theme|stylesheet/i.test(textHead)) {
        return { key: probe.key, label: probe.label, status: 'unknown', detail: 'The theme folder URL returned HTML — could be an index page or a rewrite; not a confirmed listing.' };
      }
      return { key: probe.key, label: probe.label, status: 'not_found', detail: 'No directory listing returned.' };
    }
    if (probe.key === 'devfile') {
      const isGit = /ref:\s*refs\//.test(String(res.text || '').slice(0, 100));
      return isGit
        ? { key: probe.key, label: probe.label, status: 'exposed', detail: 'A readable .git/HEAD exists inside the theme folder — source/history is exposed. Suspicious development file.' }
        : { key: probe.key, label: probe.label, status: 'not_found', detail: '.git/HEAD request returned 200 but not a valid git ref.' };
    }
    if (probe.key === 'sourcemap') {
      const isMap = ct.includes('json') || textHead.trim().startsWith('{');
      return isMap
        ? { key: probe.key, label: probe.label, status: 'exposed', detail: 'A public source map was readable — original source file names and paths can be recovered.' }
        : { key: probe.key, label: probe.label, status: 'not_found', detail: 'No readable source map.' };
    }
    const empty = !String(res.text || '').trim();
    return empty
      ? { key: probe.key, label: probe.label, status: 'unknown', detail: probe.note + ' Returned 200 with an empty body.' }
      : { key: probe.key, label: probe.label, status: 'exposed', detail: probe.note + ' Publicly readable (HTTP 200).' };
  }
  return { key: probe.key, label: probe.label, status: 'not_found', detail: probe.note + ' Not found (HTTP ' + res.status + ').' };
}

/*
 * Assemble the Theme Exposure section from observed results.
 */
function analyzeExposure(theme, probeResults, mainCssRes) {
  const items = [];
  const slug = theme && theme.slug;
  if (theme) {
    items.push({
      key: 'stylecss', label: 'Theme style.css',
      status: theme.styleCssAccess === 'public' ? 'exposed' : 'not_found',
      detail: theme.styleCssAccess === 'public'
        ? '/wp-content/themes/' + slug + '/style.css is publicly readable — the standard WordPress theme header (name, author, version…) is visible.'
        : 'style.css was not readable (' + theme.styleCssAccess + ') — theme metadata is not directly exposed.'
    });
    items.push({
      key: 'metadata', label: 'Theme metadata',
      status: theme.styleCssAccess === 'public' ? 'exposed' : 'not_found',
      detail: theme.styleCssAccess === 'public'
        ? (theme.version && theme.version.label === 'exact' ? 'Theme name, author and an exact version are public.' : 'Theme name and author are public.')
        : 'No public theme header was readable.'
    });
    items.push({
      key: 'version', label: 'Theme version',
      status: theme.version && theme.version.value ? 'exposed' : 'not_found',
      detail: theme.version && theme.version.value
        ? 'A theme version is publicly visible (source: ' + theme.version.source + ').'
        : 'No theme version is publicly detectable — this is considered good hygiene.'
    });
    if (theme.preview && theme.preview.available) {
      items.push({ key: 'screenshot', label: 'Theme screenshot', status: 'exposed', detail: '/wp-content/themes/' + slug + '/screenshot.png is public (standard for WordPress themes).' });
    }
  }
  (probeResults || []).forEach(p => items.push(p));
  const exposedCount = items.filter(i => i.status === 'exposed').length;
  return {
    items,
    summary: exposedCount === 0
      ? 'No extra theme information beyond normal asset paths was found to be exposed.'
      : exposedCount + ' item' + (exposedCount === 1 ? ' is' : 's are') + ' publicly observable. This is informational only — exposure is common on WordPress sites and is not a vulnerability claim.'
  };
}

module.exports = { buildProbes, classifyProbe, analyzeExposure };
