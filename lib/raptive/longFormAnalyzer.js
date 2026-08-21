'use strict';

const U = require('./util');
const R = require('./raptiveRules');
const { CONTENT_TYPES, UTILITY_TYPES } = require('./pageClassifier');

/**
 * Long-form content audit for Raptive's 25,000–99,999 tier
 * ("long-form content on the majority of pages").
 *
 * Eligible pages exclude privacy, terms, contact, about, search, login,
 * utility pages, and empty category pages.
 *
 * Does not treat a single word-count threshold as proof.
 */
function isEligible(type) {
  if (CONTENT_TYPES[type]) return true;
  if (UTILITY_TYPES[type]) return false;
  if (type === 'homepage' || type === 'other') return false;
  return false;
}

function longFormSignals(p, vocab) {
  const pa = p.parse;
  const words = pa.wordCount || 0;
  const uniq = U.uniqueAfter(pa.mainText, vocab).size;
  const paras = pa.paragraphCount || 0;
  const heads = pa.headingsCount || 0;
  const bp = U.boilerplateRatio(pa.visibleText, vocab);
  const contentRatio = 1 - bp;
  const sents = pa.sentenceCount || 0;
  let hits = 0;
  const notes = [];
  if (words >= 800) { hits += 2; notes.push(words + ' body words'); }
  else if (words >= 500) { hits += 1; notes.push(words + ' body words (moderate)'); }
  if (uniq >= 220) { hits += 2; notes.push(uniq + ' unique tokens after boilerplate'); }
  else if (uniq >= 160) { hits += 1; notes.push(uniq + ' unique tokens'); }
  if (paras >= 6) { hits += 1; notes.push(paras + ' paragraphs'); }
  else if (paras >= 4) { hits += 0.5; }
  if (heads >= 3) { hits += 1; notes.push(heads + ' headings'); }
  else if (heads >= 2) { hits += 0.5; }
  if (contentRatio >= 0.5) hits += 1;
  else notes.push('content-to-template ratio ' + Math.round(contentRatio * 100) + '%');
  if (sents >= 20) hits += 0.5;
  const substantial = hits >= 4 && words >= 500 && uniq >= 160;
  return { words, uniq, paras, heads, contentRatio, sents, hits, notes, substantial };
}

function analyzeLongForm(pages, ctx) {
  const out = [];
  const vocab = ctx.boilerplate;
  const eligible = pages.filter(p => p.parse && isEligible(ctx.pageType.get(p.url)));
  const emptyCats = pages.filter(p => p.parse && (ctx.pageType.get(p.url) === 'category' || ctx.pageType.get(p.url) === 'tag') && (p.parse.wordCount || 0) < 40);

  let longForm = 0, short = 0;
  const details = [];
  eligible.forEach(p => {
    const sig = longFormSignals(p, vocab);
    details.push({ url: p.url, path: U.pathOf(p.url), ...sig });
    if (sig.substantial) longForm++;
    else short++;
  });

  const coverage = eligible.length ? U.round(longForm / eligible.length * 100, 1) : 0;
  const majority = coverage >= R.LONG_FORM.majorityPct;

  ctx.longForm = {
    eligible: eligible.length,
    longForm,
    short,
    coverage,
    majority,
    emptyCategoryPages: emptyCats.length,
    sample: details.slice(0, 40)
  };

  if (!eligible.length) {
    out.push(R.finding(R.get('RAP-OFFICIAL-LONGFORM'), 'Site', 'medium',
      'No eligible content pages (articles/blog posts) were found after excluding privacy, terms, contact, about, search, login, and utility pages. Long-form majority cannot be demonstrated.',
      { confidence: 0.7, reqStatus: 'Needs Review' }));
    return out;
  }

  const evidence = longForm + ' of ' + eligible.length + ' eligible content pages contain substantial long-form content. '
    + coverage + '%. Utility pages (privacy, terms, contact, about, search, login) were excluded. '
    + 'Signals combined word count, unique words after boilerplate removal, paragraph count, heading count, and content-to-template ratio — not a single word-count threshold.';

  let status, reqStatus;
  if (majority && coverage >= 70) { status = 'passed'; reqStatus = 'Verified'; }
  else if (majority) { status = 'passed'; reqStatus = 'Likely'; }
  else if (coverage >= 30) { status = 'medium'; reqStatus = 'Needs Review'; }
  else { status = 'high'; reqStatus = 'Not Met'; }

  out.push(R.finding(R.get('RAP-OFFICIAL-LONGFORM'), 'Site', status, evidence, {
    confidence: 0.8,
    affected: longForm + '/' + eligible.length,
    severity: status,
    reqStatus
  }));

  out.push(R.finding(R.get('RAP-H-LONGFORM'), 'Site', status === 'passed' ? 'passed' : status,
    'Long-form coverage ' + coverage + '% (' + longForm + '/' + eligible.length + '). Average depth among eligible pages: '
    + (details.length ? Math.round(details.reduce((n, d) => n + d.words, 0) / details.length) : 0) + ' words.',
    { confidence: 0.78, affected: longForm + '/' + eligible.length, severity: status === 'passed' ? 'passed' : status }));

  return out;
}

module.exports = { analyzeLongForm, longFormSignals, isEligible };
