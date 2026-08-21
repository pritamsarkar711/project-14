# huvanti

Imported from the public Gitea project requested by the user:
https://gitea.com/alistairfox.london/toolsite

This workspace contains a local runnable huvanti tools website with the same structure and routes as the source project: PHP-style pages, `/tools/<slug>`, `/category/<key>`, `/all-tools`, informational pages, assets, generated catalogue data, and JavaScript tool engines.

Tools served by the Node server: SEO Audit (`/`), AdSense/Ezoic/Mediavine/Raptive eligibility checkers, the WordPress Theme Detector (`/wordpress-theme-detector`), the Domain Information Checker (`/domain-information-checker`), and the XML Sitemap Generator — all under **Other Tools** in the header.

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
