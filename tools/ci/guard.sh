#!/usr/bin/env bash
# Public-repo guards. Runs in CI (verify job) and locally: `bash tools/ci/guard.sh`.
# Fails on anything that must never be in this PUBLIC repo or its CI:
#   1. Plaid credentials in CI/deploy paths. PLAID_* secrets reach the
#      PendingBusiness Worker only as Cloudflare runtime secrets set outside CI
#      (docs/PLAID-SECRETS.md). CI must never reference them.
#   2. Tracked local secret files (.dev.vars, .env, keys, wrangler state).
#   3. Real email addresses in app config (consent and Access use none; the
#      owner email lives only in Cloudflare Access policy + Worker secrets).
set -euo pipefail
fail=0
err() { echo "::error::$*"; fail=1; }

# 1. No Plaid secret names in workflows, deploy tooling, or app deploy config.
if hits=$(git grep -nI -E 'PLAID_[A-Z_]+' -- .github tools/deploy tools/audit 'apps/*/deploy.json' 'apps/*/wrangler.toml' 2>/dev/null); then
  err "PLAID_* referenced in CI/deploy paths (must stay runtime-only, see docs/PLAID-SECRETS.md):"; echo "$hits"
fi

# 2. No tracked secret/state files.
if bad=$(git ls-files | grep -E '(^|/)(\.dev\.vars|\.env(\..*)?|.*\.pem|.*\.key|id_rsa.*|\.npmrc\.local)$|(^|/)\.wrangler/' | grep -v -E '\.env\.example$'); then
  err "secret/state files are tracked:"; echo "$bad"
fi

# 3. No real email addresses in app config.
allow='you@(example|company)\.com|@example\.(com|org|net)'
if em=$(git grep -nI -E '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}' -- 'apps/*/content.json' 'apps/*/wrangler.toml' 'apps/*/deploy.json' 'apps/*/*/wrangler.toml' | grep -v -E "$allow"); then
  err "email address in app config (public repo: use secrets / Access policy):"; echo "$em"
fi

# 4. No personal mailbox addresses anywhere in tracked files (any provider that is a
#    personal inbox). Placeholders on example domains are fine.
personal='@(gmail|googlemail|outlook|hotmail|icloud|yahoo|proton|protonmail|pm\.me)\.(com|me)|warren@gr''eenput\.com'
if pe=$(git grep -nI -i -E "[A-Za-z0-9._%+-]+($personal)" -- . ':!pnpm-lock.yaml' ':!tools/ci/guard.sh'); then
  err "personal email address in tracked files:"; echo "$pe"
fi

# 5. The head commit must be authored and committed under a GitHub noreply identity
#    (no personal address in public commit metadata; also keeps Nx Cloud at one contributor).
#    On pull_request runs the checkout is GitHub's synthetic merge commit, whose author is
#    GitHub's choice, so CI passes the real PR head in GUARD_COMMIT_SHA.
sha="${GUARD_COMMIT_SHA:-HEAD}"
if git rev-parse --verify -q "${sha}^{commit}" >/dev/null; then
  for e in $(git log -1 --format='%ae %ce' "$sha"); do
    [[ "$e" == *noreply* ]] || err "commit identity '$e' ($sha) is not a GitHub noreply address (git config user.email 23459839+warrendugan@users.noreply.github.com; GitHub Settings -> Emails -> Keep my email addresses private)"
  done
fi

[[ $fail -eq 0 ]] && echo "guard: ok"
exit $fail
