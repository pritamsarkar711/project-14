'use strict';

const U = require('./util');
const R = require('./raptiveRules');
const { CONTENT_TYPES } = require('./pageClassifier');

/**
 * Deep internal originality audit.
 * Never claims copyright ownership or AI authorship.
 * Labels: Potential duplication signal · Low unique-content ratio · High template similarity.
 */
function analyzeOriginality(pages, ctx) {
  const out = [];
  const vocab = ctx.boilerplate;
  const contentPages = pages.filter(p => p.parse && CONTENT_TYPES[ctx.pageType.get(p.url)]);
  const targets = contentPages.length ? contentPages : pages.filter(p => p.parse);
  if (!targets.length) return out;

  let uniqueSum = 0, wordSum = 0, templateHeavy = 0;
  const lowUnique = [];
  const phraseHits = [];

  targets.forEach(p => {
    const pa = p.parse;
    const path = U.pathOf(p.url);
    const uniq = U.uniqueAfter(pa.mainText, vocab);
    const words = U.words(pa.mainText).length;
    const bp = U.boilerplateRatio(pa.visibleText, vocab);
    uniqueSum += uniq.size;
    wordSum += words;
    const uniqueRatio = words ? uniq.size / Math.max(1, U.tokenSet(pa.mainText, 4).size || uniq.size) : 0;
    const contentToTemplate = 1 - bp;

    if (CONTENT_TYPES[ctx.pageType.get(p.url)] && words >= 40 && contentToTemplate < 0.35) {
      templateHeavy++;
      out.push(R.finding(R.get('RAP-H-ORIGINALITY'), path, 'medium',
        'High template similarity: ~' + Math.round(bp * 100) + '% of visible words also appear on most other crawled pages after navigation/footer extraction. Unique body-text coverage is low.',
        { confidence: 0.72, severity: 'medium' }));
    }
    if (CONTENT_TYPES[ctx.pageType.get(p.url)] && words >= 80 && uniq.size < 40) {
      lowUnique.push(path);
      out.push(R.finding(R.get('RAP-H-ORIGINALITY'), path, uniq.size < 20 ? 'high' : 'medium',
        'Low unique-content ratio: ' + uniq.size + ' unique body-text tokens after boilerplate removal on a ' + words + '-word page.',
        { confidence: 0.8, severity: uniq.size < 20 ? 'high' : 'medium' }));
    }

    const phrases = U.repeatedPhrases(pa.mainText, { ngram: 5, minCount: 4, top: 3 });
    if (phrases[0] && phrases[0].count >= 5) {
      phraseHits.push(path);
      out.push(R.finding(R.get('RAP-H-ORIGINALITY'), path, 'medium',
        'Potential duplication signal: 5-gram “' + phrases[0].phrase + '” repeats ' + phrases[0].count + ' times on this page.',
        { confidence: 0.7, sharedText: phrases[0].phrase, severity: 'medium' }));
    }
  });

  const dup = ctx.duplicateStats || { dupPct: 0, dupCount: 0, clusters: [] };
  const uniquePct = targets.length ? Math.round((1 - (dup.dupPct || 0) / 100) * 100) : 0;
  const lowUniquePct = U.pct(lowUnique.length, contentPages.length || 1);

  let status = 'passed';
  if ((dup.dupPct || 0) >= 40 || lowUniquePct >= 50 || templateHeavy / Math.max(1, contentPages.length) >= 0.5) status = 'high';
  else if ((dup.dupPct || 0) >= 15 || lowUniquePct >= 25 || templateHeavy >= 2) status = 'medium';

  out.push(R.finding(R.get('RAP-OFFICIAL-ORIGINAL'), 'Site', status,
    contentPages.length + ' eligible content page(s). Near-duplicate share ' + (dup.dupPct || 0) + '% (' + (dup.dupCount || 0) + ' pages in clusters). '
    + lowUnique.length + ' page(s) show low unique-content ratio after navigation and footer boilerplate removal. '
    + templateHeavy + ' page(s) show high template similarity. This is an internal originality screen, not proof of copyright ownership or AI authorship.',
    { confidence: 0.78, affected: lowUnique.length + '/' + (contentPages.length || 0), severity: status }));

  ctx.originality = {
    contentPages: contentPages.length,
    uniquePct,
    lowUnique: lowUnique.length,
    templateHeavy,
    phraseHits: phraseHits.length,
    dupPct: dup.dupPct || 0
  };
  return out;
}

module.exports = { analyzeOriginality };
