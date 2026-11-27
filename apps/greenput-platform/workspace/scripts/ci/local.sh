#!/usr/bin/env bash
# The GreenPut checks, on this machine — the gate every merge goes through.
#
#   scripts/ci/local.sh            # lint, prettier, unit tests, schema drift, build
#   scripts/ci/local.sh fast       # unit tests + db:check only
#
# GitHub Actions in this org are manual-only (workflow_dispatch) so no minutes
# are spent without the owner clicking. This is ci.yml's check half, run
# directly against the underlying tools rather than through the Nx cache, so
# a cached "pass" can never stand in for a real one. The deploy half is
# scripts/deploy/local.sh, from the same Doppler config.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

WHAT="${1:-full}"

unit() {
  echo "── unit tests"
  for cfg in apps/api apps/brand-assets apps/platform apps/tenant-site apps/marketing libs/shared/utils libs/shared/models libs/shared/validators libs/shared/pricing libs/shared/scheduling libs/shared/testing libs/basenative/fetch libs/basenative/auth-webauthn; do
    [ -f "$cfg/vitest.config.ts" ] || continue
    echo "   $cfg"
    pnpm exec vitest run --config "$cfg/vitest.config.ts" 2>&1 | grep -E "Test Files|Tests |FAIL" | sed 's/^/     /'
    test "${PIPESTATUS[0]}" -eq 0
  done
}

drift() { echo "── schema/migration drift"; pnpm db:check | tail -1; }

case "$WHAT" in
  fast) unit; drift ;;
  full)
    echo "── lint";     pnpm exec nx run-many --target=lint --skip-nx-cache >/dev/null && echo "   ok"
    echo "── prettier"; pnpm exec prettier --check "apps/**/*.{ts,tsx,css,html,json}" "libs/**/*.{ts,tsx,css,html,json}" | tail -1
    unit
    drift
    echo "── build";    pnpm exec nx run platform:build --skip-nx-cache >/dev/null && echo "   ok"
    scripts/ci/bundle-guard.sh
    ;;
  *) echo "usage: $0 [full|fast]" >&2; exit 2 ;;
esac
echo "all green"
