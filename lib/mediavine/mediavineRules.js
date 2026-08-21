'use strict';

/**
 * mediavineRules — Mediavine-specific rule registry.
 *
 * Kept entirely separate from adsenseRules and ezoicRules.
 *
 * sourceType classification (never mixed):
 *   official        — explicitly stated by Mediavine (official requirement)
 *   quality_signal  — consistent with Mediavine's published review criteria but not an explicit pass/fail requirement
 *   heuristic       — our own measurable estimate that may help identify potential weaknesses
 *
 * automated false → evaluate() must return status 'manual' (Unable to verify automatically).
 *
 * The official source always takes priority over third-party SEO advice. Requirements change,
 * so nothing here is hard-coded into the analyzers: edit this registry / PROGRAM_CONFIG to update.
 */

const U = require('./util');

const VERIFIED = '2026-08-21';
const EFFECTIVE = '2026-01-15'; // Mediavine's 2026 program-structure change came into effect 15 Jan 2026.

/* ------------------------------------------------------------------ *
 *  Centralized source / program configuration (single source of truth)
 * ------------------------------------------------------------------ */
const SRC = {
  approve: {
    url: 'https://help.mediavine.com/what-does-it-take-to-get-approved-by-mediavine',
    title: 'What does it take to get approved by Mediavine?'
  },
  official: {
    url: 'https://help.mediavine.com/mediavine-official',
    title: 'Mediavine Official'
  },
  brandSafety: {
    url: 'https://help.mediavine.com/troubleshoot-missing-ads',
    title: 'Mediavine Help Center — Brand Safety'
  },
  mediavineCom: {
    url: 'https://www.mediavine.com/',
    title: 'Mediavine — Official Site'
  }
};

const PROGRAM_CONFIG = {
  official: {
    key: 'official',
    name: 'Mediavine Official',
    revenueThresholdUsd: 5000,          // $5,000+ annual ad revenue
    revenuePeriod: 'annual',
    sessionThreshold: null,              // no official session minimum (replaced the old 50k)
    revenueShare: '75%',
    onRamp: false,
    automatedVerification: false,        // revenue is private — cannot be verified from a URL
    sourceUrl: SRC.official.url,
    sourceTitle: SRC.official.title,
    lastVerified: VERIFIED,
    effectiveDate: EFFECTIVE,
    note: 'Current 2026 program. The old 50,000-session requirement no longer applies for new applicants. Eligibility is revenue-based.'
  },
  journey: {
    key: 'journey',
    name: 'Journey by Mediavine',
    revenueThresholdUsd: null,           // no revenue minimum to apply
    sessionThreshold: 1000,              // 1,000+ sessions
    sessionPeriod: 'monthly',
    revenueShare: '70%',
    onRamp: true,
    requiresGrow: true,                  // Grow plugin installation + 30-day evaluation
    automatedVerification: false,        // sessions are private
    sourceUrl: SRC.approve.url,
    sourceTitle: SRC.approve.title,
    lastVerified: VERIFIED,
    effectiveDate: EFFECTIVE,
    note: 'On-ramp program for growing sites. Requires the Grow plugin and ≥1,000 sessions/month. Automatically upgrades to Official at $5,000 annual ad revenue.'
  }
};

/* ------------------------------------------------------------------ *
 *  Registry
 * ------------------------------------------------------------------ */
const REGISTRY = [];
const BY_ID = {};

function register(rule) {
  if (!rule.id) throw new Error('Rule requires id');
  REGISTRY.push(rule);
  BY_ID[rule.id] = rule;
  return rule;
}

function finding(rule, page, status, evidence, extra) {
  extra = extra || {};
  const f = {
    id: rule.id,
    category: rule.category,
    name: rule.name,
    requirement: rule.requirement,
    program: rule.program || 'both',
    status,
    severity: extra.severity || rule.severity || status,
    page: page || 'Site',
    urls: extra.urls || (page && page !== 'Site' ? [page] : []),
    evidence,
    why: extra.why || rule.why || '',
    fix: extra.fix || rule.fix || '',
    confidence: Math.round((extra.confidence == null ? 0.8 : extra.confidence) * 100),
    sourceType: rule.sourceType,
    sourceUrl: rule.officialSource,
    sourceTitle: rule.sourceTitle,
    lastVerified: rule.lastVerified,
    effectiveDate: rule.effectiveDate || EFFECTIVE,
    detectionMethod: rule.detectionMethod,
    automated: !!rule.automated,
    weight: rule.weight || 3,
    affected: extra.affected,
    sharedText: extra.sharedText,
    tier: extra.tier,
    brandCat: extra.brandCat,
    confidenceLevel: extra.confidenceLevel,
    trafficHalf: extra.trafficHalf
  };
  return f;
}

function manualFinding(rule, note, extra) {
  extra = extra || {};
  return finding(rule, 'Site', 'manual', note || 'Unable to verify automatically.', {
    confidence: 1,
    why: rule.why,
    fix: rule.fix,
    severity: 'info',
    confidenceLevel: extra.confidenceLevel
  });
}

function base(over) {
  return Object.assign({
    officialSource: SRC.approve.url,
    sourceTitle: SRC.approve.title,
    lastVerified: VERIFIED,
    effectiveDate: EFFECTIVE,
    detectionMethod: '',
    automated: true,
    severity: 'medium',
    weight: 3,
    why: '',
    fix: ''
  }, over || {});
}

/* ============================================================ *
 *  OFFICIAL REQUIREMENTS — Mediavine Official program
 * ============================================================ */

register(base({
  id: 'MV-OFFICIAL-REVENUE',
  name: 'Annual ad revenue',
  category: 'requirement',
  program: 'official',
  sourceType: 'official',
  officialSource: SRC.official.url,
  sourceTitle: SRC.official.title,
  requirement: 'Mediavine Official requires a minimum of $5,000 in annual ad revenue. This replaced the former 50,000-session requirement. Revenue is verified during application.',
  detectionMethod: 'Ad revenue is private account data. A public URL crawl cannot read it.',
  automated: false,
  severity: 'info',
  weight: 0,
  why: 'This is the primary documented gate for the Official program as of 2026.',
  fix: 'Confirm your trailing 12-month ad revenue (e.g. Google AdSense/Ad Manager earnings) is at least $5,000 before applying to Official. Not there yet? Start with Journey and upgrade on auto-upgrade.'
}));

register(base({
  id: 'MV-OFFICIAL-ADSENSE-STANDING',
  name: 'Google AdSense / Ad Exchange standing',
  category: 'requirement',
  program: 'official',
  sourceType: 'official',
  officialSource: SRC.official.url,
  sourceTitle: SRC.official.title,
  requirement: 'You do not need to have previously worked with AdSense, but you cannot have an AdSense ban in place. The site must be in good standing with Google AdSense/Ad Exchange (no active policy violations or account issues).',
  detectionMethod: 'Google account status is private and cannot be inferred from a website.',
  automated: false,
  severity: 'info',
  weight: 0,
  why: 'An existing AdSense ban or policy issue blocks approval.',
  fix: 'Resolve any Google ads policy issues. Do not apply with a banned or penalized AdSense/Ad Manager account.'
}));

register(base({
  id: 'MV-OFFICIAL-ORIGINAL-CONTENT',
  name: 'Original, quality, evergreen content',
  category: 'content',
  program: 'official',
  sourceType: 'official',
  officialSource: SRC.official.url,
  sourceTitle: SRC.official.title,
  requirement: 'Mediavine Official is for publishers who create original, quality, and evergreen content (audience-first, not built for search engines or ad revenue alone).',
  detectionMethod: 'Deterministic content audit: unique words after boilerplate removal, thin/empty ratios, duplicates, near-duplicates, originality signals.',
  automated: true,
  severity: 'high',
  weight: 6,
  why: 'Original, audience-first content is an explicitly stated requirement for Official.',
  fix: 'Improve thin, duplicate, or search-first pages. Provide unique value on the majority of content pages.'
}));

/* ============================================================ *
 *  OFFICIAL REQUIREMENTS — both programs (quality criteria)
 * ============================================================ */

register(base({
  id: 'MV-APPROVE-TRAFFIC',
  name: 'Clean, human, brand-safe traffic',
  category: 'traffic',
  sourceType: 'official',
  officialSource: SRC.approve.url,
  sourceTitle: SRC.approve.title,
  requirement: 'Mediavine requires clean, human, brand-safe traffic — real visitors, not bots, incentivized clicks, or traffic from sources that put advertisers at risk.',
  detectionMethod: 'Sessions, source distribution and human-vs-bot share are private. Only obvious public signals (bot-like URLs, incentivized-traffic language, tracking) are observable.',
  automated: false,
  severity: 'info',
  weight: 0,
  why: 'Traffic authenticity is a documented review criterion but cannot be measured from a public URL.',
  fix: 'Verify sessions and traffic sources in GA4. Avoid purchased/artificial traffic and incentivized clicks.'
}));

register(base({
  id: 'MV-APPROVE-AUDIENCE-FIRST',
  name: 'Original, audience-first content',
  category: 'content',
  sourceType: 'official',
  officialSource: SRC.approve.url,
  sourceTitle: SRC.approve.title,
  requirement: 'Content built for real users, not just search engines or ad revenue.',
  detectionMethod: 'Audience-first signal analysis: heading structure, keyword repetition, exact-match density, boilerplate, search-intent mismatch. Labeled as a potential pattern, never a definitive Google classification.',
  automated: true,
  severity: 'high',
  weight: 6,
  why: 'Audience-first content is the single most emphasized criterion in Mediavine\u2019s review guidance.',
  fix: 'Write for readers first. Reduce keyword-stuffing, generic intros, and repetitive templates.'
}));

register(base({
  id: 'MV-APPROVE-ADSENSE-STANDING',
  name: 'Good standing with Google AdSense / Ad Exchange',
  category: 'requirement',
  sourceType: 'official',
  officialSource: SRC.approve.url,
  sourceTitle: SRC.approve.title,
  requirement: 'No active policy violations or account issues with Google.',
  detectionMethod: 'Account standing is private and cannot be verified from public HTML.',
  automated: false,
  severity: 'info',
  weight: 0,
  why: 'Google account standing is a documented review factor.',
  fix: 'Keep Google accounts in good standing. Manual verification required.'
}));

register(base({
  id: 'MV-APPROVE-READER-EXPERIENCE',
  name: 'Reader experience that supports premium ads',
  category: 'ux',
  sourceType: 'official',
  officialSource: SRC.approve.url,
  sourceTitle: SRC.approve.title,
  requirement: 'Site design and UX that gives ads room to perform without disrupting the reader.',
  detectionMethod: 'Deep UX audit: viewport, navigation, overlays, popups, autoplay, sticky elements, broken layouts, horizontal overflow, content obstruction, ad density.',
  automated: true,
  severity: 'high',
  weight: 6,
  why: 'Mediavine explicitly evaluates reader experience and premium-ad compatibility.',
  fix: 'Remove intrusive overlays, auto-play media, and layouts that crowd content.'
}));

register(base({
  id: 'MV-APPROVE-TRAFFIC-COUNTRIES',
  name: 'Traffic countries of origin',
  category: 'traffic',
  sourceType: 'official',
  officialSource: SRC.approve.url,
  sourceTitle: SRC.approve.title,
  requirement: 'Mediavine evaluates traffic countries of origin (premium traffic from some countries monetizes at higher rates).',
  detectionMethod: 'Country distribution is private analytics data. Cannot be read from public pages.',
  automated: false,
  severity: 'info',
  weight: 0,
  why: 'Traffic geography is a documented review data point.',
  fix: 'Review your GA4 country breakdown. Manual verification required.'
}));

register(base({
  id: 'MV-APPROVE-TRAFFIC-SOURCES',
  name: 'Traffic sources',
  category: 'traffic',
  sourceType: 'official',
  officialSource: SRC.approve.url,
  sourceTitle: SRC.approve.title,
  requirement: 'Mediavine evaluates traffic sources (looks for sustainable, organic growth rather than spikes from a single paid or social source).',
  detectionMethod: 'Traffic source distribution is private. Not observable from a public crawl.',
  automated: false,
  severity: 'info',
  weight: 0,
  why: 'Traffic-source mix is a documented review data point.',
  fix: 'Diversify and verify organic, direct, email and legitimate social traffic in GA4.'
}));

register(base({
  id: 'MV-APPROVE-DEMOGRAPHICS',
  name: 'Reader demographics',
  category: 'traffic',
  sourceType: 'official',
  officialSource: SRC.approve.url,
  sourceTitle: SRC.approve.title,
  requirement: 'Mediavine evaluates reader demographics.',
  detectionMethod: 'Demographics are private analytics data. Cannot be read from public pages.',
  automated: false,
  severity: 'info',
  weight: 0,
  why: 'Audience demographics are a documented review data point.',
  fix: 'Review audience demographics in GA4. Manual verification required.'
}));

/* ============================================================ *
 *  OFFICIAL REQUIREMENTS — Journey program
 * ============================================================ */

register(base({
  id: 'MV-JOURNEY-SESSIONS',
  name: 'Sessions (≥1,000 / month)',
  category: 'requirement',
  program: 'journey',
  sourceType: 'official',
  officialSource: SRC.approve.url,
  sourceTitle: SRC.approve.title,
  requirement: 'To start with Journey by Mediavine, sites need over 1,000 sessions (verified through Google Analytics / the Grow plugin).',
  detectionMethod: 'Session counts are private analytics data. A public URL crawl cannot read them.',
  automated: false,
  severity: 'info',
  weight: 0,
  why: 'This is the current documented entry point for Journey (1,000+ sessions).',
  fix: 'Confirm ≥1,000 monthly sessions in GA4. Install the Grow plugin (30-day evaluation) before applying.'
}));

register(base({
  id: 'MV-JOURNEY-GROW',
  name: 'Grow plugin (Journey)',
  category: 'requirement',
  program: 'journey',
  sourceType: 'official',
  officialSource: SRC.approve.url,
  sourceTitle: SRC.approve.title,
  requirement: 'Journey traffic is tracked through the Grow by Mediavine plugin, which must be installed and run for a 30-day evaluation period.',
  detectionMethod: 'Grow is added by the publisher after joining. Its presence is not a pre-application public check.',
  automated: false,
  severity: 'info',
  weight: 0,
  why: 'Grow is the mechanism Mediavine uses to verify Journey traffic and engagement.',
  fix: 'Install Grow by Mediavine and run it for 30 days before applying to Journey.'
}));

/* ============================================================ *
 *  STRONG QUALITY SIGNALS (consistent with review criteria)
 * ============================================================ */

register(base({
  id: 'MV-Q-BRAND-SAFETY',
  name: 'Brand-safe content',
  category: 'brand',
  sourceType: 'quality_signal',
  officialSource: SRC.brandSafety.url,
  sourceTitle: SRC.brandSafety.title,
  requirement: 'Mediavine adheres to strict brand safety standards. Advertisers spend only on brand-safe content; flagged categories include violence, weapons, nudity, hacking and illegal activity.',
  detectionMethod: 'Contextual brand-safety scanner with low/medium/high confidence. Single isolated keywords never create a high finding.',
  automated: true,
  severity: 'high',
  weight: 7,
  why: 'Brand safety is a documented part of Mediavine\u2019s ad-policy review.',
  fix: 'Remove or wall off material that advertisers routinely avoid.'
}));

register(base({
  id: 'MV-Q-ADSENSE-POLICY',
  name: 'Google ad-policy compliance',
  category: 'brand',
  sourceType: 'quality_signal',
  officialSource: SRC.brandSafety.url,
  sourceTitle: SRC.brandSafety.title,
  requirement: 'Content that violates Google\u2019s stated ad policies triggers blocked ad spend on Mediavine and can penalize the whole site.',
  detectionMethod: 'Contextual scan of prohibited/restricted categories. Public screen only.',
  automated: true,
  severity: 'high',
  weight: 6,
  why: 'Ad-policy violations restrict ad spend and harm site-wide RPM.',
  fix: 'Review each high-risk page against Google\u2019s ad policies and Mediavine\u2019s brand-safety guidance.'
}));

register(base({
  id: 'MV-Q-PRIVACY',
  name: 'Privacy / transparency pages',
  category: 'trust',
  sourceType: 'quality_signal',
  officialSource: SRC.approve.url,
  sourceTitle: SRC.approve.title,
  requirement: 'Trust pages (About, Contact, Privacy, Terms, Disclaimer, Cookie, Editorial) support the legitimacy and reader-experience reviews Mediavine performs.',
  detectionMethod: 'Detects trust pages from URL, title, H1, nav, footer, and checks substance, accessibility, navigation visibility, links and placeholders.',
  automated: true,
  severity: 'medium',
  weight: 4,
  why: 'Trust and transparency support the overall site review; they are quality signals, not a standalone gate.',
  fix: 'Publish genuine, site-specific trust pages and link them in the footer.'
}));

register(base({
  id: 'MV-Q-CONTACT',
  name: 'Genuine contact information',
  category: 'trust',
  sourceType: 'quality_signal',
  officialSource: SRC.approve.url,
  sourceTitle: SRC.approve.title,
  requirement: 'A contact page with a functional email, phone, or form establishes legitimacy.',
  detectionMethod: 'Looks for a contact page plus email, phone, or form in crawled HTML.',
  automated: true,
  severity: 'medium',
  weight: 3,
  why: 'Contact information supports publisher legitimacy.',
  fix: 'Add a contact page with a working email or form and link it site-wide.'
}));

register(base({
  id: 'MV-Q-AUTHOR-TRANSPARENCY',
  name: 'Author & publisher transparency',
  category: 'trust',
  sourceType: 'quality_signal',
  officialSource: SRC.approve.url,
  sourceTitle: SRC.approve.title,
  requirement: 'Author names, author pages, bios, publication dates, updated dates, publisher info, and references support editorial transparency.',
  detectionMethod: 'Extracts author meta/byline, published/modified dates, references, sources, and author pages. Treated as a quality signal, not a universal mandatory requirement.',
  automated: true,
  severity: 'low',
  weight: 2,
  why: 'Editorial transparency supports the audience-first content assessment.',
  fix: 'Add real bylines, dates, and references where relevant.'
}));

/* ============================================================ *
 *  HEURISTICS (our own measurable estimates)
 * ============================================================ */

register(base({
  id: 'MV-H-CONTENT-DEPTH',
  name: 'Content depth & originality',
  category: 'content',
  sourceType: 'heuristic',
  requirement: 'Unique body-text words after removing repeated navigation/footer vocabulary, paragraph and heading structure, sentence variety, readability.',
  detectionMethod: 'Deterministic text analysis. Word count is never used alone.',
  automated: true,
  severity: 'medium',
  weight: 4,
  why: 'Heuristic estimate of content quality for the original-content assessment.',
  fix: 'Add original, in-depth, well-structured body copy.'
}));

register(base({
  id: 'MV-H-DUPLICATES',
  name: 'Duplicate / near-duplicate content',
  category: 'content',
  sourceType: 'heuristic',
  requirement: 'A website with many near-duplicate or thin pages holds far less content value than a site where most pages provide original value.',
  detectionMethod: 'Sentence fingerprints, n-grams, Jaccard similarity, TF-IDF cosine similarity, and SimHash across content pages.',
  automated: true,
  severity: 'high',
  weight: 5,
  why: 'Duplicate and near-duplicate libraries weaken the content portfolio assessment.',
  fix: 'Merge or rewrite near-duplicate and template pages.'
}));

register(base({
  id: 'MV-H-CONTENT-PORTFOLIO',
  name: 'Content portfolio balance',
  category: 'content',
  sourceType: 'heuristic',
  requirement: 'Measure the whole site: useful vs thin vs duplicate vs empty content, content clusters, average depth, and share of unique content.',
  detectionMethod: 'Aggregates per-page content metrics into a portfolio inventory.',
  automated: true,
  severity: 'medium',
  weight: 4,
  why: 'A URL audit must weight site-wide content quality, not just a few pages.',
  fix: 'Raise the share of genuinely useful, original pages on the site.'
}));

register(base({
  id: 'MV-H-AD-DENSITY',
  name: 'Ad density & layout',
  category: 'advertising',
  sourceType: 'heuristic',
  requirement: 'Existing ads are not automatically a problem. Ad-heavy thin pages and excessive placements hurt reader experience and ad performance.',
  detectionMethod: 'Detects ad scripts, iframes, slots, containers, networks, in-content ads, sticky/interstitial signals, and content-to-ad ratio.',
  automated: true,
  severity: 'low',
  weight: 2,
  why: 'Heuristic. Mediavine emphasizes reader experience and ad-policy quality rather than simply fewer ads.',
  fix: 'Keep ads from crowding content and maintain a clean content-to-ad ratio.'
}));

register(base({
  id: 'MV-H-TECH',
  name: 'Technical quality',
  category: 'tech',
  sourceType: 'heuristic',
  requirement: 'HTTPS, status codes, redirects/chains, canonical, robots, sitemap, noindex, hreflang, broken links/images, duplicate URLs, title, description, H1–H6, structured data, viewport.',
  detectionMethod: 'Server-header + HTML-level checks (not a Lighthouse/Core Web Vitals substitute).',
  automated: true,
  severity: 'low',
  weight: 2,
  why: 'Technical cleanliness supports crawlability and trust.',
  fix: 'Resolve the reported technical issues.'
}));

register(base({
  id: 'MV-H-PERFORMANCE',
  name: 'Performance signals',
  category: 'tech',
  sourceType: 'heuristic',
  requirement: 'TTFB, HTML size, script/style/image weight, request counts, third-party scripts, render-blocking resources, compression, cache headers, CDN indicators.',
  detectionMethod: 'Observable response headers and HTML metrics. Browser Core Web Vitals are shown separately and never implied from HTML alone.',
  automated: true,
  severity: 'low',
  weight: 2,
  why: 'Heuristic. Server-side HTML analysis does not equal a Lighthouse score.',
  fix: 'Reduce page weight and blocking resources; enable compression and caching.'
}));

register(base({
  id: 'MV-H-ARCHITECTURE',
  name: 'Site architecture & internal linking',
  category: 'architecture',
  sourceType: 'heuristic',
  requirement: 'Link graph quality: orphan candidates, dead-ends, deep pages, weak links, excessively-linked pages, broken/redirecting internal links, repeated anchor text.',
  detectionMethod: 'Builds an internal link graph and measures click depth, in/out links, and anchor distribution.',
  automated: true,
  severity: 'medium',
  weight: 3,
  why: 'Good architecture improves discoverability and reader flow.',
  fix: 'Link orphan/dead-end pages, flatten deep pages, fix broken internal links.'
}));

register(base({
  id: 'MV-H-MISSING-TRUST',
  name: 'Missing trust pages',
  category: 'trust',
  sourceType: 'heuristic',
  requirement: 'Websites lacking About, Contact, Privacy, Terms, Disclaimer, Cookie, or Editorial pages are weaker on transparency.',
  detectionMethod: 'Detects which trust pages exist and are substantive.',
  automated: true,
  severity: 'low',
  weight: 2,
  why: 'Heuristic. A quality signal for the trust/transparency assessment.',
  fix: 'Add the missing trust pages.'
}));

register(base({
  id: 'MV-H-BOT-LIKE',
  name: 'Bot-like URL patterns',
  category: 'traffic',
  sourceType: 'heuristic',
  requirement: 'URLs matching bot-traffic / traffic-exchange patterns indicate artificial traffic, which Mediavine explicitly excludes.',
  detectionMethod: 'Regex scan of crawled URLs for traffic-exchange and bot-traffic patterns.',
  automated: true,
  severity: 'high',
  weight: 5,
  why: 'Heuristic. Directly relevant to Mediavine\u2019s clean, human-traffic requirement.',
  fix: 'Remove traffic-exchange and artificial-traffic pages.'
}));

register(base({
  id: 'MV-H-INCENTIVIZED',
  name: 'Incentivized traffic language',
  category: 'traffic',
  sourceType: 'heuristic',
  requirement: 'Language offering payment for clicks/visits indicates incentivized traffic, which Mediavine excludes.',
  detectionMethod: 'Regex scan of page text for paid-to-click / traffic-buying language.',
  automated: true,
  severity: 'medium',
  weight: 4,
  why: 'Heuristic. Incentivized clicks are explicitly disallowed.',
  fix: 'Remove pages that offer payment for traffic or clicks.'
}));

register(base({
  id: 'MV-H-TRAFFIC-CLAIMS',
  name: 'Public traffic claims',
  category: 'traffic',
  sourceType: 'heuristic',
  requirement: 'Self-reported visitor counts on the site are unverified and are not proof of eligibility.',
  detectionMethod: 'Scans page text for self-reported traffic/size claims.',
  automated: true,
  severity: 'info',
  weight: 0,
  why: 'Heuristic. Public claims do not substitute for verified analytics.',
  fix: 'Confirm numbers in GA4; public claims are informational.'
}));

register(base({
  id: 'MV-H-TRACKING',
  name: 'Analytics / tracking implementation',
  category: 'traffic',
  sourceType: 'heuristic',
  requirement: 'Presence of GA4/GTM or other analytics aids later verification of traffic.',
  detectionMethod: 'Detects Google Analytics, GTM, and other analytics scripts in HTML.',
  automated: true,
  severity: 'low',
  weight: 1,
  why: 'Heuristic. Analytics presence supports later manual verification.',
  fix: 'Connect an active GA4 property (required at application).'
}));

register(base({
  id: 'MV-H-TRAFFIC-GEN',
  name: 'Traffic-generation pages',
  category: 'traffic',
  sourceType: 'heuristic',
  requirement: 'Pages whose purpose is to generate or sell traffic are a strong artificial-traffic signal.',
  detectionMethod: 'Detects traffic-exchange / traffic-buying pages by URL and text.',
  automated: true,
  severity: 'high',
  weight: 5,
  why: 'Heuristic. Strongly contradicts the clean-human-traffic requirement.',
  fix: 'Remove traffic-generation pages.'
}));

register(base({
  id: 'MV-H-ADSTXT',
  name: 'ads.txt file',
  category: 'advertising',
  sourceType: 'heuristic',
  requirement: 'An ads.txt file declares authorized ad sellers. Mediavine manages ads.txt after integration.',
  detectionMethod: 'Fetches /ads.txt and checks for mediavine.com references.',
  automated: true,
  severity: 'low',
  weight: 1,
  why: 'Heuristic. Not a pre-application quality gate.',
  fix: 'Let Mediavine manage ads.txt after joining.'
}));

module.exports = {
  REGISTRY,
  BY_ID,
  SRC,
  PROGRAM_CONFIG,
  VERIFIED,
  EFFECTIVE,
  register,
  finding,
  manualFinding,
  get: id => BY_ID[id],
  all: () => REGISTRY.slice(),
  programs: () => PROGRAM_CONFIG,
  program: key => PROGRAM_CONFIG[key]
};
