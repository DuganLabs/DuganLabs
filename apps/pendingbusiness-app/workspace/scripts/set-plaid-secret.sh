#!/usr/bin/env bash
# Put the Plaid key-encryption keys on the pending-business Worker as a runtime
# secret. Run by the owner, by hand, NOT in CI (docs/PLAID-SECRETS.md).
#
#   scripts/set-plaid-secret.sh            # production Worker `pending-business`
#
# Source: Doppler project `pendingbusiness-runtime`, config `prd` (no GitHub
# sync, no service tokens). Auth: your own `doppler login` and `wrangler login`
# sessions. The value is piped straight from Doppler into wrangler; it is never
# printed, written to disk, or placed in this shell's environment.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../worker"
PROJECT="${PLAID_DOPPLER_PROJECT:-pendingbusiness-runtime}"
CONFIG="${PLAID_DOPPLER_CONFIG:-prd}"
NAME=PLAID_CREDENTIALS_KEKS

command -v doppler >/dev/null || { echo "doppler CLI not found" >&2; exit 1; }
if [[ -n "${CI:-}" || -n "${GITHUB_ACTIONS:-}" ]]; then echo "refusing to run in CI" >&2; exit 1; fi
pnpm exec wrangler whoami >/dev/null || { echo "run 'pnpm exec wrangler login' first" >&2; exit 1; }

# Validate shape without printing: JSON object of version -> base64 32-byte key.
doppler secrets get "$NAME" --plain --project "$PROJECT" --config "$CONFIG" | node -e '
  let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
    const o=JSON.parse(d); const ks=Object.keys(o);
    if(!ks.length) throw new Error("no key versions");
    for (const k of ks) if (Buffer.from(o[k],"base64").length!==32) throw new Error("version "+k+" is not a 32-byte key");
    console.error("ok: versions "+ks.join(","));
  });'

doppler secrets get "$NAME" --plain --project "$PROJECT" --config "$CONFIG" \
  | pnpm exec wrangler secret put "$NAME"
echo "set $NAME on the pending-business Worker (value not shown)."
