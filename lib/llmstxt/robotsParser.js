'use strict';

/*
 * LLMs.txt Generator — robots.txt parser + fetcher.
 * Parses User-agent groups, Allow/Disallow (with * wildcards and $ end anchor),
 * Crawl-delay and Sitemap declarations. Deterministic; no AI.
 */

const { safeFetch } = require('./safeFetcher');

const TOOL_UA = 'huvanti-llmstxt'; // our declared identity for rule matching

function parseRobots(txt) {
  const groups = [];
  const sitemaps = [];
  let cur = null;
  for (const raw of String(txt || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase().trim();
    const v = m[2].trim();
    if (k === 'sitemap') {
      if (v) sitemaps.push(v);
    } else if (k === 'user-agent') {
      // Consecutive User-agent lines belong to the same group (RFC 9309).
      if (!cur || cur.rules.length > 0 || cur.crawlDelay !== null) {
        cur = { agents: [v.toLowerCase()], rules: [], crawlDelay: null };
        groups.push(cur);
      } else {
        cur.agents.push(v.toLowerCase());
      }
    } else if (cur && (k === 'allow' || k === 'disallow')) {
      cur.rules.push({ type: k, path: v });
    } else if (cur && k === 'crawl-delay') {
      const n = parseFloat(v);
      if (!Number.isNaN(n)) cur.crawlDelay = n;
    }
  }

  function ruleMatches(rulePath, path) {
    if (rulePath === '') return false; // empty disallow = allow all
    let pattern = rulePath;
    let exact = false;
    if (pattern.endsWith('$')) { exact = true; pattern = pattern.slice(0, -1); }
    const re = '^' + pattern.split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    const rx = new RegExp(re);
    if (exact) return rx.test(path);
    return rx.test(path);
  }

  function allowed(url, ua) {
    let u;
    try { u = new URL(url); } catch { return true; }
    const path = u.pathname + u.search;
    const uaLower = String(ua || '*').toLowerCase();
    let matching = groups.filter(g => g.agents.includes('*') || g.agents.some(a => uaLower.includes(a) || a.includes(uaLower)));
    if (!matching.length) matching = groups.filter(g => g.agents.includes('*'));
    if (!matching.length) return true;
    let best = null;
    for (const g of matching) {
      for (const r of g.rules) {
        if (ruleMatches(r.path, path) && (!best || r.path.length > best.path.length)) best = r;
      }
    }
    return !best || best.type === 'allow';
  }

  const crawlDelay = (groups.find(g => g.crawlDelay) || {}).crawlDelay || null;
  return { groups, sitemaps: [...new Set(sitemaps)], allowed, crawlDelay };
}

async function fetchRobots(origin, opts = {}) {
  const url = new URL('/robots.txt', origin).toString();
  try {
    const r = await safeFetch(url, { ...opts, accept: 'text/plain,*/*', maxBytes: 250 * 1024 });
    if (r.status === 200) {
      const parsed = parseRobots(r.body);
      return { url, exists: true, status: r.status, ...parsed, restricted: false };
    }
    return { url, exists: false, status: r.status, groups: [], sitemaps: [], allowed: () => true, crawlDelay: null, restricted: false };
  } catch (e) {
    return { url, exists: false, error: e.message, code: e.code, groups: [], sitemaps: [], allowed: () => true, crawlDelay: null, restricted: false };
  }
}

module.exports = { parseRobots, fetchRobots, TOOL_UA };
