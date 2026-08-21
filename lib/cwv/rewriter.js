/* Core Web Vitals & INP Auditor — HTML/CSS rewriter (UMD: Node + browser).
 *
 * Turns an untrusted page into something the measurement iframe can load
 * same-origin with the auditor:
 *   - resolves every subresource URL against the page's real base URL
 *   - wraps subresource URLs in the auditor proxy (proxy mode) or leaves
 *     them as absolute original URLs (browser-direct fallback mode)
 *   - removes hazards: <base>, CSP meta, meta refresh, SRI/nonce attrs
 *   - injects the measurement script as the first element of <head>
 *
 * The same code runs server-side (Node) and client-side (browser fallback),
 * so both transports produce identical page transformations. */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.CwvRewriter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SKIP_SCHEMES = /^(data:|blob:|about:|javascript:|mailto:|tel:)/i;

  function resolve(raw, base) {
    try { return new URL(raw, base || 'http://cwv.invalid/').href; } catch (e) { return null; }
  }

  function wrap(url, opt) {
    if (!url) return url;
    if (SKIP_SCHEMES.test(url)) return url;
    if (!opt || !opt.sid) return url; // direct mode: keep absolute original URL
    return '/api/cwv-proxy?sid=' + encodeURIComponent(opt.sid) + '&u=' + encodeURIComponent(url);
  }

  function rewriteUrl(raw, base, opt) {
    var u = resolve(raw, base);
    if (!u) return raw;
    if (/^data:|^blob:/i.test(u)) return raw;
    return wrap(u, opt);
  }

  // Rewrite a srcset (comma-separated candidates; URLs may contain commas
  // in rare data: URIs — those are left untouched).
  function rewriteSrcset(raw, base, opt) {
    var out = String(raw || '').split(',').map(function (part) {
      var m = part.trim().match(/^(\S+)(\s+.*)?$/);
      if (!m) return part;
      var u = m[1];
      if (SKIP_SCHEMES.test(u) || u.indexOf('(') >= 0) return part; // data: with commas
      return rewriteUrl(u, base, opt) + (m[2] || '');
    });
    return out.join(', ');
  }

  function attrsOf(tag) {
    var out = {}, m, re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
    while ((m = re.exec(tag))) out[m[1].toLowerCase()] = m[3] != null ? m[3] : (m[4] != null ? m[4] : m[5]);
    return out;
  }

  function buildTag(name, attrs, selfClose) {
    var s = '<' + name;
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null) return;
      if (v === '') s += ' ' + k;
      else if (/["'<>&]/.test(v)) s += ' ' + k + '="' + v.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"';
      else s += ' ' + k + '="' + v + '"';
    });
    return s + (selfClose ? ' />' : '>');
  }

  var URL_ATTRS = ['src', 'href', 'poster', 'data', 'data-src', 'data-href', 'data-bg', 'data-background', 'data-thumb', 'data-image', 'data-url'];
  var SRCSET_ATTRS = ['srcset', 'data-srcset'];
  var STYLE_ATTRS = ['style'];

  // Attrs removed entirely (would break the proxied page or leak control).
  var DROP_ATTRS = ['integrity', 'nonce', 'crossorigin'];

  function rewriteStyleAttr(value, base, opt) {
    return String(value || '').replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']+))\s*\)/gi, function (all, d, s, b) {
      var u = d != null ? d : (s != null ? s : b);
      if (SKIP_SCHEMES.test(u)) return all;
      return 'url("' + rewriteUrl(u, base, opt) + '")';
    });
  }

  function rewriteCssText(css, base, opt) {
    return String(css || '').replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']+))\s*\)/gi, function (all, d, s, b) {
      var u = d != null ? d : (s != null ? s : b);
      if (SKIP_SCHEMES.test(u)) return all;
      return 'url("' + rewriteUrl(u, base, opt) + '")';
    }).replace(/@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^)"'\s;]+))\s*\)?\s*([^;]*);/gi, function (all, d, s, b, rest) {
      var u = d != null ? d : (s != null ? s : b);
      var target = rewriteUrl(u, base, opt);
      if (target == null) return all;
      return '@import url("' + target + '")' + (rest || '') + ';';
    });
  }

  /* ---------- CSS parsing (audit evidence, no rewriting) ---------- */
  function parseCss(css) {
    var out = { imports: [], fontFaces: [], urlRefs: [] };
    var text = String(css || '');
    var im, re = /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^)"'\s;]+))\s*\)?\s*([^;]*);/gi;
    while ((im = re.exec(text))) out.imports.push({ url: im[1] != null ? im[1] : (im[2] != null ? im[2] : im[3]), media: (im[4] || '').trim() });
    var fm, fre = /@font-face\s*\{([^}]*)\}/gi;
    while ((fm = fre.exec(text))) {
      var body = fm[1];
      var fam = (body.match(/font-family\s*:\s*(?:"([^"]+)"|'([^']+)'|([^;,"']+))/i) || []);
      var disp = (body.match(/font-display\s*:\s*([a-z-]+)/i) || [])[1] || null;
      var weight = (body.match(/font-weight\s*:\s*([^;]+)/i) || [])[1] || '400';
      var style = (body.match(/font-style\s*:\s*([^;]+)/i) || [])[1] || 'normal';
      var srcs = [];
      var sr, sre = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)"']+))\s*\)/gi;
      while ((sr = sre.exec(body))) srcs.push(sr[1] != null ? sr[1] : (sr[2] != null ? sr[2] : sr[3]));
      out.fontFaces.push({
        family: (fam[1] != null ? fam[1] : (fam[2] != null ? fam[2] : (fam[3] || ''))).trim(),
        display: disp, weight: weight.trim(), style: style.trim(), srcs: srcs
      });
    }
    var um, ure = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)"']+))\s*\)/gi;
    while ((um = ure.exec(text))) out.urlRefs.push(um[1] != null ? um[1] : (um[2] != null ? um[2] : um[3]));
    return out;
  }

  /* ---------- HTML rewriting ---------- */
  function rewriteHtml(html, opt) {
    opt = opt || {};
    var base = opt.baseUrl || '';
    var stats = { images: 0, scripts: 0, stylesheets: 0, fonts: 0, preloads: 0, preconnects: 0, dnsPrefetches: 0, modulepreloads: 0, iframes: 0, strippedIntegrity: 0, strippedCsp: 0, strippedBase: 0, strippedRefresh: 0 };
    var warnings = [];

    var out = String(html || '');
    // Strip hazards first (whole-element or attribute removal).
    out = out.replace(/<base\b[^>]*>/gi, function () { stats.strippedBase++; return ''; });
    out = out.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy[^>]*>/gi, function () { stats.strippedCsp++; return ''; });
    out = out.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, function () { stats.strippedRefresh++; return ''; });
    out = out.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?set-cookie[^>]*>/gi, '');

    out = out.replace(/<([a-z][a-z0-9-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)\/?>/gi, function (tag, name, attrsRaw) {
      var selfClose = /\/\s*$/.test(tag);
      var attrs = attrsOf(attrsRaw);
      var lower = name.toLowerCase();
      var origAttrs = attrsRaw;

      // Remove dangerous / broken-through-proxy attributes.
      DROP_ATTRS.forEach(function (a) { if (attrs[a] != null) { stats.strippedIntegrity += (a === 'integrity' ? 1 : 0); delete attrs[a]; } });

      function setIfPresent(attr, fn) {
        if (attrs[attr] == null) return;
        attrs[attr] = fn(String(attrs[attr]));
      }

      if (lower === 'link') {
        var rel = String(attrs.rel || '').toLowerCase();
        if (/\bstylesheet\b/.test(rel) || /\balternate\b/.test(rel)) {
          if (attrs.href != null) { attrs.href = rewriteUrl(attrs.href, base, opt); stats.stylesheets++; }
        } else if (/\bpreload\b/.test(rel)) {
          if (attrs.href != null) { attrs.href = rewriteUrl(attrs.href, base, opt); stats.preloads++; }
        } else if (/\bmodulepreload\b/.test(rel)) {
          if (attrs.href != null) { attrs.href = rewriteUrl(attrs.href, base, opt); stats.modulepreloads++; }
        } else if (/\bpreconnect\b/.test(rel) || /\bdns-prefetch\b/.test(rel)) {
          if (/\bpreconnect\b/.test(rel)) stats.preconnects++; else stats.dnsPrefetches++;
          delete attrs.href; // hints to external origins are removed: subresources are proxied
        } else if (/\b(prefetch|prerender|preload)\b/.test(rel) === false && /\b(icon|apple-touch-icon|manifest|mask-icon)\b/.test(rel)) {
          if (attrs.href != null) { attrs.href = rewriteUrl(attrs.href, base, opt); }
        } else if (attrs.href != null && !/\b(canonical|alternate)\b/.test(rel)) {
          attrs.href = rewriteUrl(attrs.href, base, opt);
        }
      } else if (lower === 'script') {
        if (attrs.src != null) { attrs.src = rewriteUrl(attrs.src, base, opt); stats.scripts++; }
      } else if (lower === 'img' || lower === 'image') {
        if (attrs.src != null) { attrs.src = rewriteUrl(attrs.src, base, opt); stats.images++; }
        if (attrs.srcset != null) attrs.srcset = rewriteSrcset(attrs.srcset, base, opt);
        if (attrs['data-src'] != null) attrs['data-src'] = rewriteUrl(attrs['data-src'], base, opt);
        if (attrs['data-srcset'] != null) attrs['data-srcset'] = rewriteSrcset(attrs['data-srcset'], base, opt);
      } else if (lower === 'source') {
        if (attrs.src != null) attrs.src = rewriteUrl(attrs.src, base, opt);
        if (attrs.srcset != null) attrs.srcset = rewriteSrcset(attrs.srcset, base, opt);
      } else if (lower === 'iframe' || lower === 'frame' || lower === 'embed' || lower === 'object') {
        stats.iframes++; // left cross-origin: embedded content is not part of the page under test
      } else if (lower === 'video') {
        if (attrs.poster != null) attrs.poster = rewriteUrl(attrs.poster, base, opt);
        // video/audio src stays original: large media streams are not proxied
      } else if (lower === 'audio' || lower === 'track') {
        // left as-is
      } else if (lower === 'input') {
        if (/^image$/i.test(attrs.type || '')) setIfPresent('src', function (v) { return rewriteUrl(v, base, opt); });
      } else {
        // generic rewrite of well-known URL attributes on other elements
        ['data-bg', 'data-background', 'data-image', 'data-url', 'data-thumb'].forEach(function (a) {
          if (attrs[a] != null && !/^(#|none)/.test(attrs[a])) attrs[a] = rewriteUrl(attrs[a], base, opt);
        });
      }

      STYLE_ATTRS.forEach(function (a) {
        if (attrs[a] != null) attrs[a] = rewriteStyleAttr(attrs[a], base, opt);
      });
      if (attrs.onerror) delete attrs.onerror; // avoid noisy error loops inside the sandbox

      return buildTag(name, attrs, selfClose);
    });

    // Inline <style> blocks: rewrite url()/@import.
    out = out.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, function (all, attrsRaw, body) {
      if (body.indexOf('url(') >= 0 || body.indexOf('@import') >= 0) {
        return '<style' + attrsRaw + '>' + rewriteCssText(body, base, opt) + '</style>';
      }
      return all;
    });

    // Font URLs in inline styles & data attrs already handled; count fonts
    // from CSS url() of font extensions for stats.
    var fontRe = /url\((?:"([^"]+)"|'([^']+)'|([^)"']+))\)/gi;
    var fm2;
    while ((fm2 = fontRe.exec(String(html || '')))) {
      var fu = fm2[1] || fm2[2] || fm2[3];
      if (/\.(woff2?|ttf|otf|eot)([?#]|$)/i.test(fu)) stats.fonts++;
    }

    // Inject the measurement script as the FIRST element of <head>.
    var inject = opt.injectScript || '/assets/js/cwv/measure.js';
    var scriptTag = '<script src="' + inject + '"></script>';
    if (/<head[^>]*>/i.test(out)) {
      out = out.replace(/<head([^>]*)>/i, '<head$1>' + scriptTag);
    } else if (/<html[^>]*>/i.test(out)) {
      out = out.replace(/<html([^>]*)>/i, '<html$1><head>' + scriptTag + '</head>');
    } else {
      out = scriptTag + out;
    }

    // Mobile emulation: ensure a viewport meta exists so the page lays out
    // at the emulated width (recorded in stats).
    if (opt.addViewport && !/<meta\b[^>]*name\s*=\s*["']?viewport/i.test(out)) {
      out = out.replace(/<head([^>]*)>/i, '<head$1><meta name="viewport" content="width=device-width, initial-scale=1">');
      stats.viewportAdded = true;
    }

    return { html: out, stats: stats, warnings: warnings };
  }

  return { rewriteHtml, rewriteCssText, parseCss, rewriteUrl, rewriteSrcset, resolve };
});
