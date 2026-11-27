#!/usr/bin/env bash
# scripts/preview/setup.sh
# Claim-time provisioning for the ONE shared preview environment.
#
# Unlike the old per-PR scheme (one D1/KV/Worker set per PR number, deleted
# on PR close), every resource here has a fixed, permanent name and is
# created at most once, on whichever claim happens to be first. Every claim
# after that reuses the same D1 database, KV namespace, and Workers — this
# script's job is to reset the database to a clean, deterministic state
# (dropping the previous claimant's data) and regenerate the wrangler
# configs that point at the fixed resources, NOT to create per-PR
# infrastructure. See .github/workflows/preview-env.yml for the claim flow
# that calls this, and CLAUDE.md's "Preview Environment" section for the
# click-path a developer uses to trigger it.
#
# Uses Cloudflare REST API directly for reliable resource lookup/creation.
# Requires `gh` (authenticated via GH_TOKEN) to re-check the PR is still
# open immediately before touching anything — see the guard below.
#
# Usage: PR_NUMBER=42 ./scripts/preview/setup.sh
# Outputs: D1_PREVIEW_ID, KV_PREVIEW_ID, WORKER_NAME (exported + GITHUB_OUTPUT)
# GITHUB_OUTPUT `skipped`: 'true' if the PR was no longer open and nothing
# was touched; callers must skip every subsequent deploy step in that case.
# GITHUB_OUTPUT `d1_created`/`kv_created`: 'true' only on the very first
# claim ever (the fixed resource didn't exist yet and this run created it).

set -euo pipefail

: "${PR_NUMBER:?PR_NUMBER is required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${GH_TOKEN:?GH_TOKEN is required (for gh pr view)}"

# Fixed, permanent names — no PR number in any of them. Never create a
# second one of these; never delete these. If one doesn't exist yet, the
# find-or-create logic below creates it exactly once and it lives forever
# after that.
DB_NAME="greenput-preview"
KV_NAME="greenput-sessions-preview"
R2_NAME="greenput-files-preview"
WORKER_NAME="greenput-api-preview"
API_TEMPLATE="apps/api/wrangler.preview.toml"
API_TARGET="apps/api/wrangler.toml"
TENANT_TEMPLATE="apps/tenant-site/wrangler.preview.toml"
TENANT_TARGET="apps/tenant-site/wrangler.toml"
TENANT_WORKER_NAME="greenput-tenant-preview"

CF_API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}"
AUTH_HEADER="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"

# Call the Cloudflare API and validate the response. On HTTP error or
# non-success body, prints the status + body to stderr and exits non-zero.
# On success, writes the response body to stdout.
#
# Args: METHOD PATH [JSON_BODY]
cf_call() {
  local method="$1"
  local path="$2"
  local request_body="${3:-}"
  local raw status body

  if [ -n "$request_body" ]; then
    raw=$(curl -s -w "\n%{http_code}" -H "${AUTH_HEADER}" \
      -H "Content-Type: application/json" \
      -X "$method" "${CF_API}${path}" \
      -d "$request_body")
  else
    raw=$(curl -s -w "\n%{http_code}" -H "${AUTH_HEADER}" \
      -X "$method" "${CF_API}${path}")
  fi

  status=$(printf '%s' "$raw" | tail -n1)
  body=$(printf '%s' "$raw" | sed '$d')

  if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
    echo "  ERROR: Cloudflare API ${method} ${path} returned HTTP ${status}" >&2
    echo "  Response body: ${body}" >&2
    return 1
  fi

  printf '%s' "$body"
}

echo "==> Preview claim for PR #${PR_NUMBER}"

# ── Guard: never touch the shared environment for a PR that closed ───
# The claim workflow re-checks this live (not just from the event payload)
# because a manual workflow_dispatch claim, or a claim queued behind another
# run by the `preview-env` concurrency group, can execute well after the PR
# closed. Skipping cleanly here (rather than resetting/deploying to a
# closed PR) is what the "skipped" output exists for.
echo "  Confirming PR #${PR_NUMBER} is still open before touching the shared preview..."
PR_STATE=$(gh pr view "${PR_NUMBER}" --json state --jq .state 2>/dev/null || echo "UNKNOWN")
if [ "${PR_STATE}" != "OPEN" ]; then
  echo "::notice::PR #${PR_NUMBER} is ${PR_STATE} (not OPEN) — skipping the preview claim. The shared environment is untouched."
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "skipped=true" >> "${GITHUB_OUTPUT}"
  fi
  exit 0
fi
echo "  PR #${PR_NUMBER} is OPEN, proceeding."
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "skipped=false" >> "${GITHUB_OUTPUT}"
fi

# ── D1 database (find-or-create, once, forever) ──────────────────
echo "  Finding or creating fixed D1 database: ${DB_NAME}"

D1_CREATED="false"
list_body=$(cf_call GET "/d1/database?name=${DB_NAME}")
D1_PREVIEW_ID=$(printf '%s' "$list_body" | node -e "
  try {
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const db = (data.result || []).find(d => d.name === '${DB_NAME}');
    if (db) process.stdout.write(db.uuid);
  } catch (e) {
    console.error('Failed to parse D1 list response:', e.message);
    process.exit(1);
  }
")

if [ -n "${D1_PREVIEW_ID}" ]; then
  echo "  D1 database already exists: ${D1_PREVIEW_ID}"
else
  echo "::notice::First-ever preview claim — creating the fixed D1 database '${DB_NAME}'. It will never be deleted; every future claim reuses it."
  create_body=$(cf_call POST "/d1/database" "{\"name\": \"${DB_NAME}\"}")
  D1_PREVIEW_ID=$(printf '%s' "$create_body" | node -e "
    try {
      const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      if (data.result && data.result.uuid) {
        process.stdout.write(data.result.uuid);
      } else {
        console.error('CF returned no uuid for D1 create:', JSON.stringify(data));
        process.exit(1);
      }
    } catch (e) {
      console.error('Failed to parse D1 create response:', e.message);
      process.exit(1);
    }
  ")
  D1_CREATED="true"
  echo "  Created D1 database: ${D1_PREVIEW_ID}"
fi

# ── KV namespace (find-or-create, once, forever) ─────────────────
echo "  Finding or creating fixed KV namespace: ${KV_NAME}"

KV_CREATED="false"
kv_list_body=$(cf_call GET "/storage/kv/namespaces?per_page=100")
KV_PREVIEW_ID=$(printf '%s' "$kv_list_body" | node -e "
  try {
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const ns = (data.result || []).find(n => n.title === '${KV_NAME}');
    if (ns) process.stdout.write(ns.id);
  } catch (e) {
    console.error('Failed to parse KV list response:', e.message);
    process.exit(1);
  }
")

if [ -n "${KV_PREVIEW_ID}" ]; then
  echo "  KV namespace already exists: ${KV_PREVIEW_ID}"
else
  echo "::notice::First-ever preview claim — creating the fixed KV namespace '${KV_NAME}'. It will never be deleted; every future claim reuses it."
  kv_create_body=$(cf_call POST "/storage/kv/namespaces" "{\"title\": \"${KV_NAME}\"}")
  KV_PREVIEW_ID=$(printf '%s' "$kv_create_body" | node -e "
    try {
      const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      if (data.result && data.result.id) {
        process.stdout.write(data.result.id);
      } else {
        console.error('CF returned no id for KV create:', JSON.stringify(data));
        process.exit(1);
      }
    } catch (e) {
      console.error('Failed to parse KV create response:', e.message);
      process.exit(1);
    }
  ")
  KV_CREATED="true"
  echo "  Created KV namespace: ${KV_PREVIEW_ID}"
fi

# ── R2 bucket (find-or-create, once, forever) ────────────────────
# Panel photos from the quote form. Same fixed-resource contract as the D1
# database and the KV namespace above: created on whichever claim happens to
# find it missing, never deleted, never per-PR. Both preview Workers bind this
# one bucket — the API as FILES, tenant-site as INTAKE_PHOTOS — so a
# `files.r2_key` written by either is readable by the other.
echo "  Finding or creating fixed R2 bucket: ${R2_NAME}"
# Raw curl rather than cf_call: a 404 here is the ordinary "not created yet"
# answer, and cf_call treats any non-2xx as fatal.
r2_get_status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "${AUTH_HEADER}" -X GET "${CF_API}/r2/buckets/${R2_NAME}")

if [ "${r2_get_status}" = "200" ]; then
  echo "  R2 bucket already exists: ${R2_NAME}"
else
  echo "::notice::Creating the fixed R2 bucket '${R2_NAME}'. It will never be deleted; every future claim reuses it."
  cf_call POST "/r2/buckets" "{\"name\": \"${R2_NAME}\"}" > /dev/null
  echo "  Created R2 bucket: ${R2_NAME}"
fi

# ── Generate wrangler configs ─────────────────────────────────
# The templates still carry the __PR_NUMBER__ token from the old per-PR
# scheme (they live under apps/, out of scope for this change), but here
# it's stripped entirely (with its leading dash) instead of substituted, so
# `greenput-api-preview-__PR_NUMBER__` becomes the fixed `greenput-api-preview`
# rather than `greenput-api-preview-42`.
echo "  Generating API wrangler config from template..."
sed \
  -e "s/-__PR_NUMBER__//g" \
  -e "s/__D1_PREVIEW_ID__/${D1_PREVIEW_ID}/g" \
  -e "s/__KV_PREVIEW_ID__/${KV_PREVIEW_ID}/g" \
  "${API_TEMPLATE}" > "${API_TARGET}"
echo "  Written: ${API_TARGET}"

echo "  Generating tenant-site wrangler config from template..."
sed \
  -e "s/-__PR_NUMBER__//g" \
  -e "s/__D1_PREVIEW_ID__/${D1_PREVIEW_ID}/g" \
  "${TENANT_TEMPLATE}" > "${TENANT_TARGET}"
echo "  Written: ${TENANT_TARGET}"

# ── Reset the database ────────────────────────────────────────
# The database is now permanent and shared across every claim, so the
# previous claimant's rows must not leak into this one. Table names are
# discovered from sqlite_master rather than hand-copied from schema.sql —
# schema.sql's table list changes over time, and a stale hand-maintained
# list here would silently under-drop tables schema.sql no longer mentions
# (or never adds new ones it does). On the very first claim this simply
# finds zero tables (fresh database) and drops nothing.
echo "  Resetting D1 database (dropping all existing tables for a clean claim)..."
TABLES_JSON=$(pnpm exec wrangler d1 execute "${DB_NAME}" --remote --json \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%';")
TABLE_NAMES=$(printf '%s' "${TABLES_JSON}" | node -e "
  try {
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
    const rows = (data[0] && data[0].results) || [];
    for (const row of rows) console.log(row.name);
  } catch (e) {
    console.error('Failed to parse table list, assuming nothing to drop:', e.message);
  }
")

if [ -n "${TABLE_NAMES}" ]; then
  DROP_SQL_FILE=$(mktemp)
  trap 'rm -f "${DROP_SQL_FILE}"' EXIT
  while IFS= read -r table; do
    [ -n "${table}" ] || continue
    echo "DROP TABLE IF EXISTS \"${table}\";" >> "${DROP_SQL_FILE}"
  done <<< "${TABLE_NAMES}"
  echo "  Dropping $(grep -c . "${DROP_SQL_FILE}") existing table(s)..."
  pnpm exec wrangler d1 execute "${DB_NAME}" --file="${DROP_SQL_FILE}" --remote
  rm -f "${DROP_SQL_FILE}"
  trap - EXIT
else
  echo "  No existing tables found — nothing to drop (first claim, or already clean)."
fi
echo "  Database reset complete."

# ── No migrations here, deliberately ──────────────────────────
# The block above empties this database completely, so schema.sql creates
# every table with every column already in place. migrations/ exists to carry
# LONG-LIVED databases forward (`greenput`, `greenput-staging`); running it
# against a table that does not exist yet can only fail. The old code here ran
# one hand-picked ALTER and swallowed its error, which made the failure look
# like success and taught nobody anything.

# ── Apply D1 schema ───────────────────────────────────────────
echo "  Applying schema.sql to preview D1..."
pnpm exec wrangler d1 execute "${DB_NAME}" --file=schema.sql --remote
echo "  Schema applied."

# ── Seed preview data ────────────────────────────────────────
echo "  Seeding preview data..."
pnpm exec wrangler d1 execute "${DB_NAME}" --file=scripts/preview/seed.sql --remote
echo "  Seed data applied."

# ── Seed Greenput's global pricing machines ───────────────────
# Without these the preview tenant site's /quote page has nothing to offer.
scripts/seed/apply-pricing-fsms.sh "${DB_NAME}" --remote

# ── Export outputs ────────────────────────────────────────────
export D1_PREVIEW_ID
export KV_PREVIEW_ID
export WORKER_NAME
export TENANT_WORKER_NAME

# Write outputs for GitHub Actions
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "d1_id=${D1_PREVIEW_ID}" >> "${GITHUB_OUTPUT}"
  echo "kv_id=${KV_PREVIEW_ID}" >> "${GITHUB_OUTPUT}"
  echo "worker_name=${WORKER_NAME}" >> "${GITHUB_OUTPUT}"
  echo "tenant_worker_name=${TENANT_WORKER_NAME}" >> "${GITHUB_OUTPUT}"
  echo "d1_created=${D1_CREATED}" >> "${GITHUB_OUTPUT}"
  echo "kv_created=${KV_CREATED}" >> "${GITHUB_OUTPUT}"
fi

echo "==> Preview claim provisioning complete"
