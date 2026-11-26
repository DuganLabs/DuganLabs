#!/usr/bin/env bash
# Deploy one app's PREBUILT artifact to one stage. Never builds.
#   tools/deploy/deploy.sh <app> <staging|production> [--dry-run]
# Reads apps/<app>/deploy.json. Needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
# (Doppler duganlabs/repository -> GitHub sync; locally: `doppler run --`).
set -euo pipefail
app="${1:?usage: deploy.sh <app> <stage> [--dry-run]}"
stage="${2:?usage: deploy.sh <app> <stage> [--dry-run]}"
dry="${3:-}"
case "$stage" in staging|production) ;; *) echo "stage must be staging|production" >&2; exit 2 ;; esac
cfg="apps/${app}/deploy.json"
[[ -f "$cfg" ]] || { echo "no $cfg" >&2; exit 2; }

j() { node -e 'const c=require(process.argv[1]);const v=process.argv[2].split(".").reduce((o,k)=>o==null?o:o[k],c);process.stdout.write(v==null?"":String(v))' "./$cfg" "$1"; }

kind=$(j kind)
config=$(j config)
artifact=$(j artifact)
env_name=$(j "stages.${stage}.env")
blocked=$(j "stages.${stage}.blocked")
url=$(j "stages.${stage}.url")

if [[ -n "$blocked" ]]; then
  echo "::notice::skip ${app} ${stage}: ${blocked}"
  exit 0
fi
[[ -e "$artifact" ]] || { echo "artifact $artifact missing: run 'nx run ${app}:build' (CI downloads it)" >&2; exit 1; }

WR=(npx --yes wrangler@4)
if [[ "$dry" == "--dry-run" ]]; then WR=(echo "[dry-run] wrangler"); fi

if [[ "$kind" == "worker" ]]; then
  args=(deploy --no-bundle -c "$config")
  [[ -n "$env_name" ]] && args+=(--env "$env_name")
  "${WR[@]}" "${args[@]}" "$artifact"
elif [[ "$kind" == "pages" ]]; then
  project=$(j "pagesProject.${stage}")
  branch=$([[ "$stage" == production ]] && echo main || echo staging)
  "${WR[@]}" pages deploy "$artifact" --project-name "$project" --branch "$branch" --commit-dirty=true
else
  echo "unknown kind $kind" >&2; exit 2
fi
if [[ "$dry" == "--dry-run" ]]; then echo "(dry-run) would deploy ${app} -> ${stage} ${url}"; exit 0; fi
echo "deployed ${app} -> ${stage} ${url}"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then echo "- **${app}** → ${stage}: ${url}" >> "$GITHUB_STEP_SUMMARY"; fi
