'use strict';

const U = require('./util');
const R = require('./mediavineRules');

/**
 * Deterministic brand-safety scanner.
 * Uses contextual scoring; one isolated keyword never creates a high finding.
 * Confidence levels: Low-confidence signal | Medium-confidence signal | High-confidence signal.
 * These are public-content screens — never presented as official Mediavine violations unless the
 * category is directly supported by Mediavine's brand-safety / Google ad-policy guidance.
 */

const RULES = [
  { cat: 'adult', label: 'Adult / sexually explicit content', patterns: [/\b(porn|pornography|xxx|hentai|nsfw|escort service|webcam (sex|model)|hardcore (sex|video)|nude cam|sex chat)\b/i], related: ['nude', 'sexual', 'erotic', 'cam girl', 'adult video', 'onlyfans'], threshold: 3, base: 0.86 },
  { cat: 'explicit', label: 'Explicit / mature content', patterns: [/\b(explicit (content|lyrics|language)|mature (content|audience)|graphic (content|violence))\b/i], related: ['18+', 'adults only', 'trigger warning'], threshold: 3, base: 0.62 },
  { cat: 'drugs', label: 'Illegal drugs', patterns: [/\b(buy (cocaine|heroin|meth|mdma|lsd) online|cocaine for sale|heroin for sale|darknet (drug|market)|methamphetamine for sale|cheap mdma)\b/i], related: ['vendor', 'ship discreetly', 'darknet', 'controlled substance'], threshold: 2, base: 0.88 },
  { cat: 'gambling', label: 'Gambling', patterns: [/\b(online casino|sports betting|poker for (real )?money|slots? real money|no deposit bonus|bet now|gambling site)\b/i], related: ['odds', 'wager', 'jackpot', 'roulette', 'bookmaker'], threshold: 3, base: 0.7 },
  { cat: 'weapons', label: 'Weapons', patterns: [/\b(buy (guns?|firearms?|ammo) online|ghost gun|silencer for sale|switchblade for sale|bump stock for sale)\b/i], related: ['ammunition', 'firearm', 'weapon shop'], threshold: 2, base: 0.74 },
  { cat: 'hate', label: 'Hate / extremist material', patterns: [/\b(white power|racial supremacy|neo[- ]nazi|holocaust denial|ethnic cleansing|kill all (jews|muslims|blacks)|hate speech)\b/i], related: ['supremacy', 'extremist', 'hate group'], threshold: 2, base: 0.9 },
  { cat: 'extremist', label: 'Extremist / terrorist material', patterns: [/\b(terror(ist)? propaganda|recruit(ing|ment)? for (isis|jihad)|extremist manifesto|how to (join|plan) (a )?(terror|attack))\b/i], related: ['radicalization', 'jihad', 'militant'], threshold: 2, base: 0.9 },
  { cat: 'violence', label: 'Dangerous / violent activities', patterns: [/\b(how to make a bomb|build explosives|murder for hire|hitman service|beheading video|kill shot)\b/i], related: ['explosive', 'terror', 'assault'], threshold: 2, base: 0.88 },
  { cat: 'piracy', label: 'Piracy / copyright infringement', patterns: [/\b(free (movie|film|mp3|software) downloads?|cracked software|keygen|warez|pirate bay|full version free download|watch .+ online free hd|stream .+ free full movie)\b/i], related: ['torrent', 'crack', 'serial key', 'camrip'], threshold: 3, base: 0.76 },
  { cat: 'copyright', label: 'Copyright infringement', patterns: [/\b(unauthorized (reproduction|copy)|infringe.*copyright|stolen (content|photos|images)|scraped content)\b/i], related: ['DMCA', 'counterfeit', 'reproduction'], threshold: 3, base: 0.6 },
  { cat: 'malware', label: 'Malware', patterns: [/\b(keylogger download|rat download|phishing kit|exploit kit|stealer log|ransomware builder|trojan download)\b/i], related: ['malware', 'payload', 'stealer', 'trojan'], threshold: 2, base: 0.9 },
  { cat: 'phishing', label: 'Phishing / credential theft', patterns: [/\b(login page clone|verify your (account|password|identity) now|urgent account suspension|fake (login|paypal|bank) page)\b/i], related: ['credential', 'verify account', 'suspension'], threshold: 2, base: 0.82 },
  { cat: 'fraud', label: 'Fraud patterns', patterns: [/\b(wire transfer request|nigerian prince|claim your prize|verify your details to receive|bank account details required)\b/i], related: ['western union', 'gift card payment', 'overpayment'], threshold: 2, base: 0.7 },
  { cat: 'scam', label: 'Scam patterns', patterns: [/\b(get rich quick|guaranteed (income|returns|profit)|double your bitcoin|make \$?\d+ (a|per) day|no risk investment)\b/i], related: ['investment scheme', 'pyramid', 'miracle'], threshold: 2, base: 0.72 },
  { cat: 'dangerous_activities', label: 'Dangerous activities', patterns: [/\b(how to (make|build) (a )?(bomb|explosive|drug lab)|extreme (self[- ]harm|dangerous) challenge)\b/i], related: ['hazardous', 'life-threatening'], threshold: 2, base: 0.84 },
  { cat: 'deceptive_downloads', label: 'Deceptive downloads', patterns: [/\b(fake (update|installer|download)|trick.*download|misleading download button|bundleware)\b/i], related: ['drive-by download', 'trap link'], threshold: 2, base: 0.74 },
  { cat: 'alcohol_tobacco', label: 'Alcohol / tobacco offering', patterns: [/\b(buy (cigarettes|vapes?|cigars|whiskey|vodka) online|cheap cigarettes shipped|tobacco shop online)\b/i], related: ['add to cart', 'nicotine', 'abv', 'proof'], threshold: 3, base: 0.62 },
  { cat: 'healthcare_offer', label: 'Healthcare / drug offering', patterns: [/\b(buy (viagra|cialis|tramadol|xanax|adderall) online|no prescription (required|needed)|pharmacy without prescription)\b/i], related: ['prescription', 'overnight shipping', 'generic pills'], threshold: 2, base: 0.8 }
];

function countMatches(re, text) {
  if (!text) return 0;
  const m = String(text).match(new RegExp(re.source, 'gi'));
  return m ? m.length : 0;
}
function snippet(text, re) {
  const idx = text.search(re);
  if (idx < 0) return '';
  return text.slice(Math.max(0, idx - 50), idx + 90).replace(/\s+/g, ' ').trim();
}

function analyzeBrandSafety(pages, ctx) {
  const out = [];
  const findings = [];

  pages.forEach(p => {
    if (!p.parse) return;
    const path = U.pathOf(p.url);
    const head = ((p.parse.title || '') + ' ' + (p.parse.h1 || []).join(' ')).toLowerCase();
    const body = String(p.parse.mainText || '').slice(0, 14000).toLowerCase();
    const anchors = (p.parse.links || []).map(l => (l.text || '').toLowerCase()).join(' ');
    const combined = head + '\n' + body + '\n' + anchors;

    RULES.forEach(rule => {
      let hits = 0, headHits = 0;
      const ctxSnips = [];
      rule.patterns.forEach(re => {
        const b = countMatches(re, body), h = countMatches(re, head), a = countMatches(re, anchors);
        hits += b + a + h * 2;
        headHits += h;
        if (b || h) { const sn = snippet(combined, re); if (sn) ctxSnips.push(sn); }
      });
      const related = (rule.related || []).reduce((n, w) => n + (new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(combined) ? 1 : 0), 0);
      if (hits === 0) return;
      if (hits === 1 && related === 0 && headHits === 0) return;
      let threshold = rule.threshold;
      if (related >= 2) threshold = Math.max(1, threshold - 1);
      if (hits < threshold && !(headHits >= 1 && hits >= 2 && related >= 1)) return;

      let conf = rule.base;
      if (headHits) conf += 0.07;
      if (hits >= rule.threshold * 3) conf += 0.06;
      if (related) conf += 0.03;
      if (related === 0 && hits < rule.threshold * 2) conf -= 0.18;
      conf = U.clamp(conf, 0.28, 0.97);

      let confidenceLevel = 'Low-confidence signal';
      let status = 'low';
      let severity = 'Low';
      if (conf >= 0.82 && hits >= rule.threshold) { confidenceLevel = 'High-confidence signal'; status = 'high'; severity = 'High'; }
      else if (conf >= 0.55) { confidenceLevel = 'Medium-confidence signal'; status = 'medium'; severity = 'Medium'; }

      findings.push({
        cat: rule.cat, label: rule.label, status, severity, confidenceLevel, confidence: Math.round(conf * 100),
        page: path, url: p.url, hits, related, headline: headHits > 0,
        evidence: rule.label + ' — ' + hits + ' weighted pattern hit(s)' + (headHits ? ' including title/H1' : '')
          + (related ? ' with ' + related + ' related term(s)' : '')
          + (ctxSnips[0] ? '. Evidence: "' + ctxSnips[0].slice(0, 140) + '"' : '')
          + '. Confidence: ' + confidenceLevel + '. This is a public-content screen, not an official Mediavine determination.',
        snippet: ctxSnips[0] || ''
      });
    });
  });

  // Site-level aggregation
  const byCat = {};
  findings.forEach(f => { (byCat[f.cat] = byCat[f.cat] || []).push(f); });
  const highCount = findings.filter(f => f.status === 'high').length;
  const mediumCount = findings.filter(f => f.status === 'medium').length;

  if (findings.length) {
    const cats = Object.keys(byCat).sort((a, b) => byCat[b].length - byCat[a].length);
    const topCat = byCat[cats[0]];
    const status = highCount >= 1 ? (highCount >= 3 ? 'critical' : 'high') : (mediumCount >= 3 ? 'medium' : 'low');
    out.push(R.finding(R.get('MV-Q-BRAND-SAFETY'), 'Site', status,
      findings.length + ' brand-safety signal(s) on ' + new Set(findings.map(f => f.page)).size + ' page(s) across ' + cats.length
      + ' category(ies) (' + cats.join(', ') + '). Most concentrated: ' + topCat[0].label + ' on ' + U.pathOf(topCat[0].page)
      + ' (' + topCat[0].confidenceLevel + '). Not an official Mediavine violation — a public-content screen.',
      { confidence: highCount ? 0.82 : 0.6, severity: status, affected: String(findings.length) }));
  } else {
    out.push(R.finding(R.get('MV-Q-BRAND-SAFETY'), 'Site', 'passed',
      'No contextual brand-safety pattern reached the reporting threshold across ' + pages.filter(p => p.parse).length + ' parsed pages. Isolated keywords are ignored.',
      { confidence: 0.7, severity: 'passed' }));
  }

  // Emit per-page findings
  findings.forEach(f => {
    out.push(R.finding(R.get('MV-Q-ADSENSE-POLICY'), f.page, f.status, f.evidence, {
      confidence: f.confidence / 100, severity: f.status, brandCat: f.cat, urls: [f.page], tier: f.confidenceLevel, confidenceLevel: f.confidenceLevel
    }));
  });

  ctx.brandSafetyFindings = findings;
  ctx.brandSafetyStats = { total: findings.length, high: highCount, medium: mediumCount, pages: new Set(findings.map(f => f.page)).size };
  return out;
}

module.exports = { analyzeBrandSafety, RULES };
