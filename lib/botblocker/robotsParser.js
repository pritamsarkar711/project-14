'use strict';

/*
 * robots.txt parser (RFC 9309-oriented).
 * Supports: User-agent groups (consecutive User-agent lines merge),
 * Allow / Disallow (with * wildcards and $ end anchor), Sitemap,
 * Crawl-delay (non-standard), comments, blank lines, duplicate groups.
 * Reports syntax problems instead of silently guessing.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else {
    const BB = root.BB = root.BB || {};
    BB.robotsParser = factory(name => {
      const key = name.replace(/^\.\//, '');
      if (!BB[key]) throw new Error('botblocker module missing: ' + name);
      return BB[key];
    });
  }
})(typeof self !== 'undefined' ? self : globalThis, function (require) {

  const KNOWN_FIELDS = new Set(['user-agent', 'allow', 'disallow', 'sitemap', 'crawl-delay']);

  function parse(txt) {
    const groups = [];
    const sitemaps = [];
    const errors = [];
    const warnings = [];
    const orphanRules = [];
    let cur = null;
    let sawRule = false;
    let lineNo = 0;
    let ruleCount = 0;

    const lines = String(txt || '').split(/\r?\n/);
    if (lines.length > 100000) {
      warnings.push({ line: 0, message: 'File is unusually large (' + lines.length + ' lines), many crawlers cap robots.txt at 500 KiB.' });
    }

    for (const raw of lines) {
      lineNo++;
      const noComment = raw.replace(/#.*$/, '');
      const line = noComment.trim();
      if (!line) continue;
      const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (!m) {
        warnings.push({ line: lineNo, message: 'Unrecognized line "' + line + '", expected a "Field: value" directive.', raw: line });
        continue;
      }
      const field = m[1].toLowerCase();
      const value = m[2].trim();

      if (field === 'sitemap') {
        if (!value) warnings.push({ line: lineNo, message: 'Empty Sitemap directive ignored.' });
        else if (!/^https?:\/\//i.test(value)) errors.push({ line: lineNo, message: 'Sitemap value must be an absolute URL: "' + value + '".' });
        else sitemaps.push(value);
        continue;
      }

      if (field === 'user-agent') {
        if (!value) { warnings.push({ line: lineNo, message: 'Empty User-agent value ignored.' }); continue; }
        // Consecutive User-agent lines belong to the same group (RFC 9309 §2.2.1).
        if (!cur || cur.rules.length > 0 || cur.crawlDelay !== null) {
          cur = { agents: [value], agentsLower: [value.toLowerCase()], rules: [], crawlDelay: null };
          groups.push(cur);
        } else {
          cur.agents.push(value);
          cur.agentsLower.push(value.toLowerCase());
        }
        continue;
      }

      if (field === 'allow' || field === 'disallow') {
        if (!cur) {
          orphanRules.push({ line: lineNo, type: field, path: value });
          errors.push({ line: lineNo, message: (field === 'allow' ? 'Allow' : 'Disallow') + ' appears before any User-agent group, robots.txt requires a User-agent line first. This rule is unreachable for compliant crawlers.' });
          continue;
        }
        if (value === '') {
          warnings.push({ line: lineNo, message: (field === 'disallow' ? 'Disallow:' : 'Allow:') + ' with an empty value means "no restriction".' });
        } else if (!value.startsWith('/')) {
          if (!value.startsWith('*')) {
            warnings.push({ line: lineNo, message: field + ' path "' + value + '" does not start with "/", most crawlers expect paths beginning with a slash.' });
          }
        }
        cur.rules.push({ type: field, path: value, line: lineNo });
        ruleCount++;
        sawRule = true;
        continue;
      }

      if (field === 'crawl-delay') {
        if (!cur) { errors.push({ line: lineNo, message: 'Crawl-delay appears before any User-agent group.' }); continue; }
        const n = parseFloat(value);
        if (Number.isNaN(n) || n < 0) warnings.push({ line: lineNo, message: 'Invalid Crawl-delay value "' + value + '" ignored.' });
        else { cur.crawlDelay = n; warnings.push({ line: lineNo, message: 'Crawl-delay is a non-standard extension, support varies between crawlers (Google ignores it).' }); }
        continue;
      }

      warnings.push({ line: lineNo, message: 'Unknown directive "' + field + '" ignored, not part of RFC 9309.' });
    }

    // Duplicate tokens across separate groups
    const seen = new Map();
    for (const g of groups) {
      g.agentsLower.forEach((a, i) => {
        if (a !== '*' && seen.has(a)) {
          warnings.push({
            line: null, message: 'User-agent "' + seen.get(a) + '" is declared in more than one group. Crawlers typically merge such groups (RFC 9309: matching groups combine); keep one group per token to avoid confusion.'
          });
        } else if (!seen.has(a)) seen.set(a, g.agents[i]);
      });
    }
    for (const g of groups) {
      if (!g.rules.length && g.crawlDelay === null) {
        warnings.push({ line: null, message: 'Group for "' + g.agents.join('", "') + '" has no Allow/Disallow rules, it grants no restrictions.' });
      }
    }

    return {
      groups, sitemaps, errors, warnings, orphanRules,
      stats: { lines: lines.length, groups: groups.length, rules: ruleCount, sitemaps: sitemaps.length, empty: !txt || !String(txt).trim() }
    };
  }

  /* Groups that apply to a given UA token: exact matches win; only if none,
   * the wildcard groups apply (RFC 9309 / common crawler behavior). */
  function matchingGroups(parsed, token) {
    const t = String(token || '').toLowerCase();
    const exact = parsed.groups.filter(g => g.agentsLower.includes(t));
    if (exact.length) return { groups: exact, specificity: 'exact' };
    const wild = parsed.groups.filter(g => g.agentsLower.includes('*'));
    if (wild.length) return { groups: wild, specificity: 'wildcard' };
    return { groups: [], specificity: 'none' };
  }

  /* Wildcard/$ pattern match, prefix match with * and $ support. */
  function pathMatches(path, pattern) {
    if (!pattern) return false;
    let p = pattern;
    let anchorEnd = false;
    if (p.endsWith('$')) { anchorEnd = true; p = p.slice(0, -1); }
    let re = '^' + p.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    if (!anchorEnd) re += '.*'; // prefix semantics
    re += '$';
    try { return new RegExp(re).test(path); } catch (e) { return false; }
  }

  function normalizePath(input) {
    let p = String(input || '').trim();
    if (/^https?:\/\//i.test(p)) {
      try { const u = new URL(p); return u.pathname + u.search; } catch (e) { /* fall through */ }
    }
    if (!p.startsWith('/')) p = '/' + p;
    return p;
  }

  return { parse, matchingGroups, pathMatches, normalizePath, KNOWN_FIELDS };
});
