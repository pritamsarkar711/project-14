'use strict';

const U = require('./util');
const R = require('./mediavineRules');
const { PROGRAM_CONFIG } = R;
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

/**
 * Evaluate all official requirements, applying Mediavine Official and Journey rules separately.
 * Manual (non-automated) rules become 'manual' status, never guessed.
 * Returns { findings, programs: { official: {...}, journey: {...} } }
 */
function evaluateOfficial(pages, ctx) {
  const out = [];
  const parsed = pages.filter(p => p.parse);
  const contentPages = parsed.filter(p => CONTENT_TYPES[ctx.pageType.get(p.url)]);
  const inv = ctx.inventory || {};
  const siteType = ctx.siteType;

  // ---- Manual official rules (revenue, sessions, standing, traffic, demographics, Grow) ----
  R.all().filter(r => !r.automated).forEach(rule => {
    out.push(R.manualFinding(rule, 'Unable to verify automatically. ' + rule.detectionMethod));
  });

  // ---- Official original-content assessment (applies to both programs) ----
  const usefulPct = inv.usefulPct != null ? inv.usefulPct : (contentPages.length ? Math.round((inv.useful || 0) / contentPages.length * 100) : 0);
  const thinPct = inv.thinPct != null ? inv.thinPct : 0;
  if (contentPages.length >= 2) {
    if (usefulPct >= 65) {
      out.push(R.finding(R.get('MV-OFFICIAL-ORIGINAL-CONTENT'), 'Site', 'passed',
        usefulPct + '% of classified content pages have substantial unique body text (' + (inv.useful || 0) + '/' + contentPages.length + ').',
        { confidence: 0.8, severity: 'passed', affected: (inv.useful || 0) + '/' + contentPages.length }));
    } else if (thinPct >= 60 || usefulPct < 30) {
      out.push(R.finding(R.get('MV-OFFICIAL-ORIGINAL-CONTENT'), 'Site', 'high',
        'Only ' + usefulPct + '% of content pages look substantial; ' + thinPct + '% are thin or empty after boilerplate removal (' + (inv.thin || 0) + ' thin, ' + (inv.empty || 0) + ' empty of ' + contentPages.length + ').',
        { confidence: 0.86, affected: usefulPct + '%', severity: 'high' }));
    } else {
      out.push(R.finding(R.get('MV-OFFICIAL-ORIGINAL-CONTENT'), 'Site', 'medium',
        usefulPct + '% of content pages are substantial (' + (inv.useful || 0) + '/' + contentPages.length + '). Mediavine requires original, audience-first content, a mixed library still needs work.',
        { confidence: 0.74, affected: usefulPct + '%' }));
    }
  } else if (siteType !== 'tools' && parsed.length) {
    out.push(R.finding(R.get('MV-OFFICIAL-ORIGINAL-CONTENT'), 'Site', 'medium',
      'Fewer than 2 classified article/content pages were found in the crawl of ' + parsed.length + ' URL(s).',
      { confidence: 0.7 }));
  }

  // ---- Audience-first (audience vs search) ----
  const af = ctx.contentPortfolio || {};
  if (af.audienceFirstRiskPages) {
    out.push(R.finding(R.get('MV-APPROVE-AUDIENCE-FIRST'), 'Site', af.audienceFirstRiskPages >= 3 ? 'medium' : 'low',
      af.audienceFirstRiskPages + ' of ' + (af.contentPages || 0) + ' content pages show a Potential Search-First Content Pattern. This is a heuristic, it is not a claim that Google classified the site under helpful content.',
      { confidence: 0.65, affected: af.audienceFirstRiskPages + '/' + (af.contentPages || 0), severity: af.audienceFirstRiskPages >= 3 ? 'medium' : 'low' }));
  }

  // ---- Reader experience aggregate ----
  const ux = ctx.archStats || {};
  if (ux.missingViewport) {
    out.push(R.finding(R.get('MV-APPROVE-READER-EXPERIENCE'), 'Site', 'high',
      ux.missingViewport + ' page(s) lack a proper mobile viewport. Mobile reading is core to premium-ad performance.',
      { confidence: 0.9, affected: String(ux.missingViewport), severity: 'high' }));
  }

  // ---- Language (Journey generally expects English-capable; informational) ----
  const lang = detectLanguage(pages);
  ctx.language = lang;
  if (lang.undetermined) {
    out.push({ id: 'MV-LANGUAGE', category: 'requirement', name: 'Content language', status: 'manual', severity: 'info', page: 'Site',
      evidence: 'Unable to verify automatically, html lang was missing and the writing system was not identified with confidence.', why: 'Mediavine primarily monetizes English (and some other) content; language is assessed at review.', fix: 'Confirm primary content language at application.',
      confidence: 40, sourceType: 'official', sourceUrl: R.SRC.approve.url, lastVerified: R.VERIFIED, automated: false, weight: 0 });
  } else {
    out.push({ id: 'MV-LANGUAGE', category: 'requirement', name: 'Content language', status: 'info', severity: 'info', page: 'Site',
      evidence: 'Primary language signal: ' + lang.name + ' (' + lang.code + ').', why: 'Informational: Mediavine monetizes primarily English-language and other supported content.', fix: 'Confirm content language at application.',
      confidence: 75, sourceType: 'official', sourceUrl: R.SRC.approve.url, lastVerified: R.VERIFIED, automated: true, weight: 0 });
  }

  // ---- Program-specific readiness summaries ----
  const programs = {
    official: {
      key: 'official',
      name: PROGRAM_CONFIG.official.name,
      revenueThresholdUsd: PROGRAM_CONFIG.official.revenueThresholdUsd,
      sessionThreshold: null,
      revenueShare: PROGRAM_CONFIG.official.revenueShare,
      status: 'Manual Verification Required',          // revenue is private
      reason: 'Annual ad revenue cannot be read from a public URL.',
      ready: 'not_verified'
    },
    journey: {
      key: 'journey',
      name: PROGRAM_CONFIG.journey.name,
      sessionThreshold: PROGRAM_CONFIG.journey.sessionThreshold,
      revenueThresholdUsd: null,
      revenueShare: PROGRAM_CONFIG.journey.revenueShare,
      status: 'Manual Verification Required',          // sessions are private
      reason: 'Monthly sessions cannot be read from a public URL.',
      ready: 'not_verified'
    }
  };

  return { findings: out, programs };
}

module.exports = { evaluateOfficial, detectLanguage };
