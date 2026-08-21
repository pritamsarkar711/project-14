'use strict';

const U = require('./util');
const R = require('./ezoicRules');

const PRIVACY_TERMS = /\b(personal data|personal information|collect(s|ing)?|cookies?|third[- ]part|gdpr|ccpa|data controller|share(s|d)? with|retain|legal basis|opt[- ]out)\b/i;

function pageSubstance(e) {
  const p = e.page && e.page.parse;
  if (!p) return { words: 0, meaningful: false };
  const words = p.wordCount || 0;
  const hasPrivacyTerms = PRIVACY_TERMS.test(p.mainText || '');
  const meaningful = e.key === 'privacy'
    ? (hasPrivacyTerms && words >= 50) || words >= 140
    : words >= 60;
  return { words, meaningful, text: (p.mainText || '').slice(0, 400) };
}

function analyzeTrust(pages, ctx) {
  const out = [];
  const have = {};
  (ctx.important || []).forEach(e => { have[e.key] = e; });

  const priv = have.privacy;
  if (priv) {
    const sub = pageSubstance(priv);
    const linked = priv.linkedFromNav;
    let status = 'passed';
    let evidence = 'Privacy Policy detected at ' + U.pathOf(priv.url) + ' · confidence ' + priv.confidence + '%';
    if (!sub.meaningful) {
      status = 'medium';
      evidence += '. Page has only ' + sub.words + ' body words and/or lacks standard privacy terms (collect, cookies, third party, etc.). Existence alone is not enough.';
    } else {
      evidence += '. ' + sub.words + ' body words including privacy-related terms. ' + (linked ? 'Linked from navigation/footer.' : 'Not clearly linked from main navigation or footer.');
    }
    if (!linked && status === 'passed') status = 'medium';
    out.push(R.finding(R.get('EZ-PRIVACY-PAGE'), U.pathOf(priv.url), status, evidence, {
      confidence: priv.confidence / 100,
      severity: status === 'passed' ? 'passed' : status
    }));
    if (!linked) {
      out.push(R.finding(R.get('EZ-PRIVACY-PAGE'), U.pathOf(priv.url), 'medium',
        'Privacy Policy exists but was not found in main navigation or footer links. Ezoic asks that it be accessible from every page.',
        { confidence: 0.72 }));
    }
  } else {
    out.push(R.finding(R.get('EZ-PRIVACY-PAGE'), 'Site', 'high',
      'No Privacy Policy page detected from URL, title, H1, navigation, footer, or on-page text.',
      { confidence: 0.88 }));
  }

  const contact = have.contact;
  const anyEmail = pages.some(p => p.parse && p.parse.contactEmail);
  const anyPhone = pages.some(p => p.parse && p.parse.contactPhone);
  const anyForm = pages.some(p => p.parse && p.parse.contactForm);
  if (contact && (anyEmail || anyForm || anyPhone)) {
    const bits = [];
    if (anyEmail) bits.push('email');
    if (anyPhone) bits.push('phone');
    if (anyForm) bits.push('form');
    out.push(R.finding(R.get('EZ-CONTACT'), U.pathOf(contact.url), 'passed',
      'Contact page detected at ' + U.pathOf(contact.url) + ' · confidence ' + contact.confidence + '% · visible ' + bits.join(', ') + '.',
      { confidence: contact.confidence / 100, severity: 'passed' }));
  } else if (contact && !anyEmail && !anyForm && !anyPhone) {
    out.push(R.finding(R.get('EZ-CONTACT'), U.pathOf(contact.url), 'medium',
      'A Contact page was detected at ' + U.pathOf(contact.url) + ' but no email, phone, or contact form was found in crawled HTML.',
      { confidence: 0.7 }));
  } else if (!contact && (anyEmail || anyForm)) {
    out.push(R.finding(R.get('EZ-CONTACT'), 'Site', 'low',
      'Contact details appear on the site, but a dedicated Contact page was not identified.',
      { confidence: 0.6 }));
  } else {
    out.push(R.finding(R.get('EZ-CONTACT'), 'Site', 'high',
      'No Contact page, email address, phone number, or contact form was detected in the crawl.',
      { confidence: 0.84 }));
  }

  if (have.about) {
    const sub = pageSubstance(have.about);
    out.push(R.finding(R.get('EZ-ABOUT-PAGE'), U.pathOf(have.about.url),
      sub.words >= 60 ? 'passed' : 'medium',
      'About page detected at ' + U.pathOf(have.about.url) + ' · confidence ' + have.about.confidence + '% · ' + sub.words + ' body words'
      + (have.about.linkedFromNav ? ' · linked from nav/footer' : ' · not clearly linked') + '.',
      { confidence: have.about.confidence / 100, severity: sub.words >= 60 ? 'passed' : 'medium' }));
  } else {
    out.push(R.finding(R.get('EZ-ABOUT-PAGE'), 'Site', 'medium',
      'No About page detected. This is a strongly recommended transparency signal, not a documented hard traffic gate.',
      { confidence: 0.8 }));
  }

  ['terms', 'disclaimer', 'cookie'].forEach(k => {
    const e = have[k];
    const label = k === 'terms' ? 'Terms' : k === 'disclaimer' ? 'Disclaimer' : 'Cookie Policy';
    if (e) {
      out.push({
        id: 'TRUST_' + k.toUpperCase(),
        category: 'trust',
        name: label,
        status: 'passed',
        severity: 'passed',
        page: U.pathOf(e.url),
        evidence: label + ' detected at ' + U.pathOf(e.url) + ' · confidence ' + e.confidence + '%.',
        why: 'Heuristic / best practice. Not listed as a standalone Ezoic traffic requirement.',
        fix: 'Keep the document accurate and linked in the footer.',
        confidence: e.confidence,
        sourceType: 'heuristic',
        automated: true,
        weight: 2
      });
    } else {
      out.push({
        id: 'TRUST_' + k.toUpperCase(),
        category: 'trust',
        name: label + ' missing',
        status: 'low',
        severity: 'low',
        page: 'Site',
        evidence: 'No ' + label + ' page detected.',
        why: 'Heuristic. Helpful for ad-tech and privacy compliance, not an automatically verified official Ezoic gate.',
        fix: 'Add a ' + label + ' page if it applies to the site.',
        confidence: 70,
        sourceType: 'heuristic',
        automated: true,
        weight: 1
      });
    }
  });

  const home = pages.find(p => U.pathOf(p.url) === '/') || pages[0];
  if (home && home.parse) {
    const pa = home.parse;
    const contentLinks = (pa.links || []).filter(l => l.internal && /blog|article|post|news|guide|resource|learn/i.test((l.href || '') + ' ' + (l.text || ''))).length;
    const meaningful = pa.wordCount >= 80 && pa.hasNav && (pa.internalLinks >= 5 || contentLinks >= 3);
    out.push(R.finding(R.get('EZ-HOMEPAGE-ENTRY'), U.pathOf(home.url),
      meaningful ? 'passed' : (pa.wordCount < 40 ? 'high' : 'medium'),
      'Homepage has ' + pa.wordCount + ' body words, ' + pa.internalLinks + ' internal links, '
      + (pa.hasNav ? 'navigation present' : 'no navigation landmark') + ', '
      + contentLinks + ' content-like links.',
      { confidence: 0.72, severity: meaningful ? 'passed' : (pa.wordCount < 40 ? 'high' : 'medium') }));
  }

  const authors = pages.filter(p => p.parse && ctx.pageType.get(p.url) === 'article' && (p.parse.author || '').length >= 2).length;
  const articles = pages.filter(p => p.parse && ctx.pageType.get(p.url) === 'article').length;
  if (articles >= 3) {
    out.push({
      id: 'TRUST_AUTHOR',
      category: 'trust',
      name: 'Author information',
      status: authors / articles >= 0.4 ? 'passed' : 'low',
      severity: authors / articles >= 0.4 ? 'passed' : 'low',
      page: 'Site',
      evidence: authors + ' of ' + articles + ' article pages expose an author byline or author meta.',
      why: 'Heuristic. Bylines support transparency; they are not an official Ezoic traffic rule.',
      fix: 'Add real author names on articles.',
      confidence: 65,
      sourceType: 'heuristic',
      automated: true,
      weight: 2
    });
  }

  return out;
}

module.exports = { analyzeTrust };
