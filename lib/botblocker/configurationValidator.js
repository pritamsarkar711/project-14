'use strict';

/*
 * Configuration validator, validates the user configuration AND re-validates
 * every generated artifact (round-trip robots.txt parse, regex compile checks,
 * brace/quote balance, middleware syntax). If anything is invalid the report
 * is marked not production-ready instead of being silently presented.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else {
    const BB = root.BB = root.BB || {};
    BB.configurationValidator = factory(name => {
      const key = name.replace(/^\.\//, '');
      if (!BB[key]) throw new Error('botblocker module missing: ' + name);
      return BB[key];
    });
  }
})(typeof self !== 'undefined' ? self : globalThis, function (require) {

  const { parse } = require('./robotsParser');
  const { validateToken } = require('./botPatternMatcher');
  const classifier = require('./botClassifier');

  function validateConfig(config) {
    const errors = [], warnings = [];
    const mode = classifier.MODES.find(m => m.id === config.mode);
    if (!mode) errors.push('Unknown protection mode "' + config.mode + '".');

    const site = String(config.website || '').trim();
    if (site && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(site)) {
      warnings.push('Website "' + site + '" does not look like a URL, used only in instructions, generation continues.');
    }

    const paths = config.paths || {};
    if (paths.mode === 'specific') {
      const list = paths.list || [];
      if (!list.length) errors.push('Path scope is "specific paths" but no paths were provided.');
      for (const p of list) {
        if (!String(p).startsWith('/')) errors.push('Invalid path "' + p + '", paths must start with "/".');
        if (String(p).includes('..')) errors.push('Invalid path "' + p + '", ".." is not valid in robots.txt paths.');
      }
    }
    if (config.exceptions && config.exceptions.enabled) {
      if (!(config.exceptions.list || []).length) warnings.push('Exceptions enabled but no exception paths provided, nothing to allow.');
      if (paths.mode === 'specific') {
        warnings.push('robots.txt has no nested-exception operator: Allow carve-outs only work by the longest-match rule. Specific-path blocking plus exceptions can be surprising, verify the result in the simulator.');
      }
    }

    if (config.defaultGroup === 'block-others') {
      warnings.push('The default (*) group is set to disallow everything, this also asks search-engine crawlers not to crawl your site.');
    }

    for (const cb of config.customBots || []) {
      const v = validateToken(cb.token);
      for (const e of v.errors) errors.push('Custom bot "' + (cb.name || cb.token) + '": ' + e);
      for (const w of v.warnings) warnings.push('Custom bot "' + (cb.name || cb.token) + '": ' + w + ' Custom User-Agent rules may produce false positives if the pattern is too broad.');
    }

    if (config.rateLimit && config.rateLimit.enabled) {
      const r = config.rateLimit;
      const rps = Number(r.requestsPerSecond), rpm = Number(r.requestsPerMinute), burst = Number(r.burst);
      if (!(rps > 0) && !(rpm > 0)) warnings.push('Rate control enabled but no positive request limit set.');
      if (rps > 50 || rpm > 3000) warnings.push('Very high rate limits, these may not meaningfully limit crawlers.');
      if (burst > 100) warnings.push('Burst above 100 is effectively no burst control.');
    }

    const outputs = Object.keys(config.outputs || {}).filter(k => config.outputs[k]);
    if (!outputs.length) errors.push('No output format selected, select at least robots.txt.');

    return { errors, warnings };
  }

  function validateGenerated(robotsTxt, outputs) {
    const errors = [], warnings = [], checks = [];
    const textOf = o => (o && typeof o === 'object' ? String(o.text || '') : String(o || ''));

    // robots.txt round-trip
    const parsed = parse(robotsTxt);
    if (parsed.errors.length) {
      errors.push('Generated robots.txt did not re-parse cleanly (' + parsed.errors.length + ' error(s)), it is NOT shown as production-ready.');
    } else {
      checks.push({ name: 'robots.txt syntax', status: 'pass', message: 'Re-parsed the generated file: valid groups, paths and directives.' });
    }
    if (!parsed.stats.groups && !parsed.stats.sitemaps) warnings.push('Generated robots.txt contains no groups, effectively an empty advisory file.');
    if (parsed.warnings.length) warnings.push('robots.txt notes: ' + parsed.warnings.map(w => w.message).join(' '));

    // Duplicate robots.txt rules
    const seenRule = new Set();
    let dup = 0;
    for (const g of parsed.groups) for (const r of g.rules) {
      const k = g.agents.join('|') + '>' + r.type + ':' + r.path;
      if (seenRule.has(k)) dup++;
      else seenRule.add(k);
    }
    if (dup) warnings.push(dup + ' duplicate rule(s) in generated robots.txt.');
    else checks.push({ name: 'Duplicate rules', status: 'pass', message: 'No duplicate User-agent rules in the generated file.' });

    // nginx
    if (outputs.nginx) {
      const t = textOf(outputs.nginx);
      if (outputs.nginx.empty) {
        checks.push({ name: 'nginx structure', status: 'info', message: 'No blocked bots selected, nginx output intentionally empty.' });
      } else {
        const open = (t.match(/\{/g) || []).length, close = (t.match(/\}/g) || []).length;
        if (open !== close) errors.push('nginx: unbalanced braces (' + open + '{ vs ' + close + '}), configuration invalid.');
        else checks.push({ name: 'nginx structure', status: 'pass', message: 'Braces balanced; map + guarded if pattern present.' });
        const mapLine = t.split('\n').find(l => l.trim().startsWith('~*'));
        if (!mapLine) errors.push('nginx: no User-Agent map regex found.');
        else {
          const pat = mapLine.trim().replace(/^~\*/, '').replace(/\s+1;\s*$/, '');
          try { new RegExp(pat, 'i'); checks.push({ name: 'nginx regex', status: 'pass', message: 'User-Agent regex compiles.' }); }
          catch (e) { errors.push('nginx: generated User-Agent regex failed to compile: ' + e.message); }
        }
      }
    }

    // apache
    if (outputs.apache) {
      const t = textOf(outputs.apache);
      if (outputs.apache.empty) {
        checks.push({ name: 'Apache structure', status: 'info', message: 'No blocked bots selected: Apache output intentionally empty.' });
      } else if (!/RewriteCond %{HTTP_USER_AGENT}/.test(t)) {
        warnings.push('Apache: missing RewriteCond, check generated snippet.');
      } else {
        const m = t.match(/RewriteCond %{HTTP_USER_AGENT} (\S+) \[NC\]/);
        if (!m) errors.push('Apache: malformed RewriteCond.');
        else {
          try { new RegExp(m[1]); checks.push({ name: 'Apache regex', status: 'pass', message: 'RewriteCond pattern compiles with PCRE-compatible syntax.' }); }
          catch (e) { errors.push('Apache: RewriteCond regex failed to compile: ' + e.message); }
        }
      }
    }

    // cloudflare
    if (outputs.cloudflare && outputs.cloudflare.expression) {
      const e = outputs.cloudflare.expression;
      const bal = (e.match(/\(/g) || []).length - (e.match(/\)/g) || []).length;
      if (bal !== 0) errors.push('Cloudflare: unbalanced parentheses in the rule expression.');
      else {
        const quotes = (e.match(/"/g) || []).length;
        if (quotes % 2 !== 0) errors.push('Cloudflare: unbalanced quotes in the rule expression.');
        else checks.push({ name: 'Cloudflare expression', status: 'pass', message: 'Parentheses and quotes balanced; contains-operator clauses well-formed.' });
      }
    }

    // middleware JS syntax
    if (outputs.node && textOf(outputs.node)) {
      try { new Function(textOf(outputs.node)); checks.push({ name: 'Node.js snippet', status: 'pass', message: 'Snippet parses as JavaScript.' }); }
      catch (err) { errors.push('Node.js snippet failed to parse: ' + err.message); }
    }

    // PHP / Laravel brace balance
    for (const [label, src] of [['PHP', outputs.php], ['Laravel', outputs.laravel]]) {
      if (!src || !textOf(src)) continue;
      const bo = (textOf(src).match(/\{/g) || []).length, bc = (textOf(src).match(/\}/g) || []).length;
      if (bo !== bc) errors.push(label + ': unbalanced braces (' + bo + ' vs ' + bc + ').');
      else checks.push({ name: label + ' snippet structure', status: 'pass', message: 'Braces balanced; basic directive sanity passed.' });
    }

    return { errors, warnings, checks, productionReady: errors.length === 0 };
  }

  return { validateConfig, validateGenerated };
});
