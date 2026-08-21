'use strict';

/*
 * Bot pattern matcher — false-positive-safe User-Agent token matching.
 *
 * Never matches on vague substrings ("AI", "bot", "crawler"). A database
 * token matches only when it appears as a delimited product token inside the
 * User-Agent string, e.g. "GPTBot" matches "…; GPTBot/1.2; …" and a bare
 * "GPTBot", but NOT "MyGPTBrowser" or "XGPTBot". Likewise "Applebot" does
 * NOT match "Applebot-Extended" and vice versa.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else {
    const BB = root.BB = root.BB || {};
    BB.botPatternMatcher = factory(name => {
      const key = name.replace(/^\.\//, '');
      if (!BB[key]) throw new Error('botblocker module missing: ' + name);
      return BB[key];
    });
  }
})(typeof self !== 'undefined' ? self : globalThis, function (require) {

  const BOUNDARY = /[A-Za-z0-9_-]/;

  /* Does `token` appear in `ua` as a delimited token? */
  function uaContainsToken(ua, token) {
    const s = String(ua || '');
    const t = String(token || '');
    if (!s || !t) return false;
    let i = 0;
    while ((i = s.indexOf(t, i)) !== -1) {
      const before = i > 0 ? s[i - 1] : null;
      const afterRaw = s[i + t.length];
      const after = afterRaw === undefined ? null : afterRaw;
      const okBefore = !before || !BOUNDARY.test(before);
      const okAfter = after === null || !BOUNDARY.test(after);
      if (okBefore && okAfter) return true;
      i += 1;
    }
    return false;
  }

  /* All tokens from `tokens` present in the UA (boundary-aware). */
  function matchTokens(ua, tokens) {
    return (tokens || []).filter(t => uaContainsToken(ua, t));
  }

  /* Escape a literal for embedding in a PCRE/JS regex. */
  function regexEscape(s) { return String(s).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); }

  /*
   * Build a single PCRE/JS-compatible regex that matches any of the tokens
   * with token boundaries. Works in nginx (PCRE), Apache (PCRE) and JS:
   *   (?<![A-Za-z0-9_-])(?:tok1|tok2)(?![A-Za-z0-9_-])
   */
  function tokenBoundaryRegex(tokens, flags) {
    const list = (tokens || []).map(t => regexEscape(t)).filter(Boolean);
    if (!list.length) return null;
    return new RegExp('(?<![A-Za-z0-9_-])(?:' + list.join('|') + ')(?![A-Za-z0-9_-])', flags || 'i');
  }
  function tokenBoundaryPattern(tokens) {
    const list = (tokens || []).map(t => regexEscape(t)).filter(Boolean);
    if (!list.length) return null;
    return '(?<![A-Za-z0-9_-])(?:' + list.join('|') + ')(?![A-Za-z0-9_-])';
  }

  const GENERIC_WORDS = new Set(['ai', 'bot', 'crawler', 'spider', 'scraper', 'agent', 'assistant', 'search', 'http', 'mozilla', 'chrome', 'safari', 'python', 'curl', 'wget']);

  /*
   * Validate a custom User-Agent token.
   * Returns { ok, errors:[], warnings:[] } — never throws.
   */
  function validateToken(token) {
    const errors = [], warnings = [];
    const t = String(token || '').trim();
    if (!t) errors.push('User-Agent token is empty.');
    else {
      if (t.length < 3) errors.push('User-Agent token is too short (minimum 3 characters).');
      if (t.length > 80) errors.push('User-Agent token is too long (maximum 80 characters).');
      if (/[^\w.+\/ -]/.test(t)) errors.push('User-Agent token contains characters that are not valid in a User-Agent product token (letters, digits, _ . + / - are allowed).');
      const lower = t.toLowerCase();
      if (GENERIC_WORDS.has(lower)) errors.push('The token "' + t + '" is a generic word and would match many unrelated User-Agents. Use the exact product token (e.g. "MyAIBrowser", not "AI").');
      else if (t.length < 6 && !/\d/.test(t)) warnings.push('Very short tokens can produce false positives. Prefer the full product token.');
      if (/^[A-Za-z]+\d*$/.test(t) && t.length <= 5) warnings.push('Short word-like token — double-check it is a real product token to avoid false positives.');
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  return { uaContainsToken, matchTokens, tokenBoundaryRegex, tokenBoundaryPattern, regexEscape, validateToken };
});
