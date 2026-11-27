# Web platform

- **Baseline Widely available only.** Features newer than that (for example `text-wrap: balance`)
  are allowed only as progressive enhancement that changes nothing when missing.
  Today the kit uses none.
- **No build-time framework for landings.** The server renders HTML from `content.json`;
  one inlined stylesheet; the client script enhances the lead form in place (form validation
  and 303 redirects work without JS, while Turnstile spam verification requires JS whenever
  `TURNSTILE_SITE_KEY` is configured). Sites with `form: false` ship zero client JS.
- **Caching & bfcache:** Public HTML routes send `Cache-Control: private, no-cache` so
  per-request CSP nonces revalidate on fresh navigations without blocking Back-Forward Cache
  (bfcache). Private `/app/*` routes and API/CSV endpoints send `Cache-Control: no-store`.
- **Budgets (Lighthouse 13, mobile and desktop):** Performance, Accessibility, Best Practices
  and SEO are each at least 95. Pages that are intentionally `noindex` (`/login`, `/privacy`,
  `/app`, noindex apps) are exempt from SEO. Local baseline (Nov 26, 2026) is 100 for all
  four on greenput, warrenmd, t4bs and duganlabs.
  Agentic browsing is report-only, not a budget.
- **Security headers (kit default):**
  - CSP with a per-request nonce;
  - `frame-ancestors 'none'`;
  - HSTS;
  - `X-Content-Type-Options: nosniff`;
  - `Referrer-Policy: strict-origin-when-cross-origin`;
  - `Permissions-Policy`.
- **Private areas** fail closed: there is no Access configuration on a real hostname, so the
  response is 403.
