'use strict';

const U = require('./util');
const R = require('./mediavineRules');
const { CONTENT_TYPES, skipThinRules, isContentPage } = require('./pageClassifier');

/**
 * Original content audit + content portfolio audit + audience-first signals.
 * Never uses word count alone to judge quality.
 */
function analyzeContent(pages, ctx) {
  const out = [];
  const vocab = ctx.boilerplate;
  const siteType = ctx.siteType;
  const contentPages = pages.filter(p => p.parse && CONTENT_TYPES[ctx.pageType.get(p.url)]);
  const targets = contentPages.length ? contentPages : pages.filter(p => p.parse && !skipThinRules(ctx.pageType.get(p.url), siteType));

  let thin = 0, empty = 0, good = 0, imageOnly = 0;
  const thinUrls = [], emptyUrls = [], imageOnlyUrls = [];
  let audienceFirstRiskPages = 0;
  const audienceRisk = [];
  let deepPages = 0;

  targets.forEach(p => {
    const path = U.pathOf(p.url);
    const pa = p.parse;
    if (!pa) return;
    const ptype = ctx.pageType.get(p.url);
    const uniq = [...U.uniqueAfter(pa.mainText, vocab)];
    const bp = U.boilerplateRatio(pa.visibleText, vocab);

    if (skipThinRules(ptype, siteType) && ptype !== 'homepage') {
      if (pa.loremIpsum) {
        out.push(R.finding(R.get('MV-OFFICIAL-ORIGINAL-CONTENT'), path, 'high',
          'Placeholder copy detected on a ' + ptype + ' page ("lorem ipsum" / "insert text here").',
          { confidence: 0.9, severity: 'high' }));
      }
      return;
    }

    // Thin / empty detection (unique words after boilerplate, not raw word count)
    if (pa.wordCount < 20 || uniq.length < 10) {
      empty++; emptyUrls.push(path);
      out.push(R.finding(R.get('MV-OFFICIAL-ORIGINAL-CONTENT'), path, 'high',
        'Only ' + pa.wordCount + ' body words and ' + uniq.length + ' unique words after removing repeated navigation/footer vocabulary.',
        { confidence: 0.9, severity: 'high', affected: path }));
      return;
    }

    const imageOnlyPage = pa.imageCount >= 4 && uniq.length < 40 && pa.wordCount < 80;
    if (imageOnlyPage && CONTENT_TYPES[ptype]) { imageOnly++; imageOnlyUrls.push(path); }

    if (uniq.length < 50 || (uniq.length < 80 && pa.wordCount < 220)) {
      thin++; thinUrls.push(path);
      out.push(R.finding(R.get('MV-OFFICIAL-ORIGINAL-CONTENT'), path, uniq.length < 30 ? 'high' : 'medium',
        pa.wordCount + ' total body words, ' + uniq.length + ' unique words after boilerplate removal'
        + (pa.paragraphCount ? ' across ' + pa.paragraphCount + ' paragraphs' : '') + '.',
        { confidence: 0.86, severity: uniq.length < 30 ? 'high' : 'medium' }));
    } else {
      good++;
      if (pa.wordCount >= 600 && pa.headingsCount >= 3) deepPages++;
      out.push({
        id: 'MV-CONTENT-SUBSTANTIAL',
        category: 'content',
        name: 'Substantial unique content',
        status: 'passed',
        severity: 'passed',
        page: path,
        urls: [path],
        evidence: uniq.length + ' unique body-text words after boilerplate removal, ' + pa.paragraphCount + ' paragraphs, ' + pa.headingsCount + ' headings.',
        why: 'Original depth is the core quality signal in Mediavine\u2019s audience-first content review.',
        fix: 'Keep the page updated and accurate.',
        confidence: 88,
        sourceType: 'official',
        sourceUrl: R.SRC.approve.url,
        lastVerified: R.VERIFIED,
        automated: true,
        weight: 3
      });
    }

    if (bp > 0.6) {
      out.push(R.finding(R.get('MV-H-CONTENT-DEPTH'), path, 'medium',
        '~' + Math.round(bp * 100) + '% of visible words also appear on most other crawled pages (nav/footer/sidebar) — template-heavy.',
        { confidence: 0.72, severity: 'medium' }));
    }

    if (pa.loremIpsum) {
      out.push(R.finding(R.get('MV-OFFICIAL-ORIGINAL-CONTENT'), path, 'high',
        'Placeholder phrases such as "lorem ipsum" or "insert text here" appear in the body.',
        { confidence: 0.95 }));
    }

    /* Audience-first risk signals (labeled as potential pattern, never a definitive Google classification) */
    const topPhrase = U.repeatedPhrases(pa.mainText, { ngram: 4, minCount: 4, top: 3 });
    const k0 = pa.keywords && pa.keywords[0];
    const density = k0 ? k0[1] / Math.max(1, pa.wordCount) : 0;
    const headingHits = pa.h1.concat(pa.h2).filter(h => new RegExp('\\b' + (k0 ? k0[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '___') + '\\b', 'i').test(h)).length;
    let riskScore = 0;
    const riskNotes = [];
    if (k0 && k0[1] >= 14 && density > 0.045) { riskScore += 2; riskNotes.push('"' + k0[0] + '" appears ' + k0[1] + ' times (' + (density * 100).toFixed(1) + '% of words)'); }
    if (topPhrase[0] && topPhrase[0].count >= 8) { riskScore += 2; riskNotes.push('phrase "' + topPhrase[0].phrase + '" repeats ' + topPhrase[0].count + ' times'); }
    if (headingHits >= 3) { riskScore += 1; riskNotes.push('target keyword repeated in ' + headingHits + ' headings'); }
    if (pa.genericIntros) { riskScore += 1; riskNotes.push('generic intro/conclusion boilerplate detected'); }
    if (bp > 0.7) { riskScore += 1; riskNotes.push('more than 70% of visible text is shared template chrome'); }
    if (pa.headingKeywordHits >= 4 && pa.wordCount < 500) { riskScore += 1; riskNotes.push('many listicle-style keyword headings on a short page'); }
    if (riskScore >= 3) {
      audienceFirstRiskPages++;
      audienceRisk.push(path);
      out.push(R.finding(R.get('MV-APPROVE-AUDIENCE-FIRST'), path, riskScore >= 5 ? 'high' : 'medium',
        'Potential Search-First Content Pattern detected: ' + riskNotes.slice(0, 3).join('; ') + '. This is a heuristic estimate, not a definitive Google helpful-content classification.',
        { confidence: 0.7, severity: riskScore >= 5 ? 'high' : 'medium' }));
    }

    /* repeated sentence */
    const sents = U.sentences(pa.mainText).map(x => x.trim().toLowerCase()).filter(x => x.length > 30);
    const sc = {}; let worst = null;
    sents.forEach(x => { sc[x] = (sc[x] || 0) + 1; if (!worst || sc[x] > worst.n) worst = { s: x, n: sc[x] }; });
    if (worst && worst.n >= 5) {
      out.push(R.finding(R.get('MV-H-CONTENT-DEPTH'), path, 'medium',
        'The sentence "' + worst.s.slice(0, 110) + '" repeats ' + worst.n + ' times on this page.',
        { confidence: 0.7, sharedText: worst.s.slice(0, 160) }));
    }

    const fre = U.fleschReadingEase(pa.mainText);
    if (fre != null && fre < 35 && pa.wordCount > 200) {
      out.push({
        id: 'MV-CONTENT-READABILITY',
        category: 'content', name: 'Readability', status: 'low', severity: 'low', page: path,
        evidence: 'Flesch Reading Ease ' + Math.round(fre) + '/100 on this page.',
        why: 'Heuristic. Not an official Mediavine metric.', fix: 'Shorten long sentences where the topic allows.',
        confidence: 55, sourceType: 'heuristic', automated: true, weight: 1
      });
    }
  });

  /* ----- Content portfolio audit (site-wide) ----- */
  const total = targets.length || 1;
  const usefulPct = contentPages.length ? Math.round((good / contentPages.length) * 100) : 0;
  const thinPct = U.pct(thin + empty, contentPages.length || 1);
  ctx.contentPortfolio = {
    totalCrawled: pages.filter(p => p.parse).length,
    contentPages: contentPages.length,
    useful: good,
    usefulPct,
    thin,
    empty,
    thinPct,
    deepPages,
    averageDepth: ctx.archStats ? ctx.archStats.avgDepth : 0,
    uniqueContentPct: contentPages.length ? Math.round((good / contentPages.length) * 100) : 0,
    thinContentPct: thinPct,
    audienceFirstRiskPages,
    audienceRisk
  };

  if (contentPages.length >= 2) {
    const ratioGood = good / contentPages.length;
    let status;
    if (ratioGood >= 0.65) status = 'passed';
    else if (thinPct >= 60 || ratioGood < 0.3) status = 'high';
    else status = 'medium';
    out.push(R.finding(R.get('MV-H-CONTENT-PORTFOLIO'), 'Site', status,
      contentPages.length + ' content pages analyzed: ' + good + ' substantial (' + Math.round(ratioGood * 100) + '%), '
      + thin + ' thin, ' + empty + ' empty after boilerplate removal. ' + (deepPages ? deepPages + ' are long-form (600+ words).' : ''),
      { confidence: 0.86, affected: good + '/' + contentPages.length, severity: status }));
  } else if (siteType !== 'tools' && pages.filter(p => p.parse).length) {
    out.push(R.finding(R.get('MV-OFFICIAL-ORIGINAL-CONTENT'), 'Site', 'medium',
      'Fewer than 2 classified article/content pages were found in the crawl. A substantial content library could not be demonstrated.',
      { confidence: 0.7 }));
  }

  ctx.contentStats = { contentPages: contentPages.length, thin, empty, good, imageOnly, thinUrls, emptyUrls, imageOnlyUrls };
  return out;
}

module.exports = { analyzeContent };
