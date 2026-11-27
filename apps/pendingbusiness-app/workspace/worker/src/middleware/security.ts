/**
 * Security-headers finalizer. Runs in the router's `finally` chain on every
 * outgoing response, including the static-asset catch-all.
 *
 * The mechanism — assembling the CSP, generating a nonce, serializing HSTS,
 * rebuilding the Response without mutating the immutable one `env.ASSETS`
 * hands back — now lives in `@basenative/middleware/security-headers`, which
 * also supplies the hardened baseline (`default-src 'self'`,
 * `frame-ancestors 'none'`, `object-src 'none'`, `base-uri`/`form-action`
 * `'self'`, `upgrade-insecure-requests`, `nosniff`,
 * `strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy:
 * same-origin`, and the five high-risk browser features denied).
 *
 * What stays here is what is genuinely PendingBusiness's: the hosts it talks
 * to, the fact that it must never be indexed, and its cache stance.
 *
 * `nonce: true` because the zone injects its own scripts at the edge (Web
 * Analytics' beacon loader, Bot Fight Mode's JS-detect snippet) *after* this
 * worker returns, so they land in markup this code never sees. Cloudflare
 * stamps those injected `<script>` tags with whatever nonce the response's
 * own CSP declares, so a per-response nonce lets them pass without resorting
 * to `'unsafe-inline'`. PB has no server-rendered inline scripts of its own
 * to tag with it, so it never needs the value back.
 *
 * `style-src` deliberately stays at the baseline's `'self'`. Every stylesheet
 * is either an external `<link rel="stylesheet">` or a
 * `CSSStyleSheet().replaceSync(...)` adopted at runtime, which originates
 * from script and is governed by `script-src` instead.
 *
 * `Cache-Control: private, no-store` on JSON only — PB's API surface, and
 * personal data that must never be cached by an intermediary or a browser.
 * Detected by Content-Type rather than request URL because the `finally` hook
 * only sees the response. Static assets keep their ASSETS-binding headers.
 */
import { securityHeaders } from '@basenative/middleware/security-headers';

export const applySecurityHeaders = securityHeaders({
  csp: {
    'script-src': ['https://cdn.plaid.com', 'https://static.cloudflareinsights.com'],
    'img-src': ['https://cdn.plaid.com'],
    'connect-src': ['https://production.plaid.com', 'https://sandbox.plaid.com'],
    'frame-src': ['https://cdn.plaid.com', 'https://*.plaid.com'],
  },
  nonce: true,
  hsts: { maxAge: 63_072_000, includeSubDomains: true, preload: true },
  noindex: true,
  cache: ({ contentType }) =>
    contentType.startsWith('application/json') ? 'private, no-store' : null,
});
