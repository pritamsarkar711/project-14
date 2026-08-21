'use strict';

const U = require('./util');
const R = require('./ezoicRules');

function analyzeMonetization(pages, ctx) {
  const out = [];
  const networks = new Set();
  let adPages = 0;
  let heavy = 0;
  const heavyUrls = [];
  let downloadPages = 0;
  const downloadUrls = [];

  pages.forEach(p => {
    if (!p.parse) return;
    const pa = p.parse;
    const path = U.pathOf(p.url);
    (pa.adNetworks || []).forEach(n => networks.add(n));
    const slots = (pa.adScripts || 0) + (pa.adIframes || 0) + (pa.adSlots || 0);
    if (slots > 0) adPages++;
    if (slots >= 4 && pa.wordCount < 250) {
      heavy++;
      heavyUrls.push(path);
      out.push({
        id: 'MON_AD_DENSITY',
        category: 'monetization',
        name: 'Ad-heavy thin layout',
        status: 'medium',
        severity: 'medium',
        page: path,
        evidence: '~' + slots + ' ad signals on a ' + pa.wordCount + '-word page. Networks: ' + (pa.adNetworks.join(', ') || 'unknown') + '.',
        why: 'Heuristic. Existing ads are not automatically a problem, but ad-heavy thin pages are a poor experience and a Google-policy risk.',
        fix: 'Add original content and keep ads from crowding the page.',
        confidence: 70,
        sourceType: 'heuristic',
        automated: true,
        weight: 3
      });
    }
    if (pa.downloadLinks >= 2) {
      downloadPages++;
      downloadUrls.push(path);
    }
  });

  const netList = [...networks];
  const hasEzoic = netList.some(n => /ezoic/i.test(n));
  const competing = netList.filter(n => !/ezoic/i.test(n));

  if (competing.length) {
    out.push(R.finding(R.get('EZ-NON-EZOIC-ADS'), 'Site', 'info',
      'Detected third-party ad networks: ' + competing.join(', ') + ' on ' + adPages + ' page(s). '
      + 'This is not scored as a pre-application failure. Official checklist: non-Ezoic ads must be removed after Ezoic integration.',
      { confidence: 0.8, severity: 'info' }));
  } else if (hasEzoic) {
    out.push(R.finding(R.get('EZ-NON-EZOIC-ADS'), 'Site', 'passed',
      'Ezoic scripts were detected and no other major ad networks were found in crawled HTML.',
      { confidence: 0.75, severity: 'passed' }));
  } else {
    out.push(R.finding(R.get('EZ-NON-EZOIC-ADS'), 'Site', 'passed',
      'No competing ad-network scripts were detected. Existing advertising is not assumed to be a problem.',
      { confidence: 0.7, severity: 'passed' }));
  }

  const adsTxt = ctx.adsTxt || { present: false };
  if (adsTxt.present) {
    out.push(R.finding(R.get('EZ-ADSTXT-EXISTS'), 'Site', 'passed',
      'ads.txt is present (' + adsTxt.lineCount + ' non-comment line(s))'
      + (adsTxt.hasEzoic ? ' and already lists ezoic.com' : ' without Ezoic reseller lines yet') + '.',
      { confidence: 0.9, severity: 'passed' }));
  } else {
    out.push(R.finding(R.get('EZ-ADSTXT-EXISTS'), 'Site', 'low',
      'No ads.txt file was found at /ads.txt. This is required after Ezoic integration, not as a public pre-check that the site is ineligible.',
      { confidence: 0.85, severity: 'low' }));
  }

  if (downloadPages) {
    const status = downloadPages >= 3 ? 'high' : 'medium';
    out.push(R.finding(R.get('EZ-NO-DOWNLOADS'), 'Site', status,
      downloadPages + ' page(s) contain multiple download-like links (file extensions or “download” anchors)'
      + (downloadUrls.length ? ': ' + downloadUrls.slice(0, 5).join(', ') : '') + '. This does not prove copyright infringement.',
      { confidence: 0.62, affected: String(downloadPages), urls: downloadUrls.slice(0, 8), severity: status }));
  } else {
    out.push(R.finding(R.get('EZ-NO-DOWNLOADS'), 'Site', 'passed',
      'No concentrated download-link pattern was found on crawled pages.',
      { confidence: 0.6, severity: 'passed' }));
  }

  ctx.monetizationStats = { networks: netList, adPages, heavy, hasEzoic, adsTxt };
  return out;
}

module.exports = { analyzeMonetization };
