#!/usr/bin/env bash
# scripts/preview/teardown.sh
# Deletes the numbered-per-PR Worker/D1/KV set left behind by the OLD
# per-PR preview scheme, for a given legacy PR number.
#
# LEGACY ONLY: since the "one shared, manually-claimed preview environment"
# change (.github/workflows/preview-env.yml), CI never creates a new
# per-PR-numbered resource, so this script is no longer invoked per-PR-close
# by any workflow. Its only remaining caller is sweep.sh, which uses it to
# reclaim whatever the old scheme left orphaned (greenput-preview-N,
# greenput-{api,tenant}-preview-N, greenput-marketing-pr-N,
# greenput-sessions-preview-N). It must keep working exactly as before for
# that reason — do not repoint it at the new fixed resource names
# (greenput-preview, greenput-{api,tenant,marketing}-preview,
# greenput-sessions-preview); those are permanent and must never be deleted
# by anything.
#
# Uses Cloudflare REST API directly for reliable resource lookup/deletion.
#
# Usage: PR_NUMBER=42 ./scripts/preview/teardown.sh
#
# Every delete is attempted even if an earlier one failed (this script
# does NOT use `set -e`), so a single bad response can never hide the
# rest of the teardown. The HTTP status and response body of every
# non-2xx, non-404 delete are printed, and the script exits non-zero if
# any delete failed — a failed delete must make this job go red, not
# report success while leaving the resource behind (this is why
# greenput-preview-91's D1 database survived: the old version discarded
# the response with `> /dev/null 2>&1 || echo` and always exited 0).

set -uo pipefail

: "${PR_NUMBER:?PR_NUMBER is required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"

DB_NAME="greenput-preview-${PR_NUMBER}"
KV_NAME="greenput-sessions-preview-${PR_NUMBER}"
WORKER_NAME="greenput-api-preview-${PR_NUMBER}"
TENANT_WORKER_NAME="greenput-tenant-preview-${PR_NUMBER}"
MARKETING_WORKER_NAME="greenput-marketing-pr-${PR_NUMBER}"

CF_API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}"
AUTH_HEADER="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"

FAILURES=0
FAILED_RESOURCES=""

# Deletes CF_API+PATH and prints the HTTP status. A 404 means the
# resource is already gone and is treated as success, not a failure.
# Anything else outside 2xx prints the response body (instead of
# discarding it) and increments FAILURES so the script can exit non-zero
# at the end, after every other delete has still been attempted.
#
# Args: LABEL PATH
delete_resource() {
  local label="$1"
  local path="$2"
  local raw status body

  echo "  Deleting ${label}..."
  raw=$(curl -s -w '\n%{http_code}' -H "${AUTH_HEADER}" -X DELETE "${CF_API}${path}")
  status=$(printf '%s' "$raw" | tail -n1)
  body=$(printf '%s' "$raw" | sed '$d')

  if [ "$status" -ge 200 ] 2>/dev/null && [ "$status" -lt 300 ] 2>/dev/null; then
    echo "    OK (HTTP ${status})"
  elif [ "$status" = "404" ]; then
    echo "    Not found (HTTP 404) — already deleted or never existed."
  else
    echo "    FAILED (HTTP ${status:-unknown})"
    echo "    Response: ${body}"
    FAILURES=$((FAILURES + 1))
    FAILED_RESOURCES="${FAILED_RESOURCES}${FAILED_RESOURCES:+, }${label} (HTTP ${status:-unknown})"
  fi
}

# Looks up a resource's id by exact NAME match on NAME_FIELD in a
# Cloudflare "list" endpoint's `result` array. Prints the id (empty if
# not found or the lookup itself failed — a failed lookup is reported but
# does not fail the whole script, since there's nothing to delete).
#
# Args: PATH NAME_FIELD NAME
find_resource_id() {
  local path="$1"
  local name_field="$2"
  local name="$3"
  local raw status body

  raw=$(curl -s -w '\n%{http_code}' -H "${AUTH_HEADER}" "${CF_API}${path}")
  status=$(printf '%s' "$raw" | tail -n1)
  body=$(printf '%s' "$raw" | sed '$d')

  if [ "$status" -lt 200 ] 2>/dev/null || [ "$status" -ge 300 ] 2>/dev/null; then
    echo "    WARNING: lookup for ${name} failed (HTTP ${status:-unknown}): ${body}" >&2
    return 0
  fi

  printf '%s' "$body" | node -e "
    try {
      const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const match = (data.result || []).find(r => r['${name_field}'] === '${name}');
      if (match) process.stdout.write(match.id || match.uuid || '');
    } catch (e) {
      console.error('Failed to parse lookup response for ${name}:', e.message);
    }
  " 2>/dev/null || true
}

echo "==> Tearing down preview environment for PR #${PR_NUMBER}"

# ── Workers ──────────────────────────────────────────────────
delete_resource "API Worker (${WORKER_NAME})" "/workers/scripts/${WORKER_NAME}"
delete_resource "tenant-site Worker (${TENANT_WORKER_NAME})" "/workers/scripts/${TENANT_WORKER_NAME}"
delete_resource "marketing Worker (${MARKETING_WORKER_NAME})" "/workers/scripts/${MARKETING_WORKER_NAME}"

# ── D1 database ──────────────────────────────────────────────
echo "  Looking up D1 database: ${DB_NAME}"
D1_ID=$(find_resource_id "/d1/database?name=${DB_NAME}" "name" "${DB_NAME}")
if [ -n "${D1_ID}" ]; then
  delete_resource "D1 database (${DB_NAME}, ${D1_ID})" "/d1/database/${D1_ID}"
else
  echo "  D1 database ${DB_NAME} not found, skipping."
fi

# ── KV namespace ─────────────────────────────────────────────
# Some preview KV namespaces exist as `worker-${KV_NAME}` instead of the
# bare title setup.sh's raw Cloudflare API calls create — that's the
# shape `wrangler kv namespace create` uses when run from inside a Worker
# project. An exact-title match alone (the old behavior) can never find
# those, which is why worker-greenput-sessions-preview-5/6/8 survived
# every teardown. Match either form, and delete every match found (in
# the unlikely case both exist for the same PR).
echo "  Looking up KV namespace: ${KV_NAME} (also matching worker-${KV_NAME})"
kv_list_body=$(curl -s -H "${AUTH_HEADER}" "${CF_API}/storage/kv/namespaces?per_page=100")
KV_MATCHES=$(printf '%s' "$kv_list_body" | node -e "
  try {
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const target = '${KV_NAME}';
    const prefixed = 'worker-' + target;
    const matches = (data.result || []).filter(n => n.title === target || n.title === prefixed);
    for (const m of matches) console.log(m.id + '\t' + m.title);
  } catch (e) {
    console.error('Failed to parse KV list response:', e.message);
  }
" 2>/dev/null || true)

if [ -n "${KV_MATCHES}" ]; then
  while IFS=$'\t' read -r kv_id kv_title; do
    [ -n "${kv_id}" ] || continue
    delete_resource "KV namespace (${kv_title}, ${kv_id})" "/storage/kv/namespaces/${kv_id}"
  done <<< "${KV_MATCHES}"
else
  echo "  KV namespace ${KV_NAME} not found (checked both plain and worker-prefixed titles), skipping."
fi

echo "==> Preview teardown finished for PR #${PR_NUMBER}"

if [ "${FAILURES}" -gt 0 ]; then
  echo "::error::${FAILURES} resource(s) failed to delete for PR #${PR_NUMBER}: ${FAILED_RESOURCES}"
  exit 1
fi

echo "  All resources for PR #${PR_NUMBER} deleted (or already absent)."
