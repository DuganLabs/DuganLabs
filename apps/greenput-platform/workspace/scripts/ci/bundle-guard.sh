#!/usr/bin/env bash
# The rasterizer stays in ONE Worker.
#
# `@basenative/og-image` carries `@resvg/resvg-wasm` — 2.4 MB of WASM — and it
# belongs in apps/brand-assets and nowhere else (GP-108). apps/api serves every
# authenticated request and apps/tenant-site every micro-site page view; a WASM
# module in either is a cold-start tax on the whole product, and in apps/api a
# risk of the 1-second startup limit (error 10021) failing sign-in for everyone.
#
# This builds each Worker with `wrangler deploy --dry-run` and fails if the
# emitted bundle of a Worker that must not carry the rasterizer mentions it, or
# if the one that must does not. Sizes are printed so a PR can quote measured
# numbers rather than remembered ones.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

OUT="${TMPDIR:-/tmp}/greenput-bundle-guard.$$"
trap 'rm -rf "$OUT"' EXIT
fail=0

build() { # build <app dir> <label>
  local dir="$1" label="$2"
  ( cd "$dir" && npx --no-install wrangler deploy --dry-run --outdir "$OUT/$label" 2>&1 | grep -E "Total Upload" | sed "s/^/   $label: /" ) || { echo "   $label: dry-run failed" >&2; fail=1; }
}

must_not_carry() { # must_not_carry <label>
  local hits
  hits=$(grep -c -E "resvg|initWasm|\.wasm" "$OUT/$1/index.js" || true)
  if [ "$hits" != "0" ] || ls "$OUT/$1"/*.wasm >/dev/null 2>&1; then
    echo "   ✗ $1 carries the rasterizer ($hits references) — it belongs in apps/brand-assets only" >&2
    fail=1
  else
    echo "   ✓ $1 has no WASM"
  fi
}

must_carry() {
  if ls "$OUT/$1"/*.wasm >/dev/null 2>&1; then
    echo "   ✓ $1 carries the rasterizer"
  else
    echo "   ✗ $1 emitted no .wasm — the share card cannot render" >&2
    fail=1
  fi
}

echo "── bundle guard"
build apps/api api
build apps/tenant-site tenant-site
build apps/brand-assets brand-assets
must_not_carry api
must_not_carry tenant-site
must_carry brand-assets
exit $fail
