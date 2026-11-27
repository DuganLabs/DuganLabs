export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  CHAT_ROOM: DurableObjectNamespace;
  ENVIRONMENT: string;

  // Where apps/brand-assets serves every workspace's share card and mark
  // (https://brand.greenput.com in production; empty in staging and preview,
  // which have no such hostname). Read by POST /api/auth/register only, to hand
  // the new workspace the two URLs — nothing here fetches them. Empty means
  // the response simply omits them; see brandAssetUrls in libs/shared/design.
  BRAND_ORIGIN?: string;

  // Proof of operator identity for POST /api/admin/auth/setup, the route that
  // mints the first platform admin. Optional on purpose: absent (or shorter
  // than ADMIN_SETUP_TOKEN_MIN_LENGTH) disables that route entirely, so an
  // environment nobody has deliberately provisioned a bootstrap secret for has
  // no bootstrap route. See middleware/admin-setup.ts and
  // docs/admin-bootstrap.md.
  ADMIN_SETUP_TOKEN?: string;

  // Twilio SMS (optional — falls back to console.log in dev)
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;

  // Cloudflare Calls (optional — video chat disabled without these)
  CALLS_APP_ID?: string;
  CALLS_APP_SECRET?: string;

  // Stripe (optional — billing/payments disabled without these)
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  // No STRIPE_CONNECT_CLIENT_ID. Connect onboarding is Express account
  // links (POST /v1/account_links), not the OAuth Connect flow, so a
  // client id is never read. Do not put one back without a caller.
  // The platform PUBLISHABLE key (pk_…). Not a secret. Its only reader
  // is the dormant booking-deposit engine (lib/deposits.ts), whose
  // homeowner confirmation surface was removed in WS-0 — no live route
  // hands this key to a browser any more. Kept as configuration for the
  // dormant module; read from the environment like the other Stripe
  // values and never hardcoded.
  STRIPE_PUBLISHABLE_KEY?: string;

  // Email (optional — notifications disabled without these)
  EMAIL_FROM?: string;

  // Cloudflare R2 (optional — file uploads disabled without this)
  // Bound to `greenput-files`. The tenant-site Worker binds the SAME bucket
  // under its own `INTAKE_PHOTOS` name (see apps/tenant-site/src/env.ts):
  // one bucket, so a `files.r2_key` row is unambiguous whichever Worker
  // stored it.
  FILES?: R2Bucket;

  // Cloudflare for SaaS (optional — custom-domain provisioning falls back to
  // "record the request, wait for the owner to create it by hand" without
  // these; see apps/api/src/lib/cloudflare-saas.ts). CLOUDFLARE_API_TOKEN
  // needs the zone-scoped "SSL and Certificates: Edit" + "Custom Hostnames"
  // permissions on CLOUDFLARE_ZONE_ID — see
  // duganlabs-survey/greenput-custom-domains.md for the exact owner setup.
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ZONE_ID?: string;
  // Fallback origin every contractor CNAMEs their custom domain to. Already
  // covered by the existing `*.greenput.com` wildcard DNS + Worker route
  // (infra/dns.tf, infra/tenant.tf), so this only needs to be registered as
  // the zone's Custom Hostname Fallback Origin in Cloudflare — no new DNS.
  CUSTOM_DOMAIN_FALLBACK_ORIGIN?: string;
}
