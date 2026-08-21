'use strict';

/**
 * robots.txt Parser
 * - Fetches /robots.txt
 * - Parses User-agent, Allow, Disallow, Sitemap, Crawl-delay
 * - Respects applicable rules
 */

const { safeFetch } = require('./safeFetcher');

function parseRobots(txt) {
  const groups = [];
  const sitemaps = [];
  let cur = null;
  const lines = String(txt || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase().trim();
    const v = m[2].trim();
    if (k === 'sitemap') {
      sitemaps.push(v);
    } else if (k === 'user-agent') {
      // Each user-agent starts a new group, but consecutive user-agents belong to same group per spec
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

  function allowed(url, ua = '*') {
    let u;
    try { u = new URL(url); } catch { return true; } // if invalid, allow
    const path = u.pathname + u.search;
    const uaLower = String(ua).toLowerCase();
    // Find groups matching ua or *
    const matching = groups.filter(g => g.agents.includes('*') || g.agents.some(a => uaLower.includes(a) || a.includes(uaLower)));
    const candidates = matching.length ? matching : groups.filter(g => g.agents.includes('*'));
    if (!candidates.length) return true; // no rules
    let best = null;
    for (const g of candidates) {
      for (const r of g.rules) {
        if (r.path === '') continue; // empty disallow means allow all
        // Convert robots pattern to regex: * => .*, $ => end
        let pattern = r.path;
        let isExact = false;
        if (pattern.endsWith('$')) {
          isExact = true;
          pattern = pattern.slice(0, -1);
        }
        // Escape regex except * and handle
        const escaped = pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
        const re = new RegExp('^' + escaped + (isExact ? '$' : ''));
        if (re.test(path)) {
          if (!best || r.path.length > best.path.length) best = r;
        }
      }
    }
    if (!best) return true;
    return best.type === 'allow';
  }

  const crawlDelay = (groups.find(g => g.crawlDelay != null) || {}).crawlDelay || null;

  return {
    groups,
    sitemaps: [...new Set(sitemaps)],
    allowed,
    crawlDelay,
    raw: txt
  };
}

async function fetchRobots(origin, opts = {}) {
  const url = new URL('/robots.txt', origin).toString();
  try {
    const r = await safeFetch(url, { ...opts, accept: 'text/plain,*/*', maxBytes: 250 * 1024, method: 'GET' });
    if (r.status === 200) {
      const parsed = parseRobots(r.body);
      return { url, exists: true, status: r.status, ...parsed };
    }
    return { url, exists: false, groups: [], sitemaps: [], allowed: () => true, crawlDelay: null, status: r.status, raw: '' };
  } catch (e) {
    return { url, exists: false, error: e.message, code: e.code, groups: [], sitemaps: [], allowed: () => true, crawlDelay: null, raw: '' };
  }
}

module.exports = { parseRobots, fetchRobots };
