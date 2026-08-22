'use strict';

const U = require('./util');
const R = require('./ezoicRules');
const { CONTENT_TYPES, skipThinRules } = require('./pageClassifier');

function analyzeContent(pages, ctx) {
  const out = [];
  const vocab = ctx.boilerplate;
  const siteType = ctx.siteType;
  const contentPages = pages.filter(p => p.parse && CONTENT_TYPES[ctx.pageType.get(p.url)]);
  const targets = contentPages.length ? contentPages : pages.filter(p => p.parse && !skipThinRules(ctx.pageType.get(p.url), siteType));

  let imageOnly = 0;
  let stuffed = 0;
  let thin = 0;
  let empty = 0;
  let good = 0;
  let dated = 0;
  const imageOnlyUrls = [];
  const thinUrls = [];

  targets.forEach(p => {
    const path = U.pathOf(p.url);
    const pa = p.parse;
    if (!pa) return;
    const ptype = ctx.pageType.get(p.url);
    const uniq = [...U.uniqueAfter(pa.mainText, vocab)];
    const bp = U.boilerplateRatio(pa.visibleText, vocab);
    const topPhrase = U.repeatedPhrases(pa.mainText, { ngram: 4, minCount: 4, top: 4 });

    const sents = U.sentences(pa.mainText).map(x => x.trim().toLowerCase()).filter(x => x.length > 30);
    const sentCounts = {};
    let worstSent = null;
    sents.forEach(x => {
      sentCounts[x] = (sentCounts[x] || 0) + 1;
      if (!worstSent || sentCounts[x] > worstSent.n) worstSent = { s: x, n: sentCounts[x] };
    });

    if (skipThinRules(ptype, siteType) && ptype !== 'homepage') {
      if (pa.loremIpsum) {
        out.push(R.finding(R.get('EZ-NO-AUTOGEN'), path, 'high',
          'Placeholder copy detected on a ' + ptype + ' page.',
          { confidence: 0.9, why: R.get('EZ-NO-AUTOGEN').why, fix: 'Replace placeholder text with real information.' }));
      }
      return;
    }

    if (pa.wordCount < 20 || uniq.length < 10) {
      empty++;
      thinUrls.push(path);
      out.push(R.finding(R.get('EZ-ORIGINAL-CONTENT'), path, 'high',
        pa.wordCount + ' body words and ' + uniq.length + ' unique words after removing repeated navigation/footer vocabulary.',
        { confidence: 0.9, affected: path, severity: 'high' }));
      return;
    }

    const imageOnlyPage = pa.imageCount >= 4 && uniq.length < 40 && pa.wordCount < 80;
    if (imageOnlyPage && CONTENT_TYPES[ptype]) {
      imageOnly++;
      imageOnlyUrls.push(path);
    }

    if (uniq.length < 50 || (uniq.length < 80 && pa.wordCount < 220)) {
      thin++;
      thinUrls.push(path);
      out.push(R.finding(R.get('EZ-ORIGINAL-CONTENT'), path, uniq.length < 30 ? 'high' : 'medium',
        pa.wordCount + ' total body words, ' + uniq.length + ' unique words after boilerplate removal'
        + (pa.paragraphCount ? ' across ' + pa.paragraphCount + ' paragraphs' : '') + '.',
        { confidence: 0.86, severity: uniq.length < 30 ? 'high' : 'medium' }));
    } else {
      good++;
      out.push({
        id: 'CONTENT_SUBSTANTIAL',
        category: 'content',
        name: 'Substantial unique content',
        status: 'passed',
        severity: 'passed',
        page: path,
        urls: [path],
        evidence: uniq.length + ' unique body-text words, ' + pa.paragraphCount + ' paragraphs, ' + pa.headingsCount + ' headings.',
        why: 'Pages with original depth are the core quality signal Ezoic describes as constructive and enticing.',
        fix: 'Keep the page updated and accurate.',
        confidence: 88,
        sourceType: 'official',
        sourceUrl: R.SRC.content.url,
        lastVerified: R.VERIFIED,
        automated: true,
        weight: 3
      });
    }

    if (bp > 0.55) {
      out.push({
        id: 'CONTENT_BOILERPLATE',
        category: 'content',
        name: 'Template-heavy page',
        status: 'medium',
        severity: 'medium',
        page: path,
        evidence: '~' + Math.round(bp * 100) + '% of visible words also appear on most other crawled pages (nav/footer/sidebar).',
        why: 'Heuristic. Template chrome is not original article content.',
        fix: 'Increase unique body copy relative to repeating chrome.',
        confidence: 74,
        sourceType: 'heuristic',
        automated: true,
        weight: 3
      });
    }

    if (pa.loremIpsum) {
      out.push(R.finding(R.get('EZ-NO-AUTOGEN'), path, 'high',
        'Placeholder phrases such as “lorem ipsum” or “insert text here” appear in the body.',
        { confidence: 0.95 }));
    }

    if (worstSent && worstSent.n >= 5) {
      out.push(R.finding(R.get('EZ-NO-AUTOGEN'), path, 'medium',
        'The sentence “' + worstSent.s.slice(0, 110) + '” repeats ' + worstSent.n + ' times on this page.',
        { confidence: 0.7, sharedText: worstSent.s.slice(0, 160) }));
    }

    if (pa.keywords.length) {
      const k = pa.keywords[0];
      const density = k[1] / Math.max(1, pa.wordCount);
      const headingHits = pa.h1.concat(pa.h2).filter(h => new RegExp('\\b' + k[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(h)).length;
      if ((k[1] >= 14 && density > 0.045) || (topPhrase[0] && topPhrase[0].count >= 8) || (headingHits >= 3 && k[1] >= 10)) {
        stuffed++;
        out.push(R.finding(R.get('EZ-NO-KEYWORD-STUFF'), path, 'medium',
          '"' + k[0] + '" appears ' + k[1] + ' times (' + (density * 100).toFixed(1) + '% of words)'
          + (topPhrase[0] ? '; phrase “' + topPhrase[0].phrase + '” appears ' + topPhrase[0].count + ' times' : '')
          + (headingHits >= 3 ? '; repeated in ' + headingHits + ' headings' : '') + '.',
          { confidence: 0.8 }));
      }
    }

    topPhrase.filter(x => x.count >= 5).slice(0, 2).forEach(tp => {
      out.push({
        id: 'CONTENT_REPEATED_PHRASE',
        category: 'content',
        name: 'Repeated phrase',
        status: 'low',
        severity: 'low',
        page: path,
        evidence: 'Phrase “' + tp.phrase + '” appears ' + tp.count + ' times.',
        why: 'Heuristic. Heavy repetition can read as padded or generated.',
        fix: 'Vary wording.',
        confidence: 62,
        sourceType: 'heuristic',
        automated: true,
        weight: 2
      });
    });

    if (CONTENT_TYPES[ptype] && pa.headingsCount === 0 && pa.wordCount > 120) {
      out.push({
        id: 'CONTENT_HEADINGS',
        category: 'content',
        name: 'Heading structure',
        status: 'medium',
        severity: 'medium',
        page: path,
        evidence: 'No H1–H6 headings on a ' + pa.wordCount + '-word page.',
        why: 'Heuristic. Headings make long content scannable.',
        fix: 'Add a single H1 and descriptive H2 sections.',
        confidence: 80,
        sourceType: 'heuristic',
        automated: true,
        weight: 2
      });
    }

    if (CONTENT_TYPES[ptype] && pa.published) dated++;

    const fre = U.fleschReadingEase(pa.mainText);
    if (fre != null && fre < 35 && pa.wordCount > 200) {
      out.push({
        id: 'CONTENT_READABILITY',
        category: 'content',
        name: 'Readability',
        status: 'low',
        severity: 'low',
        page: path,
        evidence: 'Flesch Reading Ease ' + Math.round(fre) + '/100 on this page.',
        why: 'Heuristic. Not an official Ezoic metric.',
        fix: 'Shorten sentences where the topic allows.',
        confidence: 55,
        sourceType: 'heuristic',
        automated: true,
        weight: 1
      });
    }
  });

  if (imageOnly) {
    out.push(R.finding(R.get('EZ-THIN-IMAGES'), 'Site', imageOnly >= 3 ? 'high' : 'medium',
      imageOnly + ' content page(s) have several images but fewer than 40 unique body words'
      + (imageOnlyUrls.length ? ' (e.g. ' + imageOnlyUrls.slice(0, 4).join(', ') + ')' : '') + '.',
      { confidence: 0.84, affected: imageOnly + '/' + (contentPages.length || targets.length), urls: imageOnlyUrls.slice(0, 8) }));
  } else if (contentPages.length) {
    out.push(R.finding(R.get('EZ-THIN-IMAGES'), 'Site', 'passed',
      'No image-only content pages detected among ' + contentPages.length + ' classified content pages. Tool/utility pages were excluded.',
      { confidence: 0.78, severity: 'passed' }));
  }

  if (siteType === 'tools') {
    out.push({
      id: 'CONTENT_TOOL_NOTE',
      category: 'content',
      name: 'Tool site content standard',
      status: 'info',
      severity: 'info',
      page: 'Site',
      evidence: 'Site classified as a tools site. Ezoic Content Guidelines state tool sites are not required to have a blog component.',
      why: 'Official exception, do not treat missing articles as a thin-content failure on a genuine tools site.',
      fix: 'Keep each tool page useful and original. A blog is optional.',
      confidence: 90,
      sourceType: 'official',
      sourceUrl: R.SRC.content.url,
      lastVerified: R.VERIFIED,
      automated: true,
      weight: 0
    });
  }

  const articlePages = pages.filter(p => p.parse && CONTENT_TYPES[ctx.pageType.get(p.url)]);
  if (articlePages.length) {
    const withDate = articlePages.filter(p => p.parse.published).length;
    const ratio = withDate / articlePages.length;
    out.push(R.finding(R.get('EZ-PUBLISH-DATE'), 'Site',
      ratio >= 0.6 ? 'passed' : (ratio === 0 ? 'medium' : 'low'),
      withDate + ' of ' + articlePages.length + ' content pages expose a publish date (meta, JSON-LD, or time element).',
      { confidence: 0.7, affected: withDate + '/' + articlePages.length, severity: ratio >= 0.6 ? 'passed' : (ratio === 0 ? 'medium' : 'low') }));
  }

  ctx.contentStats = {
    contentPages: contentPages.length,
    thin, empty, good, stuffed, imageOnly, dated,
    thinUrls, imageOnlyUrls
  };
  return out;
}

module.exports = { analyzeContent };
