'use strict';

/*
 * Rule simulator — deterministic robots.txt access determination.
 *
 * Implements the matching behavior documented in RFC 9309 and implemented by
 * major crawlers (Google): pick the applicable group (exact token match beats
 * the wildcard group; matching groups combine), then evaluate Allow/Disallow
 * by the longest (most specific) matching pattern; ties favor Allow.
 * Every decision returns the exact reasoning — never a bare verdict.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else {
    const BB = root.BB = root.BB || {};
    BB.robotsSimulator = factory(name => {
      const key = name.replace(/^\.\//, '');
      if (!BB[key]) throw new Error('botblocker module missing: ' + name);
      return BB[key];
    });
  }
})(typeof self !== 'undefined' ? self : globalThis, function (require) {

  const { matchingGroups, pathMatches, normalizePath } = require('./robotsParser');

  /*
   * check(parsed, token, path) → {
   *   verdict: 'allowed' | 'blocked' | 'uncertain',
   *   reason, appliedGroup, rule: {type, path, line} | null,
   *   matchedRules: [...], explanation: [lines]
   * }
   */
  function check(parsed, token, path) {
    const p = normalizePath(path);
    const t = String(token || '').trim();
    const sel = matchingGroups(parsed, t);
    const explanation = [];

    if (!sel.groups.length) {
      return {
        verdict: 'uncertain', reason: 'No robots.txt group matches the User-Agent "' + t + '" and there is no wildcard (*) group. Under RFC 9309 this means crawling is allowed by default — but behavior is not guaranteed for non-compliant crawlers.',
        appliedGroup: null, rule: null, matchedRules: [], path: p, token: t,
        explanation: [
          'User-agent "' + t + '" has no matching group and no "*" group exists.',
          'RFC 9309 default: if nothing matches, access is allowed — nothing was asked of this crawler.',
          'Marked UNCERTAIN because an unknown crawler\u2019s actual behavior cannot be verified from the file alone.'
        ]
      };
    }

    explanation.push(sel.specificity === 'exact'
      ? 'Exact User-agent group match: ' + sel.groups.map(g => 'User-agent: ' + g.agents.join(' / ')).join('; ') + '. Wildcard (*) groups are ignored for this crawler.'
      : 'No exact User-agent group matches "' + t + '" — the wildcard (*) group applies: ' + sel.groups.map(g => g.agents.join(' / ')).join('; ') + '.');

    const rules = [];
    for (const g of sel.groups) for (const r of g.rules) rules.push(r);
    const matched = [];
    for (const r of rules) {
      if (r.path === '') continue; // empty value = no restriction
      if (pathMatches(p, r.path)) matched.push({ rule: r, len: r.path.length });
    }

    if (!matched.length) {
      return {
        verdict: 'allowed', reason: 'No Allow/Disallow rule in the applicable group matches "' + p + '" — crawling is allowed (nothing disallowed it).',
        appliedGroup: sel.groups.map(g => g.agents.join(', ')).join('; '), rule: null, matchedRules: [], path: p, token: t,
        explanation: explanation.concat(['No rule pattern matches "' + p + '", and an empty rule set means "not disallowed" → allowed.'])
      };
    }

    matched.sort((a, b) => b.len - a.len || (a.rule.type === 'allow' ? -1 : 1));
    const winner = matched[0];
    const ties = matched.filter(m => m.len === winner.len);
    explanation.push('Matching rules: ' + matched.map(m => m.rule.type + ': ' + (m.rule.path || '(empty)') + ' (specificity ' + m.len + ')').join(' · ') + '.');
    explanation.push('The most specific rule wins (longest pattern — RFC 9309 / Google implementation): ' + winner.rule.type + ': ' + winner.rule.path + '.');

    if (ties.length > 1) {
      const allowAmong = ties.some(m => m.rule.type === 'allow');
      const disallowAmong = ties.some(m => m.rule.type === 'disallow');
      if (allowAmong && disallowAmong) explanation.push('Allow and Disallow tie at specificity ' + winner.len + ' — the less restrictive rule (Allow) wins, matching major crawler implementations.');
    }

    const blocked = winner.rule.type === 'disallow';
    if (!blocked) explanation.push('Result: ALLOWED — the winning Allow rule overrides any shorter Disallow.');
    else explanation.push('Result: BLOCKED — the winning Disallow rule covers this path.');

    return {
      verdict: blocked ? 'blocked' : 'allowed',
      reason: (blocked ? 'Disallow: ' : 'Allow: ') + winner.rule.path + ' is the most specific rule matching "' + p + '" for User-agent "' + t + '".',
      appliedGroup: sel.groups.map(g => g.agents.join(', ')).join('; '),
      rule: winner.rule, matchedRules: matched.map(m => ({ type: m.rule.type, path: m.rule.path, line: m.rule.line, specificity: m.len })),
      path: p, token: t, explanation
    };
  }

  return { check };
});
