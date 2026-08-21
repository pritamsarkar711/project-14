'use strict';

const U = require('./util');
const R = require('./ezoicRules');

/**
 * Contextual policy-risk scanner.
 * One isolated keyword never creates a high-risk finding.
 * Findings use: Low Risk Signal | Review Recommended | High-Risk Signal
 * Never labelled as an official Ezoic policy violation unless the official rule is cited as the *category*,
 * and even then the evidence text states this is a public-content screen.
 */

const RULES = [
  {
    cat: 'adult',
    label: 'Adult / sexually explicit content',
    official: true,
    patterns: [/\b(porn|xxx|onlyfans|hentai|nsfw|escort service|webcam (sex|model)|hardcore (sex|video)|nude cam)\b/i],
    related: ['nude', 'sexual', 'erotic', 'cam', 'adult video'],
    threshold: 3,
    base: 0.88
  },
  {
    cat: 'drugs',
    label: 'Illegal drugs',
    official: true,
    patterns: [/\b(buy (cocaine|heroin|meth|mdma) online|cocaine for sale|heroin for sale|darknet (drug|market)|methamphetamine for sale)\b/i],
    related: ['vendor', 'ship discreetly', 'darknet', 'controlled substance'],
    threshold: 2,
    base: 0.86
  },
  {
    cat: 'gambling',
    label: 'Gambling',
    official: true,
    patterns: [/\b(online casino|sports betting|poker for (real )?money|slots? real money|no deposit bonus|bet now|gambling site)\b/i],
    related: ['odds', 'wager', 'jackpot', 'roulette', 'bookmaker'],
    threshold: 3,
    base: 0.72
  },
  {
    cat: 'weapons',
    label: 'Weapons',
    official: true,
    patterns: [/\b(buy (guns?|firearms?|ammo) online|ghost gun|silencer for sale|switchblade for sale)\b/i],
    related: ['ammunition', 'firearm', 'weapon shop'],
    threshold: 2,
    base: 0.75
  },
  {
    cat: 'hate',
    label: 'Hate / extremist material',
    official: true,
    patterns: [/\b(white power|racial supremacy|neo[- ]nazi|holocaust denial|ethnic cleansing|kill all (jews|muslims|blacks))\b/i],
    related: ['supremacy', 'extremist', 'hate group'],
    threshold: 2,
    base: 0.9
  },
  {
    cat: 'violence',
    label: 'Dangerous / violent activities',
    official: true,
    patterns: [/\b(how to make a bomb|build explosives|murder for hire|hitman service|beheading video)\b/i],
    related: ['explosive', 'terror', 'kill'],
    threshold: 2,
    base: 0.9
  },
  {
    cat: 'piracy',
    label: 'Piracy / copyright infringement',
    official: true,
    patterns: [/\b(free (movie|film|mp3|software) downloads?|cracked software|keygen|warez|pirate bay|full version free download|watch .+ online free hd)\b/i],
    related: ['torrent', 'crack', 'serial key', 'camrip'],
    threshold: 3,
    base: 0.78
  },
  {
    cat: 'malware',
    label: 'Malware / phishing',
    official: true,
    patterns: [/\b(keylogger download|rat download|phishing kit|exploit kit|stealer log|ransomware builder)\b/i],
    related: ['malware', 'payload', 'stealer', 'trojan'],
    threshold: 2,
    base: 0.9
  },
  {
    cat: 'scam',
    label: 'Fraud / scam patterns',
    official: true,
    patterns: [/\b(get rich quick|guaranteed (income|returns)|wire transfer request|nigerian prince|claim your prize|double your bitcoin)\b/i],
    related: ['western union', 'gift card payment', 'investment scheme'],
    threshold: 2,
    base: 0.7
  },
  {
    cat: 'alcohol_tobacco',
    label: 'Alcohol / tobacco offering',
    official: true,
    patterns: [/\b(buy (cigarettes|vapes?|cigars|whiskey|vodka) online|cheap cigarettes shipped|tobacco shop online)\b/i],
    related: ['add to cart', 'nicotine', 'abv', 'proof'],
    threshold: 3,
    base: 0.65
  },
  {
    cat: 'healthcare_offer',
    label: 'Healthcare / drug offering',
    official: true,
    patterns: [/\b(buy (viagra|cialis|tramadol|xanax|adderall) online|no prescription (required|needed)|pharmacy without prescription)\b/i],
    related: ['prescription', 'overnight shipping', 'generic pills'],
    threshold: 2,
    base: 0.8
  }
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

function analyzePolicy(pages, ctx) {
  const out = [];
  const findings = [];

  pages.forEach(p => {
    if (!p.parse) return;
    const path = U.pathOf(p.url);
    const title = (p.parse.title || '').toLowerCase();
    const h1 = (p.parse.h1 || []).join(' ').toLowerCase();
    const head = title + ' ' + h1;
    const body = String(p.parse.mainText || '').slice(0, 14000).toLowerCase();
    const anchors = (p.parse.links || []).map(l => (l.text || '').toLowerCase()).join(' ');
    const combined = head + '\n' + body + '\n' + anchors;

    RULES.forEach(rule => {
      let hits = 0;
      let headHits = 0;
      const ctxSnips = [];
      rule.patterns.forEach(re => {
        const b = countMatches(re, body);
        const h = countMatches(re, head);
        const a = countMatches(re, anchors);
        hits += b + a + h * 2;
        headHits += h;
        if (b || h) {
          const sn = snippet(combined, re);
          if (sn) ctxSnips.push(sn);
        }
      });
      const related = (rule.related || []).reduce((n, w) => n + (new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(combined) ? 1 : 0), 0);

      // Isolated single keyword / related term only → ignore
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

      let tier = 'Low Risk Signal';
      let status = 'low';
      if (conf >= 0.82 && hits >= rule.threshold) { tier = 'High-Risk Signal'; status = 'high'; }
      else if (conf >= 0.58) { tier = 'Review Recommended'; status = 'medium'; }

      findings.push({
        cat: rule.cat,
        label: rule.label,
        official: rule.official,
        status,
        tier,
        confidence: Math.round(conf * 100),
        page: path,
        url: p.url,
        hits,
        related,
        evidence: rule.label + ' — ' + hits + ' weighted pattern hit(s)'
          + (headHits ? ' including title/H1' : '')
          + (related ? ' with ' + related + ' related term(s)' : '')
          + (ctxSnips[0] ? '. Evidence: “' + ctxSnips[0].slice(0, 140) + '”' : '')
          + '. This is a public-content screen, not an official Ezoic determination.',
        snippet: ctxSnips[0] || ''
      });
    });
  });

  findings.forEach(f => {
    out.push(R.finding(R.get('EZ-PROHIBITED-CONTENT'), f.page, f.status, f.evidence, {
      confidence: f.confidence / 100,
      severity: f.status,
      tier: f.tier,
      policyCat: f.cat,
      urls: [f.page]
    }));
  });

  if (!findings.length) {
    out.push(R.finding(R.get('EZ-PROHIBITED-CONTENT'), 'Site', 'passed',
      'No contextual prohibited-content pattern reached the reporting threshold across '
      + pages.filter(p => p.parse).length + ' parsed pages. Isolated keywords are ignored.',
      { confidence: 0.7, severity: 'passed', tier: 'Low Risk Signal' }));
  }

  ctx.policyFindings = findings;
  return out;
}

module.exports = { analyzePolicy };
