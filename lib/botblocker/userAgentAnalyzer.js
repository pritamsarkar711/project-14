'use strict';

/*
 * User-Agent analyzer — identify a raw User-Agent string against the database
 * using exact, boundary-aware token matching. Explicitly reports "unknown"
 * rather than guessing from name fragments (no "AI"/"bot" keyword matching).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else {
    const BB = root.BB = root.BB || {};
    BB.userAgentAnalyzer = factory(name => {
      const key = name.replace(/^\.\//, '');
      if (!BB[key]) throw new Error('botblocker module missing: ' + name);
      return BB[key];
    });
  }
})(typeof self !== 'undefined' ? self : globalThis, function (require) {

  const db = require('./botDatabase');
  const { uaContainsToken } = require('./botPatternMatcher');

  const GENERIC_HINTS = [
    { re: /\b(bot|spider|crawler|scraper)\b/i, note: 'Contains generic crawler vocabulary — many legitimate products include these words, so this is not identification.' },
    { re: /\b(ai|llm|gpt|agents?)\b/i, note: 'Contains AI-related vocabulary — the tool never identifies a bot from keywords like "AI"; only exact database tokens count.' }
  ];

  function analyze(ua) {
    const s = String(ua || '').trim();
    const matches = db.all().filter(b => uaContainsToken(s, b.token));
    const hints = GENERIC_HINTS.filter(h => h.re.test(s)).map(h => h.note);
    const result = {
      input: s,
      known: matches.length > 0,
      matches: matches.map(b => ({ id: b.id, name: b.name, token: b.token, organization: b.organization, category: b.category, robotsSupport: b.robotsSupport, confidence: b.confidence, officialDocumentation: b.officialDocumentation })),
      ambiguous: matches.length > 1,
      spoofable: true,
      hints
    };
    if (!s) result.summary = 'Empty User-Agent string — server rules can block empty User-Agents separately if desired.';
    else if (result.ambiguous) result.summary = 'Matches ' + matches.length + ' known crawlers (' + matches.map(m => m.token).join(', ') + ') — possibly a spoofed or composite User-Agent.';
    else if (result.known) result.summary = 'Identified as ' + matches[0].name + ' (' + matches[0].organization + ') by exact User-Agent token.';
    else result.summary = 'No known crawler token in the database matches this User-Agent exactly. ' + (hints.length ? 'Vocabulary hints found, but they are NOT identification — the tool does not block on vague keywords.' : '');
    return result;
  }

  return { analyze };
});
