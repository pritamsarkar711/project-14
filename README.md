# huvanti

Imported from the public Gitea project requested by the user:
https://gitea.com/alistairfox.london/toolsite

This workspace contains a local runnable huvanti tools website with the same structure and routes as the source project: PHP-style pages, `/tools/<slug>`, `/category/<key>`, `/all-tools`, informational pages, assets, generated catalogue data, and JavaScript tool engines.

Tools served by the Node server: SEO Audit (`/`), AdSense/Ezoic/Mediavine/Raptive eligibility checkers, and the WordPress Theme Detector (`/wordpress-theme-detector`, under **Other Tools** in the header). The theme detector is a server-side, multi-signal engine in `lib/wptheme/` (SSRF-protected crawl → WordPress detection → theme discovery → style.css analysis → fingerprints → evidence/confidence) with an offline self-test covering the required detection scenarios. If the server has no direct outbound access (e.g. this sandbox), the tool automatically collects the same resources through the visitor's browser and runs the identical analysis at `/api/wptheme-analyze`:

```bash
npm test          # runs lib/wptheme/selftest.js (30 tests) + lib/wptheme/uitest.js (UI pipeline)
```

## Running locally in this Arena workspace

PHP is not installed in this sandbox, so the preview is served by the included Node development server:

```bash
npm run dev
```

Open the Arena live preview. The original PHP-style files and Apache rewrite file are included for parity.
