'use strict';

/*
 * Bot classifier — resolves the protection mode + per-bot overrides into a
 * concrete allow/block decision for every bot in the database (and any custom
 * bots). Deterministic; no AI, no network.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else {
    const BB = root.BB = root.BB || {};
    BB.botClassifier = factory(name => {
      const key = name.replace(/^\.\//, '');
      if (!BB[key]) throw new Error('botblocker module missing: ' + name);
      return BB[key];
    });
  }
})(typeof self !== 'undefined' ? self : globalThis, function (require) {

  const db = require('./botDatabase');

  const MODES = [
    { id: 'block-all', label: 'Block All Known AI Crawlers', preset: 'Maximum AI Restriction', desc: 'Advisory + technical rules for every recognized AI-related crawler in the database.' },
    { id: 'block-training', label: 'Block AI Training Crawlers Only', preset: 'Block AI Training', desc: 'Block training/data-collection crawlers; keep AI search & retrieval visible.' },
    { id: 'block-search', label: 'Block AI Search Crawlers Only', preset: 'Block AI Search', desc: 'Block AI search/indexing crawlers; training crawlers stay allowed.' },
    { id: 'block-extraction', label: 'Block AI Content Extraction Crawlers', preset: 'Block Extraction', desc: 'Block content-extraction crawlers (e.g. structured data APIs).' },
    { id: 'allow-all', label: 'Allow All AI Crawlers', preset: 'Allow AI Crawlers', desc: 'Explicitly allow every recognized AI crawler.' },
    { id: 'allow-selected', label: 'Allow Selected AI Crawlers', preset: 'Allowlist', desc: 'Block all known AI crawlers except the ones you explicitly allow below.' },
    { id: 'custom', label: 'Custom AI Crawler Rules', preset: 'Custom', desc: 'Choose Allow / Block / Default per crawler; Default means “no explicit rule, follow the default group”.' },
    { id: 'advanced', label: 'Custom Advanced Configuration', preset: 'Custom Advanced', desc: 'Full control: per-bot rules, paths, exceptions, default group, rate control, output selection.' }
  ];

  function presetDefault(mode, bot) {
    const isAi = db.AI_CATEGORIES.includes(bot.category);
    switch (mode) {
      case 'block-all': return isAi ? 'block' : 'default';
      case 'allow-selected': return isAi ? 'block' : 'default';
      case 'block-training': return bot.category === 'training' ? 'block' : 'allow';
      case 'block-search': return bot.category === 'search' ? 'block' : 'allow';
      case 'block-extraction': return bot.category === 'extraction' ? 'block' : 'allow';
      case 'allow-all': return isAi ? 'allow' : 'default';
      case 'custom':
      case 'advanced':
      default:
        return 'default';
    }
  }

  /*
   * Resolve actions for all database bots + custom bots.
   * Returns array of { bot, action, effective, source }
   *   action   — what the user (or preset) asked for: allow | block | default
   *   effective— what lands in the generated config: block | allow | none
   */
  function resolveActions(config) {
    const mode = config.mode || 'block-all';
    const overrides = config.overrides || {};
    const out = [];
    for (const bot of db.all()) {
      const override = overrides[bot.id];
      let action, source;
      if (override === 'allow' || override === 'block') { action = override; source = 'override'; }
      else if (override === 'default') { action = 'default'; source = 'override'; }
      else { action = presetDefault(mode, bot); source = 'preset'; }
      const effective = action === 'allow' ? 'allow' : action === 'block' ? 'block' : 'none';
      out.push({ bot, action, effective, source });
    }
    for (const cb of config.customBots || []) {
      const action = cb.action === 'allow' || cb.action === 'block' ? cb.action : 'default';
      out.push({
        bot: {
          id: cb.id, name: cb.name || cb.token, token: cb.token, organization: cb.organization || 'Custom',
          category: cb.category || 'unknown', purpose: cb.purpose || 'User-defined crawler entry.',
          userAgents: [], officialDocumentation: null, robotsSupport: 'unknown',
          technicalBlockingNotes: 'Custom entry — verify against your own logs. User-Agent values can be spoofed.',
          verificationNotes: 'Added by the site owner on this device.', lastVerified: null, confidence: 'unverified', recommended: 'default', custom: true
        },
        action, effective: action === 'default' ? 'none' : action, source: 'custom'
      });
    }
    return out;
  }

  /* Which blocked tokens should land in server-level (technical) configs? */
  function blockedTokens(resolved) {
    return resolved.filter(r => r.effective === 'block').map(r => r.bot.token);
  }
  function explicitlyAllowed(resolved) {
    return resolved.filter(r => r.effective === 'allow').map(r => r.bot);
  }

  function categoryCounts(resolved) {
    const counts = {};
    for (const c of db.CATEGORY_ORDER) counts[c] = { total: 0, blocked: 0, allowed: 0, default: 0 };
    for (const r of resolved) {
      const c = r.bot.category || 'unknown';
      if (!counts[c]) counts[c] = { total: 0, blocked: 0, allowed: 0, default: 0 };
      counts[c].total++;
      counts[c][r.effective === 'none' ? 'default' : r.effective]++;
    }
    return counts;
  }

  return { MODES, presetDefault, resolveActions, blockedTokens, explicitlyAllowed, categoryCounts };
});
