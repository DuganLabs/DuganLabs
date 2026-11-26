#!/usr/bin/env bash
# Build once for the monorepo deploy (standards/deploy.md): Vite client build plus
# the Pages Functions compiled to an advanced-mode _worker.js directory, so the
# deploy job uploads the same bytes without node_modules.
#   bash apps/t4bs-game/scripts/monorepo-build.sh  ->  dist/apps/t4bs-game/
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
app="$root/apps/t4bs-game"
out="$root/dist/apps/t4bs-game"
cd "$app"
npm run build
rm -rf "$out" && mkdir -p "$out"
cp -R dist/. "$out/"
npx --no-install wrangler pages functions build functions \
  --outdir="$out/_worker.js" \
  --output-routes-path="$out/_routes.json" \
  --build-output-directory="$out"
echo "built $out"
