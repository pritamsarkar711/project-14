'use strict';

const U = require('./util');
const R = require('./mediavineRules');

const PRIVACY_TERMS = /\b(personal data|personal information|collect(s|ing)?|cookies?|third[- ]part|gdpr|ccpa|data controller|share(s|d)? with|retain|legal basis|opt[- ]out)\b/i;

function pageSubstance(e, key) {
  const p = e.page && e.page.parse;
  if (!p) return { words: 0, meaningful: false, placeholders: false };
  const words = p.wordCount || 0;
  const hasPrivacyTerms = PRIVACY_TERMS.test(p.mainText || '');
  const placeholders = /lorem ipsum|placeholder|todo:|insert (text|content) here/i.test(p.mainText || '');
  const meaningful = key === 'privacy'
    ? (hasPrivacyTerms && words >= 50) || words >= 140
    : words >= 60;
  return { words, meaningful, placeholders, text: (p.mainText || '').slice(0, 400) };
}

function analyzeTrust(pages, ctx) {
  const out = [];
  const have = {};
  (ctx.important || []).forEach(e => { have[e.key] = e; });

  // Privacy
  if (have.privacy) {
    const sub = pageSubstance(have.privacy, 'privacy');
    const linked = have.privacy.linkedFromNav;
    let status = sub.meaningful ? 'passed' : 'medium';
    if (!sub.meaningful) status = sub.placeholders ? 'high' : 'medium';
    if (status === 'passed' && !linked) status = 'medium';
    const evidence = 'Privacy Policy detected at ' + U.pathOf(have.privacy.url) + ' (' + sub.words + ' body words)'
      + (sub.meaningful ? ' including privacy terms' : ', lacks standard privacy terms or is too thin. Existence alone is not enough.')
      + (sub.placeholders ? ' Contains placeholder text.' : '')
      + (linked ? ' Linked from nav/footer.' : ' Not clearly linked from main navigation or footer.');
    out.push(R.finding(R.get('MV-Q-PRIVACY'), U.pathOf(have.privacy.url), status, evidence,
      { confidence: have.privacy.confidence / 100, severity: status }));
  } else {
    out.push(R.finding(R.get('MV-Q-PRIVACY'), 'Site', 'high',
      'No Privacy Policy page detected from URL, title, H1, navigation, footer, or on-page text.',
      { confidence: 0.88, severity: 'high' }));
  }

  // Contact
  const anyEmail = pages.some(p => p.parse && p.parse.contactEmail);
  const anyPhone = pages.some(p => p.parse && p.parse.contactPhone);
  const anyForm = pages.some(p => p.parse && p.parse.contactForm);
  if (have.contact && (anyEmail || anyForm || anyPhone)) {
    const bits = []; if (anyEmail) bits.push('email'); if (anyPhone) bits.push('phone'); if (anyForm) bits.push('form');
    out.push(R.finding(R.get('MV-Q-CONTACT'), U.pathOf(have.contact.url), 'passed',
      'Contact page at ' + U.pathOf(have.contact.url) + ' · ' + have.contact.confidence + '% confidence · visible ' + bits.join(', ') + '.',
      { confidence: have.contact.confidence / 100, severity: 'passed' }));
  } else if (have.contact && !anyEmail && !anyForm && !anyPhone) {
    out.push(R.finding(R.get('MV-Q-CONTACT'), U.pathOf(have.contact.url), 'medium',
      'A Contact page exists at ' + U.pathOf(have.contact.url) + ' but no email, phone, or form was found in crawled HTML.',
      { confidence: 0.7, severity: 'medium' }));
  } else if (!have.contact && (anyEmail || anyForm)) {
    out.push(R.finding(R.get('MV-Q-CONTACT'), 'Site', 'low',
      'Contact details appear on the site, but a dedicated Contact page was not identified.',
      { confidence: 0.6, severity: 'low' }));
  } else {
    out.push(R.finding(R.get('MV-Q-CONTACT'), 'Site', 'high',
      'No Contact page, email, phone, or form detected in the crawl.',
      { confidence: 0.84, severity: 'high' }));
  }

  // About
  if (have.about) {
    const sub = pageSubstance(have.about, 'about');
    out.push(R.finding(R.get('MV-Q-AUTHOR-TRANSPARENCY'), U.pathOf(have.about.url), sub.words >= 60 ? 'passed' : 'medium',
      'About page at ' + U.pathOf(have.about.url) + ' · ' + sub.words + ' body words' + (have.about.linkedFromNav ? ' · linked from nav/footer' : ' · not clearly linked') + '.',
      { confidence: have.about.confidence / 100, severity: sub.words >= 60 ? 'passed' : 'medium' }));
  } else {
    out.push(R.finding(R.get('MV-Q-AUTHOR-TRANSPARENCY'), 'Site', 'medium',
      'No About page detected. This is a transparency quality signal, not a standalone eligibility gate.',
      { confidence: 0.8, severity: 'medium' }));
  }

  // Other trust pages: Terms, Disclaimer, Cookie, Editorial
  [['terms', 'Terms'], ['disclaimer', 'Disclaimer'], ['cookie', 'Cookie Policy'], ['editorial', 'Editorial Policy']].forEach(pair => {
    const k = pair[0], label = pair[1];
    const e = have[k];
    if (e) {
      const sub = pageSubstance(e, k);
      out.push({
        id: 'MV-TRUST-' + k.toUpperCase(), category: 'trust', name: label, status: sub.meaningful ? 'passed' : 'medium',
        severity: sub.meaningful ? 'passed' : 'medium', page: U.pathOf(e.url),
        evidence: label + ' detected at ' + U.pathOf(e.url) + ' (' + sub.words + ' body words)' + (sub.meaningful ? '' : ', thin or placeholder-like.') + ' · ' + e.confidence + '% confidence.',
        why: 'Quality signal. Trust documents support legitimacy and ad-tech/privacy compliance.',
        fix: 'Publish a substantive ' + label.toLowerCase() + ' page and link it in the footer.',
        confidence: e.confidence, sourceType: 'quality_signal', sourceUrl: R.SRC.approve.url, lastVerified: R.VERIFIED, automated: true, weight: 2
      });
    } else {
      out.push({
        id: 'MV-TRUST-' + k.toUpperCase(), category: 'trust', name: label + ' missing', status: 'low', severity: 'low', page: 'Site',
        evidence: 'No ' + label + ' page detected.', why: 'Quality signal. Helpful for transparency.', fix: 'Add a ' + label.toLowerCase() + ' page if it applies.',
        confidence: 70, sourceType: 'heuristic', automated: true, weight: 1
      });
    }
  });

  // Author & publisher transparency
  const articles = pages.filter(p => p.parse && ctx.pageType.get(p.url) === 'article');
  if (articles.length >= 3) {
    const withAuthor = articles.filter(p => (p.parse.author || '').length >= 2).length;
    const withDate = articles.filter(p => p.parse.published).length;
    const withRef = articles.filter(p => p.parse.referenceCount >= 2).length;
    const authorRatio = withAuthor / articles.length;
    out.push(R.finding(R.get('MV-Q-AUTHOR-TRANSPARENCY'), 'Site', authorRatio >= 0.4 ? 'passed' : 'low',
      withAuthor + ' of ' + articles.length + ' article pages expose an author byline; ' + withDate + ' show a publish date; ' + withRef + ' contain reference/source language.',
      { confidence: 0.7, affected: withAuthor + '/' + articles.length, severity: authorRatio >= 0.4 ? 'passed' : 'low' }));
  }

  // Homepage meaningful entry point (reader-experience signal)
  const home = pages.find(p => U.pathOf(p.url) === '/') || pages[0];
  if (home && home.parse) {
    const pa = home.parse;
    const contentLinks = (pa.links || []).filter(l => l.internal && /blog|article|post|news|guide|resource|learn/i.test((l.href || '') + ' ' + (l.text || ''))).length;
    const meaningful = pa.hasNav && (pa.internalLinks >= 5 || contentLinks >= 3);
    const status = meaningful ? 'passed' : (pa.wordCount < 20 ? 'high' : (pa.wordCount < 60 ? 'medium' : 'low'));
    out.push(R.finding(R.get('MV-APPROVE-READER-EXPERIENCE'), U.pathOf(home.url), status,
      'Homepage has ' + pa.wordCount + ' body words, ' + pa.internalLinks + ' internal links, ' + contentLinks + ' content-like links'
      + (pa.hasNav ? ', navigation present' : ', no navigation landmark') + '.',
      { confidence: 0.72, severity: status }));
  }

  ctx.trustStats = { pages: Object.keys(have) };
  return out;
}

module.exports = { analyzeTrust };
