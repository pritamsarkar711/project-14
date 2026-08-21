'use strict';

const TRACKING = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid', 'ref', 'ref_src',
  '_ga', '_gl', 'spm', 'yclid', 'wickedid', 'igshid', 'si'
]);

const STOP = new Set(('a,about,after,all,also,an,and,any,are,as,at,be,because,been,before,being,between,both,but,by,can,come,could,did,do,does,doing,down,during,each,few,for,from,further,get,got,has,had,he,her,here,hers,him,his,how,i,if,in,into,is,it,its,just,like,make,made,may,me,might,more,most,my,no,nor,not,now,of,off,on,once,one,only,or,other,our,out,over,own,same,she,should,so,some,such,than,that,the,their,them,then,there,these,they,this,those,through,to,too,under,until,up,very,was,we,well,were,what,when,where,which,while,who,whom,why,will,with,would,you,your,page,home,post,content,image,https,http,www,com,org,net,blog,article,read,using,use,used,new,even,also').split(','));

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function round(n, d) { d = d || 0; const p = Math.pow(10, d); return Math.round(n * p) / p; }
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function normalizeUrl(raw, base) {
  try {
    const u = new URL(raw, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    [...u.searchParams.keys()].forEach(k => {
      if (TRACKING.has(k.toLowerCase())) u.searchParams.delete(k);
    });
    if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
    let s = u.toString();
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) s = s.replace(/\/$/, '');
    return s;
  } catch (e) {
    return null;
  }
}

function hostOf(u) { try { return new URL(u).hostname; } catch (e) { return ''; } }
function originOf(u) { try { return new URL(u).origin; } catch (e) { return ''; } }
function pathOf(u) { try { return new URL(u).pathname || '/'; } catch (e) { return String(u || ''); } }
function normHost(h) { return String(h || '').toLowerCase().replace(/^www\./, ''); }
function sameSite(a, b) {
  try { return normHost(new URL(a).hostname) === normHost(new URL(b).hostname); }
  catch (e) { return false; }
}

const ASSET_RE = /\.(jpe?g|png|webp|gif|svg|avif|ico|bmp|css|js|mjs|json|pdf|zip|woff2?|ttf|eot|mp4|webm|mp3|exe|dmg|apk|rss|atom)(\?|#|$)/i;
function isAsset(u) { return ASSET_RE.test(u || ''); }
function isHtmlCtype(ct) { return !ct || /html|xhtml|xml|text\/plain/i.test(ct); }

function words(text) {
  return (String(text || '').match(/[\p{L}\p{N}']+/gu) || []).filter(w => /[\p{L}\p{N}]/u.test(w));
}
function sentences(text) {
  const s = String(text || '').match(/[^.!?]+[.!?]+/g) || [];
  return s.length ? s : (text && String(text).trim() ? [String(text)] : []);
}
function syllables(word) {
  word = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (!word) return 0;
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const m = word.match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}
function fleschReadingEase(text) {
  const w = words(text); const s = Math.max(1, sentences(text).length);
  if (w.length < 8) return null;
  const sy = w.reduce((n, x) => n + syllables(x), 0);
  return clamp(206.835 - 1.015 * (w.length / s) - 84.6 * (sy / w.length), 0, 100);
}

function keywordFreq(text, n) {
  n = n || 30;
  const f = {};
  words(text).forEach(w => {
    w = w.toLowerCase();
    if (w.length >= 4 && !STOP.has(w)) f[w] = (f[w] || 0) + 1;
  });
  return Object.keys(f).map(k => [k, f[k]]).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function repeatedPhrases(text, opt) {
  opt = opt || {};
  const ng = opt.ngram || 3, min = opt.minCount || 3, top = opt.top || 20;
  const toks = words(text).map(w => w.toLowerCase()).filter(w => w.length > 2 && !STOP.has(w));
  const counts = new Map();
  for (let i = 0; i + ng <= toks.length; i++) {
    const g = toks.slice(i, i + ng).join(' ');
    counts.set(g, (counts.get(g) || 0) + 1);
  }
  const arr = [];
  counts.forEach((c, g) => { if (c >= min) arr.push({ phrase: g, count: c }); });
  return arr.sort((a, b) => b.count - a.count).slice(0, top);
}

function tokenSet(text, minLen) {
  minLen = minLen || 4;
  const s = new Set();
  words(text).forEach(w => {
    w = w.toLowerCase();
    if (w.length >= minLen && !STOP.has(w)) s.add(w);
  });
  return s;
}

function uniqueAfter(text, vocab) {
  const s = new Set();
  words(text).forEach(w => {
    w = w.toLowerCase();
    if (w.length >= 4 && !STOP.has(w) && !(vocab && vocab.has(w))) s.add(w);
  });
  return s;
}

function boilerplateRatio(visible, vocab) {
  const pw = words(visible).length;
  if (!pw) return 0;
  let c = 0;
  words(visible).forEach(w => { if (vocab && vocab.has(w.toLowerCase())) c++; });
  return clamp(c / pw, 0, 1);
}

function shingles(text, k) {
  k = k || 5;
  const ws = words(text).map(w => w.toLowerCase()).filter(w => w.length > 2 && !STOP.has(w));
  const s = new Set();
  for (let i = 0; i + k <= ws.length; i++) s.add(ws.slice(i, i + k).join(' '));
  return s;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach(x => { if (b.has(x)) inter++; });
  return inter / (a.size + b.size - inter);
}

function tfMap(text) {
  const m = {};
  words(text).forEach(w => {
    w = w.toLowerCase();
    if (w.length >= 3 && !STOP.has(w)) m[w] = (m[w] || 0) + 1;
  });
  return m;
}

function cosineMap(a, b) {
  let dot = 0, na = 0, nb = 0;
  const keys = new Set(Object.keys(a).concat(Object.keys(b)));
  keys.forEach(k => {
    const x = a[k] || 0, y = b[k] || 0;
    dot += x * y; na += x * x; nb += y * y;
  });
  return (!na || !nb) ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function buildIdf(maps) {
  const df = {};
  const n = maps.length || 1;
  maps.forEach(m => {
    Object.keys(m).forEach(k => { df[k] = (df[k] || 0) + 1; });
  });
  const idf = {};
  Object.keys(df).forEach(k => { idf[k] = Math.log((n + 1) / (df[k] + 1)) + 1; });
  return idf;
}

function tfidfVector(tf, idf) {
  const v = {};
  Object.keys(tf).forEach(k => { v[k] = tf[k] * (idf[k] || 1); });
  return v;
}

function simHash(text) {
  const v = new Array(64).fill(0);
  words(text).forEach(w => {
    w = w.toLowerCase();
    let h = 0n;
    for (let i = 0; i < w.length; i++) h = ((h << 5n) - h + BigInt(w.charCodeAt(i))) & 0xffffffffffffffffn;
    for (let i = 0; i < 64; i++) v[i] += ((h >> BigInt(i)) & 1n) ? 1 : -1;
  });
  let out = 0n;
  for (let i = 0; i < 64; i++) if (v[i] > 0) out |= (1n << BigInt(i));
  return out;
}

function hamming64(a, b) {
  let x = a ^ b, n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

function sentenceFingerprints(text) {
  const out = [];
  sentences(text).forEach(s => {
    const n = s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (n.length < 40) return;
    let h = 2166136261;
    for (let i = 0; i < n.length; i++) h = Math.imul(h ^ n.charCodeAt(i), 16777619);
    out.push({ hash: h >>> 0, text: n.slice(0, 180) });
  });
  return out;
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sample(arr, n) {
  if (!arr || arr.length <= n) return arr ? arr.slice() : [];
  const out = [];
  const step = arr.length / n;
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round(part / whole * 100);
}

function makeError(code, msg, cause) {
  const e = new Error(msg);
  e.code = code;
  if (cause) e.cause = cause;
  return e;
}

const ADSENSE_LANGS = {
  af: 'Afrikaans', ar: 'Arabic', bg: 'Bulgarian', ca: 'Catalan', zh: 'Chinese',
  hr: 'Croatian', cs: 'Czech', da: 'Danish', nl: 'Dutch', en: 'English',
  et: 'Estonian', fil: 'Filipino', tl: 'Filipino', fi: 'Finnish', fr: 'French',
  de: 'German', el: 'Greek', he: 'Hebrew', hi: 'Hindi', hu: 'Hungarian',
  id: 'Indonesian', it: 'Italian', ja: 'Japanese', ko: 'Korean', lv: 'Latvian',
  lt: 'Lithuanian', ms: 'Malay', no: 'Norwegian', nb: 'Norwegian', nn: 'Norwegian',
  pl: 'Polish', pt: 'Portuguese', ro: 'Romanian', ru: 'Russian', sr: 'Serbian',
  sk: 'Slovak', sl: 'Slovenian', es: 'Spanish', sv: 'Swedish', th: 'Thai',
  tr: 'Turkish', uk: 'Ukrainian', vi: 'Vietnamese'
};

function langFromCode(code) {
  if (!code) return null;
  const c = String(code).toLowerCase().replace('_', '-');
  const short = c.split('-')[0];
  if (ADSENSE_LANGS[c]) return { code: c, name: ADSENSE_LANGS[c], supported: true };
  if (ADSENSE_LANGS[short]) return { code: short, name: ADSENSE_LANGS[short], supported: true };
  return { code: short, name: short, supported: false };
}

module.exports = {
  TRACKING, STOP, ADSENSE_LANGS,
  clamp, round, esc, normalizeUrl, hostOf, originOf, pathOf, normHost, sameSite,
  isAsset, isHtmlCtype, words, sentences, syllables, fleschReadingEase,
  keywordFreq, repeatedPhrases, tokenSet, uniqueAfter, boilerplateRatio,
  shingles, jaccard, tfMap, cosineMap, buildIdf, tfidfVector, simHash, hamming64,
  sentenceFingerprints, normalizeText, sample, pct, makeError, langFromCode
};
