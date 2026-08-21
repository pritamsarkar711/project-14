# huvanti

Imported from the public Gitea project requested by the user:
https://gitea.com/alistairfox.london/toolsite

This workspace contains a local runnable huvanti tools website with the same structure and routes as the source project: PHP-style pages, `/tools/<slug>`, `/category/<key>`, `/all-tools`, informational pages, assets, generated catalogue data, and JavaScript tool engines.

Tools served by the Node server: SEO Audit (`/`), AdSense/Ezoic/Mediavine/Raptive eligibility checkers, the WordPress Theme Detector (`/wordpress-theme-detector`), the Domain Information Checker (`/domain-information-checker`), the XML Sitemap Generator, the LLMs.txt Generator (`/llms-txt-generator`), and the AI Crawler & LLM Bot Blocker (`/ai-crawler-blocker`) — all under **Other Tools** in the header.

## LLMs.txt Generator

`/llms-txt-generator` — a deterministic, spec-compliant `llms.txt` generator and validator. Enter a public URL and it runs the full pipeline: SSRF-safe URL validation → robots.txt parsing → sitemap discovery (recursive indexes) → bounded concurrent crawl → metadata extraction (title, meta/OG description, H1/H2, canonical, noindex, dates, breadcrumbs, word count, JSON-LD types) → canonical/noindex/duplicate/tracking-parameter handling → deterministic page classification → internal relevance scoring → deterministic description generation (no LLM) → llms.txt generation → validation → internal quality score → coverage report → editable page table → download. No account, no AI, no LLM API, no paid SEO API.

The engine is modular in `lib/llmstxt/` (urlValidator, safeFetcher, robotsParser, sitemapDiscovery, crawler, urlNormalizer, duplicateAnalyzer, pageParser, canonicalAnalyzer, indexabilityAnalyzer, pageClassifier, importanceScorer, descriptionGenerator, suitabilityFilter, llmsTxtGenerator, llmsTxtValidator, qualityScorer, reportEngine, api). The generated file follows the current llmstxt.org structure — a required H1, an optional blockquote summary, then H2 "file list" sections of `- [name](url): notes`, with `## Optional` for secondary resources. No unsupported fields are emitted. The quality score is the tool's own internal assessment — never a Google or official OpenAI score, and never a visibility/ranking guarantee.

When the server has no direct outbound access (e.g. this sandbox), the tool falls back to a visitor-browser crawl (`/assets/js/llmstxt/browser.js`) that fetches pages through public read-only relays and POSTs the collected data to `/api/llmstxt-browser`, which runs the identical server-side analysis.

## AI Crawler & LLM Bot Blocker

`/ai-crawler-blocker` — under **Other Tools**. A deterministic AI-crawler management and configuration system: no account, no AI, no LLM API, no paid SEO API. Everything except the two explicitly-triggered fetches runs locally in the visitor's browser.

- **Bot database** (`lib/botblocker/botDatabase.js`, versioned, easy to update): ~30 known AI crawlers — GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User, Claude-SearchBot, Google-Extended, Google-CloudVertexBot, Applebot, Applebot-Extended, PerplexityBot, Perplexity-User, Amazonbot, Bytespider, CCBot, Meta-ExternalAgent, Meta-ExternalFetcher, FacebookBot, YouBot, DuckAssistBot, MistralAI-Index/User, cohere-ai, Diffbot, Omgilibot, AI2Bot(-Dolma), Timpibot, GoogleOther — each with organization, purpose, category, official documentation where it exists, robots.txt support, technical-blocking notes, verification notes, `lastVerified` and confidence. Classified by documented behavior, never by name (GoogleOther is deliberately listed as non-AI; Google-Extended/Applebot-Extended are labelled usage-control tokens, not crawlers).
- **Pipeline**: mode/preset selection (8 modes: block-all, block-training, block-search, block-extraction, allow-all, allow-selected, custom, advanced) → per-bot Allow/Block/Default overrides → path-level blocking + allow carve-outs → robots.txt generation → Nginx (map-based, token-boundary regex), Apache (.htaccess RewriteCond), Cloudflare WAF expression + separate deployment guidance, Node.js/Express, PHP and Laravel middleware (403) → configuration validation (round-trip parse, regex compile, brace/quote balance, snippet syntax) → rule conflict detection with robots.txt-matching explanations → bot access simulator (RFC 9309 group selection, wildcard fallback, longest-pattern precedence, Allow tie-break — every verdict explained) → existing robots.txt analyzer + before/after compare → coverage analysis ("known crawlers in our database", never claimed complete) → transparent 0–100 protection score ("Tool-generated diagnostic score — not a Google score, not an official security score").
- **Accuracy rules**: robots.txt is always described as advisory (requests compliant crawlers; does not enforce access control) vs server/CDN-level technical blocking; User-Agent spoofing limits are stated everywhere; matching uses exact product tokens with token boundaries (`MyAIBrowser` is never blocked for containing "AI"; a rule for `Applebot` does not catch `Applebot-Extended`); generic words like "AI"/"bot" are rejected as custom tokens; Cloudflare `contains` substring limits are disclosed; no crawler is ever claimed blocked without evidence.
- **Privacy**: no account; profiles (Strict/Training Only/Search Only/Custom naming, save/load/delete/export/import) live in browser localStorage; the only external requests are the user-triggered robots.txt fetch and live website check (`POST /api/botblocker-inspect` — SSRF-guarded, 8 s timeout, 256 KiB robots cap, 3-redirect max, per-IP rate limit, 60 s cache), which reports evidence only (robots.txt found, AI-bot rules detected, HTTPS, security headers, CDN headers).

Engine modules in `lib/botblocker/` (UMD — shared verbatim between Node tests and the browser via `/lib/botblocker/*.js`): `botDatabase → botClassifier / botPatternMatcher → robotsParser → robotsSimulator / robotsGenerator / ruleConflictDetector / userAgentAnalyzer → nginx|apache|cloudflare|middlewareGenerator → configurationValidator → protectionScore / coverageAnalyzer / securityChecker → index`. Offline self-test covers the 25 required scenarios (empty/basic/multi-group/wildcard/conflicting/invalid/large robots.txt, every named bot, unknown & custom UAs, spoofing, HTTP/HTTPS, Cloudflare-site evidence, nginx/Apache validity, presets consistency); the UI test drives the full browser pipeline with a fake DOM.


The theme detector is a server-side, multi-signal engine in `lib/wptheme/` (SSRF-protected crawl → WordPress detection → theme discovery → style.css analysis → fingerprints → evidence/confidence) with an offline self-test covering the required detection scenarios. If the server has no direct outbound access (e.g. this sandbox), the tool automatically collects the same resources through the visitor's browser and runs the identical analysis at `/api/wptheme-analyze`.

## Domain Information Checker

`/domain-information-checker` — evidence-based domain intelligence, no account, no AI, no paid SEO API. Enter a domain or URL (e.g. `example.com`, `bücher.de`, `https://blog.example.co.uk:8443/articles`) and get a full report:

- **Registration**: RDAP first, registry WHOIS fallback (TCP/43, IANA-assigned servers only) — dates, registrar, IANA ID, EPP statuses grouped and explained in plain language, DNSSEC delegation. Registrant (owner) data is detected for privacy status only and never surfaced.
- **DNS**: A, AAAA, CNAME, MX, NS, TXT, CAA, SOA, SRV, DS, DNSKEY via a dependency-free wire-format DNS client (UDP + TCP fallback, per-scan caching, adaptive resolvers), plus a non-alarmist DNS Health panel (missing AAAA is informational, never a fault).
- **Network**: IP → ASN/prefix/country from public BGP data (Team Cymru DNS), reverse DNS, local CIDR fingerprints. Hosting vs CDN are strictly separated — a Cloudflare edge is reported as *CDN/Proxy* and the origin as *Not publicly determinable* when it is hidden.
- **SSL/TLS & HTTP**: certificate issuer/validity/SANs/chain, TLS version, handshake-only legacy-version probes, HTTP status, response time, redirect chain analysis, HSTS, compression, cache headers (direct transport in production).
- **Email & DNSSEC**: MX providers, SPF/DMARC policies, DKIM via a small set of common selectors only (never brute-forced), DS/DNSKEY detection.
- **Extras**: domain age from the official registration date only (years/months/days/total days), registration timeline, expiration warnings, TLD database (gTLD/ccTLD, registry, RDAP/WHOIS endpoints), IDN/punycode display, domain structure parsing, passive subdomain observation (certificates/DNS/HTML — no brute force), heuristic technology fingerprints with confidence, multi-level public-suffix handling, copy buttons, JSON/text export.

**Accuracy over completeness**: every major value carries source + confidence + timestamp; conflicting sources are shown side by side; anything unavailable is labelled *Not publicly available* / *Unable to Verify* — never guessed.

Architecture (modular, in `lib/domaincheck/`): `domainParser` → `domainValidator`/SSRF guards (reuses `lib/wptheme/ssrf.js`) → `tldAnalyzer` → `rdapClient` → `whoisFallback` → `dnsAnalyzer`/`dnsClient` → `asnAnalyzer` → `hostingDetector` → `cdnDetector` → `sslAnalyzer` → `httpAnalyzer` → `redirectAnalyzer` → `emailAnalyzer` → `dnssecAnalyzer` → `subdomainAnalyzer` → `technologyDetector` → `domainAgeCalculator` → `statusInterpreter` → `reportEngine`. Bounded concurrency, timeouts, per-scan caches, rate limits, and request/byte budgets throughout. Nothing is stored server-side.

Transport honesty: in environments without direct HTTPS/WHOIS egress (like this preview sandbox), RDAP/WHOIS/TLS/HTTP sections are reported as unavailable with the reason — the DNS-based sections always work. The page offers an opt-in **“Retry HTTP via my browser”** that collects the site response through the visitor's browser (direct CORS fetch, then public read-only relays) and merges it via `/api/domaincheck-analyze`.

```bash
npm test          # wptheme selftest + uitest, domaincheck selftest (44 tests incl. the 25-scenario matrix) + uitest (UI pipeline)
```

## Running locally in this Arena workspace

PHP is not installed in this sandbox, so the preview is served by the included Node development server:

```bash
npm run dev
```

Open the Arena live preview. The original PHP-style files and Apache rewrite file are included for parity.
