# Huvanti

Free, no account website tools served by a single Node server. Every tool runs
from the visitor's browser against public pages, and every score shows the
evidence behind it.

## Tools

| Tool | Path |
| --- | --- |
| SEO Audit | `/` |
| AdSense Eligibility Checker | `/adsense-eligibility-checker` |
| Ezoic Eligibility Checker | `/ezoic-eligibility-checker` |
| Mediavine Eligibility Checker | `/mediavine-eligibility-checker` |
| Raptive Eligibility Checker | `/raptive-eligibility-checker` |
| WordPress Theme Detector | `/wordpress-theme-detector` |
| Domain Information Checker | `/domain-information-checker` |
| XML Sitemap Generator | `/xml-sitemap-generator` |
| Broken Link Checker | `/broken-link-checker` |
| LLMs.txt Generator | `/llms-txt-generator` |
| AI Crawler & LLM Bot Blocker | `/ai-crawler-blocker` |
| Core Web Vitals & INP Auditor | `/core-web-vitals-auditor` |
| RSS Feed Generator | `/rss-feed-generator` |

Informational pages: `/about`, `/contact`, `/privacy`, `/terms`. The site also
serves its own `/robots.txt` and `/sitemap.xml`.

## Running locally

```bash
npm run dev        # node server.js, listens on :3000
npm test           # offline self tests and UI tests for the engine libraries
```

## Structure

- `server.js` — pages, content, layout, compression, caching and the API routes.
- `assets/css/style.css` — the single stylesheet (inlined into every page).
- `assets/js/progress.js` — the shared real time scan progress panel used by every tool.
- `assets/js/common.js` — theme toggle, menus, small shared helpers.
- `assets/js/<tool>/` — browser UI and browser fallback crawlers per tool.
- `lib/<tool>/` — deterministic server engines (crawlers, analysers, scorers) plus
  `selftest.js` / `uitest.js` suites, and UMD modules shared with the browser.

## Engine notes

- Crawling is SSRF guarded, robots.txt aware, rate limited and byte budgeted.
- Tools whose server cannot reach a site fall back to fetching through the
  visitor's browser via public read only relays, then run the identical analysis
  server side.
- Honesty rules apply everywhere: unavailable values are labelled unavailable,
  lab data is never presented as field data, and no score is presented as an
  official platform result.
- The shared crawl layer races public relays in parallel and crawls pages with a
  small worker pool, so audits finish quickly without hammering target sites.
