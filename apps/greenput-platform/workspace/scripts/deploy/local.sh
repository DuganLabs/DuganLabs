#!/usr/bin/env bash
# Run the production deploy from this machine — the same steps, in the same
# order, from the same Doppler config as .github/workflows/ci.yml's
# deploy-worker and deploy-pages jobs.
#
# WHY THIS EXISTS. GitHub Actions minutes were running out, and the owner's
# rule is that secrets live in Doppler and get dropped into the pipeline where
# needed. Once that is true, "the pipeline" does not have to mean "a GitHub
# runner": `doppler run --` injects the identical environment on a laptop, so
# the deploy can happen from here with no secret ever copied into a shell
# profile or pasted into a dashboard.
#
# Usage:
#   scripts/deploy/local.sh            # everything, production
#   scripts/deploy/local.sh workers    # migrations, seeds, secrets, api + brand + tenant
#   scripts/deploy/local.sh pages      # platform build + Pages + marketing
#   scripts/deploy/local.sh verify     # only the post-deploy hostname check
#
# Prerequisites, checked below: `doppler login` done once on this machine,
# pnpm install done, and the working tree on the commit you mean to ship —
# this refuses to run with uncommitted changes, because a deploy nobody can
# find in git history is how production drifts from main.
#
# What it deliberately does NOT do: the test/lint/build gates that CI runs
# before it will deploy. Those are `pnpm exec nx run-many --target=test` and
# `--target=lint`; run them first. This script is the deploy half only.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

WHAT="${1:-all}"

# ── Preflight ────────────────────────────────────────────────────────────────

if ! command -v doppler >/dev/null 2>&1; then
  if [ -x "$HOME/.local/bin/doppler" ]; then
    export PATH="$HOME/.local/bin:$PATH"
  else
    echo "doppler CLI not found. Install: curl -Ls https://cli.doppler.com/install.sh | sh -s -- --no-package-manager --install-path ~/.local/bin" >&2
    exit 1
  fi
fi

# `doppler me` fails fast when there is no login on this machine.
if ! doppler me >/dev/null 2>&1; then
  echo "Not logged in to Doppler on this machine. Run: doppler login" >&2
  exit 1
fi

# doppler.yaml pins project + config; confirm it resolved to what we expect
# before anything with side effects runs.
if ! doppler secrets --only-names >/dev/null 2>&1; then
  echo "doppler cannot read the greenput/repository config from $REPO_ROOT (see doppler.yaml)." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean. Commit or discard first — a deploy must be a commit." >&2
  git status --short >&2
  exit 1
fi

BRANCH="$(git branch --show-current)"
if [ "$BRANCH" != "main" ]; then
  echo "On branch '$BRANCH', not main. CI only deploys main; this script holds the same line." >&2
  echo "Override by exporting ALLOW_NON_MAIN=1 if you really mean it." >&2
  [ "${ALLOW_NON_MAIN:-}" = "1" ] || exit 1
fi

echo "Deploying $(git rev-parse --short HEAD) ($BRANCH) from Doppler config greenput/repository"
echo

# Everything below runs inside `doppler run`, so CLOUDFLARE_API_TOKEN,
# CLOUDFLARE_ACCOUNT_ID, the Twilio trio and the rest are in the environment
# exactly as they are for the GitHub job — and nowhere else.
run() { doppler run -- "$@"; }

# ── Workers (mirrors ci.yml deploy-worker) ──────────────────────────────────

deploy_workers() {
  echo "── Migrations"
  ( cd apps/api && run ../../scripts/db/migrate.sh greenput --remote )

  echo "── Schema"
  ( cd apps/api && run pnpm exec wrangler d1 execute greenput --file=../../schema.sql --remote )

  echo "── Seed: demo tenant"
  ( cd apps/api && run pnpm exec wrangler d1 execute greenput --file=../../scripts/preview/seed.sql --remote )

  echo "── Seed: global pricing machines"
  ( cd apps/api && run ../../scripts/seed/apply-pricing-fsms.sh greenput --remote )

  echo "── Worker secrets (from Doppler)"
  # Identical `put` to ci.yml. There is no GitHub fallback here because there
  # is no GitHub here; a value that is not in Doppler is skipped, and says so.
  ( cd apps/api && run bash -c '
    put() {
      if [ -n "$2" ]; then
        printf "%s" "$2" | pnpm exec wrangler secret put "$1" 2>/dev/null || true
      else
        echo "skipping $1 — not in Doppler"
      fi
    }
    put CALLS_APP_ID        "${CALLS_APP_ID:-}"
    put CALLS_APP_SECRET    "${CALLS_APP_SECRET:-}"
    put TWILIO_ACCOUNT_SID  "${TWILIO_ACCOUNT_SID:-}"
    put TWILIO_AUTH_TOKEN   "${TWILIO_AUTH_TOKEN:-}"
    put TWILIO_FROM_NUMBER  "${TWILIO_FROM_NUMBER:-}"
    # Stripe: the API key billing.ts/payments.ts call with, and the signing
    # secret POST /api/payments/webhook verifies against. Both from Doppler
    # (greenput/repository); the Worker answers 503 on the billing routes
    # and the webhook until they are set, never a half-configured charge.
    put STRIPE_SECRET_KEY       "${STRIPE_SECRET_KEY:-}"
    put STRIPE_WEBHOOK_SECRET   "${STRIPE_WEBHOOK_SECRET:-}"
    # Publishable key the deposit confirmation page needs. See ci.yml.
    # STRIPE_CONNECT_CLIENT_ID is not pushed: nothing in the Worker reads
    # it (Express account links, not Connect OAuth).
    put STRIPE_PUBLISHABLE_KEY  "${STRIPE_PUBLISHABLE_KEY:-}"
    put ADMIN_SETUP_TOKEN   "${ADMIN_SETUP_TOKEN:-}"
  ' )

  echo "── Deploy API Worker"
  ( cd apps/api && run pnpm exec wrangler deploy )

  echo "── Wildcard tenant DNS"
  run bash -c '
    AUTH="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
    ZONE_ID=$(curl -s -H "${AUTH}" "https://api.cloudflare.com/client/v4/zones?name=greenput.com" \
      | node -e "const d=JSON.parse(require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\")); process.stdout.write((d.result?.[0]||{}).id||\"\")")
    [ -n "$ZONE_ID" ] || { echo "could not resolve the greenput.com zone" >&2; exit 1; }
    ZONE_API="https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records"
    EXISTING=$(curl -s -H "${AUTH}" "${ZONE_API}?name=*.greenput.com" \
      | node -e "const d=JSON.parse(require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\")); process.stdout.write(String((d.result||[]).length))")
    if [ "$EXISTING" != "0" ]; then echo "  ✓ *.greenput.com exists"; exit 0; fi
    curl -s -X POST "${ZONE_API}" -H "${AUTH}" -H "Content-Type: application/json" \
      -d "{\"type\":\"A\",\"name\":\"*.greenput.com\",\"content\":\"192.0.2.1\",\"proxied\":true,\"comment\":\"Wildcard for tenant micro-sites; served by the greenput-tenant Worker route.\"}" \
      | node -e "const d=JSON.parse(require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\")); if(!d.success){console.error(JSON.stringify(d.errors));process.exit(1)} console.log(\"  ✓ created\")"
  '

  echo "── Deploy tenant-site Worker"
  ( cd apps/tenant-site && run npx --no-install wrangler deploy )

  # The share-card rasterizer, on its own hostname (GP-108). Deployed AFTER the
  # tenant Worker so the exact brand.greenput.com/* route it declares is the
  # last word on that hostname, and wrangler's "Worker Startup Time" line is
  # left in the output on purpose — that number is the reason this is a
  # separate Worker.
  echo "── Deploy brand-assets Worker"
  ( cd apps/brand-assets && run npx --no-install wrangler deploy )
}

# ── Pages (mirrors ci.yml deploy-pages) ─────────────────────────────────────

deploy_pages() {
  echo "── Build platform"
  NODE_OPTIONS='--max-old-space-size=4096' pnpm exec nx run platform:build

  echo "── Pages project"
  run pnpm exec wrangler pages project create greenput-app --production-branch=main 2>/dev/null || true

  echo "── _headers / _redirects"
  # Verbatim from ci.yml. If CI's CSP changes, change it here in the same PR —
  # the whole point is that the two paths ship the same bytes.
  cat > dist/apps/platform/_headers <<'HEADERS'
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://api.greenput.com https://api.greenput.site https://greenput-api.greenput.workers.dev wss://api.greenput.com wss://api.greenput.site wss://greenput-api.greenput.workers.dev; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()
  Cross-Origin-Opener-Policy: same-origin
HEADERS
  echo "/* /index.html 200" > dist/apps/platform/_redirects

  echo "── Deploy marketing Worker"
  ( cd apps/marketing && run npx --no-install wrangler deploy )

  echo "── Deploy platform to Pages"
  run pnpm exec wrangler pages deploy dist/apps/platform --project-name=greenput-app --commit-dirty=true

  echo "── Pages custom domain + DNS"
  run bash -c '
    ACCT_API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}"
    AUTH="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
    curl -s -o /dev/null -w "  app.greenput.com → greenput-app: HTTP %{http_code}\n" -X POST "${ACCT_API}/pages/projects/greenput-app/domains" \
      -H "${AUTH}" -H "Content-Type: application/json" -d "{\"name\": \"app.greenput.com\"}"
    ZONE_ID=$(curl -s -H "${AUTH}" "https://api.cloudflare.com/client/v4/zones?name=greenput.com" \
      | node -e "const d=JSON.parse(require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\")); process.stdout.write((d.result?.[0]||{}).id||\"\")")
    [ -n "$ZONE_ID" ] || exit 0
    ZONE_API="https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records"
    EXISTING=$(curl -s -H "${AUTH}" "${ZONE_API}?type=CNAME&name=app.greenput.com" \
      | node -e "const d=JSON.parse(require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\")); process.stdout.write(String((d.result||[]).length))")
    if [ "$EXISTING" != "0" ]; then echo "  ✓ app.greenput.com CNAME exists"; else
      curl -s -X POST "${ZONE_API}" -H "${AUTH}" -H "Content-Type: application/json" \
        -d "{\"type\":\"CNAME\",\"name\":\"app.greenput.com\",\"content\":\"greenput-app.pages.dev\",\"proxied\":true}" >/dev/null && echo "  ✓ created"
    fi
  '
}

# ── Verify (mirrors ci.yml "Verify hostname routing") ───────────────────────

verify() {
  echo "── Verify hostname routing"
  fail=0
  # Polled for up to ~3 minutes, mirroring ci.yml: the deploys above
  # re-assert this zone's routes and Custom Domains, and while those
  # settle a hostname can serve the propagation placeholder or be
  # captured by the tenant wildcard (the same window the og:image check
  # below retries around). On failure, print what was actually served —
  # a check that discards the response can never be diagnosed.
  check() {
    local attempt code
    for attempt in $(seq 1 18); do
      code=$(curl -sS --max-time 20 -H 'User-Agent: greenput-local-deploy' -o /tmp/verify-body -w '%{http_code}' "$1" 2>/tmp/verify-curl-err || true)
      if grep -qF "$2" /tmp/verify-body; then echo "  ✓ $3 (attempt $attempt)"; return 0; fi
      sleep 10
    done
    echo "  ✗ $3 — $1 did not serve what it should after 3 minutes (last HTTP status: ${code:-curl failed})" >&2
    echo "    Last body received (first 300 chars): $(head -c 300 /tmp/verify-body)" >&2
    if [ -s /tmp/verify-curl-err ]; then echo "    curl said: $(cat /tmp/verify-curl-err)" >&2; fi
    fail=1
  }
  # Same rule as ci.yml: www 301/308s to exactly the apex (#245). A tenant
  # page or any other Location still fails. The redirect is not followed.
  check_www() {
    local attempt code location
    for attempt in $(seq 1 18); do
      : > /tmp/verify-headers
      code=$(curl -sS --max-time 20 -H 'User-Agent: greenput-local-deploy' -D /tmp/verify-headers -o /tmp/verify-body -w '%{http_code}' "https://www.greenput.com/" 2>/tmp/verify-curl-err || true)
      location=$(awk 'tolower(substr($0, 1, 9)) == "location:" { sub(/\r/, ""); sub(/^[^:]+:[ \t]*/, ""); sub(/[ \t]+$/, ""); print; exit }' /tmp/verify-headers 2>/dev/null || true)
      if { [ "$code" = "301" ] || [ "$code" = "308" ]; } && [ "$location" = "https://greenput.com/" ]; then
        echo "  ✓ www.greenput.com redirects to the apex (attempt $attempt)"
        return 0
      fi
      sleep 10
    done
    echo "  ✗ www.greenput.com redirects to the apex — https://www.greenput.com/ did not 301/308 to https://greenput.com/ after 3 minutes (last HTTP status: ${code:-curl failed}, Location: '${location:-none}'). The wildcard tenant route may have captured it." >&2
    echo "    Last body received (first 300 chars): $(head -c 300 /tmp/verify-body)" >&2
    if [ -s /tmp/verify-curl-err ]; then echo "    curl said: $(cat /tmp/verify-curl-err)" >&2; fi
    fail=1
  }
  check "https://app.greenput.com/"            'data-bn-app'        "app.greenput.com serves the platform"
  check "https://api.greenput.com/api/health"  '"ok"'               "api.greenput.com serves the API"
  check_www
  check "https://greenput.com/"                'Greenput'           "greenput.com serves marketing"
  check "https://demo.greenput.com/"           'Rivertown Electric' "demo.greenput.com serves its tenant"
  check "https://brand.greenput.com/health"    'greenput-brand'     "brand.greenput.com serves the brand Worker"
  # And the card the demo tenant advertises actually renders: read its og:image
  # URL off the live page and fetch it. Retried, because on the deploy that
  # first CREATED brand.greenput.com the hostname answered its first request
  # with Cloudflare's HTML placeholder while the Custom Domain propagated —
  # seconds later it was a PNG. A new hostname is the only time that happens,
  # but a verify that fails on it teaches nobody anything.
  card=$(curl -sS --max-time 20 "https://demo.greenput.com/" | grep -o 'property="og:image" content="[^"]*"' | head -1 | sed 's/.*content="//; s/"$//')
  ctype=""
  for attempt in 1 2 3 4 5; do
    ctype=$(curl -sS --max-time 30 -o /dev/null -w '%{content_type}' "$card" || true)
    [ "$ctype" = "image/png" ] && break
    sleep 5
  done
  if [ -n "$card" ] && [ "$ctype" = "image/png" ]; then echo "  ✓ demo.greenput.com og:image renders ($card)"; else echo "  ✗ demo.greenput.com og:image did not render as a PNG ($card → $ctype)" >&2; fail=1; fi
  return $fail
}

case "$WHAT" in
  all)     deploy_workers; deploy_pages; verify ;;
  workers) deploy_workers; verify ;;
  pages)   deploy_pages ;;
  verify)  verify ;;
  *) echo "usage: $0 [all|workers|pages|verify]" >&2; exit 2 ;;
esac

echo
echo "Done: $(git rev-parse --short HEAD) is live."
