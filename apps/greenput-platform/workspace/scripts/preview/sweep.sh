#!/usr/bin/env bash
# scripts/preview/sweep.sh
# Weekly (and on-demand) backstop for orphaned preview environments —
# LEGACY CLEANUP ONLY.
#
# Since the "one shared, manually-claimed preview environment" change
# (.github/workflows/preview-env.yml), CI no longer creates a per-PR-numbered
# D1/KV/Worker set for every PR, so there is nothing new for this sweep to
# find going forward. It is kept, scheduled, solely to reclaim what the OLD
# per-PR scheme already left (or leaves stragglers of, from any run of the
# old workflow still cached in a re-run): greenput-preview-N,
# greenput-{api,tenant}-preview-N, greenput-marketing-pr-N,
# greenput-sessions-preview-N. Once every one of those is gone, this job is
# expected to report zero matches on every run, forever — that's success,
# not a sign it should be removed (it's cheap insurance against any
# leftover automation still writing the old names).
#
# The naming patterns below all require a trailing PR number, so the new
# fixed resources (greenput-preview, greenput-{api,tenant,marketing}-preview,
# greenput-sessions-preview — no trailing number) can never match and will
# never be touched by this script, by construction.
#
# This was previously the primary cleanup path's backstop, for everything
# that slipped past the old per-PR-close teardown — most notably the race
# in the old setup.sh/ci.yml where a PR merged while its preview-deploy job
# was still running, so the PR-close teardown fired before the resources
# existed. That race can no longer happen (there's no more per-PR-close
# teardown to race), but the description is kept here for anyone digging
# through history to understand why the naming patterns below look the way
# they do.
#
# Previously this only listed D1 databases named `greenput-preview-*` and
# derived a PR number from that name alone, then called teardown.sh for
# each one. That could never find (a) a PR whose D1 was never created —
# e.g. greenput-marketing-pr-38, where the D1 didn't exist yet when the
# race described above hit — or (b) worker-greenput-sessions-preview-N,
# a KV namespace whose title carries a `worker-` prefix teardown.sh's own
# matching didn't tolerate (see teardown.sh; that mismatch is fixed
# there, this script's job is finding the PR number in the first place).
#
# This version enumerates Workers, D1 databases AND KV namespaces, and
# recognizes a PR number from ANY of the known preview naming patterns,
# so a PR missing one or two of its resources (partial creation, a
# previous partially-failed teardown, ...) is still found via whichever
# resource it does have.
#
# Usage: ./scripts/preview/sweep.sh
# Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, GH_TOKEN (for
# `gh pr list`)

set -uo pipefail
# No `set -e`: a failed teardown for one PR number must not stop the
# sweep from attempting every other PR number, or from printing the
# final summary.

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"

CF_API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}"
AUTH_HEADER="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Fetches every Worker script, D1 database and KV namespace, and prints
# one "<pr_number>\t<kind>\t<name>" line per resource that matches one of
# the known preview naming patterns. A resource that doesn't match any
# pattern (production/staging Workers, greenput/greenput-staging D1,
# SESSIONS/OG_CACHE-style KV, etc.) is silently ignored — this sweep only
# ever acts on names it recognizes.
scan_preview_resources() {
  local workers_json d1_json kv_json

  workers_json=$(curl -sf -H "${AUTH_HEADER}" "${CF_API}/workers/scripts" || echo '{"result":[]}')
  d1_json=$(curl -sf -H "${AUTH_HEADER}" "${CF_API}/d1/database?per_page=100" || echo '{"result":[]}')
  kv_json=$(curl -sf -H "${AUTH_HEADER}" "${CF_API}/storage/kv/namespaces?per_page=100" || echo '{"result":[]}')

  node -e '
    const [workersJson, d1Json, kvJson] = process.argv.slice(1);
    const workers = JSON.parse(workersJson).result || [];
    const d1s = JSON.parse(d1Json).result || [];
    const kvs = JSON.parse(kvJson).result || [];

    const workerPatterns = [
      /^greenput-api-preview-(\d+)$/,
      /^greenput-tenant-preview-(\d+)$/,
      /^greenput-marketing-pr-(\d+)$/,
    ];
    const d1Patterns = [/^greenput-preview-(\d+)$/];
    const kvPatterns = [
      /^greenput-sessions-preview-(\d+)$/,
      /^worker-greenput-sessions-preview-(\d+)$/,
    ];

    function prFor(name, patterns) {
      for (const p of patterns) {
        const m = name.match(p);
        if (m) return m[1];
      }
      return null;
    }

    const lines = [];
    for (const w of workers) {
      const pr = prFor(w.id, workerPatterns);
      if (pr) lines.push(`${pr}\tworker\t${w.id}`);
    }
    for (const d of d1s) {
      const pr = prFor(d.name, d1Patterns);
      if (pr) lines.push(`${pr}\td1\t${d.name}`);
    }
    for (const k of kvs) {
      const pr = prFor(k.title, kvPatterns);
      if (pr) lines.push(`${pr}\tkv\t${k.title}`);
    }
    process.stdout.write(lines.join("\n"));
  ' "$workers_json" "$d1_json" "$kv_json"
}

echo "==> Sweeping orphaned preview environments"
echo "  Scanning Workers, D1 databases and KV namespaces for preview-shaped names..."

MATCHES=$(scan_preview_resources)
MATCH_COUNT=$(printf '%s\n' "${MATCHES}" | sed '/^$/d' | wc -l | tr -d ' ')
echo "  Found ${MATCH_COUNT} preview-shaped resource(s)."

# Word-split through `echo` (unquoted) to collapse the newline-separated
# `sort` output into a single space-separated line, both for the summary
# below and for the `for` loop that follows (which relies on the same
# word-splitting either way).
PR_NUMBERS=$(echo $(printf '%s\n' "${MATCHES}" | awk -F'\t' 'NF { print $1 }' | sort -un))

OPEN_PRS=$(gh pr list --state open --json number --jq '.[].number' 2>/dev/null || echo "")

DELETED_OK=""
DELETE_FAILED=""
STILL_OPEN=""

for PR_NUM in ${PR_NUMBERS}; do
  if echo "${OPEN_PRS}" | grep -qw "${PR_NUM}"; then
    echo "  PR #${PR_NUM} is still open, leaving its preview resources in place."
    STILL_OPEN="${STILL_OPEN}${STILL_OPEN:+ }${PR_NUM}"
    continue
  fi

  echo "  PR #${PR_NUM} is not open — tearing down its preview resources..."
  if PR_NUMBER="${PR_NUM}" bash "${SCRIPT_DIR}/teardown.sh"; then
    DELETED_OK="${DELETED_OK}${DELETED_OK:+ }${PR_NUM}"
  else
    echo "::warning::Teardown for PR #${PR_NUM} reported at least one failed delete (see log above)."
    DELETE_FAILED="${DELETE_FAILED}${DELETE_FAILED:+ }${PR_NUM}"
  fi
done

# ── Verify nothing preview-shaped remains for a non-open PR ──────────
# teardown.sh reporting success is not, by itself, proof the account is
# actually clean (pagination limits, a resource created by some other
# path, a PR that got reopened mid-sweep, ...). Re-scan for real so the
# exit code — and the summary below — reflect what the account actually
# looks like afterward, not just what was attempted.
echo "  Re-scanning to confirm nothing was left behind..."
REMAINING=$(scan_preview_resources | node -e '
  const openCsv = process.argv[1] || "";
  const open = new Set(openCsv.split(",").filter(Boolean));
  const lines = require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean);
  const remaining = lines.filter((line) => {
    const pr = line.split("\t")[0];
    return pr && !open.has(pr);
  });
  process.stdout.write(remaining.join("\n"));
' "$(echo ${OPEN_PRS} | tr ' ' ',')")

echo ""
echo "==> Sweep summary"
echo "  Preview resources found          : ${MATCH_COUNT}"
echo "  PR numbers referenced            : ${PR_NUMBERS:-none}"
echo "  Still open (left alone)          : ${STILL_OPEN:-none}"
echo "  Torn down cleanly                : ${DELETED_OK:-none}"
echo "  Torn down with failures          : ${DELETE_FAILED:-none}"
if [ -n "${REMAINING}" ]; then
  echo "  STILL PRESENT after this sweep   :"
  printf '%s\n' "${REMAINING}" | while IFS=$'\t' read -r pr kind name; do
    echo "    - PR #${pr} ${kind}: ${name}"
  done
else
  echo "  STILL PRESENT after this sweep   : none"
fi
echo "==> Sweep complete"

if [ -n "${REMAINING}" ]; then
  echo "::error::Sweep left preview resource(s) behind — see 'STILL PRESENT' above. Likely cause: a delete failed (check the teardown log for that PR above) or a resource sits outside this script's known naming patterns and needs manual review."
  exit 1
fi
