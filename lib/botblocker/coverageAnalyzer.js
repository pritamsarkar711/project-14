'use strict';

/*
 * Coverage analyzer — reports how many KNOWN crawlers in the tool's database
 * are explicitly configured, implicitly covered by wildcard rules, or not
 * configured. Wording is deliberately honest: the database is not every AI
 * crawler on the internet.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else {
    const BB = root.BB = root.BB || {};
    BB.coverageAnalyzer = factory(name => {
      const key = name.replace(/^\.\//, '');
      if (!BB[key]) throw new Error('botblocker module missing: ' + name);
      return BB[key];
    });
  }
})(typeof self !== 'undefined' ? self : globalThis, function (require) {

  const db = require('./botDatabase');

  function analyze(parsed, resolved) {
    const agentTokens = new Set();
    for (const g of parsed.groups || []) for (const a of g.agentsLower) agentTokens.add(a);

    const configured = [], implicitlyCovered = [], notConfigured = [];
    for (const r of resolved) {
      const token = (r.bot.token || '').toLowerCase();
      const record = {
        id: r.bot.id, name: r.bot.name, token: r.bot.token, organization: r.bot.organization,
        category: r.bot.category, effective: r.effective, custom: !!r.bot.custom
      };
      if (agentTokens.has(token)) {
        record.reason = 'Has its own User-agent group in the generated robots.txt.';
        configured.push(record);
      } else if (agentTokens.has('*')) {
        record.reason = 'No explicit group — the wildcard (*) group governs this crawler.';
        implicitlyCovered.push(record);
      } else {
        record.reason = 'No matching group — allowed by default (nothing asked of it).';
        notConfigured.push(record);
      }
    }

    return {
      knownTotal: db.stats().total,
      knownAi: db.stats().aiRelated,
      configuredCount: configured.length,
      implicitlyCoveredCount: implicitlyCovered.length,
      notConfiguredCount: notConfigured.length,
      configured, implicitlyCovered, notConfigured,
      disclaimer: 'Covers known crawlers in our database (' + db.stats().total + ' records, v' + db.DB_VERSION + ') — not every AI crawler on the internet.'
    };
  }

  return { analyze };
});
