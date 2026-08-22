'use strict';

/*
 * Protection score, a transparent, tool-generated diagnostic (0–100).
 * Explicitly NOT a Google score, NOT an official security score. Every point
 * is traceable to a component the user can see.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else {
    const BB = root.BB = root.BB || {};
    BB.protectionScore = factory(name => {
      const key = name.replace(/^\.\//, '');
      if (!BB[key]) throw new Error('botblocker module missing: ' + name);
      return BB[key];
    });
  }
})(typeof self !== 'undefined' ? self : globalThis, function (require) {

  const { pathMatches } = require('./robotsParser');

  function compute(input) {
    const { resolved, parsed, conflicts, validation, config, coverage } = input;
    const components = [];

    // 1) Known-crawler coverage (max 40), blocked share of AI-related bots in the database
    const knownAi = coverage.knownAi;
    const blockedCount = resolved.filter(r => r.effective === 'block').length;
    const wildcardBlocks = (parsed.groups || []).some(g => g.agentsLower.includes('*') && g.rules.some(r => r.type === 'disallow' && (r.path === '/' || r.path !== '')));
    const coveredForScore = blockedCount + (wildcardBlocks ? coverage.knownAi - blockedCount : 0);
    const coveragePts = knownAi ? Math.round(Math.min(1, coveredForScore / knownAi) * 40) : 0;
    components.push({
      name: 'Known-crawler coverage', points: coveragePts, max: 40,
      note: blockedCount + ' of ' + knownAi + ' known AI-related crawlers in the database are blocked by explicit rules' + (wildcardBlocks ? ' (a blocking wildcard group additionally covers the rest)' : '') + '. The database is not exhaustive, unknown crawlers are not counted.'
    });

    // 2) Rule consistency (max 15)
    let consistency = 15;
    if (conflicts.hasWarnings) consistency = 10;
    if (conflicts.hasErrors) consistency = 0;
    components.push({
      name: 'Rule consistency', points: consistency, max: 15,
      note: conflicts.hasErrors ? 'Errors detected in the rules, fix them before deploying.' : conflicts.hasWarnings ? 'Warnings detected (e.g. non-standard directives or high-impact wildcard rules).' : 'No conflicting or contradictory rules detected.'
    });

    // 3) robots.txt validity (max 10)
    let robotsPts = 10;
    if ((parsed.errors || []).length) robotsPts = 0;
    else if ((parsed.warnings || []).length) robotsPts = 6;
    components.push({
      name: 'robots.txt correctness', points: robotsPts, max: 10,
      note: (parsed.errors || []).length ? 'The robots.txt failed validation, it is not production-ready.' : 'Generated file re-parses cleanly (groups, paths, sitemap).'
    });

    // 4) Server-level enforcement (max 20)
    const technicalSelected = Object.entries(config.outputs || {}).filter(([k, v]) => v && k !== 'robots');
    const anyTechValid = technicalSelected.length > 0 && !((validation || {}).errors || []).length;
    const techPts = anyTechValid ? 20 : 0;
    components.push({
      name: 'Server-level enforcement', points: techPts, max: 20,
      note: technicalSelected.length ? 'Technical (403) configuration selected: ' + technicalSelected.map(([k]) => k).join(', ') + ', enforcement stronger than robots.txt.' : 'Only advisory robots.txt selected. Server/CDN-level blocking enforces; robots.txt only requests.'
    });

    // 5) Bot-specific controls (max 10)
    const explicitGroups = (parsed.groups || []).filter(g => !g.agentsLower.includes('*')).length;
    const botPts = Math.min(10, explicitGroups > 0 ? 10 : 0);
    components.push({
      name: 'Bot-specific control', points: botPts, max: 10,
      note: explicitGroups > 0 ? explicitGroups + ' per-crawler groups give targeted control instead of blanket wildcard rules.' : 'No per-crawler groups, everything relies on default behavior.'
    });

    // 6) Path coverage (max 5)
    const paths = config.paths || {};
    let pathPts = 0;
    if (paths.mode !== 'specific') pathPts = 5;
    else if ((paths.list || []).length) pathPts = 3;
    components.push({
      name: 'Path coverage', points: pathPts, max: 5,
      note: paths.mode !== 'specific' ? 'Entire site covered by the selected rules.' : (paths.list || []).length + ' specific path(s) covered; paths outside them stay unprotected by these rules.'
    });

    const score = components.reduce((s, c) => s + c.points, 0);
    const clamped = Math.max(0, Math.min(100, score));
    let label = 'Minimal protection';
    if (clamped >= 85) label = 'Strong configuration';
    else if (clamped >= 60) label = 'Moderate protection';
    else if (clamped >= 35) label = 'Basic protection';
    return {
      score: clamped, label, components,
      disclaimer: 'Tool-generated diagnostic score, not a Google score, not an official security score, and not a guarantee that crawlers are stopped.'
    };
  }

  return { compute };
});
