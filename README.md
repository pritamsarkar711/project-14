# huvanti

Imported from the public Gitea project requested by the user:
https://gitea.com/alistairfox.london/toolsite

This workspace contains a local runnable huvanti tools website with the same structure and routes as the source project: PHP-style pages, `/tools/<slug>`, `/category/<key>`, `/all-tools`, informational pages, assets, generated catalogue data, and JavaScript tool engines.

## Running locally in this Arena workspace

PHP is not installed in this sandbox, so the preview is served by the included Node development server:

```bash
npm run dev
```

Open the Arena live preview. The original PHP-style files and Apache rewrite file are included for parity.
