# Bootstrapping the platform admin

`POST /api/admin/auth/setup` is the only way to create the first row in
`admin_users`, and that row is what `/api/admin/*` — platform metrics, every
workspace, `DELETE /api/admin/workspaces/:id` — authenticates against.

## What it used to be

The route's only guard was `SELECT COUNT(*) FROM admin_users = 0`. On any
environment whose database had never been bootstrapped, the first anonymous
caller to POST `{email, displayName}` became platform admin and was handed a
`gp_admin_session` cookie. There was no rate limiter on the mount either, alone
among the auth mounts.

Staging was live in that state on 2026-09-11: `greenput-api-staging` answered
`{"configured":false}` on `/api/admin/auth/status`, on a public
`*.workers.dev` hostname. Production was closed only by the accident that a row
already existed there. The shared preview Worker resets its database on every
claim, so it was open by design.

## What it is now

Two independent conditions, both enforced server-side:

1. **`ADMIN_SETUP_TOKEN` presented in the `X-Admin-Setup-Token` header** and
   matching the secret on the Worker, compared in constant time
   (`apps/api/src/lib/timing-safe.ts`). The secret must be at least 32
   characters; shorter is treated as absent.
2. **`admin_users` is still empty**, checked by the `WHERE NOT EXISTS` inside
   the `INSERT` rather than by a `SELECT` before it, so two simultaneous
   bootstraps cannot both succeed.

If no usable secret is configured on the Worker, or the presented one is wrong,
the route answers the byte-identical `404 {"error":{"code":"NOT_FOUND",...}}`
that the router returns for a path that was never mounted, and does the same
HMAC work either way — so neither the body nor the timing says whether bootstrap
is available on that host.

The practical effect: **an environment nobody has deliberately given a bootstrap
secret has no bootstrap route.** Preview Workers get no secret pushed, so they
are closed with no further action.

## Provisioning the secret

The secret is a **GitHub Actions secret** named `ADMIN_SETUP_TOKEN`, pushed to
the Worker by CI, exactly like the Twilio and Cloudflare Calls credentials.

> The org's rule is that secrets live in Doppler. The production Worker
> secret push **does** run `doppler run` when `DOPPLER_TOKEN` is set
> (`greenput/repository`). `ADMIN_SETUP_TOKEN` is the exception that stays
> a per-environment GitHub Actions secret: the script reads it as
> `GH_ADMIN_SETUP_TOKEN` and uses that when Doppler has no value. Set a
> different token on the `production` and `staging` GitHub environments.
> See `docs/stripe-twilio-setup.md`.

- `.github/workflows/ci.yml` → `deploy-worker` → "Push Cloudflare Worker
  secrets" (production)
- `.github/workflows/ci.yml` → `deploy-staging` → "Push Cloudflare Worker
  secrets (staging)"

Both use the same `put()` guard: no value configured means the step prints
`skipping ADMIN_SETUP_TOKEN — no value configured` and the Worker keeps no
bootstrap route.

Because each job runs under its own GitHub environment (`production` /
`staging`), `secrets.ADMIN_SETUP_TOKEN` resolves per environment. **Give each
environment a different value.** A token that works on staging must not work on
production.

Never set it with `wrangler secret put` by hand — the next deploy that finds no
value in CI leaves whatever is there, and the repo then has no record of what
the live value is.

## Bootstrapping an environment

```
curl -sS -X POST https://<api host>/api/admin/auth/setup \
  -H 'Content-Type: application/json' \
  -H "X-Admin-Setup-Token: $ADMIN_SETUP_TOKEN" \
  -d '{"email":"you@example.com","displayName":"Your Name"}'
```

`201` returns the new admin and sets `gp_admin_session`, which is valid for one
day — long enough to register a passkey at
`POST /api/admin/auth/webauthn/register/options` + `/verify`. Register one
before the session expires; the passkey is the only way back in afterwards.

`403 ADMIN_EXISTS` means the environment is already bootstrapped. `404` means
either no secret is configured on that Worker or the token is wrong — the route
will not tell you which. Check the deploy log for the `skipping
ADMIN_SETUP_TOKEN` line before assuming the token is at fault.

## Two things deliberately left alone

**`X-Admin-Setup-Token` is not in `Access-Control-Allow-Headers`** (which is
`Content-Type, Authorization` — `apps/api/src/middleware/auth.ts`). A browser
page therefore cannot send it cross-origin; the preflight fails. That is
intentional: bootstrap is a one-time operator action from a terminal, and a
bootstrap secret pasted into a web page is a worse place for it than a shell
history. If an admin UI is ever built and needs this, widening the header is a
one-line change — but consider keeping bootstrap out of the browser instead.

**There is no `development` exemption.** `ENVIRONMENT` is `production` even
under `wrangler dev` (it comes from `[vars]` in `wrangler.toml`), so a bypass
keyed on it would be dead code locally and a live bypass if the var were ever
wrong. To bootstrap a local database, put the token in `apps/api/.dev.vars`
(gitignored):

```
ADMIN_SETUP_TOKEN=any-local-value-at-least-32-characters-long
```

## Rotating it, and after bootstrap

Rotating `ADMIN_SETUP_TOKEN` does not affect existing admins or their passkeys;
it only changes who could bootstrap a database that is still empty. Once an
environment has an admin row, the token grants nothing — condition 2 already
refuses — so the useful window for the secret is exactly the interval between
provisioning a database and registering the first passkey.

There is no admin frontend in this repo (`apps/admin` was deleted on
2026-09-10), so nothing but this runbook calls `/api/admin/auth/setup`.
