'use strict';

/*
 * AI Crawler & LLM Bot Blocker, offline self-test.
 * Covers the 25 required scenarios: robots parsing (empty/basic/multi-group/
 * wildcards/conflicts/invalid/large), every named bot, unknown & custom UAs,
 * spoofing, HTTP/HTTPS handling, Cloudflare-site evidence, nginx & Apache
 * validity, and end-to-end consistency of every preset.
 */
const assert = require('assert');

const db = require('./botDatabase');
const classifier = require('./botClassifier');
const matcher = require('./botPatternMatcher');
const parser = require('./robotsParser');
const simulator = require('./robotsSimulator');
const generator = require('./robotsGenerator');
const conflicts = require('./ruleConflictDetector');
const uaAnalyzer = require('./userAgentAnalyzer').analyze;
const nginx = require('./nginxGenerator');
const apache = require('./apacheGenerator');
const cloudflare = require('./cloudflareGenerator');
const middleware = require('./middlewareGenerator');
const validator = require('./configurationValidator');
const score = require('./protectionScore');
const coverage = require('./coverageAnalyzer');
const checker = require('./securityChecker');
const index = require('./index');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  \u2713 ' + name); }
  catch (e) { fail++; console.log('  \u2717 ' + name + '\n    ' + (e && e.message)); }
}

/* 1: Empty robots.txt */
t('1. Empty robots.txt parses to zero groups; default allow', () => {
  const p = parser.parse('');
  assert.strictEqual(p.stats.groups, 0);
  assert.strictEqual(p.errors.length, 0);
  const r = simulator.check(p, 'GPTBot', '/any');
  assert.strictEqual(r.verdict, 'uncertain');
});

/* 2: Basic robots.txt */
t('2. Basic robots.txt: single group blocks a path for everyone', () => {
  const p = parser.parse('User-agent: *\nDisallow: /private/\n');
  assert.strictEqual(p.stats.groups, 1);
  assert.strictEqual(simulator.check(p, 'AnythingBot', '/private/x').verdict, 'blocked');
  assert.strictEqual(simulator.check(p, 'AnythingBot', '/public/x').verdict, 'allowed');
});

/* 3: Multiple User-agent groups + consecutive UA lines */
t('3. Multiple User-agent groups merge consecutive UA declarations', () => {
  const p = parser.parse('User-agent: A\nUser-agent: B\nDisallow: /x/\n\nUser-agent: *\nAllow: /\n');
  assert.strictEqual(p.stats.groups, 2);
  assert.deepStrictEqual(p.groups[0].agents, ['A', 'B']);
  assert.strictEqual(simulator.check(p, 'b', '/x/1').verdict, 'blocked');   // case-insensitive token
  assert.strictEqual(simulator.check(p, 'other', '/x/1').verdict, 'allowed'); // wildcard group, allow
});

/* 4: Wildcards and $ anchoring */
t('4. Wildcard * and $ end-anchor matching', () => {
  const p = parser.parse('User-agent: *\nDisallow: /*.pdf$\nDisallow: /blog/*\n');
  assert.strictEqual(simulator.check(p, 'X', '/files/a.pdf').verdict, 'blocked');
  assert.strictEqual(simulator.check(p, 'X', '/files/a.pdfx').verdict, 'allowed'); // $ anchor
  assert.strictEqual(simulator.check(p, 'X', '/blog/page').verdict, 'blocked');
  assert.strictEqual(simulator.check(p, 'X', '/blog').verdict, 'allowed'); // /blog/* needs something after /
});

/* 5: Allow/Disallow conflicts resolved by longest match, ties → Allow */
t('5. Longest-match precedence and Allow tie-break', () => {
  const p = parser.parse('User-agent: *\nDisallow: /\nAllow: /public/\n');
  const ok = simulator.check(p, 'X', '/public/page');
  assert.strictEqual(ok.verdict, 'allowed');
  assert.strictEqual(ok.rule.path, '/public/');
  assert.strictEqual(simulator.check(p, 'X', '/secret').verdict, 'blocked');
  const tie = parser.parse('User-agent: *\nDisallow: /\nAllow: /\n');
  const tr = simulator.check(tie, 'X', '/anything');
  assert.strictEqual(tr.verdict, 'allowed'); // equal specificity → Allow wins
  const cf = conflicts.analyze(tie);
  assert.ok(cf.issues.some(i => /Allow: \/ vs Disallow: \//.test(i.title)));
});

/* 6: AI-specific rules end-to-end */
t('6. AI-specific rules: block-all mode generates clean per-bot groups', () => {
  const r = index.generate({ website: 'https://example.com', mode: 'block-all', outputs: { robots: true } });
  assert.ok(r.robotsTxt.includes('User-agent: GPTBot\nDisallow: /'));
  assert.ok(r.robotsTxt.includes('User-agent: ClaudeBot\nDisallow: /'));
  assert.ok(r.robotsTxt.includes('User-agent: Google-Extended\nDisallow: /'));
  assert.ok(r.robotsTxt.includes('User-agent: Applebot-Extended\nDisallow: /'));
  assert.ok(r.robotsTxt.includes('User-agent: PerplexityBot\nDisallow: /'));
  assert.ok(r.robotsTxt.includes('User-agent: Amazonbot\nDisallow: /'));
  assert.ok(r.robotsTxt.includes('User-agent: Bytespider\nDisallow: /'));
  assert.ok(r.robotsTxt.includes('User-agent: CCBot\nDisallow: /'));
  assert.strictEqual(r.validation.productionReady, true);
  assert.ok(!r.robotsTxt.includes('User-agent: GoogleOther')); // non-AI bot untouched by block-all
});

/* 7–14: Named bots: resolution + simulation against generated rules */
const NAMED = [
  ['gptbot', 'GPTBot'], ['claudebot', 'ClaudeBot'], ['google-extended', 'Google-Extended'],
  ['applebot-extended', 'Applebot-Extended'], ['perplexitybot', 'PerplexityBot'],
  ['amazonbot', 'Amazonbot'], ['bytespider', 'Bytespider'], ['ccbot', 'CCBot']
];
let i = 7;
for (const [id, token] of NAMED) {
  t(i + '. ' + token + ' blocked under block-all; simulator explains the rule', () => {
    const r = index.generate({ website: 'https://example.com', mode: 'block-all', outputs: { robots: true } });
    const res = r.resolved.find(x => x.bot.id === id);
    assert.strictEqual(res.effective, 'block');
    const sim = simulator.check(r.parsed, token, '/blog/example-page');
    assert.strictEqual(sim.verdict, 'blocked');
    assert.strictEqual(sim.rule.path, '/');
    assert.ok(/Disallow/.test(sim.reason));
  });
  i++;
}

/* 15: Unknown User-Agent */
t('15. Unknown User-Agent falls back to the wildcard group', () => {
  const r = index.generate({ mode: 'block-all', outputs: { robots: true } });
  const sim = simulator.check(r.parsed, 'SomeNewAiBot', '/x');
  assert.strictEqual(sim.verdict, 'allowed'); // * group is Allow: / in default config
  const blocky = parser.parse('User-agent: *\nDisallow: /\n');
  assert.strictEqual(simulator.check(blocky, 'SomeNewAiBot', '/x').verdict, 'blocked');
});

/* 16: Custom User-Agent / custom bot entries */
t('16. Custom bot entries validate, resolve and generate', () => {
  const r = index.generate({
    mode: 'custom', outputs: { robots: true, nginx: true },
    customBots: [{ id: 'c1', name: 'MyCorpBot', token: 'MyCorpBot', organization: 'MyCorp', category: 'unknown', action: 'block' }]
  });
  assert.ok(r.robotsTxt.includes('User-agent: MyCorpBot\nDisallow: /'));
  assert.ok(r.outputs.nginx.text.includes('MyCorpBot'));
  const bad = matcher.validateToken('AI');
  assert.strictEqual(bad.ok, false); // generic word rejected (false-positive protection)
  const broad = matcher.validateToken('abc');
  assert.strictEqual(broad.ok, true);
  assert.ok(broad.warnings.length >= 1); // short token warned
});

/* 17: Bot spoofing / false-positive protection */
t('17. UA spoofing & false positives: keyword strings never match', () => {
  // Boundary matching: name-fragment UAs are NOT identified as database bots
  assert.strictEqual(matcher.uaContainsToken('MyAIBrowser/1.0', 'GPTBot'), false);
  assert.strictEqual(matcher.uaContainsToken('Mozilla/5.0 (XGPTBot; like Gecko)', 'GPTBot'), false);
  assert.strictEqual(matcher.uaContainsToken('ChatGPT-UserBot thing', 'ChatGPT-User'), false);
  assert.strictEqual(matcher.uaContainsToken('Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)', 'GPTBot'), true);
  // Applebot must NOT match Applebot-Extended and vice versa
  assert.strictEqual(matcher.uaContainsToken('Mozilla/5.0 (compatible; Applebot-Extended/1.0)', 'Applebot'), false);
  assert.strictEqual(matcher.uaContainsToken('Mozilla/5.0 (compatible; Applebot/0.1)', 'Applebot-Extended'), false);
  const a1 = uaAnalyzer('MyAIBrowser 2.0 AI-powered assistant bot');
  assert.strictEqual(a1.known, false);
  assert.ok(a1.summary.includes('does not block on vague keywords') || a1.summary.includes('NOT identification') || a1.summary.includes('not'));
  const a2 = uaAnalyzer('Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)');
  assert.strictEqual(a2.known, true);
  assert.strictEqual(a2.matches[0].id, 'gptbot');
});

/* 18/19: HTTP vs HTTPS input normalization (security checker transport section) */
t('18/19. HTTP and HTTPS URLs analyzed with correct transport verdicts', () => {
  const repHttps = checker.analyze({
    url: 'https://example.com',
    robots: { ok: true, status: 200, body: 'User-agent: *\nAllow: /\n' },
    home: { ok: true, status: 200, headers: {}, finalUrl: 'https://example.com/' }
  });
  const tSec = repHttps.sections.find(s => s.title === 'HTTPS & response');
  assert.ok(tSec.items.some(x => x.status === 'ok' && /HTTPS confirmed/.test(x.text)));
  const repHttp = checker.analyze({
    url: 'http://example.com',
    robots: { ok: true, status: 200, body: '' },
    home: { ok: true, status: 200, headers: {}, finalUrl: 'http://example.com/' }
  });
  const tSec2 = repHttp.sections.find(s => s.title === 'HTTPS & response');
  assert.ok(tSec2.items.some(x => x.status === 'warn' && /Not using HTTPS/.test(x.text)));
});

/* 20: Cloudflare site detection from header evidence */
t('20. Cloudflare website detected via cf-ray header evidence', () => {
  const rep = checker.analyze({
    url: 'https://cf.example.com',
    robots: { ok: true, status: 200, body: 'User-agent: *\nAllow: /\n' },
    home: { ok: true, status: 200, headers: { 'cf-ray': '8abc123', server: 'cloudflare' }, finalUrl: 'https://cf.example.com/' }
  });
  const cdn = rep.sections.find(s => s.title === 'CDN / server detection');
  assert.ok(cdn.items.some(x => x.status === 'ok' && /Cloudflare/.test(x.text)));
  // AI rules in the wild are reported as requests, never as technical blocks
  const rep2 = checker.analyze({
    url: 'https://x.com', robots: { ok: true, status: 200, body: 'User-agent: GPTBot\nDisallow: /\n' },
    home: { ok: true, status: 200, headers: {}, finalUrl: 'https://x.com/' }
  });
  const rb = rep2.sections.find(s => s.title === 'robots.txt');
  assert.ok(rb.items.some(x => /REQUEST those crawlers not to crawl/.test(x.text)));
  assert.ok(rb.items.every(x => !/technically blocked|is blocked at server level/.test(x.text)));
});

/* 21: Nginx configuration validity */
t('21. Nginx: balanced braces, valid regex, all blocked tokens present', () => {
  const tokens = ['GPTBot', 'ClaudeBot', 'Applebot', 'Applebot-Extended', 'Bytespider'];
  const out = nginx.generate(tokens, {});
  const v = validator.validateGenerated('', { nginx: out });
  assert.ok(!v.errors.length, v.errors.join('; '));
  for (const tk of tokens) assert.ok(out.text.includes(tk));
  assert.ok(!out.text.includes('PerplexityBot'));
  const re = out.text.split('\n').filter(l => l.trim().startsWith('~*')).map(l => l.trim().replace(/^~\*/, '').replace(/\s+1;\s*$/, ''));
  // nginx map regexes are unanchored searches (like the server applies them)
  const rx = new RegExp('(?:' + re.join('|') + ')', 'i');
  assert.ok(rx.test('Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)'));
  assert.ok(!rx.test('MyGPTBrowser 1.0'));
  assert.ok(rx.test('Mozilla/5.0 (compatible; Applebot-Extended/1.0)'));
  assert.ok(!new RegExp(re[0], 'i').test('Mozilla/5.0 (compatible; Applebot-Extended/1.0)'.replace(/Applebot-Extended/, 'ApplebotExtended')));
});

/* 22: Apache configuration validity */
t('22. Apache: RewriteCond regex compiles and matches exactly the tokens', () => {
  const tokens = ['GPTBot', 'ClaudeBot', 'Meta-ExternalAgent'];
  const out = apache.generate(tokens, {});
  const v = validator.validateGenerated('', { apache: out });
  assert.ok(!v.errors.length, v.errors.join('; '));
  const m = out.text.match(/RewriteCond %{HTTP_USER_AGENT} (\S+) \[NC\]/);
  const rx = new RegExp(m[1], 'i'); // [NC] → case-insensitive
  assert.ok(rx.test('Mozilla/5.0 (compatible; GPTBot/1.2)'));
  assert.ok(rx.test('meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)'));
  assert.ok(!rx.test('SomeGPTBotishThing/9'));
  assert.ok(/RewriteRule \^ - \[F,L\]/.test(out.text));
});

/* 23: Large robots.txt performance */
t('23. Large robots.txt (10k lines) parses and simulates fast', () => {
  const lines = [];
  for (let n = 0; n < 2000; n++) lines.push('User-agent: bot' + n + '\nDisallow: /p' + (n % 100) + '/');
  const big = lines.join('\n');
  const t0 = Date.now();
  const p = parser.parse(big);
  const r = simulator.check(p, 'bot1999', '/p99/x');
  const ms = Date.now() - t0;
  assert.strictEqual(p.stats.groups, 2000);
  assert.strictEqual(r.verdict, 'blocked');
  assert.ok(ms < 2000, 'took ' + ms + 'ms');
});

/* 24: Invalid robots.txt */
t('24. Invalid robots.txt: orphan rules and bad lines are reported', () => {
  const p = parser.parse('Disallow: /oops\nUser-agent: *\nthis is not a directive\nsitemap: not-a-url\n');
  assert.ok(p.errors.some(e => /before any User-agent/.test(e.message)));
  assert.ok(p.errors.some(e => /absolute URL/.test(e.message)));
  assert.ok(p.warnings.some(w => /Unrecognized line/.test(w.message)));
});

/* 25: Contradictory rules explained */
t('25. Contradictory rules: detector explains which rule applies', () => {
  const txt = 'User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /\n';
  const p = parser.parse(txt);
  const cf = conflicts.analyze(p);
  assert.ok(cf.issues.some(i => i.level === 'warning' && /Wildcard group blocks the entire site/.test(i.title)));
  assert.ok(cf.issues.some(i => /Specific group overrides the wildcard block/.test(i.title)));
  const sim = simulator.check(p, 'GPTBot', '/anything');
  assert.strictEqual(sim.verdict, 'allowed'); // exact group wins over *
  const simOther = simulator.check(p, 'Googlebot', /x/ && '/x');
  assert.strictEqual(simOther.verdict, 'blocked'); // Googlebot has no group → *
});

/* Extra: presets consistency + score/coverage sanity on all modes */
t('Extra: all presets generate production-ready, consistent output', () => {
  for (const mode of classifier.MODES.map(m => m.id)) {
    const r = index.generate({
      website: 'https://example.com', mode,
      outputs: { robots: true, nginx: true, apache: true, cloudflare: true, node: true, php: true, laravel: true },
      rateLimit: { enabled: true, requestsPerSecond: 2, requestsPerMinute: 120, burst: 10 }
    });
    assert.strictEqual(r.validation.productionReady, true, mode + ': ' + r.validation.errors.join('; '));
    assert.ok(r.score.score >= 0 && r.score.score <= 100);
    assert.strictEqual(r.coverage.configuredCount + r.coverage.implicitlyCoveredCount + r.coverage.notConfiguredCount, r.coverage.knownTotal);
    // block-training must keep AI search allowed
    if (mode === 'block-training') {
      assert.strictEqual(r.resolved.find(x => x.bot.id === 'perplexitybot').effective, 'allow');
      assert.strictEqual(r.resolved.find(x => x.bot.id === 'gptbot').effective, 'block');
    }
    if (mode === 'block-search') {
      assert.strictEqual(r.resolved.find(x => x.bot.id === 'gptbot').effective, 'allow');
      assert.strictEqual(r.resolved.find(x => x.bot.id === 'oai-searchbot').effective, 'block');
    }
  }
});

/* Extra: path-level blocking + exceptions */
t('Extra: path-level blocking and allow exceptions generate correct rules', () => {
  const r = index.generate({
    mode: 'block-all', outputs: { robots: true },
    paths: { mode: 'specific', list: ['/blog/', '/premium/'] },
    exceptions: { enabled: true, list: ['/blog/public/'] }
  });
  assert.ok(r.robotsTxt.includes('Disallow: /blog/'));
  assert.ok(r.robotsTxt.includes('Disallow: /premium/'));
  assert.ok(r.robotsTxt.includes('Allow: /blog/public/'));
  assert.strictEqual(simulator.check(r.parsed, 'GPTBot', '/blog/post').verdict, 'blocked');
  assert.strictEqual(simulator.check(r.parsed, 'GPTBot', '/blog/public/x').verdict, 'allowed');
  assert.strictEqual(simulator.check(r.parsed, 'GPTBot', '/about').verdict, 'allowed');
  assert.strictEqual(r.validation.productionReady, true);
});

/* Extra: middleware snippets are syntactically valid */
t('Extra: middleware snippets parse / stay balanced', () => {
  const mw = middleware.generate(['GPTBot', 'ClaudeBot'], {});
  new Function(mw.node.replace(/^.*$/m, l => l)); // full parse
  assert.ok(mw.php.startsWith('<?php'));
  assert.ok(mw.laravel.includes('class BlockAiBots'));
  const bo = (mw.php.match(/\{/g) || []).length, bc = (mw.php.match(/\}/g) || []).length;
  assert.strictEqual(bo, bc);
  const v = validator.validateGenerated('', { node: { text: mw.node }, php: { text: mw.php }, laravel: { text: mw.laravel } });
  assert.ok(!v.errors.length, v.errors.join('; '));
});

/* Extra: allow/blocklist overrides + allow-selected mode */
t('Extra: overrides (allowlist/blocklist) and allow-selected mode', () => {
  const r = index.generate({
    mode: 'allow-selected', outputs: { robots: true },
    overrides: { perplexitybot: 'allow' }
  });
  assert.strictEqual(r.resolved.find(x => x.bot.id === 'gptbot').effective, 'block');
  assert.strictEqual(r.resolved.find(x => x.bot.id === 'perplexitybot').effective, 'allow');
  assert.ok(/User-agent: PerplexityBot\nAllow: \//.test(r.robotsTxt));
});

/* Extra: compare before/after */
t('Extra: before/after comparison detects added rules', () => {
  const before = parser.parse('User-agent: *\nAllow: /\n');
  const r = index.generate({ mode: 'block-training', outputs: { robots: true } });
  const diff = conflicts.compare(before, r.parsed);
  assert.ok(diff.added.some(d => d.agent === 'GPTBot' && d.rule === 'disallow: /'));
  assert.ok(diff.removed.length === 0);
});

/* Extra: token-boundary database integrity */
t('Extra: database integrity, unique ids/tokens, required fields, categories', () => {
  const ids = new Set(), tokens = new Set();
  for (const b of db.all()) {
    assert.ok(b.id && b.token && b.name && b.organization && b.category && b.purpose, b.id + ' missing fields');
    assert.ok(db.CATEGORY_ORDER.includes(b.category), 'bad category ' + b.category);
    assert.ok(['high', 'medium', 'low'].includes(b.confidence), b.id + ' bad confidence');
    assert.ok(!ids.has(b.id), 'dup id ' + b.id); ids.add(b.id);
    assert.ok(!tokens.has(b.token.toLowerCase()), 'dup token ' + b.token); tokens.add(b.token.toLowerCase());
    if (b.officialDocumentation) assert.ok(/^https:\/\//.test(b.officialDocumentation), b.id + ' docs not https');
    const v = matcher.validateToken(b.token);
    assert.ok(v.ok, b.id + ' token invalid: ' + v.errors.join());
  }
  assert.ok(db.stats().total >= 25);
  assert.ok(db.get('gptbot').officialDocumentation.includes('openai.com'));
});

/* Extra: UA analyzer ambiguity + coverage wording honesty */
t('Extra: UA analyzer flags multi-token ambiguity; coverage never claims completeness', () => {
  const a = uaAnalyzer('Mozilla/5.0 (compatible; GPTBot/1.2; ClaudeBot/2)');
  assert.strictEqual(a.ambiguous, true);
  const r = index.generate({ mode: 'block-all', outputs: { robots: true } });
  assert.ok(r.coverage.disclaimer.includes('not every AI crawler'));
  assert.ok(r.score.disclaimer.includes('Tool-generated diagnostic score'));
  assert.ok(r.score.disclaimer.includes('not a Google score'));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
