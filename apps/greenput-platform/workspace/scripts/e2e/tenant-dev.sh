#!/usr/bin/env bash
# Serve the tenant micro-site locally, with a database a browser can quote from.
#
# The quote form is server-rendered POST-redirect-GET on the contractor's own
# origin, so the only honest end-to-end test of it is a real browser against a
# real Worker against a real D1 — not a mocked fetch. This script stands that
# up: schema, pricing templates, one demo contractor, then `wrangler dev`.
#
# Everything is LOCAL (miniflare's D1 and R2 in `.wrangler/`, which is
# gitignored). Nothing here touches a Cloudflare account, so it needs no
# credentials and cannot affect production or staging.
#
# The host matters: the Worker maps a subdomain to a workspace, so a browser
# has to arrive as `demo.greenput.site`. Playwright does that with Chromium's
# `--host-resolver-rules`; curl does it with `-H "Host: …"`. Neither needs
# /etc/hosts or root.
#
# Usage: scripts/e2e/tenant-dev.sh [port]   (default 8799)
set -euo pipefail

PORT="${1:-8799}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SITE_DIR="${REPO_ROOT}/apps/tenant-site"
DB_NAME="greenput"
TMP_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
SEED_SQL="${TMP_DIR%/}/greenput-e2e-pricing.sql"
DEMO_SQL="${TMP_DIR%/}/greenput-e2e-demo.sql"

# `npx --no-install` rather than `pnpm exec`: apps/tenant-site has no
# package.json, so pnpm climbs to the repo root and wrangler loses the
# wrangler.toml beside it. Same reason CI uses it for this Worker.
wrangler() { npx --no-install wrangler "$@"; }

cd "${SITE_DIR}"

# A fresh database every run. The suite asserts on what the form produced, so
# leads and sessions left by a previous run are noise at best; and re-seeding
# over them is worse than noise, because `INSERT OR REPLACE` on a workspace is
# a DELETE plus an INSERT and every row pointing at it fails its foreign key.
echo "==> Clearing local Worker state"
rm -rf "${SITE_DIR}/.wrangler/state"

echo "==> Building the local quote database"
wrangler d1 execute "${DB_NAME}" --local --file="${REPO_ROOT}/schema.sql" > /dev/null

node "${REPO_ROOT}/scripts/seed/pricing-fsms.mjs" sql "${SEED_SQL}" > /dev/null
wrangler d1 execute "${DB_NAME}" --local --file="${SEED_SQL}" > /dev/null

# One contractor, reachable at demo.greenput.site, with the panel-photo
# surface switched on — the E2E exists to exercise it, and it ships dark.
cat > "${DEMO_SQL}" <<'SQL'
-- ON CONFLICT rather than INSERT OR REPLACE: SQLite implements the latter as
-- DELETE + INSERT, which takes every child row with it (or fails the foreign
-- key). Harmless on a database this script just wiped; wrong the moment
-- someone runs it against one it did not.
INSERT INTO workspaces
  (id, name, slug, trade, phone, email, street, city, state, zip)
VALUES
  ('e2e-ws', 'Rivertown Electric', 'demo', 'electrical', '512-555-0134',
   'hello@rivertown.example', '1 Main St', 'Austin', 'TX', '78704')
ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, name = excluded.name;

INSERT INTO users
  (id, workspace_id, email, first_name, last_name, role, password_hash)
VALUES
  ('e2e-user', 'e2e-ws', 'owner@rivertown.example', 'Olive', 'Owner', 'owner', 'x')
ON CONFLICT(id) DO UPDATE SET role = excluded.role;

INSERT INTO feature_flags (name, config_json, description)
VALUES ('intake_panel_photo', '{"enabled":true}',
        'Enabled for the E2E run; production ships this off.')
ON CONFLICT(name) DO UPDATE SET config_json = excluded.config_json;
SQL
wrangler d1 execute "${DB_NAME}" --local --file="${DEMO_SQL}" > /dev/null

# HTTPS, with wrangler's own self-signed certificate. Not a nicety: the site's
# security headers include a CSP with `upgrade-insecure-requests`, so every
# navigation a browser makes after the first one is rewritten to https. Serving
# plain http here would hang the form on its second page, and serving it with
# the header stripped would be testing a site that does not exist. Playwright
# accepts the certificate via `ignoreHTTPSErrors` for this project only.
echo "==> Serving the tenant site on https://127.0.0.1:${PORT}"
exec npx --no-install wrangler dev \
  --port "${PORT}" --ip 127.0.0.1 --local-protocol https
