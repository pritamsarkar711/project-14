'use strict';

const U = require('./util');
const R = require('./mediavineRules');
const { CONTENT_TYPES } = require('./pageClassifier');

function unionFind() {
  const parent = {};
  function find(x) { parent[x] = parent[x] || x; if (parent[x] !== x) parent[x] = find(parent[x]); return parent[x]; }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }
  return { find, union, groups: nodes => { const m = {}; nodes.forEach(n => { const r = find(n); (m[r] = m[r] || []).push(n); }); return Object.values(m); } };
}

function analyzeDuplicates(pages, ctx) {
  const out = [];
  const vocab = ctx.boilerplate;
  const contentPages = pages.filter(p => p.parse && CONTENT_TYPES[ctx.pageType.get(p.url)]);
  const targets = contentPages.length ? contentPages : pages.filter(p => p.parse);
  const textOf = p => U.normalizeText(String(p.parse.mainText || '').replace(/\b(\w+\b(?:\.\w+)+)/g, ' '));

  const sigs = targets.map(p => ({ url: p.url, text: textOf(p), words: U.words(textOf(p)).length }));
  const tfMaps = sigs.map(s => U.tfMap(s.text));
  const idf = U.buildIdf(tfMaps);
  const tfidfVectors = tfMaps.map(tf => U.tfidfVector(tf, idf));
  const hashes = sigs.map(s => U.simHash(s.text));
  const shingleSets = sigs.map(s => U.shingles(s.text, 5));

  const pairs = [];
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const a = sigs[i], b = sigs[j];
      if (a.words < 30 || b.words < 30) continue;
      const ham = U.hamming64(hashes[i], hashes[j]);
      const simhashSim = 1 - ham / 64;
      const jac = U.jaccard(shingleSets[i], shingleSets[j]);
      // Cosine on TF-IDF vectors (not raw term frequencies) so common words do not dominate.
      const cos = U.cosineMap(tfidfVectors[i], tfidfVectors[j]);
      // SimHash is unreliable on short similar texts; treat it as supporting evidence only.
      const sim = Math.max(jac, 0.55 * cos + 0.45 * simhashSim);
      if (sim < 0.5) continue;
      const exact = a.text === b.text && a.words > 40;
      // shared sentence evidence
      const fpA = U.sentenceFingerprints(a.text);
      const fpB = new Map(U.sentenceFingerprints(b.text).map(s => [s.hash, s.text]));
      const shared = [];
      fpA.forEach(s => { if (fpB.has(s.hash)) shared.push(s.text); });
      if (sim >= 0.42 || exact) pairs.push({ a, b, sim: exact ? 1 : sim, exact, shared: shared.slice(0, 3) });
    }
  }
  pairs.sort((x, y) => y.sim - x.sim);

  const uf = unionFind();
  const nodes = [];
  pairs.forEach(d => { uf.union(d.a.url, d.b.url); nodes.push(d.a.url); nodes.push(d.b.url); });
  const clusters = uf.groups([...new Set(nodes)]);
  const dupUrls = new Set();
  pairs.forEach(d => { dupUrls.add(d.a.url); dupUrls.add(d.b.url); });
  const dupCount = dupUrls.size;
  const dupPct = U.pct(dupCount, targets.length);

  ctx.duplicateStats = {
    pairs: pairs.length,
    clusters: clusters.map(g => g.map(U.pathOf)),
    dupCount,
    dupPct,
    samples: pairs.slice(0, 8).map(d => ({ a: U.pathOf(d.a.url), b: U.pathOf(d.b.url), similarity: Math.round(d.sim * 100), exact: d.exact, shared: d.shared }))
  };

  if (pairs.length) {
    const top = pairs[0];
    const status = dupPct >= 40 || pairs.some(d => d.exact) ? 'high' : (dupPct >= 15 ? 'medium' : 'low');
    out.push(R.finding(R.get('MV-H-DUPLICATES'), 'Site', status,
      dupCount + ' of ' + targets.length + ' compared pages (' + dupPct + '%) fall into near-duplicate groups across '
      + clusters.length + ' cluster(s). Closest pair: ' + U.pathOf(top.a.url) + ' vs ' + U.pathOf(top.b.url)
      + ' at ' + Math.round(top.sim * 100) + '% similarity'
      + (top.shared[0] ? '. Shared text: "' + top.shared[0].slice(0, 140) + '"' : '') + '.',
      { confidence: 0.82, affected: dupCount + '/' + targets.length, urls: [...dupUrls].slice(0, 12).map(U.pathOf), sharedText: (top.shared || []).slice(0, 2).join(' | '), severity: status }));
  } else if (contentPages.length >= 2) {
    out.push(R.finding(R.get('MV-H-DUPLICATES'), 'Site', 'passed',
      'No near-duplicate body clusters found among ' + targets.length + ' compared pages (Jaccard, TF-IDF cosine, SimHash, sentence fingerprints).',
      { confidence: 0.75, severity: 'passed' }));
  }

  // duplicate titles
  const titleGroups = {};
  contentPages.forEach(p => { const t = (p.parse.title || '').trim().toLowerCase(); if (t) (titleGroups[t] = titleGroups[t] || []).push(p.url); });
  const dupTitles = Object.keys(titleGroups).filter(k => titleGroups[k].length > 1);
  if (dupTitles.length) {
    out.push(R.finding(R.get('MV-H-DUPLICATES'), 'Site', dupTitles.length >= 3 ? 'high' : 'medium',
      dupTitles.length + ' title(s) are reused. Example: "' + dupTitles[0].slice(0, 70) + '" on ' + titleGroups[dupTitles[0]].length + ' pages.',
      { confidence: 0.9, affected: String(dupTitles.length), severity: dupTitles.length >= 3 ? 'high' : 'medium' }));
  }
  return out;
}

module.exports = { analyzeDuplicates };
