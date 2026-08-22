'use strict';

const U = require('./util');
const R = require('./raptiveRules');
const { CONTENT_TYPES } = require('./pageClassifier');

/**
 * Heuristic detector for meaningful human involvement.
 * NEVER claims "AI-generated content detected."
 * Uses: Potential low-human-involvement pattern + evidence.
 */
const FIRST_HAND = /\b(i (tried|tested|measured|visited|interviewed|photographed|cooked|built|grew|learned)|in my (experience|kitchen|garden|lab|studio)|when we (tested|visited|measured)|our (test|trial|recipe|protocol))\b/i;
const GENERIC = /\b(in (today's|this) (article|post)|in conclusion|to sum up|it is important to note|in the world of|unlock the secrets|delve into|in this comprehensive guide|whether you're a beginner or)\b/i;

function analyzeHumanInvolvement(pages, ctx) {
  const out = [];
  const content = pages.filter(p => p.parse && CONTENT_TYPES[ctx.pageType.get(p.url)]);
  if (!content.length) {
    out.push(R.finding(R.get('RAP-OFFICIAL-HUMAN'), 'Site', 'manual',
      'Too few classified content pages to assess human-involvement signals. A crawler cannot definitively determine whether humans wrote a page.',
      { confidence: 0.5, reqStatus: 'Unable to Verify', severity: 'info' }));
    return out;
  }

  let withAuthor = 0, withBio = 0, firstHand = 0, sources = 0, generic = 0, lowVar = 0;
  const lowPages = [];
  const authors = new Set();

  content.forEach(p => {
    const pa = p.parse;
    const path = U.pathOf(p.url);
    const text = pa.mainText || '';
    if ((pa.author || '').length >= 2) { withAuthor++; authors.add(pa.author.toLowerCase()); }
    if (pa.hasAuthorPage || /author-bio|about-the-author|class=["'][^"']*bio/i.test(p.html || '')) withBio++;
    const fh = FIRST_HAND.test(text) || (pa.referenceCount >= 2 && /I |we /i.test(text.slice(0, 1500)));
    if (fh) firstHand++;
    if ((pa.referenceCount || 0) >= 2 || (pa.citationMarkers || 0) >= 2) sources++;
    const gen = GENERIC.test(text) || pa.genericIntros;
    if (gen) generic++;

    const phrases = U.repeatedPhrases(text, { ngram: 4, minCount: 5, top: 1 });
    const uniq = U.uniqueAfter(text, ctx.boilerplate).size;
    const template = U.boilerplateRatio(pa.visibleText, ctx.boilerplate) > 0.65;
    let risk = 0;
    const notes = [];
    if (!pa.author) { risk++; notes.push('no author byline'); }
    if (gen) { risk += 2; notes.push('generic repetitive language'); }
    if (phrases[0] && phrases[0].count >= 6) { risk += 2; notes.push('phrase “' + phrases[0].phrase + '” repeats ' + phrases[0].count + ' times'); }
    if (template && uniq < 80) { risk += 2; notes.push('extremely similar page template with low unique body text'); }
    if (!fh && (pa.referenceCount || 0) < 1 && uniq < 90) { risk++; notes.push('no first-hand detail or sources detected'); }
    if (risk >= 4) {
      lowVar++;
      lowPages.push(path);
      out.push(R.finding(R.get('RAP-H-HUMAN'), path, 'medium',
        'Potential low-human-involvement pattern: ' + notes.slice(0, 3).join('; ') + '. This is a heuristic, it does not prove the page was AI-generated or that a human did not write it.',
        { confidence: 0.62, severity: 'medium' }));
    }
  });

  const n = content.length;
  const authorPct = U.pct(withAuthor, n);
  const firstPct = U.pct(firstHand, n);
  const lowPct = U.pct(lowVar, n);
  const editorialIdentity = authors.size >= 1 && withAuthor / n >= 0.3;

  let status = 'passed';
  let reqStatus = 'Likely';
  if (lowPct >= 50 && firstPct < 15 && authorPct < 20) { status = 'high'; reqStatus = 'Needs Review'; }
  else if (lowPct >= 30 || (firstPct < 10 && authorPct < 15)) { status = 'medium'; reqStatus = 'Needs Review'; }
  else if (editorialIdentity && firstPct >= 20) { status = 'passed'; reqStatus = 'Likely'; }
  else { status = 'passed'; reqStatus = 'Likely'; }

  out.push(R.finding(R.get('RAP-OFFICIAL-HUMAN'), 'Site', status,
    n + ' content pages: ' + withAuthor + ' expose an author name (' + authorPct + '%), '
    + firstHand + ' show first-hand / experience language (' + firstPct + '%), '
    + sources + ' include source/reference language, '
    + lowVar + ' show a potential low-human-involvement pattern (' + lowPct + '%). '
    + 'A crawler cannot definitively determine whether humans wrote these pages. Status is therefore “' + reqStatus + '”, not a proof of authorship.',
    { confidence: 0.64, affected: lowVar + '/' + n, severity: status, reqStatus }));

  ctx.humanInvolvement = {
    contentPages: n,
    withAuthor, authorPct, firstHand, firstPct, sources, generic, lowVar, lowPct,
    authors: [...authors].slice(0, 12),
    reqStatus
  };
  return out;
}

module.exports = { analyzeHumanInvolvement };
