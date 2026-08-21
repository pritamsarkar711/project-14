'use strict';

/*
 * huvanti WordPress Theme Detector — fingerprint database.
 *
 * MAINTENANCE
 * -----------
 * This file is data only. The detection engine never hardcodes theme names;
 * it reads this database. To update it:
 *   1. Add/edit an entry in `themeFingerprints` (themes), `pluginFingerprints`
 *      (page builders & framework plugins) or `platformFingerprints`
 *      (non-WordPress CMS markers).
 *   2. `slug` must match the WordPress theme folder slug (case-insensitive).
 *   3. `latestKnown` is only a heuristic for the "Version status" note. It is a
 *      *local dataset* that can lag behind reality — the UI always says so and
 *      never derives vulnerability claims from it.
 *
 * Marker kinds per theme (each adds evidence weight when matched):
 *   assetPaths   – substrings that appear in asset URLs (path or filename)
 *   bodyClasses  – markers that appear inside HTML class="…" attributes
 *   cssSelectors – markers that appear in stylesheet text (selector prefixes)
 *   jsSignatures – markers that appear in JS asset URLs/filenames
 *   generators   – regex sources matched against <meta name=generator> content
 */

const themeFingerprints = [
  /* ---------- Popular free themes (WordPress.org) ---------- */
  {
    slug: 'astra', name: 'Astra', type: 'theme', source: 'wordpress.org', premium: false,
    themeUri: 'https://wpastra.com/', author: 'Brainstorm Force', authorUri: 'https://wpastra.com/about/',
    assetPaths: ['themes/astra/', 'astra-addon'],
    bodyClasses: ['ast-', 'astra-'],
    cssSelectors: ['.ast-', '#ast-'],
    jsSignatures: ['astra'],
    generators: [],
    weight: 10,
    latestKnown: { version: '4.13', asOf: '2026-06' }
  },
  {
    slug: 'generatepress', name: 'GeneratePress', type: 'theme', source: 'wordpress.org', premium: false,
    themeUri: 'https://generatepress.com/', author: 'Tom Usborne', authorUri: 'https://generatepress.com/',
    assetPaths: ['themes/generatepress/', 'generatepress-premium'],
    bodyClasses: ['generatepress', 'generate-columns'],
    cssSelectors: ['.generatepress', '.generate-columns-container'],
    jsSignatures: ['generatepress', 'menu.min.js'],
    generators: [],
    weight: 10,
    latestKnown: { version: '3.6', asOf: '2026-05' }
  },
  {
    slug: 'kadence', name: 'Kadence', type: 'theme', source: 'wordpress.org', premium: false,
    themeUri: 'https://kadencewp.com/kadence/', author: 'Kadence WP', authorUri: 'https://kadencewp.com/',
    assetPaths: ['themes/kadence/', 'kadence-blocks'],
    bodyClasses: ['kadence-', 'wp-block-kadence'],
    cssSelectors: ['.kt-', '.wp-block-kadence'],
    jsSignatures: ['kadence'],
    generators: [],
    weight: 10,
    latestKnown: { version: '1.4', asOf: '2026-04' }
  },
  {
    slug: 'neve', name: 'Neve', type: 'theme', source: 'wordpress.org', premium: false,
    themeUri: 'https://themeisle.com/themes/neve/', author: 'Themeisle', authorUri: 'https://themeisle.com/',
    assetPaths: ['themes/neve/'],
    bodyClasses: ['neve-', 'nv-'],
    cssSelectors: ['.nv-', '.neve-'],
    jsSignatures: ['neve'],
    generators: [],
    weight: 10,
    latestKnown: { version: '3.9', asOf: '2026-03' }
  },
  {
    slug: 'oceanwp', name: 'OceanWP', type: 'theme', source: 'wordpress.org', premium: false,
    themeUri: 'https://oceanwp.org/', author: 'OceanWP', authorUri: 'https://oceanwp.org/about-me/',
    assetPaths: ['themes/oceanwp/', 'ocean-extra'],
    bodyClasses: ['oceanwp-theme-', 'owp-'],
    cssSelectors: ['#owp-', '.oceanwp-'],
    jsSignatures: ['oceanwp'],
    generators: [],
    weight: 10,
    latestKnown: { version: '3.6', asOf: '2025-12' }
  },
  {
    slug: 'hello-elementor', name: 'Hello Elementor', type: 'theme', source: 'wordpress.org', premium: false,
    themeUri: 'https://elementor.com/', author: 'Elementor Team', authorUri: 'https://elementor.com/',
    assetPaths: ['themes/hello-elementor/'],
    bodyClasses: ['hello-elementor'],
    cssSelectors: ['.hello-elementor'],
    jsSignatures: ['hello-elementor'],
    generators: [],
    weight: 10,
    latestKnown: { version: '3.4', asOf: '2026-05' }
  },
  {
    slug: 'blocksy', name: 'Blocksy', type: 'theme', source: 'wordpress.org', premium: false,
    themeUri: 'https://creativethemes.com/blocksy/', author: 'CreativeThemes', authorUri: 'https://creativethemes.com/',
    assetPaths: ['themes/blocksy/'],
    bodyClasses: ['ct-'],
    cssSelectors: ['.ct-container', '.ct-header'],
    jsSignatures: ['blocksy'],
    generators: [],
    weight: 9
  },
  {
    slug: 'storefront', name: 'Storefront', type: 'theme', source: 'wordpress.org', premium: false,
    themeUri: 'https://woocommerce.com/storefront/', author: 'Automattic', authorUri: 'https://woocommerce.com/',
    assetPaths: ['themes/storefront/'],
    bodyClasses: ['storefront-', 'woocommerce-active'],
    cssSelectors: ['.storefront-', 'storefront-woocommerce-style'],
    jsSignatures: ['storefront'],
    generators: [],
    weight: 9
  },
  {
    slug: 'sydney', name: 'Sydney', type: 'theme', source: 'wordpress.org', premium: false,
    themeUri: 'https://athemes.com/theme/sydney/', author: 'aThemes', authorUri: 'https://athemes.com/',
    assetPaths: ['themes/sydney/'],
    bodyClasses: ['sydney-', 'sydney '],
    cssSelectors: ['.sydney-'],
    jsSignatures: ['sydney'],
    generators: [],
    weight: 8
  },
  {
    slug: 'zakra', name: 'Zakra', type: 'theme', source: 'wordpress.org', premium: false,
    themeUri: 'https://themegrill.com/themes/zakra/', author: 'ThemeGrill', authorUri: 'https://themegrill.com/',
    assetPaths: ['themes/zakra/'],
    bodyClasses: ['zakra-', 'tg-site'],
    cssSelectors: ['.tg-site', '.zakra-'],
    jsSignatures: ['zakra'],
    generators: [],
    weight: 8
  },
  {
    slug: 'hestia', name: 'Hestia', type: 'theme', source: 'wordpress.org', premium: false,
    themeUri: 'https://themeisle.com/themes/hestia/', author: 'Themeisle', authorUri: 'https://themeisle.com/',
    assetPaths: ['themes/hestia/'],
    bodyClasses: ['hestia-'],
    cssSelectors: ['.hestia-'],
    jsSignatures: ['hestia'],
    generators: [],
    weight: 8
  },
  /* Bundled default themes */
  themeDefault('twentytwentyfive', 'Twenty Twenty-Five', '2025-01', '1.3'),
  themeDefault('twentytwentyfour', 'Twenty Twenty-Four', '2023-11', '1.3'),
  themeDefault('twentytwentythree', 'Twenty Twenty-Three', '2022-11', '1.4'),
  themeDefault('twentytwentytwo', 'Twenty Twenty-Two', '2021-10', '1.8'),
  themeDefault('twentytwentyone', 'Twenty Twenty-One', '2020-12', '2.4'),
  themeDefault('twentytwenty', 'Twenty Twenty', '2019-11', '3.2'),
  themeDefault('twentynineteen', 'Twenty Nineteen', '2018-11', '2.9'),

  /* ---------- Popular premium / commercial themes ---------- */
  {
    slug: 'divi', name: 'Divi', type: 'theme', source: 'developer', premium: true,
    themeUri: 'https://www.elegantthemes.com/gallery/divi/', author: 'Elegant Themes', authorUri: 'https://www.elegantthemes.com/',
    vendor: 'Elegant Themes (developer)',
    assetPaths: ['themes/Divi/', 'et-core', 'divi-builder'],
    bodyClasses: ['et_pb_', 'et-db', 'et_divi_theme'],
    cssSelectors: ['.et_pb_', '.et-db'],
    jsSignatures: ['divi', 'et-builder'],
    generators: ['Divi|Divi Child'],
    weight: 11,
    latestKnown: { version: '4.34', asOf: '2026-06' }
  },
  {
    slug: 'avada', name: 'Avada', type: 'theme', source: 'marketplace', premium: true,
    themeUri: 'https://avada.com/', author: 'ThemeFusion', authorUri: 'https://theme-fusion.com/',
    vendor: 'ThemeForest / ThemeFusion',
    assetPaths: ['themes/Avada/', 'fusion-builder', 'avada-'],
    bodyClasses: ['fusion-', 'avada-'],
    cssSelectors: ['.fusion-', '.awb-'],
    jsSignatures: ['avada', 'fusion'],
    generators: ['Avada'],
    weight: 11,
    latestKnown: { version: '7.13', asOf: '2026-05' }
  },
  {
    slug: 'flatsome', name: 'Flatsome', type: 'theme', source: 'marketplace', premium: true,
    themeUri: 'https://flatsome.uxthemes.com/', author: 'UX-Themes', authorUri: 'https://uxthemes.com/',
    vendor: 'ThemeForest / UX-Themes',
    assetPaths: ['themes/flatsome/'],
    bodyClasses: ['ux-'],
    cssSelectors: ['.ux-', '.flatsome'],
    jsSignatures: ['flatsome'],
    generators: ['Flatsome'],
    weight: 10,
    latestKnown: { version: '3.20', asOf: '2026-04' }
  },
  {
    slug: 'woodmart', name: 'WoodMart', type: 'theme', source: 'marketplace', premium: true,
    themeUri: 'https://woodmart.xtemos.com/', author: 'XTemos', authorUri: 'https://xtemos.com/',
    vendor: 'ThemeForest / XTemos',
    assetPaths: ['themes/woodmart/'],
    bodyClasses: ['woodmart-', 'wd-'],
    cssSelectors: ['.woodmart-', '.wd-'],
    jsSignatures: ['woodmart'],
    generators: ['WoodMart'],
    weight: 10,
    latestKnown: { version: '7.6', asOf: '2026-03' }
  },
  {
    slug: 'salient', name: 'Salient', type: 'theme', source: 'marketplace', premium: true,
    themeUri: 'https://themenectar.com/salient/', author: 'ThemeNectar', authorUri: 'https://themenectar.com/',
    vendor: 'ThemeForest / ThemeNectar',
    assetPaths: ['themes/salient/', 'nectar-'],
    bodyClasses: ['nectar-'],
    cssSelectors: ['.nectar-'],
    jsSignatures: ['salient', 'nectar'],
    generators: ['Salient'],
    weight: 10
  },
  {
    slug: 'newspaper', name: 'Newspaper', type: 'theme', source: 'marketplace', premium: true,
    themeUri: 'https://tagdiv.com/newspaper/', author: 'tagDiv', authorUri: 'https://tagdiv.com/',
    vendor: 'ThemeForest / tagDiv',
    assetPaths: ['themes/newspaper/'],
    bodyClasses: ['td-', 'tagdiv-theme'],
    cssSelectors: ['.td-'],
    jsSignatures: ['tdb_', 'tagdiv'],
    generators: ['Newspaper'],
    weight: 10,
    latestKnown: { version: '13.2', asOf: '2026-02' }
  },
  {
    slug: 'newsmag', name: 'NewsMag', type: 'theme', source: 'marketplace', premium: true,
    themeUri: 'https://tagdiv.com/newsmag/', author: 'tagDiv', authorUri: 'https://tagdiv.com/',
    vendor: 'ThemeForest / tagDiv',
    assetPaths: ['themes/newsmag/'],
    bodyClasses: ['td-', 'tagdiv-theme'],
    cssSelectors: ['.td-'],
    jsSignatures: ['tdb_', 'tagdiv'],
    generators: ['NewsMag'],
    weight: 9
  },
  {
    slug: 'soledad', name: 'Soledad', type: 'theme', source: 'marketplace', premium: true,
    themeUri: 'https://soledad.pencidesign.net/', author: 'PenciDesign', authorUri: 'https://pencidesign.com/',
    vendor: 'ThemeForest / PenciDesign',
    assetPaths: ['themes/soledad/'],
    bodyClasses: ['penci-'],
    cssSelectors: ['.penci-'],
    jsSignatures: ['soledad', 'penci'],
    generators: ['Soledad'],
    weight: 10
  },
  {
    slug: 'bimber', name: 'Bimber', type: 'theme', source: 'marketplace', premium: true,
    themeUri: 'https://bringthepixel.com/bimber/', author: 'bringthepixel', authorUri: 'https://bringthepixel.com/',
    vendor: 'ThemeForest / bringthepixel',
    assetPaths: ['themes/bimber/'],
    bodyClasses: ['g1-', 'bimber-'],
    cssSelectors: ['.g1-', '.bimber-'],
    jsSignatures: ['bimber'],
    generators: ['Bimber'],
    weight: 9
  },
  {
    slug: 'betheme', name: 'Betheme', type: 'theme', source: 'marketplace', premium: true,
    themeUri: 'https://muffingroup.com/betheme/', author: 'Muffin Group', authorUri: 'https://muffingroup.com/',
    vendor: 'ThemeForest / Muffin Group',
    assetPaths: ['themes/betheme/'],
    bodyClasses: ['mfn-'],
    cssSelectors: ['.mfn-'],
    jsSignatures: ['betheme', 'mfn'],
    generators: ['Betheme'],
    weight: 9
  },
  {
    slug: 'enfold', name: 'Enfold', type: 'theme', source: 'marketplace', premium: true,
    themeUri: 'https://kriesi.at/themes/enfold/', author: 'Kriesi', authorUri: 'https://kriesi.at/',
    vendor: 'ThemeForest / Kriesi',
    assetPaths: ['themes/enfold/'],
    bodyClasses: ['avia-'],
    cssSelectors: ['.avia-'],
    jsSignatures: ['enfold', 'avia'],
    generators: ['Enfold'],
    weight: 9
  },
  {
    slug: 'jupiterx', name: 'Jupiter X', type: 'theme', source: 'marketplace', premium: true,
    themeUri: 'https://jupiterx.com/', author: 'Artbees', authorUri: 'https://artbees.net/',
    vendor: 'ThemeForest / Artbees',
    assetPaths: ['themes/jupiterx/', 'jupiterx-core'],
    bodyClasses: ['jupiterx-'],
    cssSelectors: ['.jupiterx-'],
    jsSignatures: ['jupiterx'],
    generators: ['Jupiter X'],
    weight: 9
  },
  {
    slug: 'the7', name: 'The7', type: 'theme', source: 'marketplace', premium: true,
    themeUri: 'https://the7.io/', author: 'Dream-Theme', authorUri: 'https://dream-theme.com/',
    vendor: 'ThemeForest / Dream-Theme',
    assetPaths: ['themes/the7/', 'dt-the7'],
    bodyClasses: ['the7-'],
    cssSelectors: ['.the7-'],
    jsSignatures: ['the7', 'dt-'],
    generators: ['The7'],
    weight: 8
  },

  /* ---------- Starter / framework parents ---------- */
  {
    slug: 'genesis', name: 'Genesis', type: 'framework', source: 'developer', premium: true,
    themeUri: 'https://www.studiopress.com/', author: 'StudioPress', authorUri: 'https://www.studiopress.com/',
    vendor: 'StudioPress / WP Engine (framework)',
    assetPaths: ['themes/genesis/', 'genesis-blocks'],
    bodyClasses: ['genesis-'],
    cssSelectors: ['.genesis-'],
    jsSignatures: ['genesis'],
    generators: ['Genesis'],
    weight: 9
  },
  {
    slug: 'understrap', name: 'UnderStrap', type: 'framework', source: 'github', premium: false,
    themeUri: 'https://understrap.com/', author: 'Holger Kraus', authorUri: 'https://github.com/holger1411',
    assetPaths: ['themes/understrap/'],
    bodyClasses: ['understrap-'],
    cssSelectors: ['.understrap-'],
    jsSignatures: ['understrap'],
    generators: [],
    weight: 7
  },
  {
    slug: 'underscores', name: 'Underscores (_s)', type: 'framework', source: 'github', premium: false,
    themeUri: 'https://underscores.me/', author: 'Automattic', authorUri: 'https://automattic.com/',
    assetPaths: ['themes/underscores/'],
    bodyClasses: [],
    cssSelectors: [],
    jsSignatures: [],
    generators: [],
    weight: 5
  },
  {
    slug: 'sage', name: 'Sage (Roots)', type: 'framework', source: 'github', premium: false,
    themeUri: 'https://roots.io/sage/', author: 'Roots', authorUri: 'https://roots.io/',
    assetPaths: ['themes/sage/'],
    bodyClasses: [],
    cssSelectors: [],
    jsSignatures: ['sage/'],
    generators: [],
    weight: 6
  },
  {
    slug: 'storefront-children', name: 'Storefront child theme', type: 'framework', source: 'wordpress.org', premium: false,
    hidden: true, assetPaths: [], bodyClasses: [], cssSelectors: [], jsSignatures: [], generators: [], weight: 0
  }
];

function themeDefault(slug, name, released, version) {
  return {
    slug, name, type: 'theme', source: 'wordpress.org', premium: false, bundled: true,
    themeUri: 'https://wordpress.org/themes/' + slug + '/',
    author: 'the WordPress team', authorUri: 'https://wordpress.org/',
    assetPaths: ['themes/' + slug + '/'],
    bodyClasses: [slug.replace(/-/g, '') + '-'],
    cssSelectors: ['.wp-block-' + slug.replace('twenty', 'twenty-')],
    jsSignatures: [slug],
    generators: [],
    weight: 8,
    latestKnown: { version, asOf: released.slice(0, 7) }
  };
}

/*
 * Page-builder / notable plugin fingerprints. These never identify a theme by
 * themselves; they support the WordPress decision and add context.
 */
const pluginFingerprints = [
  { slug: 'elementor', name: 'Elementor Page Builder', assetPaths: ['plugins/elementor/', 'elementor-pro'], bodyClasses: ['elementor-page', 'elementor-default'], jsSignatures: ['elementor'], weight: 8 },
  { slug: 'divi-builder', name: 'Divi Builder', assetPaths: ['divi-builder'], bodyClasses: ['et_pb_'], jsSignatures: ['et-builder'], weight: 7 },
  { slug: 'beaver-builder', name: 'Beaver Builder', assetPaths: ['plugins/bb-plugin/', 'fl-builder'], bodyClasses: ['fl-builder'], jsSignatures: ['fl-builder'], weight: 8 },
  { slug: 'wpbakery', name: 'WPBakery Page Builder', assetPaths: ['js_composer'], bodyClasses: ['vc_'], jsSignatures: ['js_composer', 'wpb_'], weight: 7 },
  { slug: 'gutenberg', name: 'Block Editor (Gutenberg)', assetPaths: [], bodyClasses: ['wp-block-'], jsSignatures: ['wp-block'], weight: 4 },
  { slug: 'bricks', name: 'Bricks Builder', assetPaths: ['plugins/bricks/'], bodyClasses: ['bricks-'], jsSignatures: ['bricks'], weight: 7 },
  { slug: 'woocommerce', name: 'WooCommerce', assetPaths: ['plugins/woocommerce/'], bodyClasses: ['woocommerce'], jsSignatures: ['woocommerce'], weight: 8 },
  { slug: 'yoast', name: 'Yoast SEO', assetPaths: ['plugins/wordpress-seo/'], bodyClasses: [], jsSignatures: ['yoast'], weight: 5 },
  { slug: 'rank-math', name: 'Rank Math SEO', assetPaths: ['plugins/seo-by-rank-math/'], bodyClasses: [], jsSignatures: ['rank-math'], weight: 5 },
  { slug: 'wp-rocket', name: 'WP Rocket', assetPaths: ['plugins/wp-rocket/'], bodyClasses: [], jsSignatures: ['wp-rocket'], weight: 5 },
  { slug: 'jetpack', name: 'Jetpack', assetPaths: ['plugins/jetpack/'], bodyClasses: ['jetpack'], jsSignatures: ['jetpack'], weight: 6 }
];

/*
 * Non-WordPress platform fingerprints. Used only to suggest a possible other
 * platform when WordPress is not detected — never a full CMS detector.
 */
const platformFingerprints = [
  { key: 'shopify', name: 'Shopify', weight: 25, markers: ['cdn.shopify.com', 'shopify.theme', 'shopify-features', '/cdn/shop/t/', 'Shopify.theme'] },
  { key: 'wix', name: 'Wix', weight: 25, markers: ['static.wixstatic.com', 'wix.com', '_wixCssModules', 'X-Wix'] },
  { key: 'squarespace', name: 'Squarespace', weight: 25, markers: ['squarespace.com', 'static1.squarespace.com', 'Static.Squarespace'] },
  { key: 'webflow', name: 'Webflow', weight: 25, markers: ['assets.website-files.com', 'webflow.js', 'data-wf-page', 'data-wf-site'] },
  { key: 'drupal', name: 'Drupal', weight: 22, markers: ['drupal.org', '/sites/default/files/', '/core/assets/', 'Drupal'] },
  { key: 'joomla', name: 'Joomla', weight: 22, markers: ['/media/jui/', '/components/com_', '/modules/mod_', 'Joomla!'] },
  { key: 'ghost', name: 'Ghost', weight: 22, markers: ['ghost-sdk', 'ghost.org', '/content/images/size/'] },
  { key: 'blogger', name: 'Blogger', weight: 24, markers: ['www.blogger.com/static', 'blogger.com', 'blogger-stylesheet'] },
  { key: 'bigcommerce', name: 'BigCommerce', weight: 22, markers: ['bigcommerce.com', 'stencil-utils', 'cdn11.bigcommerce.com'] },
  { key: 'magento', name: 'Magento (Adobe Commerce)', weight: 22, markers: ['Magento', 'mage/', 'static/version', 'magepack'] },
  { key: 'prestashop', name: 'PrestaShop', weight: 22, markers: ['prestashop', '/modules/', 'ps_shoppingcart'] },
  { key: 'simplé-site-builder', name: 'SITE123 / Weebly / GoDaddy Builder', weight: 14, markers: ['site123.me', 'weebly.com', 'godaddywebsitemaker', 'img1.wsimg.com'] },
  { key: 'nextjs', name: 'Next.js (custom web app)', weight: 14, markers: ['/_next/static'] },
  { key: 'nuxt', name: 'Nuxt (custom web app)', weight: 14, markers: ['/_nuxt/', '__NUXT__'] },
  { key: 'gatsby', name: 'Gatsby (custom web app)', weight: 14, markers: ['/gatsby-', '___gatsby'] },
  { key: 'astro', name: 'Astro (custom web app)', weight: 14, markers: ['astro-island', '/_astro/'] }
];

/* Vendor → human label used for "Theme source" detection. */
const SOURCE_DOMAINS = [
  [/(^|\.)wordpress\.org$/i, 'WordPress.org repository'],
  [/themeforest\.net|envato\.com|elements\.envato\.com/i, 'ThemeForest (Envato marketplace)'],
  [/mojo-marketplace\.com|mojomarketplace\.com/i, 'MOJO Marketplace'],
  [/templatemonster\.com/i, 'TemplateMonster'],
  [/creativemarket\.com/i, 'Creative Market'],
  [/elegantthemes\.com/i, 'Theme developer (Elegant Themes)'],
  [/avada\.com|theme-fusion\.com/i, 'Theme developer (ThemeFusion)'],
  [/wpastra\.com|brainstormforce\.com/i, 'Theme developer (Brainstorm Force)'],
  [/generatepress\.(com|net)/i, 'Theme developer (GeneratePress)'],
  [/kadencewp\.com/i, 'Theme developer (Kadence WP)'],
  [/elementor\.com/i, 'Theme developer (Elementor)'],
  [/oceanwp\.org/i, 'Theme developer (OceanWP)'],
  [/themeisle\.com|codetag\.co/i, 'Theme developer (Themeisle)'],
  [/woocommerce\.com/i, 'Theme developer (WooCommerce)'],
  [/tagdiv\.com/i, 'Theme developer (tagDiv)'],
  [/xtemos\.(com|net)/i, 'Theme developer (XTemos)'],
  [/uxthemes\.com/i, 'Theme developer (UX-Themes)'],
  [/themenectar\.com/i, 'Theme developer (ThemeNectar)'],
  [/pencidesign\.(com|net)/i, 'Theme developer (PenciDesign)'],
  [/studiopress\.com|wpengine\.com/i, 'Theme developer (StudioPress)'],
  [/kriesi\.at/i, 'Theme developer (Kriesi)'],
  [/muffingroup\.com/i, 'Theme developer (Muffin Group)'],
  [/roots\.io/i, 'Theme framework (Roots)'],
  [/github\.(com|io)/i, 'Open-source project (GitHub)']
];

/* Slugs that ship with WordPress core / are bundled default themes. */
const BUNDLED_SLUGS = new Set([
  'twentytwentyfive', 'twentytwentyfour', 'twentytwentythree', 'twentytwentytwo',
  'twentytwentyone', 'twentytwenty', 'twentynineteen', 'twentyeighteen',
  'twentyseventeen', 'twentysixteen', 'twentyfifteen', 'twentyfourteen',
  'twentythirteen', 'twentytwelve', 'twentyeleven', 'twentyten'
]);

function findBySlug(slug) {
  const s = String(slug || '').toLowerCase();
  return themeFingerprints.find(f => !f.hidden && f.slug.toLowerCase() === s) || null;
}

function sourceFromUri(uri) {
  if (!uri) return null;
  const host = (() => { try { return new URL(uri).hostname; } catch (e) { return ''; } })();
  if (!host) return null;
  for (const [re, label] of SOURCE_DOMAINS) if (re.test(host)) return label;
  return null;
}

module.exports = {
  themeFingerprints,
  pluginFingerprints,
  platformFingerprints,
  BUNDLED_SLUGS,
  findBySlug,
  sourceFromUri
};
