'use strict';

const assert = require('assert');
const { analyzeParsed } = require('./orchestrate');
const { assertPublicUrl } = require('./ssrf');
const { parseRobots } = require('./crawler');
const { jaccard, shingles, simHash, hamming64 } = require('./util');

function wrap(origin, title, inner, extraHead) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + title + '</title><meta name="description" content="' + title + ' in depth">'
    + '<style>@media (max-width: 800px) { body { margin: 0; } }</style>' + (extraHead || '') + '</head><body>'
    + '<header><nav><a href="' + origin + '/">Home</a> <a href="' + origin + '/about">About</a> '
    + '<a href="' + origin + '/contact">Contact</a> <a href="' + origin + '/privacy-policy">Privacy Policy</a> '
    + '<a href="' + origin + '/blog">Blog</a></nav></header>'
    + '<main>' + inner + '</main>'
    + '<footer><a href="' + origin + '/privacy-policy">Privacy</a> <a href="' + origin + '/contact">Contact</a> '
    + '<a href="' + origin + '/terms">Terms</a></footer>'
    + '<script src="' + origin + '/app.js"></script></body></html>';
}

function articleBody(topic, salt) {
  const sentences = [
    topic + ' rewards careful observation and original reporting rather than recycled summaries.',
    'Gardeners in zone ' + salt + ' often start seeds indoors six weeks before the last frost date.',
    'Soil structure, drainage, compost quality and mulch thickness all change how plants respond in July heat.',
    'A field notebook from 2019 recorded twenty-four cultivars and their days to harvest under identical irrigation.',
    'Readers want measurements: grams of compost, litres of water, centimetres of spacing, not vague encouragement.',
    'The greenhouse experiment compared two pruning methods and published both successes and failures.',
    'Local extension officers recommended a three-year crop rotation to reduce fusarium pressure.',
    'Photographs help, but only when captions explain what the reader should notice in the frame.',
    'This page also links related guides so visitors can move from planning to planting without dead ends.',
    'Unique anecdote ' + salt + ': a neighbour swapped seeds after a hailstorm and documented the recovery week by week.',
    'Publishers who add original tables, dates and named sources tend to keep returning visitors.',
    'None of this text is placeholder copy; it is written to be distinguishable from neighbouring articles.'
  ];
  return '<article><h1>' + topic + '</h1><p>' + sentences.join('</p><p>') + '</p>'
    + '<time datetime="2025-03-0' + ((salt % 8) + 1) + '">March 2025</time>'
    + '<span class="author">Jordan Blake</span></article>';
}

function page(url, html) {
  return {
    url, finalUrl: url, status: 200, depth: url.endsWith('/') ? 0 : 1, redirected: false,
    hops: [{ url, ip: '93.184.216.34', status: 200, ms: 40 }],
    via: 'direct', ms: 40, bytes: html.length, headers: { 'content-type': 'text/html; charset=utf-8' },
    html, parse: null
  };
}

function scan(origin, pages, extra) {
  extra = extra || {};
  return {
    start: origin + '/',
    origin,
    limit: extra.limit || 50,
    robots: extra.robots || parseRobots('User-agent: *\nAllow: /\nSitemap: ' + origin + '/sitemap.xml'),
    sitemapUrls: extra.sitemapUrls || pages.map(p => p.url),
    adsTxt: extra.adsTxt || { present: false, hasEzoic: false, lineCount: 0, text: '' },
    pages,
    errors: extra.errors || [],
    challenge: !!extra.challenge,
    reachedLimit: false,
    sslOk: true
  };
}

function qualityBlog() {
  const o = 'https://quality-blog.test';
  const pages = [
    page(o + '/', wrap(o, 'Seasonal Kitchen Garden', '<h1>Seasonal Kitchen Garden</h1><p>A practical journal of soil tests, cultivar trials and weekly harvest notes written for home growers.</p><ul><li><a href="' + o + '/blog/tomato-pruning">Tomato pruning</a></li><li><a href="' + o + '/blog/compost-ratios">Compost ratios</a></li><li><a href="' + o + '/blog/seed-starting">Seed starting</a></li><li><a href="' + o + '/blog/irrigation">Irrigation</a></li></ul>')),
    page(o + '/about', wrap(o, 'About Seasonal Kitchen Garden', '<h1>About</h1><p>Seasonal Kitchen Garden is independently published by Jordan Blake, a horticulture educator. The project exists to share original field notes, not affiliate roundups. Contact the newsroom from the contact page. We do not sell personal data.</p><p>The editorial desk is in Portland. Every article is outlined, drafted and fact-checked by a human editor before it is published with a visible date.</p>')),
    page(o + '/contact', wrap(o, 'Contact', '<h1>Contact</h1><p>Email editor@quality-blog.test or use the form below. Phone +1 503 555 0199. We reply within two business days.</p><form><input type="email" name="email"><textarea name="message"></textarea><button>Send</button></form>')),
    page(o + '/privacy-policy', wrap(o, 'Privacy Policy', '<h1>Privacy Policy</h1><p>We collect personal information such as email addresses when you submit the contact form. Cookies are used only for analytics. We do not sell personal data to third parties. You may opt-out by emailing privacy@quality-blog.test. The legal basis for processing is legitimate interest and consent. Data is retained for 24 months. Our data controller is Seasonal Kitchen Garden.</p><p>This policy explains how user data is collected, used, and shared, including analytics cookies and hosting subprocessors. Visitors can request deletion of personal data at any time.</p>')),
    page(o + '/terms', wrap(o, 'Terms', '<h1>Terms of Use</h1><p>Content is original unless otherwise credited. Do not scrape the archives. Governing law is Oregon.</p>')),
    page(o + '/blog/tomato-pruning', wrap(o, 'Tomato pruning methods compared', articleBody('Tomato pruning methods compared', 1))),
    page(o + '/blog/compost-ratios', wrap(o, 'Compost carbon to nitrogen ratios', articleBody('Compost carbon to nitrogen ratios', 2))),
    page(o + '/blog/seed-starting', wrap(o, 'Seed starting under lights', articleBody('Seed starting under lights', 3))),
    page(o + '/blog/irrigation', wrap(o, 'Drip irrigation for raised beds', articleBody('Drip irrigation for raised beds', 4)))
  ];
  return scan(o, pages);
}

function thinSite() {
  const o = 'https://thin-farm.test';
  const pages = [page(o + '/', wrap(o, 'Tips', '<h1>Tips</h1><p>Welcome.</p>'))];
  for (let i = 1; i <= 12; i++) {
    pages.push(page(o + '/p/' + i, wrap(o, 'Tip ' + i, '<h1>Tip ' + i + '</h1><p>Buy now. Best tip. Buy now. Best tip. Buy now.</p><p>Click here.</p>')));
  }
  return scan(o, pages);
}

function toolSite() {
  const o = 'https://unit-tools.test';
  const pages = [
    page(o + '/', wrap(o, 'Unit Converter', '<h1>Unit Converter</h1><p>Convert length, mass and temperature. This is a utility, not a magazine.</p><form><input id="n"><button>Convert</button></form><p><a href="' + o + '/length">Length</a> <a href="' + o + '/privacy-policy">Privacy</a></p>')),
    page(o + '/length', wrap(o, 'Length converter', '<h1>Length converter</h1><p>Metres to feet.</p><form><input><button>Go</button></form>')),
    page(o + '/privacy-policy', wrap(o, 'Privacy Policy', '<h1>Privacy Policy</h1><p>We collect personal information from the contact form only. Cookies are optional. We do not share data with third parties except hosting. You may opt-out any time. Legal basis is consent. Data controller: Unit Tools.</p>')),
    page(o + '/contact', wrap(o, 'Contact', '<h1>Contact</h1><p>Email hello@unit-tools.test</p><form><input type="email" name="email"><button>Send</button></form>'))
  ];
  return scan(o, pages);
}

function saasSite() {
  const o = 'https://flowboard-saas.test';
  return scan(o, [
    page(o + '/', wrap(o, 'Flowboard, project software', '<h1>Flowboard</h1><p>SaaS project tracking with a free trial. Sign up, see pricing, invite your team.</p><p><a href="' + o + '/pricing">Pricing</a></p>')),
    page(o + '/pricing', wrap(o, 'Pricing', '<h1>Pricing</h1><p>Free trial then twelve dollars monthly. Sign up today. Platform software for teams.</p>')),
    page(o + '/about', wrap(o, 'About Flowboard', '<h1>About</h1><p>Flowboard LLC builds software for operations teams. We are a product company, not a blog network.</p>')),
    page(o + '/privacy-policy', wrap(o, 'Privacy Policy', '<h1>Privacy Policy</h1><p>We collect personal information to operate accounts. Cookies authenticate sessions. We share data with subprocessors listed here. GDPR and CCPA rights include access and deletion. Legal basis is contract. Data controller: Flowboard LLC.</p>')),
    page(o + '/contact', wrap(o, 'Contact', '<h1>Contact</h1><p>Email support@flowboard-saas.test</p><form><input type="email"><textarea></textarea><button>Send</button></form>'))
  ]);
}

function ecommerceNoBlog() {
  const o = 'https://shop-only.test';
  return scan(o, [
    page(o + '/', wrap(o, 'Shop', '<h1>Store</h1><p>Add to cart. Checkout. Shopify products.</p><a href="' + o + '/product/hat">Hat</a>')),
    page(o + '/product/hat', wrap(o, 'Hat, buy', '<h1>Canvas hat</h1><p>Add to cart. Price $24. SKU HAT-1. Checkout with Shopify.</p><button>Add to cart</button>')),
    page(o + '/product/mug', wrap(o, 'Mug, buy', '<h1>Mug</h1><p>Add to cart. Price $12. SKU MUG-1. Checkout.</p><button>Add to cart</button>')),
    page(o + '/cart', wrap(o, 'Cart', '<h1>Cart</h1><p>Checkout now. Add to cart complete.</p>'))
  ]);
}

function directorySite() {
  const o = 'https://dirs.test';
  return scan(o, [
    page(o + '/', wrap(o, 'Site directory', '<h1>Directory</h1><p>Submit your site. Browse listings and categories.</p>')),
    page(o + '/listings/alpha', wrap(o, 'Listing Alpha', '<h1>Alpha Co</h1><p>A directory listing with a short blurb and outbound link.</p>')),
    page(o + '/listings/beta', wrap(o, 'Listing Beta', '<h1>Beta Co</h1><p>Another listing in the same directory category.</p>'))
  ]);
}

function businessSite() {
  const o = 'https://consult-llc.test';
  return scan(o, [
    page(o + '/', wrap(o, 'Northwind Consulting LLC', '<h1>Enterprise consulting</h1><p>Services and solutions for enterprise clients. Contact our LLC office.</p>')),
    page(o + '/services', wrap(o, 'Services', '<h1>Services</h1><p>Strategy workshops for enterprise teams. Solutions consulting.</p>')),
    page(o + '/contact', wrap(o, 'Contact', '<h1>Contact</h1><p>Email office@consult-llc.test</p>'))
  ]);
}

function missingTrust() {
  const o = 'https://no-trust.test';
  const innerBlog = articleBody('Hidden history of tram lines', 9);
  return scan(o, [
    page(o + '/', '<!doctype html><html lang="en"><head><title>Trams</title></head><body><h1>Trams</h1><p>Hello</p><a href="' + o + '/a1">One</a></body></html>'),
    page(o + '/a1', '<!doctype html><html lang="en"><head><title>Tram article</title></head><body>' + innerBlog + '</body></html>')
  ]);
}

function duplicateSite() {
  const o = 'https://dupes.test';
  const clone = articleBody('Best bagel recipe variation', 5);
  const pages = [
    page(o + '/', wrap(o, 'Bagel clones', '<h1>Bagels</h1><p>Many nearly identical posts.</p>')),
    page(o + '/privacy-policy', wrap(o, 'Privacy Policy', '<h1>Privacy Policy</h1><p>We collect personal information, use cookies, and do not share data with third parties. Opt-out available. Legal basis is consent. Data controller Bagel Media.</p>'))
  ];
  for (let i = 1; i <= 6; i++) {
    pages.push(page(o + '/bagel-' + i, wrap(o, 'Best bagel recipe variation', clone)));
  }
  return scan(o, pages);
}

function manyThin() {
  const o = 'https://thin-library.test';
  const pages = [page(o + '/', wrap(o, 'Library', '<h1>Library</h1><p>Posts</p>'))];
  for (let i = 1; i <= 10; i++) {
    pages.push(page(o + '/post/' + i, wrap(o, 'Post ' + i, '<article><h1>Post ' + i + '</h1><p>Short note number ' + i + '.</p></article>')));
  }
  return scan(o, pages);
}

function techErrors() {
  const o = 'https://broken.test';
  return scan(o, [
    page(o + '/', wrap(o, 'Broken', '<h1>Home</h1><p>We are currently offline often.</p>', '<meta name="robots" content="noindex">')),
    { url: o + '/gone', finalUrl: o + '/gone', status: 500, depth: 1, html: '', error: 'HTTP 500', errorCode: 'status', headers: {}, parse: null }
  ]);
}

function heavyAds() {
  const o = 'https://ad-heavy.test';
  const ad = '<script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script><ins class="adsbygoogle" data-ad-client="ca-pub-1"></ins>';
  return scan(o, [
    page(o + '/', wrap(o, 'Deals', '<h1>Deals</h1><p>Few words.</p>' + ad + ad + ad + ad)),
    page(o + '/p/1', wrap(o, 'Deal 1', '<h1>Deal</h1><p>Buy.</p>' + ad + ad + ad))
  ]);
}

function policyRisk() {
  const o = 'https://risk.test';
  const body = '<h1>Online casino sports betting</h1><p>Play poker for real money at our online casino. No deposit bonus if you bet now. Gambling site with roulette, wager and jackpot odds. Bookmaker sports betting every night.</p><p>Slots real money tables stay open.</p>';
  return scan(o, [page(o + '/', wrap(o, 'Online casino sports betting', body))]);
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

function isolatedKeyword() {
  const o = 'https://safe-sex-ed.test';
  const inner = articleBody('Public health education on reproductive anatomy', 7) + '<p>The word sex appears once in a clinical heading about public health.</p>';
  return scan(o, [
    page(o + '/', wrap(o, 'Health education', '<h1>Health education</h1>' + inner)),
    page(o + '/privacy-policy', wrap(o, 'Privacy Policy', '<h1>Privacy Policy</h1><p>We collect personal information and use cookies. Third parties are listed. Opt-out by email. Legal basis consent. Data controller Health Ed.</p>')),
    page(o + '/contact', wrap(o, 'Contact', '<h1>Contact</h1><p>Email info@safe-sex-ed.test</p>'))
  ]);
}

function runOne(name, factory) {
  const report = analyzeParsed(factory(), { onProgress: function () {} });
  return { name, total: report.score.total, verdict: report.verdict.label, conf: report.score.confidence, report };
}

function main() {
  let failed = 0;
  function check(cond, msg) {
    if (!cond) { failed++; console.error('FAIL:', msg); }
    else console.log('ok  ', msg);
  }

  try { assertPublicUrl('http://127.0.0.1/'); check(false, 'ssrf localhost'); }
  catch (e) { check(e.code === 'ssrf' || e.code === 'invalid_url', 'ssrf localhost blocked (' + e.code + ')'); }
  try { assertPublicUrl('http://169.254.169.254/latest'); check(false, 'ssrf metadata'); }
  catch (e) { check(!!e.code, 'ssrf metadata blocked'); }
  try { assertPublicUrl('http://localhost/admin'); check(false, 'ssrf localhost host'); }
  catch (e) { check(!!e.code, 'ssrf localhost host blocked'); }

  const cases = [
    ['quality-blog', qualityBlog],
    ['thin-content', thinSite],
    ['tools', toolSite],
    ['saas', saasSite],
    ['ecommerce', ecommerceNoBlog],
    ['directory', directorySite],
    ['business', businessSite],
    ['missing-trust', missingTrust],
    ['duplicates', duplicateSite],
    ['many-thin', manyThin],
    ['tech-errors', techErrors],
    ['heavy-ads', heavyAds],
    ['policy-risk', policyRisk],
    ['robots-blocked', robotsBlocked],
    ['cloudflare', cloudflareSite],
    ['js-heavy', jsHeavy],
    ['isolated-keyword', isolatedKeyword]
  ];

  const results = {};
  cases.forEach(function (c) {
    try {
      results[c[0]] = runOne(c[0], c[1]);
      console.log(c[0], results[c[0]].total, results[c[0]].verdict, 'conf=' + results[c[0]].conf);
    } catch (e) {
      results[c[0]] = { name: c[0], error: e.message, code: e.code, total: null };
      console.log(c[0], 'ERROR', e.code, e.message);
    }
  });

  const q = results['quality-blog'];
  const thin = results['thin-content'];
  const dup = results['duplicates'];
  const miss = results['missing-trust'];
  const pol = results['policy-risk'];
  const ecom = results['ecommerce'];
  const tools = results['tools'];
  const robots = results['robots-blocked'];
  const iso = results['isolated-keyword'];

  check(q && q.total != null, 'quality blog produced a score');
  check(thin && thin.total != null && q.total > thin.total, 'quality blog scores higher than thin site (' + (q && q.total) + ' > ' + (thin && thin.total) + ')');
  check(dup && dup.total != null && q.total > dup.total, 'quality blog scores higher than duplicate site');
  check(miss && miss.total != null && q.total > miss.total, 'quality blog scores higher than missing-trust site');
  check(pol && pol.total != null && q.total > pol.total, 'quality blog scores higher than policy-risk site');
  check(ecom && ecom.report && ecom.report.findings.some(f => f.id === 'EZ-SITE-TYPE' && f.status !== 'passed'), 'ecommerce without informational content is flagged');
  check(tools && tools.report && !tools.report.findings.some(f => f.id === 'EZ-ORIGINAL-CONTENT' && f.page !== 'Site' && f.status === 'high' && /length converter/i.test(f.page + f.evidence)), 'tool pages are not treated as thin articles');
  check(robots && robots.report && robots.report.findings.some(f => f.id === 'TECH_ROBOTS_BLOCK'), 'robots.txt Disallow:/ is reported');
  check(iso && iso.report && !iso.report.findings.some(f => f.policyCat === 'adult' && f.status === 'high'), 'isolated clinical keyword does not create a high adult finding');

  const totals = Object.keys(results).map(k => results[k].total).filter(n => n != null);
  const unique = new Set(totals);
  check(unique.size >= 5, 'scores vary across fixtures (unique=' + unique.size + ')');
  check(q.total !== thin.total, 'quality and thin scores are not identical');

  if (q && q.report) {
    check(q.report.manuals && q.report.manuals.some(m => m.id === 'EZ-TRAFFIC-MAU'), 'traffic requirement is manual');
    check(q.report.findings.some(f => f.id === 'EZ-PRIVACY-PAGE' && f.status === 'passed'), 'quality blog privacy passed');
  }

  if (failed) {
    console.error('\n' + failed + ' check(s) failed');
    process.exit(1);
  }
  console.log('\nAll self-checks passed.');
}

main();
