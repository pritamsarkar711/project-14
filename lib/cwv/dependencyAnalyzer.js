'use strict';

/*
 * Core Web Vitals & INP Auditor, network dependency tree.
 *
 * Reconstructs the dependency chains from measured evidence:
 *   HTML → stylesheets / scripts / images / fonts (parsed from the page)
 *   CSS  → @import stylesheets, fonts and images (parsed from CSS text
 *          when the transport exposed it)
 *   JS   → runtime requests attributed to scripts (Resource Timing
 *          initiator "script"/"fetch"/"xmlhttprequest")
 *
 * Dynamic loads built from JS string concatenation are not traced, that
 * limitation is stated rather than hidden.
 */

const FONT_EXT = /\.(woff2?|ttf|otf|eot)([?#]|$)/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)([?#]|$)/i;

function buildDependencyTree(meta, cssFiles, jsFiles, resources, linkHints) {
  const root = {
    url: meta && meta.finalUrl || meta && meta.requestedUrl || '(document)',
    label: 'HTML',
    children: [],
    kind: 'document'
  };

  const css = Array.isArray(cssFiles) ? cssFiles : [];
  const js = Array.isArray(jsFiles) ? jsFiles : [];
  const res = Array.isArray(resources) ? resources : [];

  css.forEach(c => {
    const node = { url: c.url || c.name || '(stylesheet)', label: 'CSS', kind: 'stylesheet', children: [] };
    (c.imports || []).forEach(im => {
      node.children.push({ url: im.url, label: 'CSS @import', kind: 'stylesheet', children: [] });
    });
    const fontRefs = (c.fontFaces || []).reduce((acc, f) => acc.concat(f.srcs || []), []).filter(u => FONT_EXT.test(u));
    fontRefs.slice(0, 12).forEach(u => node.children.push({ url: u, label: 'Font', kind: 'font', children: [] }));
    const imgRefs = (c.urlRefs || []).filter(u => IMAGE_EXT.test(u));
    imgRefs.slice(0, 12).forEach(u => node.children.push({ url: u, label: 'Image', kind: 'image', children: [] }));
    root.children.push(node);
  });

  js.forEach(j => {
    const node = { url: j.url || j.name || '(script)', label: 'JS', kind: 'script', children: [] };
    const runtime = res.filter(r => /^(script|fetch|xmlhttprequest|beacon)$/i.test(String(r.initiatorType || '')));
    if (runtime.length) {
      const count = runtime.length;
      const sample = runtime.slice(0, 6).map(r => ({ url: r.name, label: r.initiatorType === 'fetch' || r.initiatorType === 'xmlhttprequest' ? 'API (XHR/Fetch)' : 'Runtime request', kind: 'fetch', children: [] }));
      node.children.push({
        url: null,
        label: count + ' runtime request(s) made by scripts',
        kind: 'runtime',
        note: 'Attributed by Resource Timing initiator type (script/fetch). The specific initiating script is not always identifiable.',
        children: sample
      });
    }
    root.children.push(node);
  });

  // Top-level images/fonts not referenced by parsed CSS.
  const cssUrls = new Set(css.reduce((acc, c) => acc.concat(c.urlRefs || []).concat((c.fontFaces || []).reduce((a, f) => a.concat(f.srcs || []), [])), []));
  const topImages = [];
  res.forEach(r => {
    const name = r.name || '';
    if (IMAGE_EXT.test(name) && !cssUrls.has(name)) topImages.push(name);
    else if (FONT_EXT.test(name) && !cssUrls.has(name)) root.children.push({ url: name, label: 'Font', kind: 'font', children: [] });
  });
  if (topImages.length) {
    root.children.push({
      url: null,
      label: topImages.length + ' image(s) referenced from HTML',
      kind: 'image',
      note: 'From HTML (or JS-inserted <img> tags).',
      children: topImages.slice(0, 8).map(u => ({ url: u, label: 'Image', kind: 'image', children: [] }))
    });
  }

  // Longest chains.
  function depth(n, path) {
    if (!n.children || !n.children.length) return { depth: 1, path: path.concat([n.url || n.label]) };
    let best = { depth: 0, path: [] };
    n.children.forEach(c => {
      const d = depth(c, path.concat([n.url || n.label]));
      if (d.depth > best.depth) best = d;
    });
    return { depth: best.depth + 1, path: best.path };
  }
  const longest = depth(root, []);

  return {
    root,
    longestChain: { length: longest.depth, path: longest.path },
    limitation: 'Static dependency reconstruction from parsed HTML/CSS plus runtime initiator types. Requests built dynamically via string concatenation inside scripts are attributed to "runtime requests" without a precise script URL.',
    hints: {
      preload: linkHints && linkHints.preload || [],
      preconnect: linkHints && linkHints.preconnect || [],
      dnsPrefetch: linkHints && linkHints.dnsPrefetch || [],
      modulepreload: linkHints && linkHints.modulepreload || []
    }
  };
}

module.exports = { buildDependencyTree };
