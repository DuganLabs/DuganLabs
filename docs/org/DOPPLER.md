# Doppler convention

The owner's rule: **secrets live in Doppler and get dropped into the
pipeline where needed, securely.** Nobody runs `wrangler secret put` (or
pastes a value into a dashboard) by hand as a step in shipping a change.

This document is the one place that convention is written down. It applies
to every DuganLabs repo, matching the existing `dl-doppler-setup` skill
(`BaseNative/packages/claude-config/skills/dl-doppler-setup.md`) — this file
doesn't invent a new naming scheme, it's the CI-facing half of that same one.

## Naming

- **Doppler project** = the repo name, lowercased: `t4bs`, `basenative`,
  `warrendugan`, `greenput`, `duganlabs`, `pendingbusiness`.
- **Doppler configs**: `dev`, `stg`, `prd`. CI only ever touches `prd`
  (or `stg` for a repo with a real staging deploy, e.g. GreenPut).
- **GitHub Actions secret**: exactly one per repo, named `DOPPLER_TOKEN` — a
  **read-only service token scoped to that repo's `prd` config**. Never a
  personal token, never a token scoped to more than one config. This is the
  only Cloudflare-adjacent value that should exist as a raw GitHub Actions
  secret once a repo is on Doppler; everything downstream of it (Cloudflare
  API token, account id, per-project extras) lives in Doppler instead.

## What goes in a project's Doppler config

At minimum, whatever `cf-deploy.yml` / `d1-migrate.yml` / `cf-worker-deploy.yml`
need:

| Secret | Used for |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Pages:Edit / Workers:Edit / D1:Edit as needed |
| `CLOUDFLARE_ACCOUNT_ID` | the project's Cloudflare account id |

Plus whatever else that specific project's deploy needs (Plaid keys, Calls
app credentials, R2 keys, etc.) — one Doppler config per project holds
everything that project's pipeline injects, rather than spreading it across
a pile of same-shaped `CLOUDFLARE_API_TOKEN`-named GitHub Actions secrets
across seven repos with no single source of truth.

## How the reusable workflows consume it

`cf-deploy.yml`, `d1-migrate.yml`, and `cf-worker-deploy.yml` (this repo's
`.github/workflows/`) all take the same two-path shape:

```yaml
secrets:
  DOPPLER_TOKEN: ${{ secrets.DOPPLER_TOKEN }}                # preferred
  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}   # fallback
  CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }} # fallback
```

At run time, each build/deploy step does:

```bash
if [ -n "$DOPPLER_TOKEN" ]; then
  doppler run -- <the actual command>
else
  <the actual command>
fi
```

`doppler run --` injects everything in the project's Doppler config into the
command's environment — including `CLOUDFLARE_API_TOKEN` /
`CLOUDFLARE_ACCOUNT_ID`, which is why the fallback secrets of the same name
are silently superseded rather than conflicting. A caller only needs to pass
`DOPPLER_TOKEN` through once Doppler is set up for that project; until then,
passing the two Cloudflare secrets directly keeps the exact same reusable
workflow working unchanged.

**Migrating a repo onto Doppler is therefore a one-secret change**: create
the Doppler service token, `gh secret set DOPPLER_TOKEN --repo DuganLabs/<repo>`,
and (optionally, once confirmed working) `gh secret delete CLOUDFLARE_API_TOKEN`
/ `CLOUDFLARE_ACCOUNT_ID`. No workflow file needs to change.

## Status (2026-09-11)

| Repo | DOPPLER_TOKEN set? | Notes |
|---|---|---|
| t4bs | yes | Only repo fully on Doppler today. |
| BaseNative | no | Fallback (direct CF secrets) via `cf-deploy.yml`. |
| warrendugan | no | Fallback via `cf-worker-deploy.yml`. |
| GreenPut | yes (2026-09-13) | Bespoke pipeline (multi-worker + DNS). `DOPPLER_TOKEN` is a read-only service token scoped to `greenput/repository` (single root config — free tier). The Worker-secrets step runs under `doppler run --`, preferring Doppler and falling back to same-named GitHub secrets; `CLOUDFLARE_*` still read GitHub until that has run clean. `scripts/deploy/local.sh` runs the same deploy from a laptop under the same config. See GreenPut#153. |
| DuganLabs | no | Fallback via `cf-worker-deploy.yml`. |
| PendingBusiness | no | Bespoke pipeline (D1 bootstrap + multi-step); fallback pattern applied to its existing steps directly. |

Creating each remaining repo's Doppler project/config and its `DOPPLER_TOKEN`
service token requires a Doppler account session this automation doesn't
have — that part needs the owner's Doppler login once. Everything else
(workflow wiring, the fallback path, removing manual secret-setting
instructions from docs) is done and does not block on it.
