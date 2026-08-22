'use strict';

/**
 * raptiveRules: Raptive-specific rule registry.
 *
 * Kept entirely separate from adsenseRules, ezoicRules, and mediavineRules.
 *
 * sourceType classification (never mixed):
 *   official        , directly stated by Raptive
 *   quality_signal  , explicitly discussed by Raptive but not a simple pass/fail gate
 *   heuristic       , a measurable signal created by this tool
 *
 * automated false → evaluate() must return status 'manual' (Manual Verification Required).
 *
 * Official documentation always takes priority over blog posts, SEO articles, or Reddit.
 * Last verified against Raptive Support:
 *   https://help.raptive.com/hc/en-us/articles/360032840891-Who-is-eligible-for-Raptive
 *   https://help.raptive.com/hc/en-us/articles/6681661647515-Applying-to-Raptive-with-Google-Analytics
 *
 * Current minimum is 25,000 monthly pageviews (Raptive lowered this from 100,000).
 */

const VERIFIED = '2026-08-21';
const EFFECTIVE = '2025-10-16';

const SRC = {
  eligible: {
    url: 'https://help.raptive.com/hc/en-us/articles/360032840891-Who-is-eligible-for-Raptive',
    title: 'Who is eligible for Raptive?'
  },
  analytics: {
    url: 'https://help.raptive.com/hc/en-us/articles/6681661647515-Applying-to-Raptive-with-Google-Analytics',
    title: 'Applying to Raptive with Google Analytics'
  },
  apply: {
    url: 'https://dashboard.raptive.com/apply/',
    title: 'Apply to Raptive'
  }
};

const KEY_COUNTRIES = ['US', 'UK', 'CA', 'AU', 'NZ'];
const KEY_COUNTRY_LABELS = {
  US: 'United States',
  UK: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  NZ: 'New Zealand'
};

const TIER_CONFIG = {
  below: {
    key: 'below',
    name: 'Below 25,000 monthly pageviews',
    minPageviews: 0,
    maxPageviews: 24999,
    keyCountryPct: null,
    longFormRequired: false,
    domainMonths: 6,
    note: 'Does not meet Raptive’s current 25,000 monthly pageview minimum.'
  },
  mid: {
    key: 'mid',
    name: '25,000–99,999 monthly pageviews',
    minPageviews: 25000,
    maxPageviews: 99999,
    keyCountryPct: 50,
    longFormRequired: true,
    domainMonths: 6,
    note: 'Raptive currently requires 50%+ traffic from US, UK, CA, AU and/or NZ; long-form content on the majority of pages; high-quality original content with meaningful human involvement; Google Analytics correctly set up; domain at least 6 months old; and a site build that makes ads easy to add, configure, and manage.'
  },
  high: {
    key: 'high',
    name: '100,000+ monthly pageviews',
    minPageviews: 100000,
    maxPageviews: null,
    keyCountryPct: 40,
    longFormRequired: false,
    domainMonths: 6,
    note: 'Traffic minimum is satisfied at this tier. Raptive currently requires 40%+ traffic from US, UK, CA, AU and/or NZ; high-quality original content with meaningful human involvement; Google Analytics correctly set up; and a domain at least 6 months old. Reaching 100,000 pageviews does not automatically mean acceptance.'
  }
};

const LONG_FORM = {
  wordThresholds: [500, 800, 1200],
  uniqueWordFloor: 160,
  paragraphFloor: 4,
  headingFloor: 2,
  majorityPct: 50
};

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
  return {
    id: rule.id,
    category: rule.category,
    name: rule.name,
    requirement: rule.requirement,
    program: rule.program || rule.tier || 'all',
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
    weight: extra.weight != null ? extra.weight : (rule.weight != null ? rule.weight : 3),
    affected: extra.affected,
    sharedText: extra.sharedText,
    tier: extra.tier,
    brandCat: extra.brandCat,
    confidenceLevel: extra.confidenceLevel,
    trafficHalf: extra.trafficHalf,
    reqStatus: extra.reqStatus
  };
}

function manualFinding(rule, note, extra) {
  extra = extra || {};
  return finding(rule, 'Site', 'manual', note || 'Manual Verification Required. Unable to verify from the public website.', {
    confidence: 1,
    why: rule.why,
    fix: rule.fix,
    severity: 'info',
    reqStatus: extra.reqStatus || 'Manual Verification'
  });
}

function base(over) {
  return Object.assign({
    officialSource: SRC.eligible.url,
    sourceTitle: SRC.eligible.title,
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
 *  OFFICIAL REQUIREMENTS
 * ============================================================ */

register(base({
  id: 'RAP-OFFICIAL-PAGEVIEWS',
  name: 'Monthly pageviews (25,000 minimum)',
  category: 'requirement',
  sourceType: 'official',
  officialSource: SRC.analytics.url,
  sourceTitle: SRC.analytics.title,
  requirement: 'A minimum of 25,000 monthly pageviews within the last 30 days. Raptive currently uses 25,000 as the general entry requirement (not the former 100,000).',
  detectionMethod: 'Monthly pageviews are private Google Analytics data. A public URL crawl cannot read them.',
  automated: false,
  severity: 'info',
  weight: 0,
  why: 'This is the primary documented traffic gate. Raptive reviews Google Analytics pageviews during application.',
  fix: 'Confirm ≥ 25,000 pageviews in the last 30 days in Google Analytics 4, then optionally enter that verified number in this tool as a user-provided value.'
}));

register(base({
  id: 'RAP-OFFICIAL-COUNTRIES-MID',
  name: 'Key-country traffic (25,000–99,999 pageviews)',
  category: 'requirement',
  sourceType: 'official',
  officialSource: SRC.analytics.url,
  sourceTitle: SRC.analytics.title,
  tier: 'mid',
  requirement: 'If monthly pageviews are 25,000–99,999, at least 50% of traffic must come from the United States, United Kingdom, Canada, Australia, and/or New Zealand.',
  detectionMethod: 'Country distribution is private analytics data. Cannot be determined from URL-only crawling.',
  automated: false,
  severity: 'info',
  weight: 0,
  why: 'Documented Raptive traffic-geography requirement for the 25,000–99,999 tier.',
  fix: 'In GA4, add United States + United Kingdom + Canada + Australia + New Zealand session/pageview share. Target 50%+ at this tier. Optionally enter those percentages here as user-provided values.'
}));

register(base({
  id: 'RAP-OFFICIAL-COUNTRIES-HIGH',
  name: 'Key-country traffic (100,000+ pageviews)',
  category: 'requirement',
  sourceType: 'official',
  officialSource: SRC.analytics.url,
  sourceTitle: SRC.analytics.title,
  tier: 'high',
  requirement: 'If monthly pageviews are 100,000 or more, at least 40% of traffic must come from the United States, United Kingdom, Canada, Australia, and/or New Zealand.',
  detectionMethod: 'Country distribution is private analytics data. Cannot be determined from URL-only crawling.',
  automated: false,
  severity: 'info',
  weight: 0,
  why: 'Documented Raptive traffic-geography requirement for the 100,000+ tier.',
  fix: 'In GA4, confirm combined US/UK/CA/AU/NZ share is 40%+. Reaching 100,000 pageviews does not automatically mean acceptance.'
}));

register(base({
  id: 'RAP-OFFICIAL-GA',
  name: 'Google Analytics correctly configured',
  category: 'requirement',
  sourceType: 'official',
  officialSource: SRC.analytics.url,
  sourceTitle: SRC.analytics.title,
  requirement: 'Google Analytics must be correctly set up. A completed application requires read-only authorization of the Google Analytics account. Currently the application requires Google Analytics 4.',
  detectionMethod: 'Public HTML can show a tracking snippet (gtag.js, GTM, Measurement ID). Tracking accuracy, property settings, and account access cannot be verified without Analytics access.',
  automated: true,
  severity: 'high',
  weight: 6,
  why: 'Raptive uses GA4 to review pageviews, sessions, countries, time on page, top posts, and traffic sources.',
  fix: 'Install GA4 correctly, confirm data is recording, and be prepared to grant read-only access at application. Detecting a snippet is not the same as a verified configuration.'
}));

register(base({
  id: 'RAP-OFFICIAL-DOMAIN-AGE',
  name: 'Domain age (at least 6 months)',
  category: 'requirement',
  sourceType: 'official',
  officialSource: SRC.eligible.url,
  sourceTitle: SRC.eligible.title,
  requirement: 'Domain is at least 6 months old (listed for both the 25,000–99,999 and 100,000+ tiers).',
  detectionMethod: 'RDAP/WHOIS registration date where the registry publishes it. If lookup fails: Unable to Verify, dates are never invented.',
  automated: true,
  severity: 'high',
  weight: 5,
  why: 'Documented Raptive eligibility item.',
  fix: 'If the domain is younger than six months, wait until it is at least six months old before applying.'
}));

register(base({
  id: 'RAP-OFFICIAL-LONGFORM',
  name: 'Long-form content on the majority of pages',
  category: 'content',
  sourceType: 'official',
  officialSource: SRC.eligible.url,
  sourceTitle: SRC.eligible.title,
  tier: 'mid',
  requirement: 'For sites with 25,000–99,999 pageviews, Raptive lists long-form content on the majority of pages. Legal, login, contact, about, search, and other utility pages are excluded from this majority calculation.',
  detectionMethod: 'Word count, unique words after boilerplate removal, paragraphs, headings, and content-to-template ratio. No single word-count threshold is treated as proof.',
  automated: true,
  severity: 'high',
  weight: 6,
  why: 'Explicitly listed for the 25,000–99,999 tier on Raptive’s eligibility page.',
  fix: 'Publish substantial long-form articles on the majority of eligible content pages, depth, unique information, and structure, not padding.'
}));

register(base({
  id: 'RAP-OFFICIAL-ORIGINAL',
  name: '100% original, high-quality content',
  category: 'content',
  sourceType: 'official',
  officialSource: SRC.eligible.url,
  sourceTitle: SRC.eligible.title,
  requirement: 'Content is high-quality and original. Raptive’s public eligibility language requires original content with meaningful human involvement. This tool cannot prove copyright ownership or AI authorship.',
  detectionMethod: 'Internal originality analysis: unique body text, duplicates, near-duplicates, repeated paragraphs/sentences/phrases, boilerplate, template similarity, unique information density.',
  automated: true,
  severity: 'high',
  weight: 7,
  why: 'Original content is an explicitly stated Raptive requirement.',
  fix: 'Rewrite thin, duplicated, or template-cloned pages. Add unique information that does not appear elsewhere on the site.'
}));

register(base({
  id: 'RAP-OFFICIAL-HUMAN',
  name: 'Meaningful human involvement',
  category: 'content',
  sourceType: 'official',
  officialSource: SRC.eligible.url,
  sourceTitle: SRC.eligible.title,
  requirement: 'Content has meaningful human involvement. A crawler cannot definitively determine whether a human wrote a page.',
  detectionMethod: 'Heuristic signals only: author information, bios, first-hand details, original examples, sources, editorial identity vs. repetitive mass-generated structure. Never labelled “AI-generated content detected.”',
  automated: true,
  severity: 'high',
  weight: 5,
  why: 'Explicitly listed on Raptive’s eligibility page for both traffic tiers.',
  fix: 'Add named authors, first-hand detail, original examples, and editorial identity. Avoid large-scale low-variation templates.'
}));

register(base({
  id: 'RAP-OFFICIAL-AD-BUILD',
  name: 'Website structure suitable for ads',
  category: 'advertising',
  sourceType: 'official',
  officialSource: SRC.eligible.url,
  sourceTitle: SRC.eligible.title,
  tier: 'mid',
  requirement: 'The site’s build makes it easy to add, configure, and manage ads (listed for the 25,000–99,999 tier).',
  detectionMethod: 'Layout inspection: main content containers, article body, headings/paragraphs, sidebars, sticky overlays, existing ad slots, mobile viewport. Does not claim actual Raptive ad-platform compatibility.',
  automated: true,
  severity: 'medium',
  weight: 5,
  why: 'Raptive designs ad layouts from the site’s traffic and structure.',
  fix: 'Use a clear article body, heading/paragraph structure, and a layout that leaves room for ads without covering content.'
}));

register(base({
  id: 'RAP-OFFICIAL-TRAFFIC-QUALITY',
  name: 'High-quality trustworthy traffic',
  category: 'traffic',
  sourceType: 'official',
  officialSource: SRC.analytics.url,
  sourceTitle: SRC.analytics.title,
  requirement: 'Raptive reviews the full picture of traffic in Google Analytics (pageviews, sessions, pages per session, country demographics, time on page, top posts, traffic sources) and emphasizes high-quality trustworthy traffic from key advertiser markets.',
  detectionMethod: 'Actual traffic quality is private. Only publicly observable signals (incentivized-traffic language, auto-refresh, bot-like URLs) are scanned.',
  automated: false,
  severity: 'info',
  weight: 0,
  why: 'Raptive uses GA authorization to review traffic authenticity, a URL crawl cannot.',
  fix: 'Confirm human, brand-safe traffic in GA4. Avoid purchased, incentivized, or artificial pageviews.'
}));

/* ============================================================ *
 *  STRONG QUALITY SIGNALS
 * ============================================================ */

register(base({
  id: 'RAP-Q-BRAND-SAFETY',
  name: 'Brand-safe content',
  category: 'brand',
  sourceType: 'quality_signal',
  requirement: 'Raptive publicly emphasizes brand-safe content for advertiser demand. This is discussed by Raptive as a quality expectation, not labelled here as an official policy-violation finding unless an official Raptive source is cited.',
  detectionMethod: 'Deterministic contextual scanner. Isolated keywords never create a high finding.',
  automated: true,
  severity: 'high',
  weight: 6,
  why: 'Advertisers expect brand-safe inventory; Raptive emphasizes this publicly.',
  fix: 'Review high-risk pages. Do not treat this screen as an official Raptive policy verdict.'
}));

register(base({
  id: 'RAP-Q-READER-EXPERIENCE',
  name: 'Reader experience',
  category: 'ux',
  sourceType: 'quality_signal',
  requirement: 'Raptive publicly emphasizes reader experience alongside content quality.',
  detectionMethod: 'Viewport, navigation, typography/headings, overlays, autoplay, sticky elements, broken links, empty buttons, layout.',
  automated: true,
  severity: 'medium',
  weight: 5,
  why: 'Reader experience affects both eligibility review and later ad performance.',
  fix: 'Remove intrusive overlays, fix mobile layout, and keep content readable.'
}));

register(base({
  id: 'RAP-Q-PRIVACY',
  name: 'Privacy / transparency pages',
  category: 'trust',
  sourceType: 'quality_signal',
  requirement: 'About, Contact, Privacy, Terms, Disclaimer, and cookie information support trust. Existence alone is not enough.',
  detectionMethod: 'Detects pages from URL, title, H1, nav, footer; checks substance, placeholders, and navigation visibility.',
  automated: true,
  severity: 'medium',
  weight: 3,
  why: 'Transparency supports a legitimate publisher review.',
  fix: 'Publish genuine, site-specific trust pages and link them in the footer.'
}));

register(base({
  id: 'RAP-Q-CONTACT',
  name: 'Contact information',
  category: 'trust',
  sourceType: 'quality_signal',
  requirement: 'A working contact path (email, form, or phone) supports publisher legitimacy.',
  detectionMethod: 'Looks for a contact page plus email, phone, or form in crawled HTML.',
  automated: true,
  severity: 'medium',
  weight: 3,
  why: 'Quality signal for trust and transparency.',
  fix: 'Add a contact page with a working email or form and link it site-wide.'
}));

register(base({
  id: 'RAP-Q-AUTHOR-TRANSPARENCY',
  name: 'Author & publisher transparency',
  category: 'trust',
  sourceType: 'quality_signal',
  requirement: 'Author names, bios, dates, and publisher information support meaningful human involvement.',
  detectionMethod: 'Extracts author meta/byline, dates, references, and author pages.',
  automated: true,
  severity: 'low',
  weight: 2,
  why: 'Supports the official human-involvement requirement as an observable signal.',
  fix: 'Add real bylines, bios, and dates where relevant.'
}));

register(base({
  id: 'RAP-APPROVE-READER-EXPERIENCE',
  name: 'Reader experience (page-level)',
  category: 'ux',
  sourceType: 'quality_signal',
  requirement: 'Mobile usability, navigation, overlays, autoplay, sticky elements, and layout that do not obstruct reading.',
  detectionMethod: 'Per-page UX audit of publicly observable markup.',
  automated: true,
  severity: 'medium',
  weight: 4,
  why: 'Raptive emphasizes reader experience.',
  fix: 'Fix the listed UX issues on affected pages.'
}));

register(base({
  id: 'RAP-Q-BRAND-PAGE',
  name: 'Brand-safety page signal',
  category: 'brand',
  sourceType: 'quality_signal',
  requirement: 'Contextual brand-safety patterns on individual pages.',
  detectionMethod: 'Same scanner as RAP-Q-BRAND-SAFETY, emitted per page with confidence and severity.',
  automated: true,
  severity: 'medium',
  weight: 3,
  why: 'Page-level evidence for the site-wide brand-safety assessment.',
  fix: 'Review the cited URL and evidence snippet.'
}));

/* ============================================================ *
 *  HEURISTICS
 * ============================================================ */

register(base({
  id: 'RAP-H-CONTENT-DEPTH',
  name: 'Content depth & unique information',
  category: 'content',
  sourceType: 'heuristic',
  requirement: 'Unique body-text words after removing repeated navigation/footer vocabulary, paragraph and heading structure, sentence variety.',
  detectionMethod: 'Deterministic text analysis. Word count is never used alone.',
  automated: true,
  severity: 'medium',
  weight: 4,
  why: 'Heuristic estimate of content quality for the original-content assessment.',
  fix: 'Add original, in-depth, well-structured body copy.'
}));

register(base({
  id: 'RAP-H-DUPLICATES',
  name: 'Duplicate / near-duplicate content',
  category: 'content',
  sourceType: 'heuristic',
  requirement: 'A website with many near-duplicate or thin pages holds far less original-content value.',
  detectionMethod: 'Sentence fingerprints, n-grams, Jaccard similarity, TF-IDF cosine similarity, and SimHash.',
  automated: true,
  severity: 'high',
  weight: 5,
  why: 'Internal duplication is a potential originality problem, not a copyright-ownership proof.',
  fix: 'Merge or rewrite near-duplicate and template pages.'
}));

register(base({
  id: 'RAP-H-CONTENT-PORTFOLIO',
  name: 'Content portfolio balance',
  category: 'content',
  sourceType: 'heuristic',
  requirement: 'Measure the whole site: useful vs thin vs duplicate vs empty content and unique-content share. A site with 500 URLs but only 20 useful original pages should score weaker.',
  detectionMethod: 'Aggregates per-page content metrics into a portfolio inventory.',
  automated: true,
  severity: 'medium',
  weight: 4,
  why: 'Site-wide content quality, not a few flagship pages.',
  fix: 'Raise the share of genuinely useful, original pages.'
}));

register(base({
  id: 'RAP-H-ORIGINALITY',
  name: 'Internal originality signals',
  category: 'content',
  sourceType: 'heuristic',
  requirement: 'Potential duplication signal, low unique-content ratio, and high template similarity, never claimed as proof of copyright or AI authorship.',
  detectionMethod: 'Text normalization, sentence fingerprints, n-grams, Jaccard, TF-IDF cosine, SimHash, content-to-template ratio.',
  automated: true,
  severity: 'high',
  weight: 5,
  why: 'Supports the official original-content requirement with evidence.',
  fix: 'Increase unique body text relative to shared templates.'
}));

register(base({
  id: 'RAP-H-HUMAN',
  name: 'Human-involvement pattern',
  category: 'content',
  sourceType: 'heuristic',
  requirement: 'Observable signals of editorial identity vs. potential low-human-involvement patterns.',
  detectionMethod: 'Author bios, first-person/experience language, sources, vs. repetitive templates and generic language. Never “AI-generated content detected.”',
  automated: true,
  severity: 'medium',
  weight: 4,
  why: 'Heuristic supporting the official human-involvement requirement.',
  fix: 'Add first-hand detail, named authors, and unique explanations.'
}));

register(base({
  id: 'RAP-H-LONGFORM',
  name: 'Long-form coverage (heuristic thresholds)',
  category: 'content',
  sourceType: 'heuristic',
  requirement: 'Percentage of eligible content pages meeting configurable long-form signals (words, unique words, paragraphs, headings, template ratio).',
  detectionMethod: 'Multi-signal long-form audit. Not a single word-count proof.',
  automated: true,
  severity: 'medium',
  weight: 4,
  why: 'Supports the official majority-long-form requirement for the 25k–99,999 tier.',
  fix: 'Increase depth on eligible content pages.'
}));

register(base({
  id: 'RAP-H-AD-DENSITY',
  name: 'Ad density & insertion opportunities',
  category: 'advertising',
  sourceType: 'heuristic',
  requirement: 'Existing ads are not automatically a problem. Ad-heavy thin pages and overlays that cover content hurt reader experience.',
  detectionMethod: 'Ad scripts, iframes, slots, sticky/interstitial signals, paragraph structure, content containers.',
  automated: true,
  severity: 'low',
  weight: 2,
  why: 'Heuristic for the official “easy to add, configure, and manage ads” item.',
  fix: 'Keep a clear article body and avoid covering content with chrome.'
}));

register(base({
  id: 'RAP-H-TECH',
  name: 'Technical quality',
  category: 'tech',
  sourceType: 'heuristic',
  requirement: 'HTTPS, status codes, redirects, canonical, robots, sitemap, noindex, hreflang, broken links/images, title, description, H1–H6, structured data, viewport.',
  detectionMethod: 'Server-header + HTML-level checks (not a Lighthouse substitute).',
  automated: true,
  severity: 'low',
  weight: 2,
  why: 'Technical cleanliness supports crawlability, ads, and review.',
  fix: 'Resolve the reported technical issues.'
}));

register(base({
  id: 'RAP-H-PERFORMANCE',
  name: 'Performance signals',
  category: 'tech',
  sourceType: 'heuristic',
  requirement: 'TTFB, HTML size, script/style/image weight, third-party requests, render-blocking resources, compression, cache headers, CDN indicators.',
  detectionMethod: 'Observable response headers and HTML metrics. Not Lighthouse / Core Web Vitals.',
  automated: true,
  severity: 'low',
  weight: 2,
  why: 'Heuristic. Server-side HTML analysis does not equal a Lighthouse score.',
  fix: 'Reduce page weight and blocking resources; enable compression and caching.'
}));

register(base({
  id: 'RAP-H-ARCHITECTURE',
  name: 'Site architecture & internal linking',
  category: 'architecture',
  sourceType: 'heuristic',
  requirement: 'Link graph: orphan candidates, dead-ends, deep pages, broken/redirecting internal links, discoverability.',
  detectionMethod: 'Internal link graph from the crawl.',
  automated: true,
  severity: 'medium',
  weight: 3,
  why: 'Good architecture improves discoverability for readers and reviewers.',
  fix: 'Link orphan/dead-end pages and fix broken internal links.'
}));

register(base({
  id: 'RAP-H-BOT-LIKE',
  name: 'Bot-like URL patterns',
  category: 'traffic',
  sourceType: 'heuristic',
  requirement: 'URLs matching traffic-exchange / bot-traffic patterns are a public artificial-traffic signal.',
  detectionMethod: 'Regex scan of crawled URLs.',
  automated: true,
  severity: 'high',
  weight: 5,
  why: 'Heuristic relevant to trustworthy traffic.',
  fix: 'Remove traffic-exchange and artificial-traffic pages.'
}));

register(base({
  id: 'RAP-H-INCENTIVIZED',
  name: 'Incentivized traffic language',
  category: 'traffic',
  sourceType: 'heuristic',
  requirement: 'Language offering payment for clicks/visits indicates incentivized traffic.',
  detectionMethod: 'Regex scan of page text.',
  automated: true,
  severity: 'medium',
  weight: 4,
  why: 'Heuristic. Incentivized clicks undermine trustworthy traffic.',
  fix: 'Remove pages that offer payment for traffic or clicks.'
}));

register(base({
  id: 'RAP-H-TRAFFIC-CLAIMS',
  name: 'Public traffic claims',
  category: 'traffic',
  sourceType: 'heuristic',
  requirement: 'Self-reported visitor counts on the site are unverified and are not proof of eligibility.',
  detectionMethod: 'Scans page text for self-reported traffic/size claims.',
  automated: true,
  severity: 'info',
  weight: 0,
  why: 'Public claims do not substitute for verified Analytics pageviews.',
  fix: 'Confirm numbers in GA4; public claims are informational.'
}));

register(base({
  id: 'RAP-H-TRACKING',
  name: 'Analytics snippet presence',
  category: 'traffic',
  sourceType: 'heuristic',
  requirement: 'Presence of GA4/gtag/GTM is “tracking code detected,” not “Analytics configuration verified.”',
  detectionMethod: 'Detects GA4 Measurement IDs, gtag.js, analytics.js, GTM, duplicate IDs, placement.',
  automated: true,
  severity: 'low',
  weight: 2,
  why: 'Supports the official GA requirement with a public signal only.',
  fix: 'Install a single GA4 property correctly and verify hits in the GA4 UI.'
}));

register(base({
  id: 'RAP-H-TRAFFIC-GEN',
  name: 'Traffic-generation pages',
  category: 'traffic',
  sourceType: 'heuristic',
  requirement: 'Pages whose purpose is to generate or sell traffic are a strong artificial-traffic signal.',
  detectionMethod: 'Detects traffic-exchange / traffic-buying pages by URL and text.',
  automated: true,
  severity: 'high',
  weight: 5,
  why: 'Heuristic contradicting trustworthy traffic.',
  fix: 'Remove traffic-generation pages.'
}));

register(base({
  id: 'RAP-H-ADSTXT',
  name: 'ads.txt file',
  category: 'advertising',
  sourceType: 'heuristic',
  requirement: 'An ads.txt file declares authorized ad sellers. Raptive typically manages ads.txt after integration.',
  detectionMethod: 'Fetches /ads.txt and checks for raptive.com / adthrive.com references.',
  automated: true,
  severity: 'low',
  weight: 1,
  why: 'Heuristic. Not a pre-application quality gate.',
  fix: 'Let Raptive manage ads.txt after joining.'
}));

function tierFromPageviews(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return null;
  if (v < 25000) return TIER_CONFIG.below;
  if (v < 100000) return TIER_CONFIG.mid;
  return TIER_CONFIG.high;
}

module.exports = {
  REGISTRY,
  BY_ID,
  SRC,
  TIER_CONFIG,
  KEY_COUNTRIES,
  KEY_COUNTRY_LABELS,
  LONG_FORM,
  VERIFIED,
  EFFECTIVE,
  register,
  finding,
  manualFinding,
  get: id => BY_ID[id],
  all: () => REGISTRY.slice(),
  tierFromPageviews
};
