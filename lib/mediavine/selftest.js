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

function articleBody(topic, salt) {
  const heads = ['compost depth', 'soil moisture', 'frost dates', 'crop rotation', 'pruning timing', 'bed drainage', 'mulch layers', 'seed spacing', 'irrigation timing', 'weed suppression', 'nutrient timing', 'pollinator habitat'];
  const h = heads[salt % heads.length];
  // Each article is built around its own topic, numbers and findings so the corpus is genuinely distinct.
  const y = 2012 + (salt * 3) % 11;
  const day = 12 + salt * 2;
  const sentences = [
    topic + ' investigates ' + h + ' in a controlled trial that began on day ' + day + ' of spring.',
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
    'No treatment eliminated the pest problem, so honest reporting of that failure closes the piece.'
  ];
  const byline = '<p class="author">A. Gardener</p><time datetime="' + y + '-01-' + (10 + (salt % 19)) + '">January</time>';
  return '<article><h1>' + topic + '</h1>' + byline + '<p>' + sentences.join(' ') + '</p></article>';
}

function scan(origin, pages) {
  return { start: origin, origin, limit: pages.length, robots: parseRobots('User-agent: *\nDisallow:'), sitemapUrls: [], adsTxt: { present: false, hasMediavine: false, lineCount: 0 }, challenge: false, reachedLimit: false, errors: [], pages };
}
function page(url, html) { return { url, finalUrl: url, status: 200, depth: 0, redirected: false, via: 'fixture', ms: 120, bytes: (html || '').length, headers: { 'content-type': 'text/html', server: 'fixture', 'cache-control': 'public' }, html, parse: null }; }

function qualityBlog() {
  const o = 'https://quality.test';
  const blogLinks = [];
  for (let i = 1; i <= 5; i++) blogLinks.push('<a href="' + o + '/blog/garden-' + i + '">Garden guide ' + i + '</a>');
  const pages = [page(o + '/', wrap(o, 'Horticulture Journal', '<h1>Horticulture Journal</h1><p>Original gardening advice and research. <a href="' + o + '/blog">Read the blog</a></p>' + blogLinks.join(' ')))];
  pages.push(page(o + '/blog', wrap(o, 'Blog', '<h1>Blog</h1><p>All guides.</p>' + blogLinks.join(' '))));
  for (let i = 1; i <= 5; i++) {
    const next = '<p><a href="' + o + '/blog/garden-' + (i + 1) + '">Next guide</a></p>';
    pages.push(page(o + '/blog/garden-' + i, wrap(o, 'Garden guide ' + i, articleBody('Garden guide ' + i + ' detailed advice', i) + next)));
  }
  pages.push(page(o + '/about', wrap(o, 'About', '<h1>About</h1><p>We are a team of horticulturists publishing original, well-sourced guides since 2018. Our editorial policy requires named authors, sources, and a correction process. Contact us at editor@quality.test.</p>')));
  pages.push(page(o + '/privacy-policy', wrap(o, 'Privacy Policy', '<h1>Privacy Policy</h1><p>We collect personal information such as your name and email, use cookies for analytics and advertising, and share data with third-party partners. We are a data controller. Legal basis is consent. You may opt out at any time in accordance with GDPR and CCPA requirements.</p>')));
  pages.push(page(o + '/contact', wrap(o, 'Contact', '<h1>Contact</h1><p>Email editor@quality.test or call 555-0100.</p>')));
  pages.push(page(o + '/terms', wrap(o, 'Terms of Service', '<h1>Terms</h1><p>These terms govern the use of the website and its original content. All rights reserved. Limitation of liability applies.</p>')));
  return scan(o, pages);
}

function thinSite() {
  const o = 'https://thin.test';
  const pages = [page(o + '/', wrap(o, 'Notes', '<h1>Notes</h1><p>Short notes.</p>'))];
  for (let i = 1; i <= 8; i++) pages.push(page(o + '/p/' + i, wrap(o, 'Note ' + i, '<article><h1>Note ' + i + '</h1><p>Short note number ' + i + '.</p></article>')));
  return scan(o, pages);
}

function aiRepetitive() {
  const o = 'https://ai.test';
  const clone = articleBody('Best SEO friendly thing', 3);
  const pages = [page(o + '/', wrap(o, 'SEO library', '<h1>SEO library</h1><p>Many articles.</p>'))];
  for (let i = 1; i <= 6; i++) pages.push(page(o + '/seo/' + i, wrap(o, 'Best SEO friendly thing', clone)));
  return scan(o, pages);
}

function duplicateSite() {
  const o = 'https://dupes.test';
  const clone = articleBody('Best bagel recipe variation', 5);
  const pages = [page(o + '/', wrap(o, 'Bagel clones', '<h1>Bagels</h1><p>Many nearly identical posts.</p>'))];
  for (let i = 1; i <= 6; i++) pages.push(page(o + '/bagel-' + i, wrap(o, 'Best bagel recipe variation', clone)));
  pages.push(page(o + '/privacy-policy', wrap(o, 'Privacy Policy', '<h1>Privacy Policy</h1><p>We collect personal information, use cookies, and do not share data with third parties. Data controller consent opt-out.</p>')));
  return scan(o, pages);
}

function largeBlog() {
  const o = 'https://large.test';
  const links = [];
  for (let i = 1; i <= 12; i++) links.push('<a href="' + o + '/blog/post-' + i + '">Post ' + i + '</a>');
  const pages = [page(o + '/', wrap(o, 'Large blog', '<h1>Large blog</h1><p>Original content.</p>' + links.join(' ')))];
  pages.push(page(o + '/blog', wrap(o, 'Blog', '<h1>Blog</h1>' + links.join(' '))));
  pages.push(page(o + '/privacy-policy', wrap(o, 'Privacy Policy', '<h1>Privacy Policy</h1><p>We collect personal information, use cookies, share with third parties, and data controller consent opt-out GDPR CCPA.</p>')));
  for (let i = 1; i <= 12; i++) { const next = '<p><a href="' + o + '/blog/post-' + (i + 1) + '">Next</a></p>'; pages.push(page(o + '/blog/post-' + i, wrap(o, 'Post ' + i, articleBody('Post ' + i + ' original long form', i) + next))); }
  return scan(o, pages);
}
function smallBlog() { const o = 'https://small.test'; return scan(o, [page(o + '/', wrap(o, 'Small', '<h1>Small blog</h1><p>A small personal blog.</p><a href="' + o + '/about">About</a><a href="' + o + '/privacy-policy">Privacy</a>')), page(o + '/privacy-policy', wrap(o, 'Privacy Policy', '<h1>Privacy Policy</h1><p>collect personal information cookies consent data controller opt-out</p>'))]); }

function toolSite() {
  const o = 'https://tools.test';
  const pages = [page(o + '/', wrap(o, 'Free tools', '<h1>Free online tools</h1><p>Converters and calculators.</p>')), page(o + '/privacy-policy', wrap(o, 'Privacy Policy', '<h1>Privacy Policy</h1><p>collect cookies consent data controller opt-out</p>')), page(o + '/contact', wrap(o, 'Contact', '<h1>Contact</h1><p>Email tools@tools.test</p>'))];
  pages.push(page(o + '/length-converter', wrap(o, 'Length converter', '<h1>Length converter</h1><p>Convert meters to feet and inches with a precise calculator. Original tool logic.</p>')), page(o + '/weight-converter', wrap(o, 'Weight converter', '<h1>Weight converter</h1><p>Convert kilograms to pounds with a precise calculator.</p>')));
  return scan(o, pages);
}

function saasSite() {
  const o = 'https://saas.test';
  return scan(o, [page(o + '/', wrap(o, 'SaaS', '<h1>Project SaaS</h1><p>Pricing, free trial, sign up, dashboard, solutions.</p>')), page(o + '/pricing', wrap(o, 'Pricing', '<h1>Pricing</h1><p>Plans and pricing for teams.</p>')), page(o + '/privacy-policy', wrap(o, 'Privacy Policy', '<h1>Privacy Policy</h1><p>collect personal data cookies consent data controller opt-out GDPR</p>'))]);
}
function ecommerceSite() {
  const o = 'https://shop.test';
  const pages = [page(o + '/', wrap(o, 'Store', '<h1>Store</h1><p>Shopify checkout cart product price SKU add to cart.</p>')), page(o + '/privacy-policy', wrap(o, 'Privacy Policy', '<h1>Privacy Policy</h1><p>collect personal data cookies consent opt-out data controller</p>'))];
  pages.push(page(o + '/product/hat', wrap(o, 'Hat, buy', '<h1>Hat</h1><p>Add to cart. Price $24. SKU HAT-1. Checkout with Shopify.</p><button>Add to cart</button>')));
  pages.push(page(o + '/product/mug', wrap(o, 'Mug, buy', '<h1>Mug</h1><p>Add to cart. Price $12. SKU MUG-1. Checkout.</p><button>Add to cart</button>')));
  return scan(o, pages);
}
function directorySite() {
  const o = 'https://dirs.test';
  return scan(o, [page(o + '/', wrap(o, 'Site directory', '<h1>Directory</h1><p>Submit your site. Browse listings and categories.</p>')), page(o + '/listings/alpha', wrap(o, 'Listing Alpha', '<h1>Alpha Co</h1><p>A directory listing with a short blurb and outbound link.</p>')), page(o + '/privacy-policy', wrap(o, 'Privacy Policy', '<h1>Privacy Policy</h1><p>collect cookies consent data controller opt-out</p>'))]);
}
function businessSite() {
  const o = 'https://consult.test';
  return scan(o, [page(o + '/', wrap(o, 'Northwind Consulting LLC', '<h1>Enterprise consulting</h1><p>Services and solutions for enterprise clients. Contact our LLC office.</p>')), page(o + '/services', wrap(o, 'Services', '<h1>Services</h1><p>Strategy workshops for enterprise teams. Solutions consulting.</p>')), page(o + '/contact', wrap(o, 'Contact', '<h1>Contact</h1><p>Email office@consult.test</p>')), page(o + '/privacy-policy', wrap(o, 'Privacy Policy', '<h1>Privacy Policy</h1><p>collect personal information cookies consent data controller opt-out</p>'))]);
}
function adHeavy() {
  const o = 'https://adheavy.test';
  const ad = '<script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script><ins class="adsbygoogle" data-ad-client="ca-pub-1"></ins><script src="https://securepubads.g.doubleclick.net/tag/js/gpt.js"></script>';
  return scan(o, [page(o + '/', wrap(o, 'Deals', '<h1>Deals</h1><p>Few words.</p>' + ad + ad + ad + ad)), page(o + '/privacy-policy', wrap(o, 'Privacy Policy', '<h1>Privacy Policy</h1><p>collect cookies consent data controller opt-out</p>')), page(o + '/p/1', wrap(o, 'Deal 1', '<h1>Deal</h1><p>Buy.</p>' + ad + ad + ad))]);
}
function policyRisk() {
  const o = 'https://risk.test';
  const body = '<h1>Online casino sports betting</h1><p>Play poker for real money at our online casino. No deposit bonus if you bet now. Gambling site with roulette, wager and jackpot odds. Bookmaker sports betting every night. Slots real money tables stay open.</p>';
  return scan(o, [page(o + '/', wrap(o, 'Online casino sports betting', body))]);
}
function brandSafe() { return qualityBlog(); }
function goodUx() { return qualityBlog(); }
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
function missingTrust() {
  const o = 'https://no-trust.test';
  return scan(o, [page(o + '/', '<!doctype html><html lang="en"><head><title>Trams</title></head><body><h1>Trams</h1><p>Hello</p><a href="' + o + '/a1">One</a></body></html>'), page(o + '/a1', '<!doctype html><html lang="en"><head><title>Tram article</title></head><body>' + articleBody('Hidden history of tram lines', 9) + '</body></html>')]);
}
function incentivesSite() {
  const o = 'https://incentive.test';
  return scan(o, [page(o + '/', wrap(o, 'Earn', '<h1>Get paid to browse</h1><p>Earn money by clicking and visiting websites. Buy website traffic fast.</p>')), page(o + '/privacy-policy', wrap(o, 'Privacy Policy', '<h1>Privacy Policy</h1><p>collect cookies consent data controller opt-out</p>'))]);
}

function runOne(name, factory) {
  const report = analyzeParsed(factory(), { onProgress: function () {} });
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
    ['duplicates', duplicateSite], ['large-blog', largeBlog], ['small-blog', smallBlog],
    ['tools', toolSite], ['saas', saasSite], ['ecommerce', ecommerceSite], ['directory', directorySite],
    ['business', businessSite], ['ad-heavy', adHeavy], ['policy-risk', policyRisk], ['brand-safe', brandSafe],
    ['good-ux', goodUx], ['poor-ux', badUxFixture], ['robots-blocked', robotsBlocked], ['cloudflare', cloudflareSite],
    ['js-heavy', jsHeavy], ['missing-trust', missingTrust], ['incentive', incentivesSite]
  ];

  const results = {};
  cases.forEach(c => { try { results[c[0]] = runOne(c[0], c[1]); console.log(c[0], results[c[0]].total, results[c[0]].verdict, 'conf=' + results[c[0]].conf); } catch (e) { results[c[0]] = { name: c[0], error: e.message, code: e.code, total: null }; console.log(c[0], 'ERROR', e.code, e.message); } });

  const q = results['quality-blog'];
  const thin = results['thin-content'];
  const ai = results['ai-repetitive'];
  const dup = results['duplicates'];
  const pol = results['policy-risk'];
  const miss = results['missing-trust'];
  const robots = results['robots-blocked'];
  const poorUx = results['poor-ux'];
  const incentive = results['incentive'];
  const adHeavyR = results['ad-heavy'];
  const cloud = results['cloudflare'];

  check(q && q.total != null, 'quality blog produced a score');
  check(q.total > thin.total, 'quality > thin (' + q.total + ' > ' + thin.total + ')');
  check(q.total > dup.total, 'quality > duplicates');
  check(q.total > pol.total, 'quality > policy-risk');
  check(q.total > miss.total, 'quality > missing-trust');
  check(q.total > incentive.total, 'quality > incentive-traffic');
  check(thin.total > 0 && poorUx.total >= 0, 'thin and poor-ux produced scores');
  check(q.total > ai.total, 'quality > ai-repetitive (' + q.total + ' > ' + ai.total + ')');
  check(robots.report.findings.some(f => f.id === 'MV-H-TECH' && f.status === 'critical'), 'robots.txt block reported critical');
  check(cloud.report && (cloud.report.verdict.label === 'Unable to Determine' || cloud.total < q.total), 'cloudflare site is not scored optimistically');
  check(q.report.manuals.some(m => m.id === 'MV-OFFICIAL-REVENUE'), 'Official revenue is a manual item');
  check(q.report.manuals.some(m => m.id === 'MV-JOURNEY-SESSIONS'), 'Journey sessions is a manual item');
  check(q.report.programEligibility.official.applicationEligibility === 'Cannot Be Confirmed', 'Official eligibility not confirmed without revenue');
  check(q.report.manualVerification && q.report.manualVerification.length >= 6, 'manual verification panel populated');
  check(q.report.applicationRequirements.some(a => a.item.indexOf('Annual ad revenue') >= 0 && a.status === 'Manual Verification Required'), 'app requirements list revenue as manual');

  const totals = Object.keys(results).map(k => results[k].total).filter(n => n != null);
  check(new Set(totals).size >= 8, 'scores vary across fixtures (unique=' + new Set(totals).size + ')');
  check(q.total !== thin.total && q.total !== pol.total, 'quality differs from thin and policy');
  check(adHeavyR.report && adHeavyR.report.advertising && adHeavyR.report.advertising.networks.indexOf('Google AdSense') >= 0, 'ad networks detected');

  if (failed) { console.error('\n' + failed + ' check(s) failed'); process.exit(1); }
  console.log('\nAll Mediavine self-checks passed.');
}

main();
