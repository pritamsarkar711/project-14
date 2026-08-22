'use strict';

/**
 * Ezoic-specific rule registry.
 * Kept entirely separate from adsenseRules.
 *
 * sourceType:
 *   official      , documented on Ezoic Support / Ezoic publisher materials
 *   best_practice , strongly recommended by Ezoic checklists
 *   heuristic     , general website-quality signal used as supporting evidence
 *
 * automated false → evaluate() must return status 'manual' (Unable to verify automatically)
 */

const U = require('./util');

const VERIFIED = '2026-08-21';

const SRC = {
  requirements: {
    url: 'https://support.ezoic.com/kb/article/getting-started-ezoics-requirements',
    title: "Getting Started: Ezoic's Requirements"
  },
  content: {
    url: 'https://support.ezoic.com/kb/article/ezoic-content-guidelines',
    title: 'Ezoic Content Guidelines'
  },
  checklist: {
    url: 'https://support.ezoic.com/kb/article/compliance-and-quality-checklist-for-ezoic-monetization',
    title: 'Compliance and Quality Checklist for Ezoic Monetization'
  },
  policies: {
    url: 'https://osticket.ezoic.com/kb/article/ezoic-site-requirements-for-monetization',
    title: 'Ezoic Publisher Compliance and Quality Policies for Monetization'
  },
  adstxt: {
    url: 'https://support.ezoic.com/kb/article/everything-you-need-to-know-about-adstxt',
    title: 'Everything You Need To Know About ads.txt'
  }
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
  const f = {
    id: rule.id,
    category: rule.category,
    name: rule.name,
    requirement: rule.requirement,
    status,
    severity: extra.severity || rule.severity,
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
    detectionMethod: rule.detectionMethod,
    automated: !!rule.automated,
    weight: rule.weight || 3,
    affected: extra.affected,
    sharedText: extra.sharedText,
    tier: extra.tier,
    policyCat: extra.policyCat
  };
  return f;
}

function manualFinding(rule, note) {
  return finding(rule, 'Site', 'manual', note || 'Unable to verify automatically.', {
    confidence: 1,
    why: rule.why,
    fix: rule.fix,
    severity: 'info'
  });
}

/* ---------------- Official Ezoic requirements ---------------- */

register({
  id: 'EZ-TRAFFIC-MAU',
  name: 'Monthly active users',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.requirements.url,
  sourceTitle: SRC.requirements.title,
  lastVerified: VERIFIED,
  requirement: 'Sites are generally required to have 250,000+ monthly active users. Traffic is verified by connecting Google Analytics during application. Publishers monetizing before 19 Feb 2026 may be grandfathered if they keep continuous use.',
  detectionMethod: 'Public HTML cannot show authenticated analytics. Manual verification required.',
  automated: false,
  severity: 'info',
  weight: 0,
  why: 'This is currently the primary documented traffic gate for new Ezoic sites.',
  fix: 'Confirm monthly active users in Google Analytics before applying. Smaller sites may look at the Ezoic Incubator program if still offered.'
});

register({
  id: 'EZ-TRAFFIC-SOURCES',
  name: 'Reliable traffic sources',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.requirements.url,
  sourceTitle: SRC.requirements.title,
  lastVerified: VERIFIED,
  requirement: 'The site should have reliable traffic sources (human, identifiable traffic, not invalid or incentivized).',
  detectionMethod: 'Traffic quality is not observable from public pages.',
  automated: false,
  severity: 'info',
  weight: 0,
  why: 'Invalid or inorganic traffic is a documented Google-policy compliance item Ezoic enforces.',
  fix: 'Use organic, direct, email or legitimate social traffic. Do not buy junk traffic or inflate visits.'
});

register({
  id: 'EZ-INVALID-TRAFFIC',
  name: 'Invalid clicks / impressions',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.requirements.url,
  sourceTitle: SRC.requirements.title,
  lastVerified: VERIFIED,
  requirement: 'No invalid clicks or impressions; do not falsely encourage clicks.',
  detectionMethod: 'Click fraud and impression quality cannot be measured from a public crawl.',
  automated: false,
  severity: 'info',
  weight: 0,
  why: 'Ezoic is a Google Certified Publishing Partner and requires Google policy compliance.',
  fix: 'Never ask users to click ads, never disguise ads as content, never inflate impressions.'
});

register({
  id: 'EZ-MCM',
  name: 'Google Ad Manager / MCM approval',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.checklist.url,
  sourceTitle: SRC.checklist.title,
  lastVerified: VERIFIED,
  requirement: 'The site must be approved for Google Ad Manager. Google MCM review of the account and domain is required before ads serve.',
  detectionMethod: 'MCM status lives in the Ezoic dashboard after signup, not on the public site.',
  automated: false,
  severity: 'info',
  weight: 0,
  why: 'Even after Ezoic accepts a site, Google still has to approve the domain.',
  fix: 'This is completed during onboarding. It cannot be pre-checked from public HTML.'
});

register({
  id: 'EZ-ADSENSE-STANDING',
  name: 'Existing AdSense / Ad Manager standing',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.requirements.url,
  sourceTitle: SRC.requirements.title,
  lastVerified: VERIFIED,
  requirement: 'Prior AdSense approval is not required for most sites, but any existing AdSense/Ad Manager account must be in good standing.',
  detectionMethod: 'Account standing is not public.',
  automated: false,
  severity: 'info',
  weight: 0,
  why: 'Banned or penalized Google ads accounts can block Ezoic monetization.',
  fix: 'Resolve any Google ads policy issues on existing accounts before applying.'
});

register({
  id: 'EZ-CMP',
  name: 'Consent management (GDPR / CCPA)',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.checklist.url,
  sourceTitle: SRC.checklist.title,
  lastVerified: VERIFIED,
  requirement: 'Enable CCPA compliance in the consent management tool and fill in GEO information. Ezoic CMP is recommended; only one CMP should run.',
  detectionMethod: 'Dashboard CMP configuration cannot be verified from a public crawl with confidence.',
  automated: false,
  severity: 'info',
  weight: 0,
  why: 'Privacy-law consent is required to serve personalized ads in many regions.',
  fix: 'Configure a single CMP (Ezoic CMP or equivalent) during onboarding.'
});

register({
  id: 'EZ-PRIVACY-EZOIC-SNIPPET',
  name: 'Ezoic privacy disclosure snippet',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.checklist.url,
  sourceTitle: SRC.checklist.title,
  lastVerified: VERIFIED,
  requirement: 'Privacy policy must include Ezoic privacy information (typically added from the Ezoic dashboard).',
  detectionMethod: 'The Ezoic-specific snippet is added after joining; absence on a non-Ezoic site is expected.',
  automated: false,
  severity: 'info',
  weight: 0,
  why: 'Required after integration, not as a pre-application public-page check.',
  fix: 'After joining, add the snippet from Settings → Privacy, or let Ezoic insert it.'
});

register({
  id: 'EZ-ADSTXT-RESELLER',
  name: 'ads.txt Ezoic reseller lines',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.adstxt.url,
  sourceTitle: SRC.adstxt.title,
  lastVerified: VERIFIED,
  requirement: 'An ads.txt file must include Ezoic reseller information once the site is integrated.',
  detectionMethod: 'We can detect whether ads.txt exists. Ezoic reseller lines are expected after onboarding, not before.',
  automated: false,
  severity: 'info',
  weight: 0,
  why: 'Buyers will not bid without authorization. This is an integration step.',
  fix: 'After joining, let Ezoic manage ads.txt or add the provided reseller lines.'
});

register({
  id: 'EZ-JS-INTEGRATION',
  name: 'JavaScript integration capability',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.requirements.url,
  sourceTitle: SRC.requirements.title,
  lastVerified: VERIFIED,
  requirement: 'The only universal site-type technical requirement is the ability to include JavaScript in the site’s code. JavaScript integration is the primary connection method.',
  detectionMethod: 'If the site serves HTML that already includes scripts, it can include Ezoic’s script. We cannot prove CMS write-access.',
  automated: true,
  severity: 'medium',
  weight: 4,
  why: 'Without the ability to run Ezoic’s JavaScript, the platform cannot operate.',
  fix: 'Use a CMS or host that allows adding a site-wide script, or use Ezoic cloud integration.'
});

register({
  id: 'EZ-LANGUAGE',
  name: 'AdSense-supported language',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.requirements.url,
  sourceTitle: SRC.requirements.title,
  lastVerified: VERIFIED,
  requirement: 'All sites must be written in an AdSense-supported language.',
  detectionMethod: 'Uses html lang, content-language header, and script/character heuristics. Not a full language ID model.',
  automated: true,
  severity: 'high',
  weight: 5,
  why: 'Ezoic requires AdSense-supported languages because Google demand is the core of monetization.',
  fix: 'Publish primary content in a supported language such as English, Spanish, German, French, Portuguese, or others on the AdSense language list.'
});

register({
  id: 'EZ-ORIGINAL-CONTENT',
  name: 'Original, constructive content',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.requirements.url,
  sourceTitle: SRC.requirements.title,
  lastVerified: VERIFIED,
  requirement: 'All content must be original, constructive, and enticing. No empty pages with no original content. No content copied from other webpages.',
  detectionMethod: 'Site-wide unique-word, thin-page, and near-duplicate analysis after boilerplate removal. Cannot compare against the entire web.',
  automated: true,
  severity: 'high',
  weight: 8,
  why: 'Original value is a core documented Ezoic content standard.',
  fix: 'Publish substantial unique pages. Remove or rewrite empty, scraped, or templated pages.'
});

register({
  id: 'EZ-NO-AUTOGEN',
  name: 'No automatically generated content',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.requirements.url,
  sourceTitle: SRC.requirements.title,
  lastVerified: VERIFIED,
  requirement: 'Do not use automatically generated content.',
  detectionMethod: 'Heuristic only: repeated sentences, near-duplicate clusters, placeholder text, extreme repetition. Cannot prove AI authorship.',
  automated: true,
  severity: 'high',
  weight: 6,
  why: 'Auto-generated pages are a documented Google-policy item Ezoic lists.',
  fix: 'Replace spun, scraped, or mass-generated pages with human-reviewed original work.'
});

register({
  id: 'EZ-NO-KEYWORD-STUFF',
  name: 'No keyword stuffing',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.requirements.url,
  sourceTitle: SRC.requirements.title,
  lastVerified: VERIFIED,
  requirement: 'Do not keyword-stuff pages.',
  detectionMethod: 'Term density, repeated n-grams, and heading repetition on content pages.',
  automated: true,
  severity: 'medium',
  weight: 4,
  why: 'Keyword stuffing is listed in Ezoic’s Google policy compliance section.',
  fix: 'Write naturally. Remove repeated exact-match phrases that do not help the reader.'
});

register({
  id: 'EZ-THIN-IMAGES',
  name: 'Articles must include substantial text',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.content.url,
  sourceTitle: SRC.content.title,
  lastVerified: VERIFIED,
  requirement: 'Articles cannot consist solely of images. Pages must include text, not just images. Tool sites are not required to have a blog component.',
  detectionMethod: 'Compares unique body words vs image count on classified content pages. Tool/utility pages are excluded.',
  automated: true,
  severity: 'high',
  weight: 5,
  why: 'Image-only or near-image galleries are called out as not ready for monetization.',
  fix: 'Add coherent written content alongside images. Do not publish galleries without explanation.'
});

register({
  id: 'EZ-NO-DOWNLOADS',
  name: 'Downloadable / copyrighted material',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.content.url,
  sourceTitle: SRC.content.title,
  lastVerified: VERIFIED,
  requirement: 'Do not offer copyrighted material or downloads. Sites with a limited number of articles that contain downloadable content are not ready. No counterfeit goods.',
  detectionMethod: 'Counts download-like links and piracy-adjacent phrasing. Cannot prove copyright ownership.',
  automated: true,
  severity: 'high',
  weight: 5,
  why: 'Copyrighted downloads are a documented prohibited-site pattern.',
  fix: 'Remove pirated files, cracks, and warez-style download pages.'
});

register({
  id: 'EZ-SITE-TYPE',
  name: 'Site type compatibility',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.content.url,
  sourceTitle: SRC.content.title,
  lastVerified: VERIFIED,
  requirement: 'Sites that mostly feature content that cannot be monetized will not be approved. This includes ecommerce without a blog/informational content, corporate sites, video/image sites with limited text, and unoriginal tool sites. Ezoic otherwise supports many site types that can include JavaScript.',
  detectionMethod: 'Classifies site type from structure and content mix. Heuristic: Ezoic still makes the final call.',
  automated: true,
  severity: 'high',
  weight: 6,
  why: 'Pure storefronts and brochure sites are listed as prohibited site patterns.',
  fix: 'Add a genuine informational/blog section, or apply only if the site is already content-rich.'
});

register({
  id: 'EZ-PRIVACY-PAGE',
  name: 'Visible privacy policy',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.checklist.url,
  sourceTitle: SRC.checklist.title,
  lastVerified: VERIFIED,
  requirement: 'Have a visible Privacy Policy page, accessible from every page (menu or footer). It must meet industry standards and state how user data is collected, used, and shared.',
  detectionMethod: 'Detects a privacy URL via path, title, H1, nav and footer anchors, then checks substance (word count + privacy terms). Does not legally review the policy.',
  automated: true,
  severity: 'high',
  weight: 6,
  why: 'A public privacy policy is a documented Ezoic legal requirement.',
  fix: 'Publish a real privacy policy and link it in the footer of every page.'
});

register({
  id: 'EZ-CONTACT',
  name: 'Genuine contact information',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.checklist.url,
  sourceTitle: SRC.checklist.title,
  lastVerified: VERIFIED,
  requirement: 'Provide genuine contact information on the site. A dedicated contact page with a functional email or contact form is required to establish legitimacy.',
  detectionMethod: 'Looks for a contact page plus email, phone, or form in crawled HTML.',
  automated: true,
  severity: 'high',
  weight: 5,
  why: 'Verified contact details are listed on Ezoic’s compliance checklist.',
  fix: 'Add a contact page with a working email or form and link it site-wide.'
});

register({
  id: 'EZ-HOMEPAGE-ENTRY',
  name: 'Homepage as a meaningful entry point',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.checklist.url,
  sourceTitle: SRC.checklist.title,
  lastVerified: VERIFIED,
  requirement: 'Homepages should provide a meaningful point of entry to the site (for example latest posts or curated content).',
  detectionMethod: 'Checks homepage word count, internal links to content, headings, and navigation.',
  automated: true,
  severity: 'medium',
  weight: 4,
  why: 'Ezoic’s quality checklist requires the homepage to orient visitors.',
  fix: 'Feature recent or best content on the homepage instead of an empty landing page.'
});

register({
  id: 'EZ-UNIQUE-TITLES',
  name: 'Unique articles and titles',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.checklist.url,
  sourceTitle: SRC.checklist.title,
  lastVerified: VERIFIED,
  requirement: 'Articles and titles should be unique, no duplicates or near-duplicates. Each article should provide unique value.',
  detectionMethod: 'Duplicate titles plus near-duplicate body clusters among content pages.',
  automated: true,
  severity: 'high',
  weight: 5,
  why: 'Duplicate and near-duplicate articles are explicitly called out.',
  fix: 'Rewrite or merge near-duplicate posts. Give every article a distinct title and angle.'
});

register({
  id: 'EZ-PUBLISH-DATE',
  name: 'Show a publish date',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.checklist.url,
  sourceTitle: SRC.checklist.title,
  lastVerified: VERIFIED,
  requirement: 'Show a publish date on articles.',
  detectionMethod: 'Checks article:published_time, time datetime, JSON-LD datePublished, and visible date-like text on content pages.',
  automated: true,
  severity: 'medium',
  weight: 3,
  why: 'Publish dates are on Ezoic’s content checklist.',
  fix: 'Display a visible published date on every article.'
});

register({
  id: 'EZ-REDIRECTS-POPUPS',
  name: 'No undesirable redirects or pop-unders',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.requirements.url,
  sourceTitle: SRC.requirements.title,
  lastVerified: VERIFIED,
  requirement: 'Sites should not redirect users to undesirable pages/sites or use pop-ups / pop-unders.',
  detectionMethod: 'Counts meta-refresh, long redirect hops, and popup/overlay markup. Cannot see runtime pop-unders.',
  automated: true,
  severity: 'medium',
  weight: 4,
  why: 'Hostile redirects and pop-unders are listed under Google policy compliance.',
  fix: 'Remove interstitial spam, pop-unders, and surprise redirects.'
});

register({
  id: 'EZ-NON-EZOIC-ADS',
  name: 'Competing ad scripts (post-integration)',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.checklist.url,
  sourceTitle: SRC.checklist.title,
  lastVerified: VERIFIED,
  requirement: 'Non-Ezoic ads must be removed once the site is integrated with Ezoic.',
  detectionMethod: 'Detects common ad network scripts. Presence before joining is informational, not an automatic pre-eligibility failure.',
  automated: true,
  severity: 'low',
  weight: 2,
  why: 'Competing tags conflict with Ezoic after onboarding. They are not by themselves a reason a site cannot apply.',
  fix: 'If you join Ezoic, remove other ad networks as instructed in the dashboard.'
});

register({
  id: 'EZ-PROHIBITED-CONTENT',
  name: 'Prohibited content categories',
  category: 'ezoic',
  sourceType: 'official',
  officialSource: SRC.requirements.url,
  sourceTitle: SRC.requirements.title,
  lastVerified: VERIFIED,
  requirement: 'Do not use adult/sexually explicit, dangerous, derogatory, illegal, aggressive/threatening content. Gambling, alcohol, tobacco, and healthcare-related content are restricted. No counterfeit goods.',
  detectionMethod: 'Contextual policy scanner (see policyAnalyzer). Single keywords do not create a high-risk finding.',
  automated: true,
  severity: 'high',
  weight: 7,
  why: 'These categories are listed in Ezoic’s Google policy compliance section.',
  fix: 'Remove or wall off prohibited material. Informational healthcare discussion may still need review: Ezoic decides.'
});

/* ---------------- Best practices ---------------- */

register({
  id: 'EZ-ABOUT-PAGE',
  name: 'About / ownership transparency',
  category: 'trust',
  sourceType: 'best_practice',
  officialSource: SRC.policies.url,
  sourceTitle: SRC.policies.title,
  lastVerified: VERIFIED,
  requirement: 'Ezoic materials recommend About information (including sidebar About on some layouts) so visitors can identify who runs the site.',
  detectionMethod: 'Detects an About page from URL, title, H1, nav and footer.',
  automated: true,
  severity: 'medium',
  weight: 3,
  why: 'Ownership transparency supports legitimacy reviews.',
  fix: 'Add a real About page that explains who you are and what the site does.'
});

register({
  id: 'EZ-HTTPS',
  name: 'HTTPS',
  category: 'tech',
  sourceType: 'best_practice',
  officialSource: SRC.requirements.url,
  sourceTitle: SRC.requirements.title,
  lastVerified: VERIFIED,
  requirement: 'Serve the site over HTTPS with a valid certificate.',
  detectionMethod: 'Start URL protocol plus TLS handshake during the crawl.',
  automated: true,
  severity: 'high',
  weight: 4,
  why: 'Secure transport is expected for advertising and user trust.',
  fix: 'Install TLS and redirect HTTP to HTTPS.'
});

register({
  id: 'EZ-ADSTXT-EXISTS',
  name: 'ads.txt file present',
  category: 'ezoic',
  sourceType: 'best_practice',
  officialSource: SRC.adstxt.url,
  sourceTitle: SRC.adstxt.title,
  lastVerified: VERIFIED,
  requirement: 'An ads.txt file shows who can sell your inventory and is required to show Google ads after integration.',
  detectionMethod: 'Fetches /ads.txt. Missing file is a future integration task if the site is not yet on Ezoic.',
  automated: true,
  severity: 'low',
  weight: 2,
  why: 'Useful to know before onboarding, required after.',
  fix: 'You can add a basic ads.txt now; Ezoic will replace/extend it during setup.'
});

module.exports = {
  REGISTRY,
  BY_ID,
  SRC,
  VERIFIED,
  register,
  finding,
  manualFinding,
  get: id => BY_ID[id],
  all: () => REGISTRY.slice()
};
