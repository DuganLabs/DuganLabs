#!/usr/bin/env bash
# Load Greenput's global pricing machines into a D1 database.
#
# The five machines and the default rate card in seeds/pricing/ are Greenput
# TEMPLATES — every row has workspace_id NULL — so a contractor's site can quote
# on day one, before anyone has authored anything. Without this, every tenant's
# /quote page correctly but uselessly says "we're not set up for instant prices
# just yet".
#
# seeds/pricing/*.json is the source of truth; SQL is a transport format
# generated from it and never committed. Every statement is INSERT OR REPLACE
# against a deterministic id, so re-running this updates the templates in place
# rather than inserting a second copy of everything — which is what makes it
# safe on every deploy.
#
# The tables it writes to are created by schema.sql and migrations/010, so this
# must run after both.
#
# Usage: scripts/seed/apply-pricing-fsms.sh <database-name> [--remote|--local]
set -euo pipefail

DB_NAME="${1:?usage: apply-pricing-fsms.sh <database-name> [--remote|--local]}"
MODE="${2:---remote}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
OUT_FILE="${OUT_DIR%/}/greenput-pricing-fsms.seed.sql"

echo "==> Seeding pricing machines into '${DB_NAME}' (${MODE})"
node "${REPO_ROOT}/scripts/seed/pricing-fsms.mjs" sql "${OUT_FILE}"
pnpm exec wrangler d1 execute "${DB_NAME}" --file="${OUT_FILE}" "${MODE}"
echo "==> Pricing machines seeded"
