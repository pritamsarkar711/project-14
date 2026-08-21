'use strict';

const U = require('./util');
const R = require('./ezoicRules');
const { CONTENT_TYPES } = require('./pageClassifier');

function detectLanguage(pages) {
  const langs = {};
  pages.forEach(p => {
    if (!p.parse) return;
    const code = (p.parse.lang || (p.headers && p.headers['content-language']) || '').toLowerCase();
    if (code) {
      const info = U.langFromCode(code);
      if (info) langs[info.code] = (langs[info.code] || 0) + 1;
    }
  });
  const top = Object.keys(langs).sort((a, b) => langs[b] - langs[a])[0];
  if (top) return U.langFromCode(top);

  // script heuristic
  const sample = pages.filter(p => p.parse).slice(0, 8).map(p => p.parse.mainText || '').join(' ').slice(0, 8000);
  if (/[\u4e00-\u9fff]/.test(sample)) return U.langFromCode('zh');
  if (/[\u3040-\u30ff]/.test(sample)) return U.langFromCode('ja');
  if (/[\uac00-\ud7af]/.test(sample)) return U.langFromCode('ko');
  if (/[\u0600-\u06ff]/.test(sample)) return U.langFromCode('ar');
  if (/[\u0400-\u04ff]/.test(sample)) return U.langFromCode('ru');
  if (/[\u0e00-\u0e7f]/.test(sample)) return U.langFromCode('th');
  if (/[\u0900-\u097f]/.test(sample)) return U.langFromCode('hi');
  if (/[äöüß]/.test(sample.toLowerCase())) return U.langFromCode('de');
  if (/\b(the|and|of|to|in|for)\b/i.test(sample)) return U.langFromCode('en');
  return { code: 'und', name: 'undetermined', supported: false, undetermined: true };
}

function evaluateOfficial(pages, ctx) {
  const out = [];

  R.all().filter(r => !r.automated).forEach(rule => {
    if (rule.id === 'EZ-ADSTXT-RESELLER') {
      const ads = ctx.adsTxt || {};
      const note = ads.present
        ? (ads.hasEzoic
          ? 'ads.txt exists and already mentions ezoic.com. Still confirm dashboard reseller lines after onboarding.'
          : 'ads.txt exists but does not mention ezoic.com. Ezoic reseller lines are added after joining — Unable to verify automatically as an eligibility gate.')
        : 'No ads.txt yet. Ezoic reseller authorization is an onboarding step — Unable to verify automatically.';
      out.push(R.manualFinding(rule, note));
      return;
    }
    out.push(R.manualFinding(rule, 'Unable to verify automatically. ' + rule.detectionMethod));
  });

  const parsed = pages.filter(p => p.parse);
  const withScripts = parsed.filter(p => (p.parse.scripts && p.parse.scripts.length) || p.parse.inlineScripts > 0).length;
  const htmlPages = parsed.length;
  if (htmlPages && withScripts / htmlPages >= 0.3) {
    out.push(R.finding(R.get('EZ-JS-INTEGRATION'), 'Site', 'passed',
      withScripts + ' of ' + htmlPages + ' parsed pages already include JavaScript, so the site can technically host Ezoic’s script. CMS write-access is still a manual check.',
      { confidence: 0.7, severity: 'passed' }));
  } else if (htmlPages) {
    out.push(R.finding(R.get('EZ-JS-INTEGRATION'), 'Site', 'low',
      'Few crawled pages include scripts. The site still likely can add JavaScript, but this could not be strongly confirmed. Cloud integration is an alternative.',
      { confidence: 0.45 }));
  }

  const lang = detectLanguage(pages);
  ctx.language = lang;
  if (lang.undetermined) {
    out.push(R.finding(R.get('EZ-LANGUAGE'), 'Site', 'manual',
      'Unable to verify automatically — html lang was missing and the writing system was not identified with confidence.',
      { confidence: 0.4, severity: 'info' }));
  } else if (lang.supported) {
    out.push(R.finding(R.get('EZ-LANGUAGE'), 'Site', 'passed',
      'Primary language signal: ' + lang.name + ' (' + lang.code + '), which is on the AdSense-supported list used by Ezoic.',
      { confidence: 0.75, severity: 'passed' }));
  } else {
    out.push(R.finding(R.get('EZ-LANGUAGE'), 'Site', 'high',
      'Primary language signal: ' + lang.name + ' (' + lang.code + '). This code is not on the AdSense-supported language list this checker uses.',
      { confidence: 0.7 }));
  }

  const siteType = ctx.siteType;
  const contentPages = parsed.filter(p => CONTENT_TYPES[ctx.pageType.get(p.url)]);
  const useful = ctx.inventory ? ctx.inventory.useful : contentPages.filter(p => p.parse.wordCount >= 220).length;

  if (siteType === 'tools') {
    out.push(R.finding(R.get('EZ-SITE-TYPE'), 'Site', 'passed',
      'Classified as a tools site. Official Ezoic Content Guidelines say tool sites are not required to have a blog. Unoriginal tool copies can still be rejected — originality is assessed separately.',
      { confidence: 0.7, severity: 'passed' }));
  } else if (siteType === 'ecommerce' && contentPages.length < 6) {
    out.push(R.finding(R.get('EZ-SITE-TYPE'), 'Site', 'high',
      'Classified as ecommerce with only ' + contentPages.length + ' informational/content page(s) in the crawl. Ezoic lists ecommerce sites without a blog or informational content as a prohibited site pattern.',
      { confidence: 0.72 }));
  } else if (siteType === 'business' && contentPages.length < 4 && parsed.every(p => (p.parse.wordCount || 0) < 250)) {
    out.push(R.finding(R.get('EZ-SITE-TYPE'), 'Site', 'medium',
      'Classified as a business/corporate site with little informational content. Corporate sites are listed among patterns that are often not approved.',
      { confidence: 0.64 }));
  } else {
    out.push(R.finding(R.get('EZ-SITE-TYPE'), 'Site', 'passed',
      'Classified as “' + siteType + '” with ' + contentPages.length + ' content-like page(s). Ezoic states it supports many site types as long as JavaScript can be included and content is monetizable.',
      { confidence: 0.62, severity: 'passed' }));
  }

  const inv = ctx.inventory || {};
  if (contentPages.length >= 2) {
    const usefulPct = inv.usefulPct != null ? inv.usefulPct : U.pct(useful, contentPages.length);
    const thinPct = inv.thinPct != null ? inv.thinPct : 0;
    if (usefulPct >= 65) {
      out.push(R.finding(R.get('EZ-ORIGINAL-CONTENT'), 'Site', 'passed',
        usefulPct + '% of classified content pages have substantial unique body text (' + (inv.useful || useful) + '/' + contentPages.length + ').',
        { confidence: 0.8, severity: 'passed', affected: (inv.useful || useful) + '/' + contentPages.length }));
    } else if (thinPct >= 60 || usefulPct < 30) {
      out.push(R.finding(R.get('EZ-ORIGINAL-CONTENT'), 'Site', 'high',
        'Only ' + usefulPct + '% of content pages look substantial; ' + thinPct + '% are thin or empty after boilerplate removal ('
        + (inv.thin || 0) + ' thin, ' + (inv.empty || 0) + ' empty, of ' + contentPages.length + ').',
        { confidence: 0.86, affected: usefulPct + '%', severity: 'high' }));
    } else {
      out.push(R.finding(R.get('EZ-ORIGINAL-CONTENT'), 'Site', 'medium',
        usefulPct + '% of content pages are substantial (' + (inv.useful || useful) + '/' + contentPages.length + '). Ezoic requires original, constructive pages — a mixed library still needs work.',
        { confidence: 0.74, affected: usefulPct + '%' }));
    }
  } else if (siteType !== 'tools' && parsed.length) {
    out.push(R.finding(R.get('EZ-ORIGINAL-CONTENT'), 'Site', 'medium',
      'Fewer than 2 classified article/content pages were found in the crawl of ' + parsed.length + ' URL(s). A content-rich library could not be demonstrated.',
      { confidence: 0.7 }));
  }

  if (inv.duplicatePages && inv.dupPct >= 25) {
    out.push(R.finding(R.get('EZ-NO-AUTOGEN'), 'Site', inv.dupPct >= 40 ? 'high' : 'medium',
      inv.duplicatePages + ' pages (' + inv.dupPct + '%) sit in near-duplicate clusters. Combined with repetition this is a heuristic for automatically generated or scraped libraries — not proof of AI use.',
      { confidence: 0.7, affected: inv.dupPct + '%' }));
  }

  return out;
}

module.exports = { evaluateOfficial, detectLanguage };
