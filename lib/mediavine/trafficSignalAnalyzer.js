'use strict';

const U = require('./util');
const R = require('./mediavineRules');

/**
 * Traffic quality section.
 * Divides traffic into "Automatically Observable" (public, deterministic signals) and
 * "Cannot Be Verified" (private analytics). Never fabricates sessions, sources, countries,
 * demographics, or human-traffic percentages.
 */
function analyzeTrafficSignals(pages, ctx) {
  const out = [];

  // ---- Automatically Observable ----
  // 1. Bot-like URL patterns
  const botLike = [];
  pages.forEach(p => {
    const u = String(p.url || '');
    if (/(\/)?(bot-?traffic|buy-?traffic|increase-?(traffic|visits|views)|traffic-?exchange|web-traffic-bot|hit-?exchange|auto-?surf)(\/|\.|\?|$)/i.test(u)) botLike.push(u);
  });
  if (botLike.length) {
    out.push(R.finding(R.get('MV-H-BOT-LIKE'), 'Site', 'high',
      botLike.length + ' URL(s) match bot-like / traffic-exchange patterns: ' + botLike.slice(0, 5).join(', ') + '.',
      { confidence: 0.7, affected: String(botLike.length), severity: 'high' }));
  } else {
    out.push(R.finding(R.get('MV-H-BOT-LIKE'), 'Site', 'passed',
      'No bot-like or traffic-exchange URL patterns detected in the crawled pages.',
      { confidence: 0.6, severity: 'passed' }));
  }

  // 2. Incentivized traffic language
  const incentive = [];
  pages.forEach(p => {
    if (!p.parse) return;
    if (/(earn money by (clicking|visiting|watching)|paid to (click|browse)|get paid to read|buy website traffic|increase web traffic (fast|instantly))/i.test(p.parse.visibleText)) incentive.push(U.pathOf(p.url));
  });
  if (incentive.length) {
    out.push(R.finding(R.get('MV-H-INCENTIVIZED'), 'Site', 'medium',
      'Incentivized-traffic language found on ' + incentive.length + ' page(s): ' + incentive.slice(0, 4).join(', ') + '. Mediavine explicitly requires clean, human traffic (not incentivized clicks).',
      { confidence: 0.6, affected: String(incentive.length), severity: 'medium' }));
  } else {
    out.push(R.finding(R.get('MV-H-INCENTIVIZED'), 'Site', 'passed',
      'No obvious incentivized-traffic language detected on crawled pages.',
      { confidence: 0.55, severity: 'passed' }));
  }

  // 3. Publicly visible traffic claims
  let visibleClaim = 0;
  pages.forEach(p => {
    if (!p.parse) return;
    if (/(\d[\d,\.]*)\s*(million|k|thousand)?\s*(monthly )?(visitors|readers|users|pageviews)\b/i.test(p.parse.visibleText)) visibleClaim++;
  });
  if (visibleClaim) {
    out.push(R.finding(R.get('MV-H-TRAFFIC-CLAIMS'), 'Site', 'info',
      visibleClaim + ' page(s) make publicly visible traffic/size claims. These are self-reported, not verified, and are not treated as proof of the Official revenue or Journey session thresholds.',
      { confidence: 0.6, severity: 'info' }));
  }

  // 4. Tracking implementation (GA4 / analytics presence)
  const tracking = { ga: 0, gtm: 0, other: 0 };
  pages.forEach(p => {
    if (!p.parse) return;
    const h = p.parse.visibleText + ' ' + (p.parse.scripts || []).join(' ');
    if (/googletagmanager\.com\/gtag|googletagmanager\.com\/gtm\.js|gtag\(|analytics\.google|g\.js|gtm\.js|GA4/i.test(h)) tracking.ga++;
    if (/googletagmanager\.com\/gtm\.js/i.test(h)) tracking.gtm++;
    if (/(matomo|plausible|fathom|piwik|segment\.com|mixpanel|hotjar)/i.test(h)) tracking.other++;
  });
  const parsedCount = pages.filter(p => p.parse).length;
  const anyTracking = tracking.ga || tracking.gtm || tracking.other;
  out.push(R.finding(R.get('MV-H-TRACKING'), 'Site', anyTracking ? 'passed' : 'info',
    anyTracking
      ? 'Tracking signals detected on ' + (tracking.ga ? tracking.ga + ' page(s) GA/GTM' : '') + (tracking.gtm ? ', ' + tracking.gtm + ' GTM' : '') + (tracking.other ? ', ' + tracking.other + ' other analytics' : '') + '. Presence of analytics helps verify traffic later, but does not itself prove session volume.'
      : 'No Google Analytics/GTM tracking signal detected in the crawl of ' + parsedCount + ' parsed page(s). GA4 connection is required at application time and is a manual verification step.',
    { confidence: 0.7, severity: anyTracking ? 'passed' : 'info' }));

  // 5. Traffic-generation pages
  const genPages = [];
  pages.forEach(p => {
    if (!p.parse) return;
    if (/(\/(traffic|hits|visits|views)-?exchange)|traffic generator|get more traffic fast/i.test((p.url || '') + ' ' + p.parse.visibleText.slice(0, 400))) genPages.push(U.pathOf(p.url));
  });
  if (genPages.length) {
    out.push(R.finding(R.get('MV-H-TRAFFIC-GEN'), 'Site', 'high',
      'Traffic-generation pages detected: ' + genPages.slice(0, 4).join(', ') + '. These are associated with artificial traffic, which Mediavine excludes.',
      { confidence: 0.65, affected: String(genPages.length), severity: 'high' }));
  }

  // ---- Manual (Cannot Be Verified) items ----
  [
    ['MV-MANUAL-SESSIONS', 'Monthly sessions', 'Actual monthly session counts (Official has no session minimum; Journey requires 1,000+).'],
    ['MV-MANUAL-SOURCES', 'Traffic sources', 'Actual traffic-source distribution (organic, direct, social, paid, referral).'],
    ['MV-MANUAL-COUNTRIES', 'Traffic countries', 'Actual country-of-origin distribution and premium-traffic share.'],
    ['MV-MANUAL-DEMOGRAPHICS', 'Audience demographics', 'Reader demographics (age, gender, interests).'],
    ['MV-MANUAL-HUMAN', 'Human traffic percentage', 'Share of sessions from real humans vs bots/invalid traffic.'],
    ['MV-MANUAL-HISTORY', 'Traffic quality history', 'Historical traffic authenticity and growth pattern.']
  ].forEach(def => {
    out.push({
      id: def[0], category: 'traffic', name: def[1], status: 'manual', severity: 'info',
      page: 'Site', evidence: 'Unable to verify automatically. ' + def[2] + ' This is private Google Analytics data.', 
      why: 'Mediavine evaluates these data points during review, but they cannot be read from a public URL.',
      fix: 'Provide GA4 evidence for this metric at application time.',
      confidence: 100, sourceType: 'official', sourceUrl: R.SRC.approve.url, lastVerified: R.VERIFIED,
      automated: false, weight: 0, trafficHalf: 'Cannot Be Verified'
    });
  });

  return out;
}

module.exports = { analyzeTrafficSignals };
