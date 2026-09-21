# CMS-0057-F.com

Independent educational guide to the CMS Interoperability and Prior Authorization final rule ([CMS-0057-F](https://www.cms.gov/newsroom/fact-sheets/cms-interoperability-prior-authorization-final-rule-cms-0057-f)).

Published by [Aurelianware, Inc.](https://cloudhealthoffice.com). **Not affiliated with CMS or HHS.**

Live: [https://cms-0057-f.com](https://cms-0057-f.com)

Product implementation (separate site, commercial intent):
[Cloud Health Office — CMS-0057-F compliance layer](https://cloudhealthoffice.com/cms-0057f-compliance)

## Official sources

- [CMS fact sheet](https://www.cms.gov/newsroom/fact-sheets/cms-interoperability-prior-authorization-final-rule-cms-0057-f)
- [CMS rule page](https://www.cms.gov/initiatives/burden-reduction/overview/interoperability/policies-regulations/cms-interoperability-prior-authorization-final-rule-cms-0057-f)
- [Federal Register (2024-00895)](https://www.federalregister.gov/documents/2024/02/08/2024-00895/medicare-and-medicaid-programs-patient-protection-and-affordable-care-act-advancing-interoperability)

## Content structure

- Regulatory pages live at the site root (`/fact-sheet`, `/provider-access-api`, …).
- Implementation guides live under `/guides` (index at `public/guides.html`, articles in `public/guides/*.html`) and share `public/css/guides.css`, including the responsive HTML/CSS diagram framework.

## HTTPS

`src/worker.mjs` sits in front of the static-asset binding and 301s any
plain-HTTP request to its `https://` equivalent, preserving path and query
string. Cloudflare's "Always Use HTTPS" zone setting should be enabled as well.
Background, the dashboard settings that are not in this repo, and why HSTS is
deliberately not enabled: [`docs/https-enforcement.md`](docs/https-enforcement.md).

```
npm run verify:https   # asserts a single 301 hop for every sitemap URL
```

## Validate / build

`scripts/validate.mjs` (Node built-ins only, no dependencies) checks per-page SEO invariants (one `<title>`, one `<h1>`, meta description, canonical), parses every JSON-LD block, verifies internal links resolve to real routes, rejects any `http://` reference in an `href`/`src`/`content` attribute, and checks the sitemap against the files on disk (https-only, canonical host).

```
npm run validate   # SEO invariants, links, sitemap
npm test           # unit tests for the HTTPS-redirect Worker
npm run build      # both of the above; `npm run deploy` runs it first
```

Both run in CI on every pull request.

## Deploy

Cloudflare Workers static assets (`wrangler.jsonc`, files in `public/`). After merging this tree:

```
npx wrangler deploy   # `npm run deploy` runs validate first
```

Submit `https://cms-0057-f.com/sitemap.xml` in Google Search Console and Bing Webmaster Tools.

## Notes

- `/cms-0057f-compliance` 301s to the CHO product page (do not host a duplicate).
- Educational pages stay on this domain. Implementation / overlay claims stay on cloudhealthoffice.com.
