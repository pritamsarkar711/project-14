'use strict';

/**
 * Content Analyzer
 * - Detects noindex
 * - X-Robots-Tag
 * - Basic content signals
 */

function detectNoindex(html, headers) {
  html = String(html || '');
  headers = headers || {};

  // Meta robots
  const metaRe = /<meta\b[^>]*name\s*=\s*(?:\"robots\"|'robots'|robots)[^>]*>/gi;
  let m;
  let metaNoindex = false;
  let metaContent = '';
  while ((m = metaRe.exec(html))) {
    const tag = m[0];
    const contentMatch = tag.match(/content\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>]+))/i);
    if (contentMatch) {
      const content = (contentMatch[1] || contentMatch[2] || contentMatch[3] || '').toLowerCase();
      metaContent = content;
      if (/noindex/.test(content)) metaNoindex = true;
    }
  }

  // Also check googlebot, etc
  const metaGoogleRe = /<meta\b[^>]*name\s*=\s*(?:\"googlebot\"|'googlebot')[^>]*>/gi;
  while ((m = metaGoogleRe.exec(html))) {
    const tag = m[0];
    const contentMatch = tag.match(/content\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>]+))/i);
    if (contentMatch) {
      const content = (contentMatch[1] || contentMatch[2] || contentMatch[3] || '').toLowerCase();
      if (/noindex/.test(content)) metaNoindex = true;
    }
  }

  // X-Robots-Tag header
  const xRobots = String(headers['x-robots-tag'] || headers['X-Robots-Tag'] || '').toLowerCase();
  const headerNoindex = /noindex/.test(xRobots);

  return {
    noindex: metaNoindex || headerNoindex,
    metaNoindex,
    headerNoindex,
    metaContent,
    xRobotsTag: xRobots || null
  };
}

function detectContentIssues(html) {
  html = String(html || '');
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    wordCount: text.split(/\s+/).filter(Boolean).length,
    isThin: text.length < 200,
    isEmpty: text.length === 0,
    textLength: text.length
  };
}

module.exports = { detectNoindex, detectContentIssues };
