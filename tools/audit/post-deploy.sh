#!/usr/bin/env bash
# One post-deploy audit job: Lighthouse on each deployed app's production URL
# and the paths listed in apps/<app>/deploy.json "lighthouse". Report-only.
#   tools/audit/post-deploy.sh '["greenput","boxsized"]'
set -uo pipefail
apps_json="${1:-[]}"
mkdir -p dist/audit
for app in $(node -e 'for (const a of JSON.parse(process.argv[1])) console.log(a)' "$apps_json"); do
  cfg="apps/${app}/deploy.json"; [[ -f "$cfg" ]] || continue
  read -r base blocked <<<"$(node -e 'const c=require(process.argv[1]);const p=c.stages.production;process.stdout.write((p.url||"")+" "+(p.blocked?"1":""))' "./$cfg")"
  [[ -n "$blocked" || -z "$base" ]] && { echo "skip $app (production blocked or no url)"; continue; }
  for path in $(node -e 'for (const p of (require(process.argv[1]).lighthouse||["/"])) console.log(p)' "./$cfg"); do
    out="dist/audit/${app}$(echo "$path" | tr '/' '_').json"
    npx --yes lighthouse@12 "${base}${path}" --quiet --chrome-flags="--headless=new --no-sandbox" --output=json --output-path="$out" || true
    node -e 'const r=require(process.argv[1]);const s=Object.fromEntries(Object.entries(r.categories).map(([k,v])=>[k,Math.round(v.score*100)]));console.log(process.argv[2],JSON.stringify(s))' "./$out" "${app}${path}" | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
  done
done
