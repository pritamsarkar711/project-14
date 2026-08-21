'use strict';

const assert = require('assert');
const { analyzeParsed } = require('./orchestrate');
const { assertPublicUrl } = require('./ssrf');
const { parseRobots } = require('./crawler');

function wrap(origin, title, inner, extraHead) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + title + '</title><meta name="description" content="' + title + ' in depth">'
    + '<style>@media (max-width: 800px) { body { margin: 0; } }</style>' + (extraHead || '') + '</head><body>'
    + '<header><nav><a href="' + origin + '/">Home</a> <a href="' + origin + '/about">About</a> '
    + '<a href="' + origin + '/contact">Contact</a> <a href="' + origin + '/privacy-policy">Privacy Policy</a> '
    + '<a href="' + origin + '/blog">Blog</a></nav></header>'
    + '<main>' + inner + '</main>'
    + '<footer><a href="' + origin + '/privacy-policy">Privacy</a> <a href="' + origin + '/contact">Contact</a> '
    + '<a href="' + origin + '/terms">Terms</a></footer></body></html>';
}

const GA = '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABCD1234"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config","G-ABCD1234");</script>';
const DUP_GA = GA + '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ZZZZ9999"></script><script>gtag("config","G-ZZZZ9999");</script>';

function articleBody(topic, salt, long) {
  const heads = ['compost depth', 'soil moisture', 'frost dates', 'crop rotation', 'pruning timing', 'bed drainage', 'mulch layers', 'seed spacing'];
  const h = heads[salt % heads.length];
  const y = 2012 + (salt * 3) % 11;
  const sentences = [
    topic + ' investigates ' + h + ' in a controlled trial that began on day ' + (12 + salt) + ' of spring.',
    'The experiment measured leaf width every nine days and recorded ' + (20 + salt * 5) + ' individual plants per treatment.',
    'Plot ' + (salt + 3) + ' received the experimental amendment while the control used the standard recipe.',
    'After ' + (14 + salt) + ' weeks the amended bed showed ' + (3 + salt) + ' percent higher dry weight overall.',
    'A key limitation was the unusually dry ' + y + ' season, which reduced baseline vigor for every plot.',
    'The second measurement round used a calibrated scale rather than visual estimates to avoid bias.',
    'Cross-checks with a neighbouring organic farm in the ' + (salt + 2) + 'th county matched the trend.',
    'We intentionally avoided the common error of comparing beds that had different exposure to wind.',
    'The protocol required identical watering at dawn and a fixed order of weeding across all treatments.',
    'Monthly soil probes showed that pH drifted only slightly in the amended plots by late July.',
    'Because the season was hot, irrigation was increased every other day beginning in week six.',
    'The data table in the appendix lists each measurement together with the exact date it was taken.',
    'Taken together the results argue for a careful, measured approach rather than a single bold change.',
    'No treatment eliminated the pest problem, so honest reporting of that failure closes the piece.',
    'I tested this myself in our garden and photographed each plot on the same morning.',
    'According to the county extension study, similar amendments failed when drainage was ignored.'
  ];
  if (long) {
    for (let i = 0; i < 18; i++) {
      sentences.push('Additional field note ' + i + ' for ' + topic + ': moisture at 10cm was ' + (12 + i + salt) + ' percent, canopy temperature ' + (18 + (i % 7)) + ' C, and we recorded pest counts of ' + (i * 2 + salt) + ' on the underside of leaves.');
    }
  }
  const byline = '<p class="author">A. Gardener</p><time datetime="' + y + '-01-' + (10 + (salt % 19)) + '">January</time>';
  return '<article><h1>' + topic + '</h1>' + byline + '<h2>Methods</h2><p>' + sentences.slice(0, 8).join(' ') + '</p><h2>Results</h2><p>' + sentences.slice(8).join(' ') + '</p></article>';
}

function scan(origin, pages, extra) {
  extra = extra || {};
  return {
    start: origin, origin, limit: pages.length, robots: parseRobots('User-agent: *\nDisallow:'), sitemapUrls: [],
    adsTxt: { present: false, hasRaptive: false, lineCount: 0 }, challenge: false, reachedLimit: false, errors: [], pages,
    domainAge: extra.domainAge || { verified: true, registeredAt: '2018-03-01T00:00:00.000Z', ageDays: 3000, ageMonths: 98, atLeastSixMonths: true, confidence: 0.85, source: 'RDAP' }
  };
}
function page(url, html) { return { url, finalUrl: url, status: 200, depth: 0, redirected: false, via: 'fixture', ms: 120, bytes: (html || '').length, headers: { 'content-type': 'text/html', server: 'fixture', 'cache-control': 'public' }, html, parse: null }; }

function qualityBlog() {
  const o = 'https://quality.test';
  const blogLinks = [];
  for (let i = 1; i <= 5; i++) blogLinks.push('<a href="' + o + '/blog/garden-' + i + '">Garden guide ' + i + '</a>');
  const pages = [page(o + '/', wrap(o, 'Horticulture Journal', '<h1>Horticulture Journal</h1><p>Original gardening advice and research. <a href="' + o + '/blog">Read the blog</a></p>' + blogLinks.join(' '), GA))];
  pages.push(page(o + '/blog', wrap(o, 'Blog', '<h1>Blog</h1><p>All guides.</p>' + blogLinks.join(' '), GA)));
  for (let i = 1; i <= 5; i++) {
    const next = '<p><a href="' + o + '/blog/garden-' + (i + 1) + '">Next guide</a></p>';
    pages.push(page(o + '/blog/garden-' + i, wrap(o, 'Garden guide ' + i, articleBody('Garden guide ' + i + ' detailed advice', i, true) + next, GA)));
  }
  pages.push(page(o + '/about', wrap(o, 'About', '<h1>About</h1><p>We are a team of horticulturists publishing original, well-sourced guides since 2018. Our editorial policy requires named authors, sources, and a correction process. Contact us at editor@quality.test.</p>', GA)));
  pages.push(page(o + '/privacy-policy', wrap(o, 'Privacy Policy', '<h1>Privacy Policy</h1><p>We collect personal information such as your name and email, use cookies for analytics and advertising, and share data with third-party partners. We are a data controller. Legal basis is consent. You may opt out at any time in accordance with GDPR and CCPA requirements.</p>', GA)));
  pages.push(page(o + '/contact', wrap(o, 'Contact', '<h1>Contact</h1><p>Email editor@quality.test or call 555-0100.</p>', GA)));
  pages.push(page(o + '/terms', wrap(o, 'Terms of Service', '<h1>Terms</h1><p>These terms govern the use of the website and its original content. All rights reserved. Limitation of liability applies.</p>', GA)));
  return scan(o, pages);
}

function thinSite() {
  const o = 'https://thin.test';
  const pages = [page(o + '/', wrap(o, 'Notes', '<h1>Notes</h1><p>Short notes.</p>'))];
  for (let i = 1; i <= 8; i++) pages.push(page(o + '/blog/p-' + i, wrap(o, 'Note ' + i, '<article><h1>Note ' + i + '</h1><p>Short note number ' + i + '.</p></article>')));
  return scan(o, pages);
}

function aiRepetitive() {
  const o = 'https://ai.test';
  const clone = articleBody('Best SEO friendly thing', 3, false);
  const pages = [page(o + '/', wrap(o, 'SEO library', '<h1>SEO library</h1><p>Many articles.</p>'))];
  for (let i = 1; i <= 6; i++) pages.push(page(o + '/blog/seo-' + i, wrap(o, 'Best SEO friendly thing', clone)));
  return scan(o, pages);
}

function duplicateSite() {
  const o = 'https://dupes.test';
  const clone = articleBody('Best bagel recipe variation', 5, true);
  const pages = [page(o + '/', wrap(o, 'Bagel clones', '<h1>Bagels</h1><p>Many nearly identical posts.</p>'))];
  for (let i = 1; i <= 6; i++) pages.push(page(o + '/blog/bagel-' + i, wrap(o, 'Best bagel recipe variation', clone)));
  pages.push(page(o + '/privacy-policy', wrap(o, 'Privacy Policy', '<h1>Privacy Policy</h1><p>We collect personal information, use cookies, and do not share data with third parties. Data controller consent opt-out.</p>')));
  return scan(o, pages);
}

function longFormSite() { return qualityBlog(); }

function shortPages() {
  const o = 'https://short.test';
  const pages = [page(o + '/', wrap(o, 'Short', '<h1>Short</h1><p>Tiny posts.</p>', GA))];
  for (let i = 1; i <= 6; i++) pages.push(page(o + '/blog/s-' + i, wrap(o, 'Short ' + i, '<article><h1>Short ' + i + '</h1><p>Only a few words on page ' + i + '.</p></article>', GA)));
  return scan(o, pages);
}

function noGaSite() {
  const o = 'https://noga.test';
  const pages = [page(o + '/', wrap(o, 'No analytics', '<h1>Journal</h1><p>Original research notes without tracking.</p><a href="' + o + '/blog/a-1">One</a>'))];
  pages.push(page(o + '/blog/a-1', wrap(o, 'Article', articleBody('Field notes without tracking', 4, true))));
  pages.push(page(o + '/privacy-policy', wrap(o, 'Privacy Policy', '<h1>Privacy Policy</h1><p>collect personal information cookies consent data controller opt-out GDPR</p>')));
  return scan(o, pages);
}

function dupGaSite() {
  const o = 'https://dupga.test';
  return scan(o, [page(o + '/', wrap(o, 'Dup GA', '<h1>Site</h1><p>Two measurement IDs.</p>' + articleBody('Dup ga article', 2, true), DUP_GA))]);
}

function youngDomain() {
  const s = qualityBlog();
  s.domainAge = { verified: true, registeredAt: new Date(Date.now() - 40 * 86400000).toISOString(), ageDays: 40, ageMonths: 1, atLeastSixMonths: false, confidence: 0.85, source: 'RDAP' };
  return s;
}

function unverifiedDomain() {
  const s = qualityBlog();
  s.domainAge = { verified: false, reason: 'RDAP failed' };
  return s;
}

function adHeavy() {
  const o = 'https://adheavy.test';
  const ad = '<script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script><ins class="adsbygoogle" data-ad-client="ca-pub-1"></ins><script src="https://securepubads.g.doubleclick.net/tag/js/gpt.js"></script>';
  return scan(o, [page(o + '/', wrap(o, 'Deals', '<h1>Deals</h1><p>Few words.</p>' + ad + ad + ad + ad)), page(o + '/privacy-policy', wrap(o, 'Privacy Policy', '<h1>Privacy Policy</h1><p>collect cookies consent data controller opt-out</p>')), page(o + '/blog/p-1', wrap(o, 'Deal 1', '<h1>Deal</h1><p>Buy.</p>' + ad + ad + ad))]);
}

function policyRisk() {
  const o = 'https://risk.test';
  const body = '<h1>Online casino sports betting</h1><p>Play poker for real money at our online casino. No deposit bonus if you bet now. Gambling site with roulette, wager and jackpot odds. Bookmaker sports betting every night. Slots real money tables stay open.</p>';
  return scan(o, [page(o + '/', wrap(o, 'Online casino sports betting', body, GA))]);
}

function badUxFixture() {
  const o = 'https://badux.test';
  const html = '<!doctype html><html lang="en"><head><title>Bad UX</title></head><body style="width:1800px"><div style="position:fixed;z-index:99"><a href="#">x</a></div><h1>Bad UX</h1><p>Text without viewport or navigation.</p></body></html>';
  return scan(o, [page(o + '/', html)]);
}

function robotsBlocked() {
  const o = 'https://blocked.test';
  const s = scan(o, [page(o + '/', wrap(o, 'Private', '<h1>Private</h1><p>You should not crawl this.</p>'))]);
  s.robots = parseRobots('User-agent: *\nDisallow: /');
  s.robots.blocksAll = true;
  return s;
}

function cloudflareSite() {
  const o = 'https://cf.test';
  const html = '<!doctype html><html><head><title>Just a moment...</title></head><body>Just a moment Checking your browser before accessing challenge-platform cdn-cgi/challenge</body></html>';
  const s = scan(o, [page(o + '/', html)]);
  s.challenge = true;
  s.pages[0].challenge = true;
  s.pages[0].headers = { 'cf-ray': 'abc', server: 'cloudflare', 'content-type': 'text/html' };
  return s;
}

function jsHeavy() {
  const o = 'https://spa.test';
  const scripts = Array.from({ length: 12 }, (_, i) => '<script src="' + o + '/chunk' + i + '.js"></script>').join('');
  const html = '<!doctype html><html lang="en"><head><title>App</title>' + scripts + '</head><body><div id="root"></div>' + scripts + '</body></html>';
  return scan(o, [page(o + '/', html), page(o + '/app', html)]);
}

function brokenLinks() {
  const o = 'https://broken.test';
  const pages = [page(o + '/', wrap(o, 'Broken', '<h1>Broken</h1><p>See <a href="' + o + '/missing">missing</a>.</p>', GA))];
  pages.push({ url: o + '/missing', finalUrl: o + '/missing', status: 404, depth: 1, redirected: false, via: 'fixture', ms: 80, bytes: 20, headers: { 'content-type': 'text/html' }, html: '<html><body>Not found</body></html>', parse: null });
  return scan(o, pages);
}

function incentivesSite() {
  const o = 'https://incentive.test';
  return scan(o, [page(o + '/', wrap(o, 'Earn', '<h1>Get paid to browse</h1><p>Earn money by clicking and visiting websites. Buy website traffic fast.</p>')), page(o + '/privacy-policy', wrap(o, 'Privacy Policy', '<h1>Privacy Policy</h1><p>collect cookies consent data controller opt-out</p>'))]);
}

function runOne(name, factory, user) {
  const report = analyzeParsed(factory(), { onProgress: function () {}, user: user || {} });
  return { name, total: report.score.total, verdict: report.verdict.label, conf: report.score.confidence, report };
}

function main() {
  let failed = 0;
  function check(cond, msg) { if (!cond) { failed++; console.error('FAIL:', msg); } else console.log('ok  ', msg); }

  try { assertPublicUrl('http://127.0.0.1/'); check(false, 'ssrf localhost'); } catch (e) { check(e.code === 'ssrf' || e.code === 'invalid_url', 'ssrf localhost blocked (' + e.code + ')'); }
  try { assertPublicUrl('http://169.254.169.254/latest'); check(false, 'ssrf metadata'); } catch (e) { check(!!e.code, 'ssrf metadata blocked'); }
  try { assertPublicUrl('http://localhost/admin'); check(false, 'ssrf localhost host'); } catch (e) { check(!!e.code, 'ssrf localhost host blocked'); }

  const cases = [
    ['quality-blog', qualityBlog], ['thin-content', thinSite], ['ai-repetitive', aiRepetitive],
    ['duplicates', duplicateSite], ['long-form', longFormSite], ['short-pages', shortPages],
    ['no-ga', noGaSite], ['dup-ga', dupGaSite], ['young-domain', youngDomain], ['unverified-domain', unverifiedDomain],
    ['ad-heavy', adHeavy], ['policy-risk', policyRisk], ['poor-ux', badUxFixture],
    ['robots-blocked', robotsBlocked], ['cloudflare', cloudflareSite], ['js-heavy', jsHeavy],
    ['broken-links', brokenLinks], ['incentive', incentivesSite]
  ];

  const results = {};
  cases.forEach(c => { try { results[c[0]] = runOne(c[0], c[1]); console.log(c[0], results[c[0]].total, results[c[0]].verdict, 'conf=' + results[c[0]].conf); } catch (e) { results[c[0]] = { name: c[0], error: e.message, code: e.code, total: null }; console.log(c[0], 'ERROR', e.code, e.message); } });

  const q = results['quality-blog'];
  const thin = results['thin-content'];
  const ai = results['ai-repetitive'];
  const dup = results['duplicates'];
  const pol = results['policy-risk'];
  const robots = results['robots-blocked'];
  const poorUx = results['poor-ux'];
  const incentive = results['incentive'];
  const noGa = results['no-ga'];
  const young = results['young-domain'];
  const unver = results['unverified-domain'];
  const short = results['short-pages'];
  const longf = results['long-form'];
  const dupga = results['dup-ga'];
  const cloud = results['cloudflare'];

  check(q && q.total != null, 'quality blog produced a score');
  check(q.total > thin.total, 'quality > thin (' + q.total + ' > ' + thin.total + ')');
  check(q.total > dup.total, 'quality > duplicates');
  check(q.total > pol.total, 'quality > policy-risk');
  check(q.total > incentive.total, 'quality > incentive-traffic');
  check(q.total > ai.total, 'quality > ai-repetitive (' + q.total + ' > ' + ai.total + ')');
  check(longf.total >= short.total, 'long-form >= short-pages (' + longf.total + ' >= ' + short.total + ')');
  check(q.total > noGa.total || q.report.analytics.detected, 'quality has GA detection or scores higher than no-ga');
  check(q.report.analytics && q.report.analytics.detected, 'quality blog GA tracking code detected');
  check(noGa.report.analytics && !noGa.report.analytics.detected, 'no-ga site has no tracking code');
  check(noGa.report.findings.some(f => f.id === 'RAP-OFFICIAL-GA' && f.status !== 'passed'), 'missing GA is not passed');
  check(dupga.report.analytics && dupga.report.analytics.ga4Ids.length >= 2, 'duplicate GA IDs detected');
  check(young.report.findings.some(f => f.id === 'RAP-OFFICIAL-DOMAIN-AGE' && f.reqStatus === 'Not Met'), 'young domain not met');
  check(unver.report.findings.some(f => f.id === 'RAP-OFFICIAL-DOMAIN-AGE' && (f.status === 'manual' || f.reqStatus === 'Unable to Verify')), 'unverified domain is unable to verify, not invented');
  check(q.report.applicationEligibility.status === 'Cannot Be Fully Verified', 'eligibility not confirmed without pageviews');
  check(q.report.manualVerification && q.report.manualVerification.length >= 5, 'manual verification panel populated');
  check(q.report.officialRequirements.some(a => a.id === 'RAP-OFFICIAL-PAGEVIEWS'), 'pageviews listed as official requirement');
  check(robots.report.findings.some(f => f.id === 'RAP-H-TECH' && f.status === 'critical'), 'robots.txt block reported critical');
  check(cloud.report && (cloud.report.verdict.label === 'Unable to Verify' || cloud.total < q.total), 'cloudflare site is not scored optimistically');
  check(q.report.disclaimer.indexOf('NOT an official Raptive score') >= 0, 'disclaimer present');
  check(!q.report.findings.some(f => /100,000 monthly pageviews is still the minimum/i.test(f.evidence || '')), 'does not claim outdated 100k minimum');

  const below = runOne('below-25k', qualityBlog, { pageviews: 12000 });
  const mid = runOne('mid-40k', qualityBlog, { pageviews: 40000, us: 20, uk: 10, ca: 5, au: 5, nz: 2 });
  const midOk = runOne('mid-ok', qualityBlog, { pageviews: 40000, us: 40, uk: 10, ca: 5, au: 3, nz: 2 });
  const high = runOne('high-120k', qualityBlog, { pageviews: 120000, us: 25, uk: 10, ca: 5, au: 2, nz: 1 });
  const nonTarget = runOne('non-target', qualityBlog, { pageviews: 80000, us: 5, uk: 2, ca: 1, au: 1, nz: 0 });

  check(below.report.applicationEligibility.status === 'Not Met', 'below 25k user-provided pageviews → Not Met');
  check(mid.report.declaredTraffic.label === 'User-provided value', 'declared traffic labelled user-provided');
  check(mid.report.declaredTraffic.independentlyVerified === false, 'user-provided not independently verified');
  check(nonTarget.report.applicationEligibility.status === 'Not Met', 'low key-country share at 25k–99k → Not Met');
  check(midOk.report.declaredTraffic.combinedKeyCountryPct >= 50, 'combined key-country % calculated');
  check(high.report.applicationEligibility.tier && high.report.applicationEligibility.tier.key === 'high', '100k+ maps to high tier');
  check(high.report.applicationEligibility.tier.keyCountryPct === 40, '100k+ country target is 40%');
  check(midOk.report.applicationEligibility.tier.keyCountryPct === 50, '25k–99k country target is 50%');
  check(q.report.score.total === below.report.score.total, 'unverified private data does not change website quality score when only pageviews added (same public crawl)');

  const totals = Object.keys(results).map(k => results[k].total).filter(n => n != null);
  check(new Set(totals).size >= 6, 'scores vary across fixtures (unique=' + new Set(totals).size + ')');

  if (failed) { console.error('\n' + failed + ' check(s) failed'); process.exit(1); }
  console.log('\nAll Raptive self-checks passed.');
}

main();
