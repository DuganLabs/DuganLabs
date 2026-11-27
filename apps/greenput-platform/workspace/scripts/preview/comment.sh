#!/usr/bin/env bash
# scripts/preview/comment.sh
# Posts (or updates) the single PR comment that reports the shared preview
# environment's lease status. Used by .github/workflows/preview-env.yml for
# every outcome of a claim/release attempt — always upserting the same
# comment (matched by COMMENT_MARKER) rather than adding a new one each
# time, so a PR's thread doesn't fill up with one comment per push/label
# toggle.
#
# Usage:
#   PR_NUMBER=42 STATUS=claimed \
#   PREVIEW_API_URL=https://greenput-api-preview.workers.dev \
#   PREVIEW_PLATFORM_URL=https://preview.greenput-app.pages.dev \
#   PREVIEW_MARKETING_URL=https://greenput-marketing-preview.<account>.workers.dev \
#   PREVIEW_TENANT_URL=https://greenput-tenant-preview.workers.dev \
#   D1_CREATED=false KV_CREATED=false \
#   ./scripts/preview/comment.sh
#
#   PR_NUMBER=42 STATUS=released ./scripts/preview/comment.sh
#   PR_NUMBER=42 STATUS=conflict CONFLICT_PR=17 ./scripts/preview/comment.sh
#   PR_NUMBER=42 STATUS=skipped ./scripts/preview/comment.sh

set -euo pipefail

: "${PR_NUMBER:?PR_NUMBER is required}"
: "${STATUS:?STATUS is required (claimed|released|conflict|skipped)}"

COMMENT_MARKER="<!-- greenput-preview-comment -->"

case "${STATUS}" in
  claimed)
    NOTES=""
    if [ "${D1_CREATED:-false}" = "true" ] || [ "${KV_CREATED:-false}" = "true" ]; then
      NOTES="
> First-ever claim: the fixed D1 database and/or KV namespace didn't exist yet and were just created. They will never be deleted — every future claim reuses them."
    fi
    BODY=$(cat <<EOF
${COMMENT_MARKER}
## Preview Environment

This PR now holds the shared preview environment lease.
${NOTES}

| App | URL | Type |
|-----|-----|------|
| API | ${PREVIEW_API_URL:-not deployed} | Worker |
| Platform | ${PREVIEW_PLATFORM_URL:-not deployed} | Pages |
| Marketing | ${PREVIEW_MARKETING_URL:-not deployed} | Worker |
| Tenant-site | ${PREVIEW_TENANT_URL:-not deployed} | Worker |

The database was reset (schema + seed data only) when this claim ran — any data from a previous claimant is gone.

**To release:** remove the \`preview\` label from this PR, or close/merge it.
**To refresh after new commits:** remove and re-add the \`preview\` label (or re-run "Shared Preview Environment" via workflow_dispatch with this PR number).

---
*Updated: $(date -u +"%Y-%m-%d %H:%M UTC")*
EOF
)
    ;;

  released)
    BODY=$(cat <<EOF
${COMMENT_MARKER}
## Preview Environment

The shared preview environment lease held by this PR has ended. The environment is now free — add the \`preview\` label to another PR to claim it.

---
*Updated: $(date -u +"%Y-%m-%d %H:%M UTC")*
EOF
)
    ;;

  conflict)
    : "${CONFLICT_PR:?CONFLICT_PR is required when STATUS=conflict}"
    BODY=$(cat <<EOF
${COMMENT_MARKER}
## Preview Environment

Could not claim the shared preview environment — it is currently held by #${CONFLICT_PR}.

Remove the \`preview\` label from #${CONFLICT_PR} first (or wait for it to close/merge), then remove and re-add the \`preview\` label here to retry.

---
*Updated: $(date -u +"%Y-%m-%d %H:%M UTC")*
EOF
)
    ;;

  skipped)
    BODY=$(cat <<EOF
${COMMENT_MARKER}
## Preview Environment

This PR is no longer open, so the preview claim was skipped. The shared environment was left untouched.

---
*Updated: $(date -u +"%Y-%m-%d %H:%M UTC")*
EOF
)
    ;;

  *)
    echo "Unknown STATUS: ${STATUS}" >&2
    exit 1
    ;;
esac

# Check if a preview comment already exists
REPO="${GITHUB_REPOSITORY:-}"
if [ -z "${REPO}" ]; then
  REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null || true)
fi

if [ -z "${REPO}" ]; then
  echo "  Could not determine repository — skipping comment."
  exit 0
fi

EXISTING_COMMENT_ID=$(gh api \
  "repos/${REPO}/issues/${PR_NUMBER}/comments" \
  --jq ".[] | select(.body | contains(\"${COMMENT_MARKER}\")) | .id" \
  2>/dev/null | head -1 || true)

if [ -n "${EXISTING_COMMENT_ID}" ]; then
  echo "  Updating existing comment ${EXISTING_COMMENT_ID}..."
  gh api \
    "repos/${REPO}/issues/comments/${EXISTING_COMMENT_ID}" \
    --method PATCH \
    --field body="${BODY}" \
    > /dev/null
else
  echo "  Creating new preview comment..."
  gh api \
    "repos/${REPO}/issues/${PR_NUMBER}/comments" \
    --method POST \
    --field body="${BODY}" \
    > /dev/null
fi

echo "  Preview lease comment (${STATUS}) posted on PR #${PR_NUMBER}"
