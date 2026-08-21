'use strict';

/*
 * Rule conflict detector — inspects a parsed robots.txt for contradictions,
 * duplicates, unreachable rules and potentially unintended blocking, and
 * explains which rule actually wins according to robots.txt matching behavior.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else {
    const BB = root.BB = root.BB || {};
    BB.ruleConflictDetector = factory(name => {
      const key = name.replace(/^\.\//, '');
      if (!BB[key]) throw new Error('botblocker module missing: ' + name);
      return BB[key];
    });
  }
})(typeof self !== 'undefined' ? self : globalThis, function (require) {

  const { pathMatches } = require('./robotsParser');

  const winExplain = 'Matching behavior: for one User-agent, the most specific (longest) matching pattern wins; ties favor Allow (RFC 9309 + Google implementation).';

  function analyze(parsed) {
    const issues = [];
    const groups = parsed.groups || [];

    for (const g of groups) {
      const label = g.agents.join('", "');
      const dis = g.rules.filter(r => r.type === 'disallow');
      const allows = g.rules.filter(r => r.type === 'allow');

      // Exact duplicate paths
      const seenPath = new Map();
      for (const r of g.rules) {
        const key = r.type + ' ' + r.path;
        if (seenPath.has(key)) {
          issues.push({ level: 'info', title: 'Duplicate rule in "' + label + '" group', detail: '"' + r.type + ': ' + r.path + '" is declared more than once. Duplicates are harmless but should be cleaned up.' });
        } else seenPath.set(key, true);
      }

      // Same path both allowed and disallowed
      const disPaths = new Set(dis.map(r => r.path));
      for (const a of allows) {
        if (disPaths.has(a.path) && a.path !== '') {
          issues.push({ level: 'info', title: 'Same path Allowed and Disallowed in "' + label + '"', detail: 'Both "' + a.path + '" rules match identically (equal specificity). The Allow wins under the standard tie-breaking rule. ' + winExplain });
        }
      }

      const fullBlock = dis.find(r => r.path === '/');
      if (fullBlock) {
        // Redundant extra disallows
        if (dis.length > 1) {
          issues.push({ level: 'info', title: 'Redundant rules under full block in "' + label + '"', detail: '"Disallow: /" already covers the whole site, so the other Disallow rules in this group are unreachable/redundant.' });
        }
        // Allow carve-outs
        for (const a of allows) {
          if (a.path === '/') {
            issues.push({ level: 'info', title: 'Allow: / vs Disallow: / in "' + label + '"', detail: 'Both rules have equal specificity. The Allow wins — effectively nothing is disallowed for this group. ' + winExplain });
          } else if (pathMatches(a.path, '/')) {
            issues.push({ level: 'info', title: 'Allow exception inside full block in "' + label + '"', detail: '"Allow: ' + a.path + '" is longer than "Disallow: /", so it carves out an exception for that subtree. Intentional carve-outs are valid; verify this is what you want.' });
          }
        }
        if (g.agentsLower.includes('*')) {
          issues.push({ level: 'warning', title: 'Wildcard group blocks the entire site', detail: '"User-agent: *" with "Disallow: /" asks every compliant crawler — including Googlebot, Bingbot and other search engines — not to crawl your site. Only specific groups listed separately are unaffected.' });
        }
      }

      // Empty disallow alongside real ones
      const emptyDis = dis.find(r => r.path === '');
      if (emptyDis && dis.length > 1) {
        issues.push({ level: 'info', title: 'Empty Disallow mixed with real rules in "' + label + '"', detail: '"Disallow:" with an empty value means "no restriction"; the other rules still apply. The empty line is redundant.' });
      }
    }

    // Cross-group: wildcard blocks everything while specific groups allow
    const wildBlockAll = groups.find(g => g.agentsLower.includes('*') && g.rules.some(r => r.type === 'disallow' && r.path === '/'));
    if (wildBlockAll) {
      for (const g of groups) {
        if (g.agentsLower.includes('*')) continue;
        if (g.rules.some(r => r.type === 'allow' && r.path === '/')) {
          issues.push({
            level: 'info', title: 'Specific group overrides the wildcard block',
            detail: 'The wildcard group disallows everything, but "' + g.agents.join('", "') + '" has its own "Allow: /" group. The exact User-agent group takes precedence for that crawler, so it remains allowed. This is how robots.txt precedence works — not a contradiction — but verify it is intentional.'
          });
        }
      }
    }
    const wildAny = groups.filter(g => g.agentsLower.includes('*'));
    const specific = groups.filter(g => !g.agentsLower.includes('*'));
    if (wildAny.length && specific.length) {
      issues.push({ level: 'info', title: 'Wildcard group plus specific groups', detail: 'Crawlers named explicitly follow only their own group and ignore the "*" group. Bots with no exact group follow "*" — e.g. "' + specific[0].agents[0] + '" ignores the "*" rules entirely.' });
    }

    // Orphan rules / parse errors elevated
    for (const e of parsed.errors || []) {
      issues.push({ level: 'error', title: 'Syntax problem (line ' + (e.line || '?') + ')', detail: e.message });
    }
    for (const w of parsed.warnings || []) {
      if (/unrecognized|unknown directive/i.test(w.message)) {
        issues.push({ level: 'warning', title: 'Unrecognized line (line ' + (w.line || '?') + ')', detail: w.message });
      }
    }

    return { issues, hasErrors: issues.some(i => i.level === 'error'), hasWarnings: issues.some(i => i.level === 'warning') };
  }

  /* Before/after comparison at the per-group rule level. */
  function compare(beforeParsed, afterParsed) {
    function snapshot(parsed) {
      const map = new Map();
      for (const g of parsed.groups || []) {
        for (const a of g.agents) {
          const key = a;
          if (!map.has(key)) map.set(key, new Set());
          for (const r of g.rules) map.get(key).add(r.type + ': ' + r.path);
        }
      }
      return map;
    }
    const before = snapshot(beforeParsed), after = snapshot(afterParsed);
    const added = [], removed = [], changed = [];
    const agents = new Set([...before.keys(), ...after.keys()]);
    for (const a of [...agents].sort()) {
      const b = before.get(a) || new Set();
      const f = after.get(a) || new Set();
      for (const rule of f) if (!b.has(rule)) added.push({ agent: a, rule });
      for (const rule of b) if (!f.has(rule)) removed.push({ agent: a, rule });
      if (b.size && f.size && b.size !== f.size) changed.push({ agent: a, before: b.size, after: f.size });
    }
    const sitemapsAdded = (afterParsed.sitemaps || []).filter(s => !(beforeParsed.sitemaps || []).includes(s));
    return { added, removed, changed, sitemapsAdded };
  }

  return { analyze, compare };
});
