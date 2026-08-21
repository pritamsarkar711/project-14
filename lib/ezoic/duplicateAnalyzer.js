'use strict';

const U = require('./util');
const R = require('./ezoicRules');
const { CONTENT_TYPES, UTILITY_TYPES } = require('./pageClassifier');

function unionFind() {
  const parent = {};
  function find(x) {
    parent[x] = parent[x] || x;
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  function groups(nodes) {
    const g = {};
    nodes.forEach(u => {
      const r = find(u);
      (g[r] = g[r] || []).push(u);
    });
    return Object.keys(g).map(k => g[k]).filter(x => x.length > 1);
  }
  return { find, union, groups };
}

function sharedSentenceEvidence(aText, bText) {
  const fa = U.sentenceFingerprints(aText);
  const fb = U.sentenceFingerprints(bText);
  const map = new Map();
  fa.forEach(s => map.set(s.hash, s.text));
  const shared = [];
  fb.forEach(s => { if (map.has(s.hash) && shared.length < 3) shared.push(map.get(s.hash)); });
  return shared;
}

function analyzeDuplicates(pages, ctx) {
  const out = [];
  const parsed = pages.filter(p => p.parse && !p.error);
  const contentPages = parsed.filter(p => CONTENT_TYPES[ctx.pageType.get(p.url)]);
  const targets = contentPages.slice();
  parsed.forEach(p => {
    if (targets.indexOf(p) >= 0) return;
    const t = ctx.pageType.get(p.url);
    if (t && UTILITY_TYPES[t]) return;
    if (p.parse.wordCount >= 80) targets.push(p);
  });

  if (targets.length < 2) {
    ctx.duplicateStats = { pairs: 0, clusters: [], dupCount: 0, dupPct: 0 };
    return out;
  }

  const tfs = targets.map(p => U.tfMap((p.parse.mainText || '').slice(0, 8000)));
  const idf = U.buildIdf(tfs);
  const vecs = tfs.map(tf => U.tfidfVector(tf, idf));
  const features = targets.map((p, i) => ({
    p,
    sh: U.shingles((p.parse.mainText || '').slice(0, 7000), 5),
    hash: U.simHash((p.parse.mainText || '').slice(0, 7000)),
    vec: vecs[i],
    norm: U.normalizeText((p.parse.mainText || '').slice(0, 4000))
  }));

  const pairs = [];
  const n = features.length;
  const maxCompare = n > 80 ? 80 : n;
  for (let i = 0; i < maxCompare; i++) {
    for (let j = i + 1; j < maxCompare; j++) {
      const ham = U.hamming64(features[i].hash, features[j].hash);
      if (ham > 18 && features[i].sh.size > 8 && features[j].sh.size > 8) continue;
      const jac = U.jaccard(features[i].sh, features[j].sh);
      const cos = U.cosineMap(features[i].vec, features[j].vec);
      const exact = features[i].norm.length > 80 && features[i].norm === features[j].norm;
      const sim = exact ? 1 : Math.max(jac, cos * 0.92);
      if (exact || sim >= 0.78 || (sim >= 0.62 && ham <= 8)) {
        const shared = sharedSentenceEvidence(features[i].p.parse.mainText, features[j].p.parse.mainText);
        pairs.push({
          a: features[i].p, b: features[j].p,
          sim: U.round(sim, 3), jac: U.round(jac, 3), cos: U.round(cos, 3), ham,
          exact, shared
        });
      }
    }
  }

  const uf = unionFind();
  pairs.forEach(d => uf.union(d.a.url, d.b.url));
  const nodes = [];
  pairs.forEach(d => { nodes.push(d.a.url); nodes.push(d.b.url); });
  const clusters = uf.groups([...new Set(nodes)]);
  const dupUrls = new Set();
  pairs.forEach(d => { dupUrls.add(d.a.url); dupUrls.add(d.b.url); });
  const dupCount = dupUrls.size;
  const dupPct = U.pct(dupCount, targets.length);

  ctx.duplicateStats = {
    pairs: pairs.length,
    clusters: clusters.map(g => g.map(u => U.pathOf(u))),
    dupCount,
    dupPct,
    samples: pairs.slice(0, 8).map(d => ({
      a: U.pathOf(d.a.url),
      b: U.pathOf(d.b.url),
      similarity: Math.round(d.sim * 100),
      exact: d.exact,
      shared: d.shared
    }))
  };

  if (pairs.length) {
    const top = pairs.slice().sort((a, b) => b.sim - a.sim)[0];
    const status = dupPct >= 40 || pairs.some(d => d.exact) ? 'high' : (dupPct >= 15 ? 'medium' : 'low');
    out.push(R.finding(R.get('EZ-UNIQUE-TITLES'), 'Site', status,
      dupCount + ' of ' + targets.length + ' compared pages (' + dupPct
      + '%) are near-duplicates across ' + clusters.length + ' cluster(s). '
      + 'Closest pair: ' + U.pathOf(top.a.url) + ' vs ' + U.pathOf(top.b.url)
      + ' at ' + Math.round(top.sim * 100) + '% similarity'
      + (top.shared[0] ? '. Shared text: “' + top.shared[0].slice(0, 140) + '”' : '') + '.',
      {
        confidence: 0.82,
        affected: dupCount + '/' + targets.length,
        urls: [...dupUrls].slice(0, 12).map(U.pathOf),
        sharedText: (top.shared || []).slice(0, 2).join(' | '),
        severity: status
      }));
  } else if (contentPages.length >= 2) {
    out.push(R.finding(R.get('EZ-UNIQUE-TITLES'), 'Site', 'passed',
      'No near-duplicate body clusters found among ' + targets.length + ' compared pages (Jaccard/TF-IDF/SimHash).',
      { confidence: 0.75, severity: 'passed' }));
  }

  const titleGroups = {};
  contentPages.forEach(p => {
    const t = (p.parse.title || '').trim().toLowerCase();
    if (t) (titleGroups[t] = titleGroups[t] || []).push(p.url);
  });
  const dupTitles = Object.keys(titleGroups).filter(k => titleGroups[k].length > 1);
  if (dupTitles.length) {
    out.push(R.finding(R.get('EZ-UNIQUE-TITLES'), 'Site', dupTitles.length >= 3 ? 'high' : 'medium',
      dupTitles.length + ' title(s) are reused. Example: “' + dupTitles[0].slice(0, 70) + '” on '
      + titleGroups[dupTitles[0]].length + ' pages.',
      { confidence: 0.9, affected: String(dupTitles.length), severity: dupTitles.length >= 3 ? 'high' : 'medium' }));
  }

  return out;
}

module.exports = { analyzeDuplicates };
