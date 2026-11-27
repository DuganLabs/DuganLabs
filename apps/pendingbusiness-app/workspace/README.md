> **Archived 2026-11-26.** The public pendingbusiness.com is now the DuganLabs coming-soon page, built from [DuganLabs/public](https://github.com/DuganLabs/public) (`apps/pendingbusiness`). This app still runs, unchanged, at **private.pendingbusiness.com** behind Cloudflare Access (owner only). To change it, unarchive this repo first. Plaid key handling: `docs/PLAID-SECRETS.md`.

# PendingBusiness

Sovereign financial OS — float capture, last-responsible-moment payments, deterministic cash routing. Member-funded non-profit. Private beta.

Lives at <https://pendingbusiness.com>.

## Stack

- Cloudflare Workers + D1
- pnpm + Nx monorepo, strict TypeScript 5.9
- BaseNative everywhere: `@basenative/router` (`resolveRoute`) on the worker, `@basenative/runtime` signals on the frontend (with a local shim until upstream tarball fix — see [CLAUDE.md](CLAUDE.md) "Known BN gaps")
- `@basenative/auth-webauthn` for passkey auth
- Vitest for the worker, esbuild for the site bundle

## Layout

```
apps/site/          # signal-driven frontend — dashboard, settings, account, login, welcome
worker/             # API worker (BN-router-backed) + static-asset catch-all to dist/site
packages/core/      # @pendingbusiness/core — pure TS financial engine + vitest
migrations/         # D1 schema + Warren seed (wrangler d1 migrations)
```

## Develop

```bash
pnpm install
pnpm nx run-many --target=typecheck
pnpm nx run-many --target=test
pnpm nx run site:build
pnpm nx run worker:dev        # wrangler dev on :8787
```

## Deploy

Push to `main`. CI ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) runs typecheck + test + build + deploys Worker (+ bootstraps D1 on first run).

Required GitHub Actions secrets:
- `CLOUDFLARE_API_TOKEN` — Workers Scripts: Edit, D1: Edit, Workers Routes: Edit
- `CLOUDFLARE_ACCOUNT_ID`

## Auth

Passkey (WebAuthn) login via [`@basenative/auth-webauthn`](https://github.com/DuganLabs/basenative/tree/main/packages/auth-webauthn). All `/api/*` routes are gated except `/api/health`, `/api/waitlist`, and the passkey ceremony itself (`/api/auth/*`).

Set up a passkey from `/account.html` once per device. Sessions live for 30 days in an `HttpOnly; Secure; SameSite=Lax` cookie (`pb_auth`). Admin handles are seeded from `ADMIN_HANDLES` in [worker/wrangler.toml](worker/wrangler.toml) on login.

## Constitution

See [CLAUDE.md](CLAUDE.md).
