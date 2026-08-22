'use strict';

const U = require('./util');
const R = require('./raptiveRules');

/**
 * Google Analytics public-HTML audit.
 * Distinguishes:
 *   Tracking code detected  ≠  Analytics configuration verified
 * Never claims GA is correctly configured from a snippet alone.
 */
function analyzeAnalytics(pages, ctx) {
  const out = [];
  const ids = { ga4: new Set(), ua: new Set(), gtm: new Set() };
  let gtagPages = 0, gaJsPages = 0, gtmPages = 0, headPlacement = 0, bodyPlacement = 0, dupInstall = 0;
  const pageHits = [];

  pages.forEach(p => {
    if (!p.parse) return;
    const a = p.parse.analytics || {};
    (a.ga4Ids || []).forEach(id => ids.ga4.add(id));
    (a.uaIds || []).forEach(id => ids.ua.add(id));
    (a.gtmIds || []).forEach(id => ids.gtm.add(id));
    if (a.gtag) gtagPages++;
    if (a.gaJs) gaJsPages++;
    if (a.gtmJs) gtmPages++;
    if (a.inHead) headPlacement++;
    if (a.inBody) bodyPlacement++;
    if (a.duplicateInstall) dupInstall++;
    if (a.ga4Ids && a.ga4Ids.length || a.gtag || a.gtmJs || a.gaJs) pageHits.push(U.pathOf(p.url));
  });

  const parsed = pages.filter(p => p.parse).length;
  const detected = ids.ga4.size || ids.gtm.size || gtagPages || gaJsPages || gtmPages;
  ctx.analytics = {
    detected: !!detected,
    ga4Ids: [...ids.ga4],
    uaIds: [...ids.ua],
    gtmIds: [...ids.gtm],
    gtagPages, gaJsPages, gtmPages, headPlacement, bodyPlacement, dupInstall,
    pagesWithCode: pageHits.length,
    configurationVerified: false
  };

  if (!detected) {
    out.push(R.finding(R.get('RAP-OFFICIAL-GA'), 'Site', 'high',
      'No Google Analytics 4, gtag.js, analytics.js, or Google Tag Manager snippet was detected in ' + parsed + ' parsed page(s). '
      + 'Tracking code not detected. Analytics configuration cannot be verified without Analytics access. Raptive currently requires GA4 and read-only authorization at application.',
      { confidence: 0.78, severity: 'high', reqStatus: 'Needs Review' }));
    out.push(R.finding(R.get('RAP-H-TRACKING'), 'Site', 'high',
      'Tracking code not detected on crawled pages.',
      { confidence: 0.78, severity: 'high' }));
    return out;
  }

  const bits = [];
  if (ids.ga4.size) bits.push('GA4 Measurement ID(s): ' + [...ids.ga4].slice(0, 4).join(', '));
  if (ids.ua.size) bits.push('legacy Universal Analytics ID(s): ' + [...ids.ua].slice(0, 3).join(', ') + ' (UA is not GA4)');
  if (ids.gtm.size) bits.push('GTM container(s): ' + [...ids.gtm].slice(0, 3).join(', '));
  if (gtagPages) bits.push('gtag.js on ' + gtagPages + ' page(s)');
  if (gtmPages) bits.push('GTM on ' + gtmPages + ' page(s)');

  let extra = '';
  let status = 'passed';
  let reqStatus = 'Likely';
  if (ids.ga4.size === 0 && !gtmPages && !gtagPages) {
    status = 'medium';
    reqStatus = 'Needs Review';
    extra = ' Only legacy Universal Analytics signals were found. Raptive currently requires Google Analytics 4.';
  }
  if (ids.ga4.size > 1 || dupInstall) {
    status = status === 'passed' ? 'medium' : status;
    reqStatus = 'Needs Review';
    extra += ' Possible duplicate Analytics installation (' + ids.ga4.size + ' GA4 ID(s); duplicate-install signal on ' + dupInstall + ' page(s)).';
  }

  out.push(R.finding(R.get('RAP-OFFICIAL-GA'), 'Site', status,
    'Tracking code detected. ' + bits.join('; ') + '. Found on ' + pageHits.length + ' of ' + parsed + ' parsed page(s). '
    + (headPlacement ? 'Snippet appears in <head> on ' + headPlacement + ' page(s). ' : '')
    + 'Analytics configuration verified: no, actual tracking accuracy, filters, and property settings cannot be verified without Analytics access.'
    + extra,
    { confidence: 0.82, severity: status, reqStatus }));

  out.push(R.finding(R.get('RAP-H-TRACKING'), 'Site', status === 'passed' ? 'passed' : status,
    'Tracking code detected on ' + pageHits.length + ' page(s). This is not a claim that Google Analytics is correctly configured.',
    { confidence: 0.8, severity: status === 'passed' ? 'passed' : status }));

  return out;
}

module.exports = { analyzeAnalytics };
