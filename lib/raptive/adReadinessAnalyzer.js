'use strict';

const U = require('./util');
const R = require('./raptiveRules');

/**
 * Advertising audit.
 * Detects ad scripts, iframes, slots, containers and networks, and content-to-ad ratio.
 * Does NOT penalize a site merely for containing ads — Raptive evaluates reader experience
 * and ad-policy quality, not a low number of ads. Not every iframe/3rd-party script is advertising.
 */
function analyzeAdvertising(pages, ctx) {
  const out = [];
  const networks = new Set();
  let adPages = 0;
  const heavy = [], thinWithAds = [];
  let totalSlots = 0, totalWords = 0;
  const interstitialPages = [];

  pages.forEach(p => {
    if (!p.parse) return;
    const pa = p.parse, path = U.pathOf(p.url);
    (pa.adNetworks || []).forEach(n => networks.add(n));
    const slots = (pa.adScripts || 0) + (pa.adIframes || 0) + (pa.adSlots || 0) + (pa.adContainers ? Math.min(pa.adContainers, 10) : 0);
    if (slots > 0) adPages++;
    totalSlots += slots;
    totalWords += pa.wordCount || 0;
    // Content-to-ad ratio heuristic: ad-heavy thin layouts
    if (slots >= 4 && pa.wordCount < 250) { heavy.push(path); thinWithAds.push(path); }
    if (slots >= 6 && pa.wordCount < 400) { heavy.push(path); }
    if (pa.autoRefreshAds || pa.interstitials >= 2) interstitialPages.push(path);
    // ads above/inside content hints
    if (/class=["'][^"']*\b(ad-?top|header-ad|before-content|ad-before|in-content-ad|ad-in-content)\b/i.test(pa.visibleText + (p.html ? '' : ''))) { /* hint only */ }
  });

  const netList = [...networks];
  const hasRaptive = netList.some(n => /raptive|grow\.raptive/i.test(n));
  const competing = netList.filter(n => !/raptive|grow\.raptive/i.test(n));

  if (netList.length) {
    out.push(R.finding(R.get('RAP-H-AD-DENSITY'), 'Site', 'info',
      'Detected ad network(s): ' + netList.join(', ') + ' on ' + adPages + ' page(s). Existing advertising is not automatically a problem. If you join Raptive, non-Raptive tags must be removed.',
      { confidence: 0.8, severity: 'info' }));
  } else {
    out.push(R.finding(R.get('RAP-H-AD-DENSITY'), 'Site', 'passed',
      'No ad-network scripts detected in crawled HTML. Existing ads are not required — this is treated as a clean advertising-readiness state, not a deficiency. (The Official program\u2019s $5,000 revenue is verified separately and is not inferred from ad presence.)',
      { confidence: 0.7, severity: 'passed' }));
  }

  if (heavy.length) {
    out.push(R.finding(R.get('RAP-H-AD-DENSITY'), 'Site', 'medium',
      heavy.length + ' page(s) combine a high ad-signal count with thin content (e.g. ' + heavy.slice(0, 4).join(', ') + '). Ad-heavy thin layouts harm reader experience and ad performance.',
      { confidence: 0.7, affected: String(heavy.length), severity: 'medium', urls: heavy.slice(0, 8) }));
  } else if (netList.length) {
    out.push(R.finding(R.get('RAP-H-AD-DENSITY'), 'Site', 'passed',
      'Ads detected but no ad-heavy thin pages were found. Content-to-ad ratio looks reasonable.',
      { confidence: 0.65, severity: 'passed' }));
  }

  if (interstitialPages.length) {
    out.push(R.finding(R.get('RAP-H-AD-DENSITY'), 'Site', 'medium',
      'Interstitial or ad auto-refresh signals on ' + interstitialPages.length + ' page(s): ' + interstitialPages.slice(0, 4).join(', ') + '. Intrusive interstitials are a reader-experience concern.',
      { confidence: 0.5, affected: String(interstitialPages.length), severity: 'medium', urls: interstitialPages.slice(0, 6) }));
  }

  // ads.txt
  const adsTxt = ctx.adsTxt || { present: false };
  out.push(R.finding(R.get('RAP-H-ADSTXT'), 'Site', adsTxt.present ? 'passed' : 'low',
    adsTxt.present ? 'ads.txt is present (' + (adsTxt.lineCount || 0) + ' non-comment line(s))' + (adsTxt.hasRaptive ? ' and already lists raptive.com' : ' without Raptive lines yet') + '.'
      : 'No ads.txt found at /ads.txt. Raptive will manage ads.txt after integration; its absence before joining is not a quality failure.',
    { confidence: 0.85, severity: adsTxt.present ? 'passed' : 'low' }));

  ctx.advertisingStats = {
    networks: netList, adPages,
    totalAdSlots: totalSlots,
    totalContentWords: totalWords,
    contentToAdRatio: totalSlots ? U.round(totalWords / totalSlots, 1) : null,
    heavyPages: heavy.length,
    hasRaptive,
    adsTxt: { present: adsTxt.present }
  };
  return out;
}

module.exports = { analyzeAdvertising };
