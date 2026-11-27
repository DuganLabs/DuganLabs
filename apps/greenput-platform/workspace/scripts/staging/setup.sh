#!/usr/bin/env bash
# scripts/staging/setup.sh
# Staging environment provisioning.
# Copies staging wrangler configs into place and applies the DB schema.
#
# Usage: ./scripts/staging/setup.sh
# Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID

set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"

DB_NAME="greenput-staging"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "==> Staging setup"

# ── Copy staging wrangler configs ─────────────────────────────
echo "  Copying API wrangler staging config..."
cp "apps/api/wrangler.staging.toml" "apps/api/wrangler.toml"
echo "  Written: apps/api/wrangler.toml"

echo "  Copying tenant-site wrangler staging config..."
cp "apps/tenant-site/wrangler.staging.toml" "apps/tenant-site/wrangler.toml"
echo "  Written: apps/tenant-site/wrangler.toml"

# ── Apply additive migrations (must run before schema.sql) ───
# Additive migrations add columns that schema.sql indexes reference, so they
# must land first or CREATE INDEX aborts and the rest of schema.sql never runs.
# Delegated to the shared runner, which production CI also calls, so staging
# and production cannot drift apart. (Preview skips migrations: it recreates
# its database empty, so schema.sql alone gives it everything.)
"${REPO_ROOT}/scripts/db/migrate.sh" "${DB_NAME}" --remote

# ── Apply D1 schema ───────────────────────────────────────────
echo "  Applying schema.sql to staging D1..."
pnpm exec wrangler d1 execute "${DB_NAME}" --file=schema.sql --remote
echo "  Schema applied."

# ── Seed the demo tenant (reference/showcase site) ────────────
# scripts/preview/seed.sql is all `INSERT OR IGNORE`, so this is safe to
# re-run on every staging deploy — it only ever adds the fictional `demo`
# workspace and its supporting rows.
echo "  Seeding the demo tenant..."
pnpm exec wrangler d1 execute "${DB_NAME}" --file=scripts/preview/seed.sql --remote
echo "  Demo tenant seeded."

# ── Seed Greenput's own workspace (the contact form's inbox) ─
# greenput.com/contact files leads into the workspace CONTACT_WORKSPACE_SLUG
# names (apps/marketing/wrangler.staging.toml). Production has the owner's
# real row; staging gets this stand-in. INSERT OR IGNORE throughout.
echo "  Seeding Greenput's own workspace..."
pnpm exec wrangler d1 execute "${DB_NAME}" --file=scripts/seed/duganlabs-workspace.sql --remote
echo "  Greenput workspace seeded."

# ── Seed Greenput's global pricing machines ───────────────────
# Templates (workspace_id NULL) every tenant site can quote from until a
# contractor authors their own. Generated from seeds/pricing/*.json, all
# INSERT OR REPLACE against deterministic ids, so re-running updates in place.
"${REPO_ROOT}/scripts/seed/apply-pricing-fsms.sh" "${DB_NAME}" --remote

echo "==> Staging setup complete"
