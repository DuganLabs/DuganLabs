# CLAUDE.md — PendingBusiness

## Identity

PendingBusiness is Warren's personal treasury OS. It makes idle money earn yield while it waits to be spent, pays bills at the last responsible moment to maximize float, eliminates debt via APR-ordered avalanche, and optimizes W-4 withholding to capture safe-harbor-floored tax float in a HYSA.

This is a one-person tool built for Warren Dugan. Features ship when Warren needs them.

## Constitution

1. **Float is the product** — every dollar should earn yield every day it isn't needed elsewhere.
2. **Pay at the last responsible moment** — `due_date + grace_period_days`, never before.
3. **Avalanche for debt** — highest APR first. Snowball costs real money.
4. **Tax math must be correct** — 2025 IRS brackets, safe harbor rules, FICA caps. No hand-waving.
5. **BaseNative everywhere** — `@basenative/router` on the worker (via `resolveRoute`), `@basenative/runtime` signals + a small `bind*` helper layer on the frontend. No itty-router, no third-party framework.
6. **Minimal build step** — esbuild bundles the site for the `dist/site` ASSETS binding. No dev-server middleware, no SSR template engine yet (blocked on `@basenative/server` 0.4.0 tarball — see Known BN gaps below).
7. **No CSS frameworks** — Custom properties + plain CSS only.
8. **Parameterized SQL only** — Never interpolate user input into SQL strings.
9. **Security first** — Validate all inputs, consistent error envelopes, passkey-only auth via `@basenative/auth-webauthn` (no passwords, no Basic auth).

## Workspace Structure

Nx monorepo, pnpm workspaces.

```
pendingbusiness/
├── apps/site/                       # Frontend (esbuild → dist/site, served by worker ASSETS)
│   ├── src/
│   │   ├── lib/
│   │   │   ├── auth-fetch.ts        # apiFetch with 401-redirect-to-login handling
│   │   │   ├── bind.ts              # bindText / bindAttr / bindHidden / bindList — signal → DOM
│   │   │   └── dialog.ts            # confirmDialog() — @basenative/components renderDialog/renderButton
│   │   ├── main.ts                  # Dashboard (index.html)
│   │   ├── settings.ts              # Plaid creds + bank linking
│   │   ├── account.ts               # Passkey enrollment + per-credential management
│   │   ├── login.ts                 # Passkey login
│   │   ├── welcome.ts               # Multi-tenant onboarding
│   │   ├── *.html                   # Static templates (no SSR yet)
│   │   └── styles.css               # @basenative/components CSS import + --bn-* token bridge + plain CSS
│   └── scripts/build.mjs            # esbuild entry-point + CSS bundler
├── worker/                          # Cloudflare Worker
│   └── src/
│       ├── index.ts                 # Entry — wires createApiRouter to all handlers
│       ├── router.ts                # BN-router-backed HTTP router (resolveRoute + before/finally)
│       ├── env.ts
│       ├── middleware/{auth,security}.ts
│       ├── routes/                  # Plain (Request, Env, ctx, params) handlers
│       ├── auth/                    # @basenative/auth-webauthn adapter + PB stores
│       └── plaid.ts                 # Plaid REST client (per-vertical, locked-in)
├── packages/core/                   # Tax math, FICA, S-Corp, debt avalanche
└── migrations/                      # D1 SQL migrations
```

## Domain Model

### Accounts

Checking, HYSA, credit, investment accounts. HYSA accounts are the float vehicles. Credit/investment accounts can be `is_debt = true`.

### Liabilities

Monthly recurring bills. `due_day` + `grace_period_days` = optimal pay date. Autopay-enabled bills are still tracked for float opportunity.

### Float Ledger

Daily snapshots of total float balance, daily yield, YTD yield, pending liabilities, net available.

### Debt Targets

Per-account payoff strategy config. Priority ordered by APR (avalanche).

### Tax Profile

Filing status, state, dependents, pay frequency, prior year tax, HYSA APY. Single row per user.

### Paychecks

Historical paycheck log: gross, federal/state withholding, FICA, net. Drives the tax projection.

### W-4 Scenarios

What-if scenarios for W-4 configurations: projected withholding, refund/owed, float yield.

## API Endpoints

### Auth (passkey via `@basenative/auth-webauthn`)

- `POST /api/auth/register-options` — start passkey enrollment (handle in body)
- `POST /api/auth/register-verify` — finish passkey enrollment, sets `pb_auth` cookie
- `POST /api/auth/login-options` — start passkey login (optional handle for non-resident-key flows)
- `POST /api/auth/login-verify` — finish passkey login, sets `pb_auth` cookie
- `GET /api/auth/me` — current user (or `{ user: null }`)
- `POST /api/auth/logout` — clear session

All other `/api/*` routes require a valid `pb_auth` cookie. Public exceptions: `/api/health`, `/api/waitlist`, `/api/auth/*`.

### Data (the router in `worker/src/index.ts` is the source of truth)

- `GET /api/situation` — the caller's situation plus the tax projection (marginal, thresholds, S-Corp ladder, Augusta, CTC, SALT)
- `GET/PATCH /api/household` — household profile: monthly living expenses, liquidity floor, kids, Augusta days/rate, S-Corp salary split (`users.*` columns from `0006_household_profile.sql`)
- `GET/POST /api/income-sources`, `PATCH/DELETE /api/income-sources/:id`
- `GET/POST /api/liabilities`, `PATCH/DELETE /api/liabilities/:id`
- `POST /api/scenario` — route one month of cash (`persist: true` to keep it); `GET /api/scenarios`; `DELETE /api/scenarios/:id`
- `GET/POST /api/plaid/credentials`, `POST /api/plaid/link-token`, `POST /api/plaid/exchange`, `GET /api/plaid/accounts`, `POST /api/plaid/sync`

Not built yet (the PRD's float ledger, payments calendar, debt waterfall and W-4 tax engine): nothing under `/api/float`, `/api/payments`, `/api/debt`, `/api/tax` or `/api/paychecks` exists. Trust the router, not this list, before extending anything.

## BaseNative Signal API

BaseNative signals use function-call syntax (not property access):

```javascript
const count = signal(0);
count(); // read — subscribes if inside effect()
count.set(1); // write
count.peek(); // read without subscribing

const doubled = computed(() => count() * 2);
effect(() => console.log(count())); // auto re-runs on change
```

**Note**: This differs from the old custom signal API (`signal.value`). All code uses the BaseNative function-call API.

## Known BN gaps (file upstream)

**Update (refactor/runtime-signals):** all four issues below are fixed upstream as of the 0.6.0 / router 0.4.3 line, and PB now imports `signal`/`computed`/`effect` directly from `@basenative/runtime` everywhere — the local `apps/site/src/signals.ts` shim and its dedicated unit test are deleted. Consumers (`bind.ts`, `main.ts`, `settings.ts`, `account.ts`, `login.ts`, `welcome.ts`, `bind.test.ts`) import from `@basenative/runtime`. Note `dialog.ts` never consumed the shim (it uses `@basenative/components` directly) so it needed no import change.

1. ~~**`@basenative/runtime@0.4.0` published tarball is broken.**~~ **Fixed in 0.6.0.** `src/evaluate.js` / `src/scope.js` now import `./shared/expression.js` from inside the package, and the `"exports"` map gained a `"./shared/expression"` subpath. `apps/site/src/signals.ts` has been deleted — every consumer imports `signal`/`computed`/`effect` directly from `@basenative/runtime` (see note above).
2. ~~**`@basenative/router@0.4.0` types aren't reachable under `moduleResolution: bundler`.**~~ **Fixed in 0.4.3.** The `"."` export entry is now `{ "types": "./types/index.d.ts", "default": "./src/index.js" }`. `worker/src/types/basenative-router.d.ts` has been deleted — verified with `tsc --noEmit` against the real package types.
3. ~~**`@basenative/components@0.5.0`'s published `"exports"` map is missing `./layers.css`.**~~ **Fixed in 0.6.0.** `"./layers.css": "./src/layers.css"` is now in the published map. `apps/site/src/styles.css` imports `@basenative/components/layers.css` directly instead of the `./css` bundled-entry workaround.
4. ~~**`@basenative/components@0.5.0` types aren't reachable under `moduleResolution: bundler`.**~~ **Fixed in 0.6.0.** Same fix shape as #2 — the `"."` export entry is now a `{ types, default }` object. `apps/site/src/types/basenative-components.d.ts` has been deleted — verified with `tsc --noEmit`.

All four were tracked as upstream issues against `DuganLabs/basenative`; close them out when convenient.

## Tax Math References

- IRS Rev. Proc. 2024-40 — 2025 federal brackets and standard deductions
- IRC §3401 — withholding mechanics
- IRC §6654 — underpayment penalty and safe harbor rules
- Safe harbor: withhold ≥ 100% of prior year tax (110% if AGI > $150K), OR ≥ 90% of current year liability
- FICA: SS 6.2% up to $176,100 (2025 wage base); Medicare 1.45% + 0.9% above $200K single/$250K MFJ
- California: FTB Publication 1005 — 2025 CA withholding schedules

## Commit Convention

Conventional Commits. Co-Authored-By line on every commit:

```
Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

## Next Steps for AI / Claude Code Backlog

### 1. Plaid Integration Pipeline **[DOGFOODING REQUIRED]**

We are abandoning manual entry and adopting Plaid for bank syncing. Your first priority is to build this integration.

- **Task A**: Do **NOT** write the Plaid Link wrapper natively in this repo. You must construct `@basenative/integrations/plaid` in the upstream `basenative` monorepo first.
- **Task B**: Once linked, use that package to add POST `/api/plaid/create-link-token` and POST `/api/plaid/exchange-public-token` to the worker. Ensure env vars (PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV) are cleanly handled via `c.env`.
- **Task C**: Implement the frontend view using the BaseNative integration to load the Plaid Link drop-in script.
- **Task D**: Update `worker/schema.sql` to add `plaid_item_id`, `plaid_access_token`, and `plaid_account_id` to the `accounts` table. Then configure a CRON trigger to sync balances and execute auto-pay.

### 2. Tax Engine

After Plaid sync is stable, execute Phase 3 (Tax Engine) in PRD by implementing the `/api/tax/scenarios` route logic according to the 2025 calculation rules.

### 3. S-Corp Optimization Engine [Phase 3] **[DOGFOODING REQUIRED]**

- **Task A**: Dogfooding Check! Verify `@basenative/forms` schema validation is robust enough for complex tax logic. If not, pivot and upgrade it in `basenative` first.
- **Task B**: Construct a multi-step Tax Liability configuration wizard in the UI to manage S-Corp distributions versus W-2 reasonable salary.
- **Task C**: Build the worker API edge-logic for W-2 to S-Corp float impact modeling (`GET /api/tax/scenarios/scorp-transition`).

### 4. Debt Extinction Engine [Phase 4]

- **Task A**: Implement custom payoff matrices (Snowball vs Avalanche) in the D1 schema and worker endpoints (`GET /api/debt/waterfall`).
- **Task B**: Construct the UI dashboard for Debt Extinction, tracking balance transfer opportunity detection and daily interest capitalization.
