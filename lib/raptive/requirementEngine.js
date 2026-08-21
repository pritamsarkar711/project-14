'use strict';

const U = require('./util');
const R = require('./raptiveRules');
const { CONTENT_TYPES } = require('./pageClassifier');

function detectLanguage(pages) {
  const langs = {};
  pages.forEach(p => {
    if (!p.parse) return;
    const code = (p.parse.lang || (p.headers && p.headers['content-language']) || '').toLowerCase();
    if (code) { const info = U.langFromCode(code); if (info) langs[info.code] = (langs[info.code] || 0) + 1; }
  });
  const top = Object.keys(langs).sort((a, b) => langs[b] - langs[a])[0];
  if (top) return U.langFromCode(top);
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

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function userInputs(opt) {
  opt = opt || {};
  const pageviews = num(opt.pageviews);
  const us = num(opt.us);
  const uk = num(opt.uk);
  const ca = num(opt.ca);
  const au = num(opt.au);
  const nz = num(opt.nz);
  const parts = [us, uk, ca, au, nz].filter(n => n != null);
  const combined = parts.length ? parts.reduce((a, b) => a + b, 0) : null;
  return { pageviews, us, uk, ca, au, nz, combined, provided: pageviews != null };
}

function evaluateOfficial(pages, ctx) {
  const out = [];
  const parsed = pages.filter(p => p.parse);
  const inv = ctx.inventory || {};
  const user = userInputs(ctx.user || {});
  ctx.userInputs = user;

  const tier = user.provided ? R.tierFromPageviews(user.pageviews) : null;
  ctx.declaredTier = tier;

  // Manual official rules that stay manual unless user provided values
  R.all().filter(r => !r.automated).forEach(rule => {
    if (rule.id === 'RAP-OFFICIAL-PAGEVIEWS' && user.provided) {
      if (user.pageviews < 25000) {
        out.push(R.finding(rule, 'Site', 'high',
          'User-provided value: ' + Math.round(user.pageviews).toLocaleString('en-US') + ' monthly pageviews. Below Raptive’s current 25,000 minimum. This is a user-provided value, not independently verified.',
          { confidence: 1, severity: 'high', reqStatus: 'Not Met' }));
      } else {
        out.push(R.finding(rule, 'Site', 'info',
          'User-provided value: ' + Math.round(user.pageviews).toLocaleString('en-US') + ' monthly pageviews — ' + tier.name + '. Not independently verified from the public website.',
          { confidence: 1, severity: 'info', reqStatus: 'Manual Verification' }));
      }
      return;
    }
    if ((rule.id === 'RAP-OFFICIAL-COUNTRIES-MID' || rule.id === 'RAP-OFFICIAL-COUNTRIES-HIGH') && user.combined != null && user.provided) {
      const need = tier && tier.keyCountryPct;
      if (need == null) {
        out.push(R.manualFinding(rule, 'Key-country share is not applicable below 25,000 pageviews (user-provided).'));
        return;
      }
      const met = user.combined >= need;
      out.push(R.finding(rule, 'Site', met ? 'passed' : 'high',
        'User-provided key-country share: ' + U.round(user.combined, 1) + '% (US ' + (user.us == null ? '—' : user.us) + '%, UK ' + (user.uk == null ? '—' : user.uk) + '%, CA ' + (user.ca == null ? '—' : user.ca) + '%, AU ' + (user.au == null ? '—' : user.au) + '%, NZ ' + (user.nz == null ? '—' : user.nz) + '%). Target at this tier: ' + need + '%+. User-provided — not independently verified.',
        { confidence: 1, severity: met ? 'passed' : 'high', reqStatus: met ? 'Likely' : 'Not Met' }));
      return;
    }
    out.push(R.manualFinding(rule, 'Manual Verification Required. ' + rule.detectionMethod));
  });

  // Language informational
  const lang = detectLanguage(pages);
  ctx.language = lang;

  // Ad-build official (structure)
  const ad = ctx.advertisingStats || {};
  const ux = ctx.archStats || {};
  const contentPages = parsed.filter(p => CONTENT_TYPES[ctx.pageType.get(p.url)]);
  const articleLike = contentPages.filter(p => (p.parse.paragraphCount || 0) >= 3 && (p.parse.headingsCount || 0) >= 2).length;
  const overlayHeavy = (ux.fixedOverlays || 0) >= 6;
  const viewportMissing = (ux.missingViewport || 0) >= Math.max(1, Math.round(parsed.length * 0.4));
  let adStatus = 'passed';
  let adReq = 'Likely';
  const adNotes = [];
  if (articleLike >= Math.max(2, Math.round(contentPages.length * 0.5)) && !viewportMissing && !overlayHeavy) {
    adNotes.push(articleLike + ' of ' + contentPages.length + ' content pages have paragraph + heading structure suitable for in-content ads');
  } else {
    if (contentPages.length && articleLike / contentPages.length < 0.4) { adStatus = 'medium'; adReq = 'Needs Review'; adNotes.push('few pages have a clear article body with headings and paragraphs'); }
    if (viewportMissing) { adStatus = 'high'; adReq = 'Needs Review'; adNotes.push('many pages lack a mobile viewport'); }
    if (overlayHeavy) { adStatus = adStatus === 'passed' ? 'medium' : adStatus; adReq = 'Needs Review'; adNotes.push('multiple fixed overlays may obstruct ad placement'); }
  }
  out.push(R.finding(R.get('RAP-OFFICIAL-AD-BUILD'), 'Site', adStatus,
    'Layout appears technically suitable for ad placement: ' + (adNotes.join('; ') || 'main content containers and article structure were inspected') + '. Existing networks: ' + ((ad.networks && ad.networks.length) ? ad.networks.join(', ') : 'none detected') + '. This is not a claim of actual Raptive ad-platform compatibility.',
    { confidence: 0.7, severity: adStatus, reqStatus: adReq }));

  return { findings: out, user, tier };
}

function applicationEligibility(score, ctx) {
  const user = ctx.userInputs || userInputs(ctx.user || {});
  const reasons = [];
  if (!user.provided) {
    reasons.push('Monthly pageviews are not publicly verifiable and were not provided.');
  } else if (user.pageviews < 25000) {
    return {
      status: 'Not Met',
      class: 'notready',
      reason: 'User-provided monthly pageviews (' + Math.round(user.pageviews).toLocaleString('en-US') + ') are below Raptive’s current 25,000 minimum. User-provided — not independently verified.',
      tier: R.tierFromPageviews(user.pageviews)
    };
  }
  if (user.combined == null) reasons.push('Traffic-country percentages cannot be determined from URL-only crawling.');
  else {
    const tier = R.tierFromPageviews(user.pageviews);
    if (tier && tier.keyCountryPct != null && user.combined < tier.keyCountryPct) {
      return {
        status: 'Not Met',
        class: 'notready',
        reason: 'User-provided combined key-country traffic is ' + U.round(user.combined, 1) + '%, below the ' + tier.keyCountryPct + '% target for ' + tier.name + '. User-provided — not independently verified.',
        tier
      };
    }
  }
  const ga = ctx.analytics || {};
  if (!ga.detected) reasons.push('Google Analytics tracking code was not detected (configuration still cannot be fully verified).');
  const domain = ctx.domainAge || {};
  if (domain.verified && domain.atLeastSixMonths === false) {
    return {
      status: 'Not Met',
      class: 'notready',
      reason: 'Domain age from RDAP is under six months.',
      tier: user.provided ? R.tierFromPageviews(user.pageviews) : null
    };
  }
  if (!domain.verified) reasons.push('Domain age could not be verified.');

  return {
    status: 'Cannot Be Fully Verified',
    class: 'unverifiable',
    reason: reasons.join(' ') || 'Private Analytics data is required before application eligibility can be confirmed.',
    tier: user.provided ? R.tierFromPageviews(user.pageviews) : null
  };
}

module.exports = { evaluateOfficial, detectLanguage, userInputs, applicationEligibility };
