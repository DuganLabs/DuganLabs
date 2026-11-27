export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;

  /**
   * Absolute origin of `apps/api` (https://api.greenput.com in
   * production, https://api.greenput.site in staging). Its only reader
   * was the booking-deposit confirmation page, removed in WS-0 when
   * the deposit model was revoked — nothing in this Worker reads it
   * any more, and the unrouted page module (src/deposit.ts) was
   * deleted on 2026-11-01. The [vars] entries are left as deployed
   * config, untouched; do not give it a new reader casually.
   */
  API_ORIGIN?: string;

  /**
   * Absolute origin of `apps/brand-assets`, used for exactly one thing:
   * building the `og:image` URL of this tenant's own share card
   * (`https://brand.greenput.com/<slug>/<version>/card.png`).
   *
   * A `[vars]` entry rather than something derived from the request hostname,
   * because the derivation would be a guess. Production is
   * `https://brand.greenput.com`; staging and preview have no such hostname,
   * so they leave it empty — and an empty value means the page falls back to
   * Greenput's own share card instead of advertising a URL that 404s. See
   * `normaliseBrandOrigin`, which also rejects a non-http(s) value outright.
   *
   * NOT used for the quote form or any other request: the site's CSP is
   * `connect-src 'self'` and `form-action 'self'`, and nothing here makes the
   * browser fetch this origin. The card URL is read by crawlers, not by the
   * page.
   */
  BRAND_ORIGIN?: string;

  /**
   * Where a homeowner's panel photos go.
   *
   * Bound now: `greenput-files` (and its `-staging` / `-preview` siblings).
   * The same bucket is bound in `apps/api` under that Worker's existing
   * `FILES` name — one bucket, so a `files.r2_key` is unambiguous whichever
   * Worker wrote it; each binding keeps the name its own code already uses.
   *
   * Still optional. When it is absent the quote form works exactly as before —
   * the traversal never waits for a photo, so the price still appears; the
   * upload is simply refused with a 503 rather than a file being accepted and
   * dropped.
   */
  INTAKE_PHOTOS?: R2Bucket;
}
