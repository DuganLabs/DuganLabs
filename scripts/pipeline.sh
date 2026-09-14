#!/usr/bin/env bash
# The DuganLabs site pipeline, on this machine.
#
#   scripts/pipeline.sh check     # syntax checks, unit tests, wrangler dry-run — what deploy.yml's Check job ran
#   scripts/pipeline.sh deploy    # wrangler deploy the worker — what its Deploy job ran
#   scripts/pipeline.sh all
#
# GitHub Actions in this org are manual-only (workflow_dispatch); this is the
# same pipeline from the same Doppler config (doppler.yaml → duganlabs/repository).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

WHAT="${1:-check}"

need_doppler() {
  command -v doppler >/dev/null 2>&1 || export PATH="$HOME/.local/bin:$PATH"
  command -v doppler >/dev/null 2>&1 || { echo "doppler CLI not found." >&2; exit 1; }
  doppler secrets --only-names >/dev/null 2>&1 || { echo "doppler cannot read duganlabs/repository from here (doppler.yaml)." >&2; exit 1; }
}

check() {
  echo "── syntax"
  shopt -s nullglob
  for f in worker/*.js pages/js/*.js pages/vendor/basenative/*/*.js; do node --check "$f"; done
  echo "── test"; pnpm test
  echo "── wrangler dry-run"; ( cd worker && npx wrangler deploy --dry-run --outdir=.wrangler-dry )
}

deploy() {
  need_doppler
  if [ -n "$(git status --porcelain)" ]; then
    echo "Working tree is not clean. Commit or discard first." >&2; git status --short >&2; exit 1
  fi
  echo "── deploy"; doppler run -- pnpm exec nx run worker:deploy
  echo "── verify"; curl -fsS -o /dev/null -w "duganlabs.com %{http_code}\n" https://duganlabs.com/
}

case "$WHAT" in
  check)  check ;;
  deploy) deploy ;;
  all)    check; deploy ;;
  *) echo "usage: $0 check|deploy|all" >&2; exit 2 ;;
esac
