#!/usr/bin/env bash
# The PendingBusiness pipeline, on this machine.
#
#   scripts/pipeline.sh check     # lint, typecheck, tests, site build — what deploy.yml's check job ran
#   scripts/pipeline.sh deploy    # site build, D1 bootstrap + migrations, Worker secret, wrangler deploy
#   scripts/pipeline.sh all
#
# GitHub Actions in this org are manual-only (workflow_dispatch); this is the
# same pipeline from the same Doppler config (doppler.yaml →
# pendingbusiness/repository). Plaid key material is NOT handled here: it is a
# Worker runtime secret set by scripts/set-plaid-secret.sh from the unsynced
# Doppler project pendingbusiness-runtime (docs/PLAID-SECRETS.md).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

WHAT="${1:-check}"

need_doppler() {
  command -v doppler >/dev/null 2>&1 || export PATH="$HOME/.local/bin:$PATH"
  command -v doppler >/dev/null 2>&1 || { echo "doppler CLI not found." >&2; exit 1; }
  doppler secrets --only-names >/dev/null 2>&1 || { echo "doppler cannot read pendingbusiness/repository from here (doppler.yaml)." >&2; exit 1; }
}

check() {
  echo "── lint";      pnpm nx run-many --target=lint
  echo "── typecheck"; pnpm nx run-many --target=typecheck
  echo "── test";      pnpm nx run-many --target=test
  echo "── build";     pnpm nx run site:build
}

# The committed worker/wrangler.toml carries PLACEHOLDER_PENDINGBUSINESS_D1_ID
# so a database id is never in git. CI substituted it into a throwaway
# checkout; here the file is restored on exit, whatever happens.
restore_toml() { git checkout -q -- worker/wrangler.toml 2>/dev/null || true; }

d1_id() {
  doppler run -- pnpm exec wrangler d1 list --json 2>/dev/null | node -e '
    let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>{
      try { const r=JSON.parse(d).find(x=>x.name==="pendingbusiness"); if (r) process.stdout.write(r.uuid||r.database_id||""); } catch {}
    });'
}

deploy() {
  need_doppler
  if [ -n "$(git status --porcelain)" ]; then
    echo "Working tree is not clean. Commit or discard first." >&2; git status --short >&2; exit 1
  fi
  echo "── build"; pnpm nx run site:build
  trap restore_toml EXIT
  (
    cd worker
    ID="$(d1_id)"
    if [ -z "$ID" ]; then
      echo "D1 'pendingbusiness' not found — creating."
      OUT="$(doppler run -- pnpm exec wrangler d1 create pendingbusiness 2>&1 || true)"; echo "$OUT"
      ID="$(printf '%s' "$OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)"
      [ -n "$ID" ] || ID="$(d1_id)"
    fi
    [ -n "$ID" ] || { echo "Could not resolve the pendingbusiness D1 id." >&2; exit 1; }
    echo "D1 database_id=$ID"
    sed -i "s/PLACEHOLDER_PENDINGBUSINESS_D1_ID/$ID/" wrangler.toml
    echo "── d1 migrations"; doppler run -- pnpm exec wrangler d1 migrations apply pendingbusiness --remote
    echo "── deploy"; doppler run -- pnpm exec wrangler deploy
  )
  echo "── verify"; curl -fsS -o /dev/null -w "pendingbusiness.com %{http_code}\n" https://pendingbusiness.com/
}

case "$WHAT" in
  check)  check ;;
  deploy) deploy ;;
  all)    check; deploy ;;
  *) echo "usage: $0 check|deploy|all" >&2; exit 2 ;;
esac
