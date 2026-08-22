'use strict';

/*
 * AI Crawler & LLM Bot Blocker, engine entry point.
 * botDatabase → classifier → robots.txt generation → server configs →
 * validation → conflict detection → coverage → score. Deterministic, offline,
 * no AI, no account, no external requests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else {
    const BB = root.BB = root.BB || {};
    BB.index = factory(name => {
      const key = name.replace(/^\.\//, '');
      if (!BB[key]) throw new Error('botblocker module missing: ' + name);
      return BB[key];
    });
  }
})(typeof self !== 'undefined' ? self : globalThis, function (require) {

  const db = require('./botDatabase');
  const classifier = require('./botClassifier');
  const robotsParser = require('./robotsParser');
  const robotsGenerator = require('./robotsGenerator');
  const robotsSimulator = require('./robotsSimulator');
  const conflicts = require('./ruleConflictDetector');
  const nginx = require('./nginxGenerator');
  const apache = require('./apacheGenerator');
  const cloudflare = require('./cloudflareGenerator');
  const middleware = require('./middlewareGenerator');
  const validator = require('./configurationValidator');
  const score = require('./protectionScore');
  const coverage = require('./coverageAnalyzer');

  function normalizeConfig(raw) {
    const c = raw || {};
    return {
      website: String(c.website || '').trim(),
      mode: classifier.MODES.some(m => m.id === c.mode) ? c.mode : 'block-all',
      paths: {
        mode: c.paths && c.paths.mode === 'specific' ? 'specific' : 'entire',
        list: Array.isArray(c.paths && c.paths.list) ? c.paths.list.map(String) : []
      },
      exceptions: {
        enabled: !!(c.exceptions && c.exceptions.enabled),
        list: Array.isArray(c.exceptions && c.exceptions.list) ? c.exceptions.list.map(String) : []
      },
      defaultGroup: ['allow', 'none', 'mirror', 'block-others'].includes(c.defaultGroup) ? c.defaultGroup : 'allow',
      overrides: c.overrides && typeof c.overrides === 'object' ? c.overrides : {},
      customBots: Array.isArray(c.customBots) ? c.customBots.filter(b => b && b.token) : [],
      rateLimit: {
        enabled: !!(c.rateLimit && c.rateLimit.enabled),
        requestsPerSecond: Number(c.rateLimit && c.rateLimit.requestsPerSecond) || 1,
        requestsPerMinute: Number(c.rateLimit && c.rateLimit.requestsPerMinute) || 60,
        burst: Number(c.rateLimit && c.rateLimit.burst) || 20
      },
      sitemap: String(c.sitemap || '').trim(),
      outputs: Object.assign({ robots: true, nginx: false, apache: false, cloudflare: false, node: false, php: false, laravel: false }, c.outputs || {})
    };
  }

  /* Full deterministic generation pipeline. */
  function generate(rawConfig) {
    const config = normalizeConfig(rawConfig);
    const resolved = classifier.resolveActions(config);
    const tokens = classifier.blockedTokens(resolved);

    const robotsResult = robotsGenerator.generate(config, resolved, { website: config.website });
    const parsed = robotsParser.parse(robotsResult.text);
    const conflictReport = conflicts.analyze(parsed);
    const outputs = {};
    if (config.outputs.robots) outputs.robots = { label: 'robots.txt', text: robotsResult.text, placement: ['Upload to ' + (config.website ? config.website.replace(/\/$/, '') : 'https://example.com') + '/robots.txt, the file must be served at the domain root.', 'Propagation: compliant crawlers re-read robots.txt periodically (often cached up to 24 h), changes are not instant.'] };
    if (config.outputs.nginx) outputs.nginx = Object.assign({ label: 'Nginx', placement: [] }, nginx.generate(tokens, { rateLimit: config.rateLimit }));
    if (config.outputs.apache) outputs.apache = Object.assign({ label: 'Apache (.htaccess)', placement: [] }, apache.generate(tokens, { rateLimit: config.rateLimit }));
    if (config.outputs.cloudflare) outputs.cloudflare = Object.assign({ label: 'Cloudflare', placement: [] }, cloudflare.generate(tokens, { rateLimit: config.rateLimit }));
    const mw = middleware.generate(tokens, { rateLimit: config.rateLimit });
    if (config.outputs.node) outputs.node = { label: 'Node.js / Express', text: mw.node, placement: ['Install as Express middleware before your routes (see snippet header).'] };
    if (config.outputs.php) outputs.php = { label: 'PHP', text: mw.php, placement: ['Include at the top of your PHP entry point (index.php).'] };
    if (config.outputs.laravel) outputs.laravel = { label: 'Laravel', text: mw.laravel, placement: ['Save as app/Http/Middleware/BlockAiBots.php and register it (see snippet footer).'] };

    const configValidation = validator.validateConfig(config);
    const generatedValidation = validator.validateGenerated(robotsResult.text, outputs);
    const cov = coverage.analyze(parsed, resolved);
    const sc = score.compute({ resolved, parsed, conflicts: conflictReport, validation: generatedValidation, config, coverage: cov });

    return {
      config, resolved, blockedTokens: tokens,
      robotsTxt: robotsResult.text, robotsNotes: robotsResult.notes,
      parsed, conflicts: conflictReport, outputs,
      validation: {
        configErrors: configValidation.errors, configWarnings: configValidation.warnings,
        checks: generatedValidation.checks, errors: generatedValidation.errors, warnings: generatedValidation.warnings,
        productionReady: generatedValidation.productionReady && configValidation.errors.length === 0
      },
      coverage: cov, score: sc,
      database: { version: db.DB_VERSION, updated: db.DB_UPDATED, total: db.stats().total, aiRelated: db.stats().aiRelated },
      generatedAt: new Date().toISOString()
    };
  }

  /* Simulator against the CURRENT generated rules. */
  function simulateGenerated(report, token, path) {
    return robotsSimulator.check(report.parsed, token, path);
  }

  return { generate, simulateGenerated, normalizeConfig, MODES: classifier.MODES };
});
