# PendingBusiness — Product Requirements Document

> Status: **stub** · Owner: Warren Dugan · Last updated: 2026-04-26
> Visibility: **private** today; planned to open-source later.
>
> This is a placeholder. Run `bn prd init` (once the BaseNative CLI lands `bn prd`) to scaffold an interactive build-out.

## 1. Overview

PendingBusiness is a proprietary DuganLabs project (formerly known as YieldPay — that name is dead). Live at pendingbusiness.com. Details to be filled in via `bn prd init`.

## 2. Goals
- TBD

## Non-goals
- TBD

## 3. Users
- TBD

## 4. Key flows
- TBD

## 5. Data model
- TBD

## 6. Design principles
Inherit from BaseNative defaults unless explicitly overridden.

## 7. Architecture

### Today
- **Auth**: passkey (WebAuthn) login via [`@basenative/auth-webauthn`](https://github.com/DuganLabs/basenative/tree/main/packages/auth-webauthn). Sessions stored in D1 (`user_sessions`), 30-day TTL, opaque random token in an `HttpOnly; Secure; SameSite=Lax` cookie (`pb_auth`). Admin role seeded from `ADMIN_HANDLES` in `worker/wrangler.toml` `[vars]`. Custom store layer (`worker/src/auth/stores.ts`) bridges PB's INTEGER user IDs to the package's TEXT-id contract.
- **Worker**: BaseNative-native HTTP routing on Cloudflare Workers — `worker/src/router.ts` is a thin layer over `@basenative/router`'s server-safe `resolveRoute`, with `requireAuth` as a `before` hook and security headers applied as a `finally` hook. Static assets served from `dist/site` via the `ASSETS` binding.
- **DB**: Cloudflare D1, migrations in `migrations/` (0001 init, 0002 Warren seed, 0003 Plaid, 0004 webauthn).
- **Frontend**: signal-driven (`@basenative/runtime`-style) TS bundled by esbuild. Each page declares state signals at the top, then `bind*` helpers in `apps/site/src/lib/bind.ts` wire them to the DOM via effects. Plaid Link still loads from the cdn.plaid.com drop-in (per-vertical Plaid logic is locked-in until `@basenative/integrations/plaid` lands upstream).

### Target
- **Auth**: stay on `@basenative/auth-webauthn`. Once stable, expose passkey management (rename, revoke per credential) on `/account.html`.
- **Lint/TS**: `@basenative/eslint-config` + `@basenative/tsconfig`.
- **Deploy**: `DuganLabs/.github/.github/workflows/cf-deploy.yml@v1` via Doppler.
- **Wrangler**: `@basenative/wrangler-preset` (pinned version).

## 8. Milestones
- M0 — PRD build-out
- M1 — **Auth swap to `@basenative/auth-webauthn`** ✅ landed (2026-04-26)
- M1.5 — **Worker + site migrate to BaseNative runtime** ✅ landed (2026-04-26): `@basenative/router` + signal-driven `bind*` helpers replace itty-router and vanilla DOM manipulation respectively.
- M2 — Adopt BaseNative shared configs (`@basenative/eslint-config`, `@basenative/tsconfig`, `@basenative/wrangler-preset`).
- M3 — Re-introduce SSR via `@basenative/server` once its 0.4.0 tarball is fixed (currently ships a broken transitive import to `../../../src/shared/expression.js`).
- M4 — Open-source the repo.

## 9. Open questions
- Timeline for open-sourcing.
- Multi-tenant onboarding: when PB grows past one user, the create-on-register codepath in `worker/src/auth/stores.ts#pbUsers.create` needs a real onboarding flow (capture email/filing_status/state, not the placeholder values it uses today).
- Per-credential management UI on `/account.html` (list, rename, revoke individual passkeys).

## 10. Glossary
- TBD
