# CLAUDE.md — Greenput

> This file is the **single source of truth** that tells Claude Code (and
> every other LLM-powered tool) what Greenput is, how the codebase is
> organised, what to build, and how to build it.

---

## 1. IDENTITY

| Field        | Value                                                            |
| ------------ | ---------------------------------------------------------------- |
| Product name | **Greenput**                                                     |
| Tagline      | _CRM & marketing automation for residential service contractors_ |
| Domain       | `greenput.com`                                                   |
| Preview env  | `*.greenput.site`                                                |
| Repo root    | `greenput/` (Nx monorepo)                                        |

Greenput helps electricians, plumbers, HVAC techs, and other home-service
professionals manage leads, convert opportunities, schedule jobs, track
revenue, and run hyper-local marketing campaigns — all from one dashboard.

---

## 2. CONSTITUTION (non-negotiable rules)

1. **TypeScript everywhere.** Every file that can be `.ts` or `.tsx` must be.
2. **Strict mode.** `"strict": true` in every `tsconfig`.
3. **No `any`.** Use `unknown` + type narrowing instead. The only exception is
   third-party type gaps documented with `// eslint-disable-next-line
@typescript-eslint/no-explicit-any`.
4. **Shared types live in `libs/shared/models`.** Never duplicate an
   interface — import it.
5. **Single-responsibility routes.** One BaseNative route per folder, one
   route handler per file.
6. **Signal-based state.** Use `@basenative/runtime` `signal()` /
   `computed()` / `effect()`. No NgRx, no BehaviorSubject stores, no
   global state singletons — wire dependencies through `PlatformDeps`.
7. **No CSS classes.** All styling hooks are `data-bn-*` attributes on
   semantic HTML, with adopted stylesheets and CSS custom properties.
8. **Tests are mandatory.** Every new file gets a co-located `.spec.ts`.
   Use Vitest + happy-dom for unit tests, Playwright for E2E.
9. **No barrel-file re-exports deeper than one level.** `libs/shared/models/src/index.ts` is fine; `libs/shared/index.ts` that re-exports models _and_ utils is not.
10. **Commit messages follow Conventional Commits.**
    `feat(leads): add bulk-import endpoint`
11. **No secrets in code.** Use `wrangler secret`, environment variables, or
    Cloudflare KV. Never hard-code keys.
12. **SQL via D1 bindings only.** All queries go through `env.DB.prepare()`.
    No ORMs, no query builders.
13. **Every API response uses the `ApiResponse<T>` / `ApiError` envelope**
    defined in `libs/shared/models`.
14. **Mobile-first CSS.** Default styles target small screens; add
    `@media (min-width: …)` for larger.
15. **Accessibility baseline.** Every interactive element must be keyboard-
    reachable and have an accessible label.

---

## 3. SUBDOMAIN TOPOLOGY

```
greenput.com              → apps/marketing   → Marketing / landing pages
app.greenput.com          → apps/platform    → Contractor SPA (BaseNative)
api.greenput.com          → apps/api         → Cloudflare Workers API
brand.greenput.com        → apps/brand-assets → Share card + mark PNGs (the one Worker with the rasterizer)
<slug>.greenput.com       → apps/tenant-site → Public micro-site per contractor
```

Preview deploys (Cloudflare Pages / Workers):

```
*.greenput.site           → same mapping, staging environment
```

### 3.1 CI Preview Environment (manual, shared — read before touching `scripts/preview/`)

There is exactly **one** preview environment, shared across the whole repo,
manually claimed by a PR. There is no more automatic per-PR preview — the
old scheme (a fresh D1 database + KV namespace + three Workers created for
every PR, deleted on close) blew through the Cloudflare account's
**10-database D1 cap** and broke CI for an unrelated PR. See
`.github/workflows/preview-env.yml` and `scripts/preview/setup.sh` for the
implementation.

**Fixed resources** (created once, on whichever claim happens to be first;
never deleted, never duplicated):

| Resource           | Name                                                                        |
| ------------------ | --------------------------------------------------------------------------- |
| D1 database        | `greenput-preview`                                                          |
| KV namespace       | `greenput-sessions-preview`                                                 |
| API Worker         | `greenput-api-preview`                                                      |
| Tenant-site Worker | `greenput-tenant-preview`                                                   |
| Marketing Worker   | `greenput-marketing-preview`                                                |
| Pages (platform)   | `greenput-app` project, `preview` branch → `preview.greenput-app.pages.dev` |
| R2 bucket          | `greenput-files-preview`                                                    |

**To claim it for your PR:** add the `preview` label to the PR (one click
from the PR page's Labels menu). This resets the shared database (schema +
seed data — any previous claimant's data is gone), deploys your PR's build
to the fixed Workers/Pages above, and comments the URLs on your PR
(updating the same comment on every subsequent claim/release rather than
piling up new ones).

**Fallback (label event didn't fire, or you want to force a redeploy):**
Actions tab → "Shared Preview Environment" → Run workflow → enter your PR
number. This also adds the `preview` label to your PR so the lease state
stays consistent.

**Only one PR may hold it at a time.** If another open PR already carries
the `preview` label, your claim fails fast and comments on your PR naming
that PR — remove the label from that PR first, then retry.

**To release it:** remove the `preview` label, or close/merge the PR. This
only frees the lease (comments that it's free) — it never deletes the
fixed resources.

**To refresh after pushing new commits while you hold the lease:** remove
and re-add the `preview` label, or re-run the workflow via
`workflow_dispatch` with your PR number. Pushing new commits alone does not
redeploy the held preview.

`scripts/preview/sweep.sh` (scheduled weekly by `preview-cleanup.yml`, plus
`workflow_dispatch`) still exists, but only to reclaim orphans left by the
OLD per-PR scheme (`greenput-preview-N`, `greenput-{api,tenant}-preview-N`,
`greenput-marketing-pr-N`, `greenput-sessions-preview-N`). It can never
match the fixed names above, by construction, and never deletes them.

---

## 4. WORKSPACE STRUCTURE

```
greenput/
├── apps/
│   ├── api/              # Cloudflare Worker — itty-router REST API
│   │   ├── src/
│   │   │   ├── index.ts          # Worker entry, router setup
│   │   │   ├── env.ts            # Env interface (D1, KV bindings)
│   │   │   ├── lib/              # Response helpers, ID generation
│   │   │   ├── middleware/       # Auth (session cookie), CORS, security headers
│   │   │   ├── modules/          # Business logic (future)
│   │   │   └── routes/           # Route handlers (auth, leads, dashboard …)
│   │   ├── wrangler.toml
│   │   └── package.json
│   ├── platform/         # BaseNative SPA — the main contractor dashboard
│   │   ├── index.html            # Shell with <div data-bn-app>
│   │   ├── vite.config.ts        # Vite dev + build config
│   │   ├── vitest.config.ts      # Vitest unit-test config
│   │   ├── project.json          # Nx targets: dev, build, test, lint
│   │   └── src/
│   │       ├── main.ts           # Composition root
│   │       ├── deps.ts           # Wires API + auth + router
│   │       ├── api/              # One file per resource — typed factories
│   │       ├── auth/             # @basenative/auth-webauthn glue
│   │       ├── routes/           # One folder per route, each exports
│   │       │   │                 # render(deps): RouteView
│   │       │   ├── shared/       # Reusable panel + helpers
│   │       │   └── …
│   │       ├── shell/            # Header / nav / outlet + nav-items.ts
│   │       ├── styles/           # Adopted stylesheets (tokens + list-route)
│   │       ├── lib/              # DOM + format helpers
│   │       └── test/             # Test helper (createFakeFetch, buildTestDeps)
│   ├── marketing/        # Landing pages / public site
│   ├── brand-assets/     # brand.greenput.com — share card + mark PNGs; the ONLY
│   │                     # Worker that carries @basenative/og-image (resvg WASM)
│   └── tenant-site/      # Per-contractor public micro-site
├── libs/
│   ├── shared/
│   │   ├── models/       # Domain interfaces (the canonical types)
│   │   ├── validators/   # Zod schemas (shared FE ↔ BE validation)
│   │   ├── scheduling/   # Pure slot generation (GP-102): opening hours minus booked jobs → bookable times
│   │   └── utils/        # Pure utility functions
│   ├── basenative/       # GreenPut-side BaseNative glue. The published
│   │   │                 # @basenative/{runtime,router,server,components,fetch}
│   │   │                 # packages come from GitHub Packages (see .npmrc).
│   │   │                 # router-guards and the runtime type augmentation
│   │   │                 # that used to live here were upstreamed — routing
│   │   │                 # guards ship as @basenative/router/guards (0.5.0)
│   │   │                 # and @basenative/runtime (0.6.2) now declares
│   │   │                 # `raw`/`RawHtml` and the `shared/*` subpaths
│   │   │                 # itself. `fetch` shrank the same way (0.4.0, see
│   │   │                 # below) — only auth-webauthn is still fully local:
│   │   │                 # it wraps the GreenPut passkey client, which has
│   │   │                 # no upstream package to move to.
│   │   ├── fetch/        #  Only `resolveGreenPutApiBase` (API-base-URL
│   │   │                 #  resolution by hostname) and the signal-based
│   │   │                 #  `createResource` are still GreenPut's own —
│   │   │                 #  neither went upstream. Everything else
│   │   │                 #  (createApiClient, ApiClient, ApiError, the
│   │   │                 #  envelope/query helpers) is re-exported from the
│   │   │                 #  published `@basenative/fetch` (0.4.0). The
│   │   │                 #  workspace alias `@basenative/fetch` still points
│   │   │                 #  here (`tsconfig.json` paths, plus the Vite
│   │   │                 #  `resolve.alias` in apps/platform and
│   │   │                 #  auth-webauthn's vitest configs) so every import
│   │   │                 #  site keeps working unchanged; the re-export
│   │   │                 #  itself reaches the real package through the
│   │   │                 #  `basenative-fetch-upstream` dependency (an
│   │   │                 #  `npm:@basenative/fetch@0.4.0` alias in the root
│   │   │                 #  package.json) instead of the bare
│   │   │                 #  `@basenative/fetch` specifier, since that would
│   │   │                 #  resolve back to this same file. One installed
│   │   │                 #  copy, reached under two names — see
│   │   │                 #  `libs/basenative/fetch/src/index.ts`.
│   │   └── auth-webauthn/#  GreenPut passkey client + AuthStore — aliased as
│   │                     #  @basenative/auth-webauthn, likewise GreenPut-owned
├── contracts/            # Pact contract tests
├── e2e/                  # Playwright E2E tests
├── mocks/                # MSW mock handlers
├── public/               # Static assets & MSW service worker
├── schema.sql            # Cloudflare D1 schema (SQLite)
├── scripts/              # Tooling scripts
├── nx.json
├── pnpm-workspace.yaml
├── tsconfig.json
└── package.json
```

### 4.1 Workspace notes

- bumped `@basenative/components` 0.7.0 → 0.11.0 on 2026-09-14 (the only
  one of the three BaseNative releases that day GreenPut depends on;
  `@basenative/theme` 0.3.0 and `@basenative/builder` 0.2.0 are not used —
  the `--bn-*` bridge in `apps/platform/src/styles/tokens.ts` still covers
  every token the components consume, the new `--bn-color-control-selected`
  pair falls back to the bridged accent scale). Behaviour change to know
  about: `initCalendarDragDrop` and `initPipelineDragDrop` now move things by
  select-then-place as well as by drag — a plain click (or Enter/Space) on a
  calendar event, sidebar `renderPipelineBlock` or kanban card PICKS IT UP
  (`data-picked`; a second click on it, or Escape, cancels), a click on a
  slot / column drops it, arrow keys walk the target, and a polite live
  region narrates. The calendar (`routes/jobs`) had nothing to fight it —
  events and blocks carry no click of their own — so nothing changed
  there. The kanbans (`routes/opportunities`, `routes/leads`) did: the
  component decides "picked up" from `closest('[data-card-id]')`, so a
  click or Enter on a card's Convert/Qualify button would have picked the
  card up and Enter would have been default-prevented, leaving the button
  keyboard-unreachable. `routes/shared/pipeline.ts` therefore stops
  `click`/`keydown` bubbling out of `[data-bn="pipeline-card-actions"]`
  (Escape excepted) and `onCardAction` listens in the capture phase, so
  click = pick on the card body and click = action on its buttons. The
  hand-rolled "Move to" `<select>` (`moveOptions`, `onCardMoveSelect`) that
  was GreenPut's keyboard/touch alternative to dragging is deleted — the
  component's path replaces it. Pipeline cards still carry no detail link
  (GP-003 links live in the list-view title column), so there is no
  click-vs-navigate conflict to resolve; if a card ever gets an "Open"
  link, put it in the actions slot, never on the card body. Calendar events
  now sit on integer subgrid rows with `--bn-calendar-event-lead/-trail`
  offsets and hour labels/slots are numbered from row 1 — nothing in
  GreenPut pinned the old `grid-row` values. `components` 0.11.0 pulls
  `@basenative/runtime` 0.6.3 while the root still pins 0.6.2, so the
  lockfile holds both until the runtime/server bump.
- shrank `libs/basenative/fetch` on 2026-09-10, once `@basenative/fetch`
  0.4.0 published the `createApiClient`/`ApiClient`/`ApiError`/envelope/query
  layer GreenPut had been carrying locally (BaseNative PR #180, dogfooding
  the client GreenPut needed). `client.ts`, `api-error.ts`, `envelope.ts`,
  and `query.ts` (plus their specs) were deleted; `libs/basenative/fetch`
  now keeps only `resolveGreenPutApiBase` and the signal-based
  `createResource`, and re-exports the rest of the published package from
  `src/index.ts`. The `@basenative/fetch` alias (tsconfig `paths`, and the
  Vite `resolve.alias` in `apps/platform` and `auth-webauthn`'s vitest
  configs) still points at this local file, so none of the ~35 import sites
  across `apps/platform` and `libs/basenative/auth-webauthn` needed to
  change — only `auth-webauthn`'s `auth-store.ts`/`webauthn-client.ts` (and
  their specs), which reached into `libs/basenative/fetch/src/{client,
api-error}.ts` by relative path instead of the alias, were repointed at
  `@basenative/fetch` now that those files are gone. The published package's
  API deliberately differs from the old local one in a few spots that turned
  out not to matter to any GreenPut call site: positional verb signatures,
  `headers` instead of `defaultHeaders`, no `RequestContext.attempt`, sorted
  query keys, and 2xx bodies shaped like an error envelope now throwing.
- removed `worker/` on 2026-09-10: the original itty-router API scaffold
  (auth, leads, dashboard, jobs, customers, campaigns, opportunities
  routes; `wrangler.toml` name `greenput-api`, same as `apps/api`). CI was
  already repointed from `worker/` to `apps/api` back in March 2026
  (`fix(ci): point pipeline deployment to apps/api instead of stale
worker/`); `apps/api` has since grown a full superset of its routes plus
  billing, chat, webhooks, admin, and more. `worker/` had no Nx
  `project.json`, no tests, and was never deployed or referenced outside
  its own directory. Superseded by `apps/api`; restore from git `c288a34`.
- removed `apps/customer-portal` on 2026-09-10: a standalone Cloudflare
  Worker serving a server-rendered customer self-service portal
  (magic-link login, jobs, estimates, invoices) added in Phase 4-5
  (`feat: Phase 4-5 — audit trail, reports, PWA, customer portal, plan
limits`). Its functionality is covered by `apps/api`'s `portalRouter`
  (`src/routes/customer-portal.ts`, mounted at `/api/portal` in
  `apps/api/src/index.ts`), which implements the same
  magic-link/verify/jobs/estimates/invoices flow as part of the deployed
  API worker. `apps/customer-portal` was never in any CI lint, build, or
  deploy job (only its Nx `test` target ran, implicitly, via
  `nx run-many`'s default project sweep), has no custom domain or route
  of its own, and neither `greenput-customer-portal.workers.dev` nor
  `portal.greenput.com` resolve. Superseded by `apps/api`; restore from
  git `c288a34`.
- removed `apps/admin` and `libs/ui` on 2026-09-10: the original Angular
  admin dashboard (login, activity/metrics/users/workspaces features,
  `@angular/build`-based `project.json`) and its shared `@greenput/ui`
  component library (confirm-dialog, data-table, empty-state, form-field,
  stats-card), both left over from before the Angular → BaseNative
  migration. Neither could build once `@angular/build` was dropped from
  devDependencies, and both had been excluded from the unit-test matrix
  (`nx run-many --target=test --exclude=admin,ui,greenput`) ever since; the
  exclusion is now just `--exclude=greenput`. The `@greenput/ui` path alias
  is removed from the root `tsconfig.json`; neither directory was ever
  listed in `pnpm-workspace.yaml` (only `.` and `apps/api` are pnpm
  packages there) or in `nx.json`, so no change was needed in either. The
  admin CI lint step and the `apps/admin`/`libs/ui` build-skip NOTE are
  removed from `.github/workflows/ci.yml`; the production
  "Configure Pages custom domains and DNS" step no longer registers the
  `greenput-admin` Pages project or the `admin.greenput.com` CNAME (it never
  had a matching deploy step — nothing has built or deployed `apps/admin`
  from CI). No `apps/api` route was touched: `apps/api/src/routes/admin.ts`
  and its `admin.greenput.com` / `greenput-admin.pages.dev` CORS/WebAuthn-RP
  entries in `apps/api/src/middleware/auth.ts` are a live, tested,
  independently-deployed part of the API and are out of scope here — flagged
  separately as a possible follow-up now that no frontend serves that
  origin. The Cloudflare Pages project `greenput-admin` and the
  `admin.greenput.com` DNS record, if the CI step above ever created them,
  still exist in the account; deleting them is a manual owner action, not
  done here. Restore from git `789c719`.

### 4.2 Infrastructure

Terraform (`infra/`, `.github/workflows/terraform.yml`) was retired 2026-09-10 —
org-wide decision, retired everywhere as a control plane. CI + `wrangler` are now the
only source of truth for provisioning. The R2 state bucket (`greenput-tf`) still exists
but is no longer used by anything in this repo; it's on the owner's cleanup list, not
deleted by this change.

| Resource                                                                                                 | Defined in                                                                                                                    |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| D1 `greenput` (binding `DB`)                                                                             | `apps/api/wrangler.toml`, `apps/tenant-site/wrangler.toml`, `apps/marketing/wrangler.toml`, `apps/brand-assets/wrangler.toml` |
| KV `greenput-sessions` (binding `SESSIONS`)                                                              | `apps/api/wrangler.toml`                                                                                                      |
| Worker `greenput-api` + custom domain `api.greenput.com`                                                 | `apps/api/wrangler.toml` (`[[routes]]`)                                                                                       |
| Worker `greenput-marketing` + routes `greenput.com/*`, `www.greenput.com/*`                              | `apps/marketing/wrangler.toml`                                                                                                |
| Worker `greenput-tenant`                                                                                 | `apps/tenant-site/wrangler.toml` (deploy only — see gap below)                                                                |
| Worker `greenput-brand` + custom domain `brand.greenput.com` + exact route `brand.greenput.com/*`        | `apps/brand-assets/wrangler.toml` (`[[routes]]`, both — a Custom Domain alone loses to the tenant wildcard, #159)             |
| Pages `greenput-app` (platform), `greenput-admin`                                                        | `wrangler pages deploy --project-name=…` in `.github/workflows/ci.yml`; Pages projects have no wrangler.toml                  |
| R2 `greenput-files` (binding `FILES` in the API, `INTAKE_PHOTOS` in tenant-site — one bucket, two names) | `apps/api/wrangler.toml`, `apps/tenant-site/wrangler.toml`                                                                    |

**Gap, not fixed here:** the `*.greenput.com` wildcard route to `greenput-tenant`, the
apex/`www` A records, and the `admin.greenput.com`/`app.greenput.com` Pages
custom-domain attachments were Terraform-managed (`infra/tenant.tf`, `infra/dns.tf`,
`infra/pages.tf`, all now deleted) and aren't defined anywhere in CI/wrangler. They keep
working because the Cloudflare-side resource already exists, but nothing here recreates
them if they're ever removed — flagging for the owner, not addressed by this change.

---

## 5. DOMAIN MODEL

All canonical TypeScript interfaces live in
`libs/shared/models/src/index.ts`. The database schema lives in `schema.sql`.

### 5.0 The wire contract — how a row becomes a response

`libs/shared/models/src/wire.ts` holds ONE machine-readable table saying, for
every entity the API hands out, which D1 column each model field comes from and
what type it has. Three things are driven off it:

1. **apps/api serializes every list and detail response through it**
   (`apps/api/src/lib/serialize.ts` — `entity()` / `entityList()`). No route
   maps a column name itself and no route answers `data: rows.results`. The
   body is exactly the declared model: extra columns are dropped, a NULL in an
   optional field omits the key, and `workspaces.stripe_customer_id` and
   `webhooks.secret` stop riding along in a list.
2. **`checkWire` validates a real response body against it**, so
   `apps/api/src/routes/wire-contract.spec.ts` can drive every endpoint over a
   real SQLite database built from `schema.sql` and assert on the bytes.
3. **`wire.spec.ts` checks the table against the database**: every column it
   names must exist on the table it names, and every closed value set
   (`libs/shared/models/src/enums.ts`) must match that column's CHECK
   constraint.

`apps/platform/src/contract/reads-the-real-api.spec.ts` closes the loop from
the other side: the real Worker routers answer real requests over a real
database, and the platform's own renderers are asserted against those bytes.
`e2e/fixtures/api-shapes.ts` builds every e2e fixture from a snake_case ROW
through the same serializer, so a fixture cannot be in a shape the API does not
produce.

To add a field to a model: add it to the interface, add it to the entity in
`wire.ts`, and add it to that entity's sample in `wire.spec.ts`. All three are
required — the sample is typed `Required<Model>` (so `tsc`, which
`shared-models:test` runs before vitest, demands the field) and is checked with
`checkWire` (so an unmapped field fails as an unexpected key).

### 5.0.1 MONEY: every amount column is integer cents

The canonical unit for every amount, in the database and on the wire, is
**integer minor units (US cents)**. `kind: 'cents'` marks each one; `toWire`
rounds to a whole cent and `checkWire` rejects a fractional value. Three
amounts are deliberately not cents and say so in their own names:
`lead_meter_events.price_usd` (whole dollars — Greenput's own per-lead fee),
`estimates.tax_rate`, which is a PERCENTAGE (8.25 means 8.25%), not an amount,
and `workspaces.usage_balance_micro_usd` plus `workspace_usage_ledger.amount_micro_usd`
(micro-USD, 1 USD = 1_000_000 — a US SMS segment is $0.0083, which cents
cannot represent). The SMS top-up and its threshold are cents, because they
are Stripe charges.

It used to mean three things at once: apps/platform divided by 100,
`apps/api/src/lib/pdf/invoice.ts` and `apps/tenant-site/src/proposal.ts`
printed the raw column value, and `scripts/preview/seed.sql` wrote dollars — so
the live demo tenant showed $26.52 for a $2,652 job and an invoice would have
read $265,213.00. `migrations/023-money-to-cents.sql` converted the rows
written under the old reading.

It happened once more, after 023 (GP-111): the quote flow's two writers of
`leads.estimated_value` — `createLeadFromQuote` and `resolvePhotoReview` in
`libs/shared/pricing` — wrote the band's midpoint in whole DOLLARS, while
GP-103's booking wrote `jobs.total` and `opportunities.value` in cents from the
same band, so one quote produced a $11.38 lead and a $1,137.50 job. Both now go
through `estimatedValueCents()` (`libs/shared/pricing/src/lead.ts`), and
`migrations/030-quote-lead-value-to-cents.sql` converted the historical rows
using the only safe predicate there is: a lead is multiplied only while its
value still equals the rounded dollar midpoint of its own session's
`quote_low`/`quote_high` — no date or size heuristic, and a re-run finds
nothing to do. A quote lead whose value had been edited by hand no longer
matches and was deliberately left alone. The band on the session (`quote_low`,
`quote_high`) stays in dollars: it is the price the homeowner was shown, not an
amount column.

### 5.1 Scalar aliases

```ts
export type ID = string; // UUID v4
export type Timestamp = string; // ISO 8601
```

### 5.2 Shared value objects

```ts
export interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface ContactInfo {
  email: string;
  phone: string;
  preferredContact: 'email' | 'phone' | 'text';
}

export interface AuditFields {
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: ID;
}
```

### 5.3 Lead

```ts
export type LeadStatus =
  'new' | 'contacted' | 'qualified' | 'unqualified' | 'converted';

export type LeadSource =
  | 'website'
  | 'referral'
  | 'campaign'
  | 'manual'
  | 'google'
  | 'nextdoor'
  | 'other';

export interface Lead extends AuditFields {
  id: ID;
  firstName: string;
  lastName: string;
  contact: ContactInfo;
  address?: Address;
  status: LeadStatus;
  source: LeadSource;
  campaignId?: ID;
  notes: string;
  estimatedValue?: number;
  serviceType: string;
  convertedToOpportunityId?: ID;
}
```

### 5.4 Opportunity

```ts
export type OpportunityStatus =
  'open' | 'proposal_sent' | 'negotiating' | 'won' | 'lost';

export interface Opportunity extends AuditFields {
  id: ID;
  leadId: ID;
  customerId?: ID;
  title: string;
  status: OpportunityStatus;
  value: number;
  serviceType: string;
  notes: string;
  proposalSentAt?: Timestamp;
  closedAt?: Timestamp;
  convertedToJobId?: ID;
}
```

### 5.5 Job

```ts
export type JobStatus =
  'scheduled' | 'in_progress' | 'completed' | 'invoiced' | 'paid' | 'cancelled';

export interface JobLineItem {
  id: ID;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Job extends AuditFields {
  id: ID;
  opportunityId: ID;
  customerId: ID;
  jobNumber: string;
  title: string;
  status: JobStatus;
  address: Address;
  scheduledStart: Timestamp;
  scheduledEnd: Timestamp;
  actualStart?: Timestamp;
  actualEnd?: Timestamp;
  lineItems: JobLineItem[];
  total: number;
  notes: string;
  invoicedAt?: Timestamp;
  paidAt?: Timestamp;
  /** The technician doing the work (GP-034) — owner/admin/tech in this workspace; distinct from createdBy. */
  assignedTo?: ID;
}
```

### 5.6 Customer

```ts
export interface Customer extends AuditFields {
  id: ID;
  firstName: string;
  lastName: string;
  company?: string;
  contact: ContactInfo;
  address: Address;
  notes: string;
  consentGivenAt?: Timestamp;
  consentMethod?: 'form' | 'verbal' | 'email';
  totalJobValue: number;
  jobCount: number;
}
```

### 5.7 Campaign

```ts
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed';
export type CampaignChannel =
  'email' | 'sms' | 'postcard' | 'social' | 'google';

export interface Campaign extends AuditFields {
  id: ID;
  name: string;
  status: CampaignStatus;
  channel: CampaignChannel;
  targetArea?: string;
  budget?: number;
  spent?: number;
  leadsGenerated: number;
  /** Derived, not a column: COUNT(DISTINCT leads.id) citing this campaign (GP-034). */
  leadCount: number;
  startDate: Timestamp;
  endDate?: Timestamp;
  notes: string;
}
```

### 5.8 User / Auth

```ts
export type UserRole = 'owner' | 'admin' | 'tech' | 'office';

// NOT `extends AuditFields`: `users` has no `created_by` column, so a
// WorkspaceUser cannot carry `createdBy`.
export interface WorkspaceUser {
  id: ID;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  /** Derived from firstName/lastName — not a column. */
  avatarInitials: string;
  lastSeenAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 5.9 Workspace

```ts
export interface Workspace {
  id: ID;
  name: string;
  trade: string;
  phone: string;
  email: string;
  address: Address;
  licenseNumber?: string;
  logoUrl?: string;
  /** Every service offered; `trade` is its first entry (GP-039). */
  serviceTypes: string[];
  serviceArea?: string;
  serviceRadiusMiles?: number;
  createdAt: Timestamp;
}
```

`serviceTypes` is `workspaces.service_types`, a JSON array column; `trade` is
kept as its first entry because `apps/tenant-site` and the brand card still
read one string. `serviceArea` / `serviceRadiusMiles` are NULL (and so absent)
on a workspace that never gave them. All three are written by
`POST /api/auth/register` and editable through `PATCH /api/workspace`
(Settings → Workspace). Migration `033-workspace-service-area.sql`.

### 5.9.1 Subscription (GP-048)

```ts
export interface Subscription {
  id: ID;
  plan: SubscriptionPlan; // 'starter' | 'pro' | 'business' | 'enterprise'
  status: SubscriptionStatus; // 'active' | 'past_due' | 'canceled' | 'trialing' | 'incomplete'
  currentPeriodStart: Timestamp;
  currentPeriodEnd: Timestamp;
  cancelAtPeriodEnd: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

The `subscriptions` table as `GET /api/billing/subscription` hands it out,
serialized through `WIRE_SUBSCRIPTION`. `stripe_subscription_id` and
`stripe_customer_id` are deliberately NOT on the wire. `data: null` means the
workspace has no subscription; the platform says so and must not synthesise
one from `workspaces.stripe_customer_id`.

### 5.10 API envelope

```ts
export interface ApiResponse<T> {
  data: T;
  meta?: {
    total: number;
    page: number;
    perPage: number;
  };
}

export interface ApiError {
  code: string;
  message: string;
  field?: string;
}
```

### 5.11 Dashboard

```ts
export interface ActivityEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  meta: string | null;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
}

export interface DashboardStats {
  leads: { thisMonth: number; growth: number | null };
  jobs: { active: number; dueThisWeek: number };
  revenue: { thisMonth: number; growth: number | null };
  conversion: { rate: number };
  activity: ActivityEntry[];
}
```

---

## 6. API ENDPOINTS

Base URL: `api.greenput.com` (production) / `api.greenput.site` (staging)

**Sign-in is passkeys only.** `POST /api/auth/login` (email + password) was
removed on 2026-09-12, along with `LoginSchema` and every path that wrote a
password: registration and the teammate invite both store the `NO_PASSWORD`
sentinel, and migration 025 cleared the last two hashes in production. The
product's own `/login` had been passkey-only for some time, so this closed a
second front door nothing in the product opened — and it deletes the only
guessable credential in the system, which is why there is nothing left for a
password-login throttle to protect. The way back in when no passkey works is
`/api/auth/otp/*` below. `users.password_hash` remains as a NOT NULL column
holding `''` (dropping it is a table rebuild for no gain), and
`verifyPassword` remains in `lib/password.ts`, referenced by no route, so that
a future password path starts from the fail-closed version.

All protected routes require an `HttpOnly` session cookie (`gp_session`).
The session is stored in Cloudflare KV and **slides**: it idles out 7 days after
its last use (not 7 days after sign-in), and dies unconditionally 30 days after
first sign-in however much it is used. `requireAuth` moves the KV expiration and
the cookie's `Max-Age` together.

Three properties make that safe on a hot KV key. `apps/api/src/lib/session.ts`
owns every number, the one `createSession` helper all four sign-in doors share,
and the long-form reasoning behind each:

- **The renewal write is idempotent.** Time is cut into 1.75-day slots anchored
  on the session's `createdAt`, and the expiry written is a pure function of the
  slot — not of `now`. Concurrent requests, and requests whose read falls inside
  KV's 60-second staleness window, therefore compute byte-identical records, so
  duplicate writes cannot diverge. The cost is that the idle window rounds up:
  7 to 8.75 days of silence, never less.
- **The renewal write is best-effort.** KV allows one write per second per key
  and throws 429 past that, and a dashboard load is several concurrent
  authenticated requests on one session key. A lost race means "this request did
  not slide the session", never an HTTP 500. Renewals are also coalesced per
  isolate, so the common case never needs that safety net.
- **Revocation has its own signal.** `POST /api/auth/logout` writes a
  `revoked:<token>` tombstone as well as deleting the record, and every read
  consults both. Deleting alone was not final: a renewal already in flight put
  the record straight back and re-issued the cookie.

### 6.1 Auth

| Method | Path                                  | Description                                                                                                                                                        | Auth |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| POST   | `/api/auth/register`                  | Create workspace + owner account (the ONE signup door)                                                                                                             | No   |
| POST   | `/api/auth/logout`                    | Revoke the session (tombstone + KV delete), clear cookie                                                                                                           | No   |
| GET    | `/api/auth/me`                        | Return current authenticated user                                                                                                                                  | Yes  |
| POST   | `/api/auth/webauthn/register/options` | Passkey enrolment options (discoverable credential)                                                                                                                | Yes  |
| POST   | `/api/auth/webauthn/register/verify`  | Store the enrolled credential                                                                                                                                      | Yes  |
| POST   | `/api/auth/webauthn/login/options`    | Passkey authentication options                                                                                                                                     | No   |
| POST   | `/api/auth/webauthn/login/verify`     | Authenticate via passkey, sets cookie                                                                                                                              | No   |
| GET    | `/api/auth/invite/:token`             | Who an invitation is for and whether it is still open (`InvitationPreview`); 404 unknown, 410 `INVITE_USED` / `INVITE_EXPIRED`                                     | No   |
| POST   | `/api/auth/invite/:token/accept`      | Burn the invitation (single-use, conditional UPDATE) and sign the holder in — the session they enrol a passkey under; 409 `ALREADY_ENROLLED` once the user has one | No   |

**Register body** (`RegisterSchema`, `libs/shared/validators/src/auth.ts`):
`firstName`, `lastName`, `email`, `workspaceName`, `trade`, and optionally
`phone`, `street`, `city`, `state`, `zip`, `serviceTypes` (string[]; `trade`
leads it), `serviceArea`, `serviceRadiusMiles` (integer), `brandColor`
(`#rrggbb`) and `logoUrl`. The handler writes **four** rows in ONE D1 batch —
`workspaces`, `users`, `activity_log` and a `branding` row carrying
`brandColor` → `primary_color` and `logoUrl` → `branding.logo_url` — so a
failure anywhere leaves nothing behind. `brandColor` defaults to
`DEFAULT_BRAND_PRIMARY_COLOR` (`libs/shared/models`), which is also
`branding.primary_color`'s schema default (GP-039).

**Invitations (GP-008)** are `user_invitations` rows written by
`POST /api/workspace/users` (§6.15), one live token per invited user, seven
days. Nothing sends them: the inviter copies
`https://app.greenput.com/accept-invite/<token>` from Settings → Team and
passes it on. `apps/api/src/routes/invitations.ts`, `lib/invitations.ts`.

#### Account recovery (`/api/auth/otp/*`)

The way back in when every passkey is gone. A code is only ever sent to
`users.recovery_phone` — the owner's **personal** number — never to
`workspaces.phone`, which the product publishes on the contractor's own
micro-site. `verify` signs in an existing account and nothing else; it cannot
create one, and `/api/auth/register` is the only signup door.

| Method | Path                             | Description                                                                                                                                                                         | Auth |
| ------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| POST   | `/api/auth/otp/send`             | Text a sign-in code to a recovery number. Always answers `{sent:true}`, so it cannot be used to test who has an account, and no code is generated unless a recovery number matches. | No   |
| POST   | `/api/auth/otp/verify`           | Exchange the code for a session. Five wrong guesses burn the code (`OTP_LOCKED`).                                                                                                   | No   |
| GET    | `/api/auth/otp/recovery`         | Is a recovery number set, and which one (last four digits only)                                                                                                                     | Yes  |
| POST   | `/api/auth/otp/recovery/start`   | Text a code to a candidate personal number. Refuses the workspace phone (`PHONE_IS_PUBLIC`) and a number already bound to another account (`PHONE_TAKEN`).                          | Yes  |
| POST   | `/api/auth/otp/recovery/confirm` | Store the number, once the code proves possession                                                                                                                                   | Yes  |
| DELETE | `/api/auth/otp/recovery`         | Remove the recovery number                                                                                                                                                          | Yes  |

**Rate-limit budgets** (`apps/api/src/middleware/rate-limit.ts`) are namespaced
per limiter. They used to share one sliding window per client IP, so `/api/*`
traffic through the 60-a-minute general limiter filled the bucket the
5-a-minute auth limiter then measured — ordinary navigation looked like abuse
and `/login` reported it as a network fault. `/api/auth/otp/*` now has its own
10-a-minute budget, so the door out cannot be shut by the failed sign-ins that
led to it, and `webauthn/login/options` + `logout` ride the general budget
because neither is a credential submission.

### 6.1.1 Public brand assets (`brand.greenput.com`, `apps/brand-assets`)

The share card every micro-site advertises in `og:image`, and the square mark an
invoice, an email or Google's `LocalBusiness.logo` can point at. No auth — these
are fetched by crawlers. **Not on `api.greenput.com`**: since GP-108 they are
served by their own Worker, `apps/brand-assets`, and `POST /api/auth/register`
hands the new workspace absolute URLs on that origin (from `env.BRAND_ORIGIN`;
empty in staging and preview, where the URLs are simply omitted).

| Method | URL                                                  | Description                                                                                             | Auth |
| ------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---- |
| GET    | `https://brand.greenput.com/:slug/:version/card.png` | 1200x630 share card: business name, trade, service area, and the generated or uploaded mark             | No   |
| GET    | `https://brand.greenput.com/:slug/:version/mark.png` | 512x512 square mark                                                                                     | No   |
| GET    | `https://brand.greenput.com/health`                  | `{"status":"ok","worker":"greenput-brand"}` — the deploy's proof that this hostname reaches this Worker | No   |

`:version` is `brandAssetVersion` from `libs/shared/design` — a hash of every
string the card draws, so any change to the row moves the URL. That is what
makes `Cache-Control: immutable` honest. The Worker reads the workspace row on
every request and keys its cache by the version it computes from THAT row, never
by the one in the path, so a crawler holding a pre-rename URL is answered with
the post-rename card (and a five-minute `max-age` instead of `immutable`).

**Never `workspaces.phone`.** The card scene takes `ShareCardFacts`, which has no
phone field; `brand-assets.spec.ts` asserts the key set exactly. That number is
already public on the micro-site, and `/api/auth/otp/recovery/start` refuses to
text a recovery code to it _because_ it is public — how much further it spreads
is that guard's business.

**The rasterizer lives in exactly one Worker.** `@basenative/og-image` carries
`@resvg/resvg-wasm` — 2.4 MB of WASM — and `apps/brand-assets` is the only
bundle allowed to contain it. `apps/api` serves every authenticated request and
`apps/tenant-site` every micro-site page view; in either, the WASM is a
cold-start tax on the whole product, and in `apps/api` a risk of the 1-second
startup CPU limit (error 10021) failing sign-in for everyone. Measured with
`wrangler deploy --dry-run` on 2026-09-13: `apps/api` 1863.87 KiB / gzip 327.33
KiB with zero WASM references, `apps/tenant-site` 1192.37 / 235.96,
`apps/brand-assets` 2491.90 / 958.14 of which 73 KiB is JavaScript.
`scripts/ci/bundle-guard.sh` fails the build if that ever changes.
`libs/shared/design` holds only what all three share — the identity, the facts,
the version and the URL. `brand` is in `RESERVED_SUBDOMAINS` so no contractor
can be handed that slug.

### 6.2 Dashboard

| Method | Path                   | Description                                                 | Auth |
| ------ | ---------------------- | ----------------------------------------------------------- | ---- |
| GET    | `/api/dashboard/stats` | Aggregated KPIs: leads, jobs, revenue, conversion, activity | Yes  |

### 6.3 Leads

| Method | Path                      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Auth |
| ------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| GET    | `/api/leads`              | List leads (paginated, filterable by status/source/q)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Yes  |
| GET    | `/api/leads/:id`          | Get single lead                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Yes  |
| POST   | `/api/leads`              | Create lead                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Yes  |
| PATCH  | `/api/leads/:id`          | Update lead fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Yes  |
| DELETE | `/api/leads/:id`          | Delete lead                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Yes  |
| POST   | `/api/leads/:id/convert`  | Convert lead to opportunity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Yes  |
| POST   | `/api/leads/:id/qualify`  | Mark a lead qualified (stamps `qualified_at`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Yes  |
| GET    | `/api/leads/:id/fee`      | `{ leadId, vertical, priceUsd, receive }` — the lead fee this lead will cost, metered when the job is booked (not on `accept`), from `quoteLeadFee` (`lead-rate-card.ts`): `workspaces.lead_fee_override_usd` or a grandfathered slug (`hi-power` = $1) wins, otherwise `PER_LEAD_USD` for the explicit service→vertical map. Whole dollars (§5.0.1). `receive` is `{ ok: true }` or `{ ok: false, code, message }` (`CARD_REQUIRED` / `DELIVERY_PAUSED`). The platform reads the price into the Accept confirmation and leaves Confirm disabled when `receive.ok` is false | Yes  |
| POST   | `/api/leads/:id/accept`   | Accept a qualified lead — a state transition only (stamps `accepted_at`); bills nothing, the fee fires at booking (WS-1)                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Yes  |
| POST   | `/api/leads/:id/withdraw` | Consumer withdraws — bills nothing if before booking; a booking fee already billed stands, withdrawal never waives it (WS-1/v14). Optional body `{ reason }` from the closed set on `leads.withdrawn_reason` (`schedule_no_longer_works` \| `chose_another_provider` \| `no_longer_needed` \| `other`); no body records none. Recorded, never adjudicated                                                                                                                                                                                                                   | Yes  |

The money rules of `withdraw` live in ONE function, `withdrawLead` in
`libs/shared/pricing/src/lead-withdraw.ts`, which this route and the tenant
site's `POST /quote/s/:id/cancel` (§8.1, GP-105) both call: before booking
nothing is billed; after booking the fee stands — the `pending`
`lead_meter_events` row stays `pending` and collectible, never waived or
deleted by a withdrawal, and an already-invoiced row is left alone;
idempotent and one-way. Every write is one `db.batch()`, and a caller may put
its own statements in the same transaction (the tenant site cancels the job
and frees its `job_slots` rows there). The staff route scopes to the
authenticated workspace; the consumer path scopes to the session row's — never
to input. `withdrawn_reason` is validated in code (`WithdrawLeadSchema`, and the
tenant site's form): migration 029 added the column by `ALTER TABLE`, which
cannot carry the CHECK `schema.sql` declares for fresh databases.

Booking a lead charges that fee immediately (WS-1: the fee fires at
booking commit — schedule-aware delivery — never at a staff accept
click or a pool accept, which are state transitions), and only when
the workspace can receive one. `assertCanReceiveLeads`
(`apps/api/src/lib/lead-billing-gate.ts`) runs before the accept write,
before delivery books, and before a pool offer is accepted. With
`STRIPE_SECRET_KEY` set, no saved card is `409 CARD_REQUIRED` and nothing
is written. A pending meter row with `payment_status` `failed` or
`processing` is `409 DELIVERY_PAUSED` even when the key is unset.
`chargeBookedLeadFee` (`apps/api/src/lib/lead-fee-billing.ts`) then runs
from the booking path, only when `recordLeadMeter` actually inserted the
row. It creates a Stripe Customer when `workspaces.stripe_customer_id` is
empty (`metadata.workspace_id`) and confirms one off-session PaymentIntent
per meter row (idempotency key `lead-fee-${meterEventId}`; the meter is
unique per (lead, workspace)). It never sets
`receipt_email` and never calls `POST /invoices` or `/invoices/:id/send`.
A decline after the gate leaves the row `pending` (withdrawal never
waives it — the pause lifts only when the fee is collected, or reversed
by `refundLeadFee` under FR-1.4) and does not roll that booking back. A succeeded charge is `invoiced`; the only refund path is
`refundLeadFee`, for proven fraud or platform fault, with the reason
recorded. There is no
cron. `POST /api/billing/lead-fees/collect` charges whatever is still
pending, and so do `payment_method.attached`, `customer.updated`, and
`setup_intent.succeeded`. `payment_intent.succeeded` /
`payment_intent.payment_failed` reconcile a row whose metadata `kind` is
`lead_fee`, and never un-waive. Outbound SMS the contractor sends (chat
fallback, booking texts) is paid from `workspaces.usage_balance_micro_usd`
(micro-USD). A send reserves Twilio's published US list price ($0.0083 per
segment); `POST /api/webhooks/twilio/sms` adjusts that reserve to Twilio's
Price. When the balance falls below the threshold (default $2) the saved
card is charged the top-up (default $10), idempotent on the ledger row. A
failed or processing top-up is `DELIVERY_PAUSED` the same way a failed lead
fee is, and those texts are blocked. The same reserve applies to SMS
`dispatchNotification` sends on a contractor workspace's behalf: the API
injects that hook from `dispatchWorkspaceNotification`
(`apps/api/src/lib/workspace-notifications.ts`) and the shared library
does not import the API. A blocked or failed SMS is emailed instead of
dropped. The marketing contact form calls `dispatchNotification` with no
hook, and account-recovery OTP does not enter the dispatcher, so both
stay GreenPut-paid and ungated. Cloudflare request volume is not billed.
See `docs/billing-lead-fees.md`.

### 6.4 Opportunities

| Method | Path                             | Description                           | Auth |
| ------ | -------------------------------- | ------------------------------------- | ---- |
| GET    | `/api/opportunities`             | List opportunities (paginated)        | Yes  |
| GET    | `/api/opportunities/:id`         | Get single opportunity                | Yes  |
| POST   | `/api/opportunities`             | Create opportunity                    | Yes  |
| PATCH  | `/api/opportunities/:id`         | Update opportunity                    | Yes  |
| DELETE | `/api/opportunities/:id`         | Delete opportunity                    | Yes  |
| POST   | `/api/opportunities/:id/convert` | Convert opportunity to job + customer | Yes  |

`convert` books the job through the same `job_slots` guard as `POST /api/jobs`
(§6.5): when every lane for a half-hour of the requested schedule is already
taken it answers `409 { error: { code: 'SLOT_TAKEN', message: 'That time just
went — pick another' } }` and writes nothing — no job, no customer, and the
opportunity is not flipped to `won`. The platform's convert panel stays open
and shows that message.

### 6.5 Jobs

| Method | Path                    | Description                                                                               | Auth |
| ------ | ----------------------- | ----------------------------------------------------------------------------------------- | ---- |
| GET    | `/api/jobs`             | List jobs (paginated, filterable)                                                         | Yes  |
| GET    | `/api/jobs/schedule`    | Calendar blocks for a date window                                                         | Yes  |
| GET    | `/api/jobs/:id`         | Get single job with line items                                                            | Yes  |
| POST   | `/api/jobs`             | Create job                                                                                | Yes  |
| PATCH  | `/api/jobs/:id`         | Update job (not `lineItems`/`total`: 409 `CHANGE_ORDER_REQUIRED`, see §6.8a)               | Yes  |
| DELETE | `/api/jobs/:id`         | Delete job                                                                                | Yes  |
| GET    | `/api/jobs/:id/invoice` | Render invoice as HTML (the contractor's own copy)                                        | Yes  |
| POST   | `/api/jobs/:id/invoice` | Mark invoiced, mint `jobs.invoice_token`, answer `{ data, share }`                        | Yes  |
| POST   | `/api/jobs/:id/paid`    | Mark job as paid                                                                          | Yes  |
| POST   | `/api/jobs/:id/no-show` | Customer no-show: cancel the job, free its slots, forfeit the booking deposit (fee first) | Yes  |

**Invoice links (GP-008).** `POST /api/jobs/:id/invoice` stores a random UUID
in `jobs.invoice_token` (migrations/032; partial unique index) and answers
`ShareableResponse<Job>`: `share.url` is
`https://<slug>.greenput.com/invoice/<token>` — the public page in §8.1,
rendered by the same `libs/shared/documents` renderer as the GET above — and
`share.message` is a line the contractor pastes into their own email or SMS.
Nothing is sent, and no status may say it was. `share` is absent when the
workspace has no slug. `Job.invoiceToken` rides the wire so the platform can
offer "Copy invoice link" on a row invoiced earlier; jobs invoiced before 032
carry NULL and get no link. Origins: `apps/api/src/lib/origins.ts`
(`tenantOrigin`, staging → `greenput.site`).

`GET /api/jobs/schedule?start=YYYY-MM-DD&end=YYYY-MM-DD[&techId=]` answers
`{ data: ScheduleBlock[] }` (`WIRE_SCHEDULE_BLOCK`), ascending by start, not
paginated — a window is bounded. It returns every status except `cancelled`:
finished work (`completed` / `invoiced` / `paid`) stays on the calendar so last
week does not render empty. The platform's `/jobs` calendar reads this, never
the list — the list is one 25-row page, newest first.

`techId` filters on `jobs.assigned_to` — the technician doing the job — never
on `created_by`, which is whoever typed it in (GP-034). Each block carries
`assignedTo` / `assigneeName` from a `users` JOIN when the job is assigned.
`POST` / `PATCH /api/jobs` accept `assignedTo` (a UUID; `null` on PATCH
unassigns) and answer 400 unless it names a user in the session workspace with
role `owner`, `admin` or `tech`. Jobs that predate `migrations/031` are
unassigned — nothing was backfilled from `created_by`.

**Booking deposits (fee paper v2 §3).** Auto-booked jobs (schedule-aware
delivery, `POST /api/leads/:id/deliver`) carry a customer deposit, collected at booking
as a Stripe Connect destination charge with manual capture — the engine is
`apps/api/src/lib/deposits.ts` and the row is `deposits` (migrations/039).
Size: 2× the delivered-lead fee actually charged (the lead's meter
`price_usd`), hard-capped at the lesser of 10% of the quote's low end or
$1,000 (CA §7159); at the pilot's $1 fee the deposit is $2. States:
`pending` → `held` (authorization landed, via the payments webhook) →
exactly one of `applied` (job completed: captured in full to the shop,
credited against the invoice; the fee still bills through the meter),
`refunded` (every non-forfeit exit — pre-confirmation exit, shop cancel,
outside-window cancel, undone delivery: the authorization is voided, or
refunded with the transfer reversed if captured), or `forfeited` (the only
forfeit case: a confirmed booking cancelled inside the 24h window via
`POST /api/leads/:id/withdraw`, or `POST /api/jobs/:id/no-show` — captured
with the fee as Stripe's application fee, fee first, remainder to the
shop; a shortfall against the fee is absorbed by GreenPut and the lead's
pending meter event is waived, never invoiced as a second bill). Deposit
calls from lifecycle handlers are total — a Stripe failure is recorded on
the row (`last_error`, status `failed` at creation) and never fails the
booking; creation retries through `POST /api/payments/deposits` (also
`GET /api/payments/deposits/:id` and `GET /api/payments/deposits?jobId=`).
A shop-side `PATCH` to `cancelled` releases the deposit — never forfeits
it. Tenant-site bookings carry no deposit in this build: the tenant
Worker has no Stripe credentials, so deposit creation lives in the API
(delivery + the endpoint above).

**Deposit confirmation (the customer's half).** Creation opens the
intent; the homeowner authorizes it in their own browser on the shop's
tenant site at `/deposit/<confirmation_token>` — the token is minted at
creation (`migrations/040`) and is the whole authorisation for the page,
the `jobs.invoice_token` pattern: workspace-scoped, and a wrong token is
an indistinguishable 404. The tenant Worker needs no Stripe credentials
for this: confirmation is a browser operation. The page's script calls
`POST /api/public/deposits/:token/session`, and the API — which holds
the secret key — answers with the intent's `client_secret` plus the
platform publishable key (`STRIPE_PUBLISHABLE_KEY`, read from the
environment like the other Stripe values, never hardcoded); Stripe.js +
the Payment Element confirm against Stripe directly, and the webhook
above lands the row in `held`. A decline leaves the intent confirmable
(the customer retries with another card on the same intent); a `failed`
row whose intent is spent is repaired in place by the session endpoint
through the same creation path. The delivery SMS carries the
confirmation link whenever a deposit was opened and the workspace has a
public site (`depositShareLink` in `@greenput/shared/utils` shapes it —
the one place these URLs are built). Go-live needs
`STRIPE_PUBLISHABLE_KEY` provisioned alongside the other Stripe values;
without it the session endpoint answers 503 and the page reports status
only. Tenant-site bookings still carry no deposit (their flow never
meters a delivered-lead fee to size one from) — but a deposit created
by the API for any booking confirms on the tenant site exactly this
way. One CORS consequence: the page's calls are cross-origin, and a
shop with an active custom domain serves the page from that domain, so
`corsHeadersForRequest` (`apps/api/src/middleware/auth.ts`) lets an
origin through for these two endpoints only when it is the
`custom_hostname` — status `active`, the tenant Worker's own
resolution rule — of the workspace that owns the token in the path.
Every other route keeps the static Greenput-hosts-only policy; a
custom domain earns nothing there.

**Double booking (GP-104).** `job_slots (workspace_id, slot_start, lane, job_id)`
holds one row per half-hour a job occupies, per lane, and its `PRIMARY KEY
(workspace_id, slot_start, lane)` is the whole guard — never a SELECT-then-INSERT
on top of it. `POST /api/jobs`, `PATCH /api/jobs/:id` with a new schedule (the
calendar drag PATCHes the same way) and `convert` write the job and its slot
rows in ONE `env.DB.batch()`; a collision rolls the batch back and the handler
retries the next lane up to `workspaces.concurrent_jobs`, lowest free lane
first (`apps/api/src/lib/job-slots.ts`). When every lane is taken the answer is
`409 { error: { code: 'SLOT_TAKEN', message: 'That time just went — pick
another' } }` with no `jobs` row left behind. A `PATCH` to `status: 'cancelled'`
frees the job's slots; `DELETE` frees them by `ON DELETE CASCADE`. The
platform shows the message and reloads the schedule.

### 6.6 Customers

| Method | Path                 | Description                            | Auth |
| ------ | -------------------- | -------------------------------------- | ---- |
| GET    | `/api/customers`     | List customers (paginated, searchable) | Yes  |
| GET    | `/api/customers/:id` | Get single customer with job history   | Yes  |
| POST   | `/api/customers`     | Create customer                        | Yes  |
| PATCH  | `/api/customers/:id` | Update customer                        | Yes  |
| DELETE | `/api/customers/:id` | Delete customer                        | Yes  |

### 6.7 Campaigns

| Method | Path                 | Description                | Auth |
| ------ | -------------------- | -------------------------- | ---- |
| GET    | `/api/campaigns`     | List campaigns (paginated) | Yes  |
| GET    | `/api/campaigns/:id` | Get single campaign        | Yes  |
| POST   | `/api/campaigns`     | Create campaign            | Yes  |
| PATCH  | `/api/campaigns/:id` | Update campaign            | Yes  |
| DELETE | `/api/campaigns/:id` | Delete campaign            | Yes  |

Every campaign body (list, detail, and the row a POST/PATCH answers with)
carries two lead counts: `leadsGenerated` is the number the contractor typed,
and `leadCount` is `COUNT(DISTINCT leads.id)` over the leads citing that
`campaign_id` — the same join `/api/reports/campaigns` uses — so the
"Leads (tracked)" column and the report's Cost/lead divide by one number
(GP-034). Do not redefine `leads_generated` from lead rows: off-platform
channels have no rows, and the typed number is the only count they have.

### 6.8 Estimates

| Method | Path                        | Description                                                      | Auth |
| ------ | --------------------------- | ---------------------------------------------------------------- | ---- |
| GET    | `/api/estimates`            | List estimates (paginated)                                       | Yes  |
| GET    | `/api/estimates/:id`        | Get single estimate                                              | Yes  |
| POST   | `/api/estimates`            | Create estimate                                                  | Yes  |
| PATCH  | `/api/estimates/:id`        | Update fields; line items/tax only while draft (else §6.8a)      | Yes  |
| DELETE | `/api/estimates/:id`        | Delete estimate (draft only)                                     | Yes  |
| POST   | `/api/estimates/:id/send`   | Mark sent; answer `{ data, share }` with the public proposal URL | Yes  |
| POST   | `/api/estimates/:id/accept` | Mark estimate as accepted                                        | Yes  |

`send` answers `ShareableResponse<Estimate>` (GP-008): `share.url` is
`https://<slug>.greenput.com/proposal/<id>` — the page in §8.1, keyed on the
estimate UUID, which is already an unguessable capability, so no token is
minted — plus a message for the contractor to paste. Nothing is sent.

### 6.8a Change orders

Once a job exists, or an estimate has been sent, its price moves only through a
change order: proposed → approved | rejected, decided exactly once, with a
signed `priceDelta` in cents and an append-only `events` trail. Approving
appends the lines (prefixed `CO-1001: `) to the job or estimate and moves its
total by exactly the delta (an estimate's tax is recomputed). Invoiced, paid
and cancelled jobs, and rejected/expired estimates, take none; a draft
estimate is edited directly (409 `EDIT_THE_DRAFT`). Migration 045.

| Method | Path                                | Description                                       | Auth        |
| ------ | ----------------------------------- | ------------------------------------------------- | ----------- |
| GET    | `/api/change-orders?jobId=&estimateId=` | List, newest first                            | Yes         |
| GET    | `/api/change-orders/:id`            | One, with `events`                                | Yes         |
| POST   | `/api/change-orders`                | Propose (`jobId` xor `estimateId`, `lineItems`)   | Yes         |
| POST   | `/api/change-orders/:id/approve`    | Record the homeowner's yes, apply the lines       | office+     |
| POST   | `/api/change-orders/:id/reject`     | Record the homeowner's no                         | office+     |

### 6.9 Inventory

| Method | Path                             | Description                                  | Auth |
| ------ | -------------------------------- | -------------------------------------------- | ---- |
| GET    | `/api/inventory`                 | List inventory items (paginated, searchable) | Yes  |
| GET    | `/api/inventory/low-stock`       | Items below minimum quantity                 | Yes  |
| GET    | `/api/inventory/:id`             | Get item with transaction history            | Yes  |
| POST   | `/api/inventory`                 | Create inventory item                        | Yes  |
| PATCH  | `/api/inventory/:id`             | Update inventory item                        | Yes  |
| DELETE | `/api/inventory/:id`             | Delete inventory item                        | Yes  |
| POST   | `/api/inventory/:id/transaction` | Record purchase/usage/adjustment/return      | Yes  |

### 6.10 Vehicles (Fleet)

| Method | Path                | Description                           | Auth |
| ------ | ------------------- | ------------------------------------- | ---- |
| GET    | `/api/vehicles`     | List vehicles (paginated, filterable) | Yes  |
| GET    | `/api/vehicles/:id` | Get vehicle details                   | Yes  |
| POST   | `/api/vehicles`     | Add vehicle to fleet                  | Yes  |
| PATCH  | `/api/vehicles/:id` | Update vehicle                        | Yes  |
| DELETE | `/api/vehicles/:id` | Remove vehicle                        | Yes  |

### 6.11 Reviews

| Method | Path                    | Description                         | Auth |
| ------ | ----------------------- | ----------------------------------- | ---- |
| GET    | `/api/reviews`          | List reviews (paginated)            | Yes  |
| GET    | `/api/reviews/stats`    | Aggregate rating stats by platform  | Yes  |
| GET    | `/api/reviews/:id`      | Get single review                   | Yes  |
| POST   | `/api/reviews`          | Create review (internal)            | Yes  |
| PATCH  | `/api/reviews/:id`      | Update review (respond, archive)    | Yes  |
| DELETE | `/api/reviews/:id`      | Delete review                       | Yes  |
| GET    | `/api/reviews/requests` | List review requests                | Yes  |
| POST   | `/api/reviews/requests` | Record a review request (`pending`) | Yes  |

`POST /api/reviews/requests` (also served on the singular `/request` it was
first registered under) writes the row `status = 'pending'` with `sent_at`
NULL and logs `request_created`. Greenput sends nothing (GP-008: links, not
sending — no provider): the contractor copies the message from **Request
review** on a paid job row on `/jobs` and sends it from their own phone or
email. Never write `sent` here — a status that says sent must mean sent
(GP-047).

### 6.12 Reports

| Method | Path                       | Description                                                                                                                                                                 | Auth |
| ------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| GET    | `/api/reports/revenue`     | Revenue by period, service type, top customers                                                                                                                              | Yes  |
| GET    | `/api/reports/pipeline`    | Lead funnel, conversion rate, source breakdown                                                                                                                              | Yes  |
| GET    | `/api/reports/technicians` | Jobs, paid revenue and average completion days per owner/admin/tech, joined on `jobs.assigned_to` (GP-034) — an unassigned job is credited to nobody, never to `created_by` | Yes  |

### 6.13 Plugins

| Method | Path                             | Description                 | Auth |
| ------ | -------------------------------- | --------------------------- | ---- |
| GET    | `/api/plugins`                   | List available plugins      | Yes  |
| GET    | `/api/plugins/installed`         | List installed plugins      | Yes  |
| POST   | `/api/plugins/:id/install`       | Install plugin              | Yes  |
| DELETE | `/api/plugins/:installId`        | Uninstall plugin            | Yes  |
| PATCH  | `/api/plugins/:installId/config` | Update plugin configuration | Yes  |

### 6.14 Webhooks

| Method | Path                | Description             | Auth |
| ------ | ------------------- | ----------------------- | ---- |
| GET    | `/api/webhooks`     | List webhooks           | Yes  |
| POST   | `/api/webhooks`     | Create webhook          | Yes  |
| PATCH  | `/api/webhooks/:id` | Update webhook (toggle) | Yes  |
| DELETE | `/api/webhooks/:id` | Delete webhook          | Yes  |

### 6.15 Workspace / Settings

| Method | Path                       | Description                                                                                                                                    | Auth |
| ------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| GET    | `/api/workspace`           | Get current workspace profile                                                                                                                  | Yes  |
| PATCH  | `/api/workspace`           | Update workspace settings                                                                                                                      | Yes  |
| GET    | `/api/workspace/users`     | List workspace members                                                                                                                         | Yes  |
| POST   | `/api/workspace/users`     | Invite a teammate: the user row AND a `user_invitations` token; answers `{ data, share }` with the accept-invite link (201 new, 200 re-issued) | Yes  |
| PATCH  | `/api/workspace/users/:id` | Update user role                                                                                                                               | Yes  |
| DELETE | `/api/workspace/users/:id` | Remove user from workspace                                                                                                                     | Yes  |

Re-inviting an email already in the workspace RE-ISSUES the link (the old
token is deleted, a fresh one returned) while that user has no
`webauthn_credentials` row — which is what makes `/recover`'s "ask to be
invited again" true — and is the 409 `DUPLICATE` it always was once they
have one (GP-008). The link's origin is the request's Origin when it is a
known platform host, else the environment's (`apps/api/src/lib/origins.ts`).

### 6.15.1 Availability (booking hours) — GP-101

| Method | Path                | Description                                                         | Auth        |
| ------ | ------------------- | ------------------------------------------------------------------- | ----------- |
| GET    | `/api/availability` | The recurring week, dated exceptions, booking policy and `bookable` | admin/owner |
| PUT    | `/api/availability` | Replace all of it atomically (one `db.batch()`)                     | admin/owner |

`apps/api/src/routes/availability.ts`, `requireRole('admin')` on both handlers,
scoped to the session workspace. The body is `WorkspaceAvailability`
(`libs/shared/models`, serialized through `WIRE_WORKSPACE_AVAILABILITY` with
`week` / `exceptions` as children): the five booking-policy columns on
`workspaces` (`timezone`, `booking_lead_hours`, `booking_horizon_days`,
`travel_buffer_minutes`, `concurrent_jobs`), one `AvailabilityDay` per
`workspace_availability` row (`weekday` 0 = Sunday, `opensAt` / `closesAt`
local `HH:MM`, `isOpen`), and one `AvailabilityException` per
`workspace_availability_exceptions` row (`date` local `YYYY-MM-DD`, same shape,
optional `reason`). An exception wins over the weekday row for its date in both
directions — `resolveAvailabilityForDate` in `libs/shared/utils` is the one
definition of that.

`bookable` is computed by the route, never stored: a `timezone` is set AND at
least one weekday is open. **A workspace with no rows is not bookable, never
"always open"** — an absent answer must not publish a claim. `timezone` is
nullable on purpose; slot generation (GP-102) must refuse to run without it
rather than guess UTC.

PUT validates with `UpdateAvailabilitySchema` (`libs/shared/validators`): every
field required, `week` must name each weekday exactly once, an open day needs
both times in order, exception dates unique, `timezone` an IANA name the
runtime resolves or `null`. It replaces the week, the exceptions and the policy
in one batch, logs `availability_updated` on the workspace to `activity_log`,
and answers with the same body GET would.

### 6.15.2 Billing (`apps/api/src/routes/billing.ts`)

| Method | Path                             | Description                                                                                             | Auth  |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------- | ----- |
| GET    | `/api/billing/status`            | Workspace billing state (trial / active / expired)                                                      | Yes   |
| GET    | `/api/billing/meter`             | Per-lead meter summary, recent charges, and `receive` (card on file / delivery paused). No side effects | admin |
| GET    | `/api/billing/usage`             | Prepaid SMS balance (micro-USD), top-up amount, threshold, and the last 25 ledger rows. No side effects | admin |
| PATCH  | `/api/billing/usage`             | Set top-up cents (50–100000) and threshold cents (strictly less than the top-up). Does not charge       | admin |
| POST   | `/api/billing/lead-fees/collect` | Charge still-pending lead fees to the saved card                                                        | admin |
| POST   | `/api/billing/payment-method`    | Customer Portal session to save a card; creates the customer when missing                               | admin |
| GET    | `/api/billing/subscription`      | Newest `Subscription` via `WIRE_SUBSCRIPTION`, or `null`                                                | admin |
| POST   | `/api/billing/subscribe`         | Create a Stripe subscription (no platform caller yet)                                                   | owner |
| POST   | `/api/billing/cancel`            | Cancel at period end                                                                                    | owner |
| POST   | `/api/billing/portal`            | Stripe Customer Portal session URL                                                                      | admin |

`/portal` refuses with 503 `BILLING_UNAVAILABLE` when `STRIPE_SECRET_KEY` is
unset and 400 `NO_CUSTOMER` when the workspace has no `stripe_customer_id`.
Settings → Billing shows the API's message for either, is busy while the
request is in flight, and renders Renews from `currentPeriodEnd`. With no
subscription row it says billing is not set up for the workspace and hides the
portal button — starting a subscription is staff-assisted today; nothing in
`apps/platform` calls `/subscribe`.

### 6.16 Branding

| Method | Path            | Description              | Auth |
| ------ | --------------- | ------------------------ | ---- |
| GET    | `/api/branding` | Get workspace branding   | Yes  |
| PATCH  | `/api/branding` | Update branding settings | Yes  |

### 6.17 API Keys

| Method | Path                | Description    | Auth |
| ------ | ------------------- | -------------- | ---- |
| GET    | `/api/api-keys`     | List API keys  | Yes  |
| POST   | `/api/api-keys`     | Create API key | Yes  |
| PATCH  | `/api/api-keys/:id` | Update API key | Yes  |
| DELETE | `/api/api-keys/:id` | Revoke API key | Yes  |

### 6.18 Intake / pricing (the enrichment form)

An enrichment form is a finite state machine whose traversal deterministically
produces a price range. The engine is `libs/shared/pricing`; the five seeded
machines and the default rate card are `seeds/pricing/`. The homeowner filling
the form in is never logged in, so the consumer half sits under `/api/public/`
alongside the lead-capture routes.

| Method | Path                                      | Description                                                                                           | Auth |
| ------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---- |
| GET    | `/api/public/intake/flows?slug=`          | Published flows a tenant site can offer                                                               | No   |
| POST   | `/api/public/intake/sessions`             | Start a form (`{slug, flow, sourceUrl}`) — returns the first screen                                   | No   |
| GET    | `/api/public/intake/sessions/:id`         | The screen this form is on, or the quote if it is done                                                | No   |
| POST   | `/api/public/intake/sessions/:id/answers` | Answer a screen (`{stateId, input}`) and advance                                                      | No   |
| GET    | `/api/public/intake/sessions/:id/quote`   | The final range (409 while unfinished)                                                                | No   |
| GET    | `/api/intake/flows`                       | Flows this workspace's site is offering                                                               | Yes  |
| GET    | `/api/intake/sessions`                    | Forms started on this workspace's site (paginated, `status` filter)                                   | Yes  |
| GET    | `/api/intake/sessions/:id`                | One form: answers, route taken, events, price                                                         | Yes  |
| POST   | `/api/public/intake/sessions/:id/photo`   | Attach the panel photo (`multipart/form-data`, field `file`). The upload IS the answer to that screen | No   |
| GET    | `/api/intake/reviews`                     | Panel photos still waiting on a human                                                                 | Yes  |
| GET    | `/api/intake/reviews/:id/photo`           | The image itself, streamed from R2 (`private, no-store`)                                              | Yes  |
| POST   | `/api/intake/reviews/:id`                 | Record what was read off it (`{status, fields}`) and re-price the session                             | Yes  |

A session id is a capability — a v4 UUID, never listed publicly, carrying no
contractor data — which is what lets a homeowner finish a form after closing the
tab. Each session pins the graph version AND the rate-card version it started
on, so republishing a flow can never move a price a contractor has promised to
honour. Completing a form that collected contact details creates a lead
(`source = 'website'`, `service_type` = the machine's vertical) exactly once.

**Qualification and the photo.** Reaching a priced terminal is the qualification
event: the lead is created `qualified`, which is what `POST /api/leads/:id/accept`
requires before it will fire the billable meter event. A `span` does not qualify
— the band is real and is shown immediately, but it still covers several
outcomes because nobody has read the panel photo yet.

Photo interpretation is **not solved**. Nothing classifies a panel image, so the
shipped classifier declines (`libs/shared/pricing/src/photo.ts`, `PhotoClassifier`
is the seam), the answer stays `unreviewed`, and the quote lands on the spanning
terminal. A human narrows it through the review queue above; `resolvePhotoReview`
re-prices against the session's own pinned versions and may only move the range
INSIDE what was shown — a reading that escapes it is reported as `requires_call`
and rewrites nothing. A photo answer is never taken from the request body: the
client can say "a file is attached" or "no file", and the verdict comes from
`pricing_photo_reviews`.

The panel-photo surface (upload + review queue) is gated on the
`intake_panel_photo` feature flag, off by default. §6.19 turns it on.

**Going back, and starting over (GP-014).** `pricing_quote_events` is
append-only and stays so: `rewindTo(db, session, stateId)` and
`restartSession(db, session)` in `libs/shared/pricing/src/store.ts` never
DELETE a row. A rewind rebuilds `answers` from the events that survive —
each stored `input` back through `coerceScreenAnswers` against the pinned
machine, merged in order (`replayAnswers`); never by subtracting keys, since
one screen can write several and two screens can write the same one — moves
`current_state_id` to the target and appends ONE row (`{"_rewind": true}`,
`from` the screen left, `to` the screen returned to). A restart empties the
answers, clears the cursor and any frozen outcome (status back to
`in_progress`; the lead a first finish created stays attached, so a second
finish does not create another), and appends `{"_restart": true}`.
`foldEvents` is the one reading of that record: `live` is what still stands,
`undone` what a rewind cut off (a restart empties both). `stateId` is checked
against the session's OWN surviving history — a state nothing surviving left
is a no-op and writes nothing. A photo answer stepped back past is withdrawn
by marking its `pricing_photo_reviews` row `missing` (file and reading kept;
`withPhotoReadings` holds no reading for a `missing` row, and a re-upload's
upsert brings it back). No schema change; the api's `events` view shows the
navigation rows as they are.

Booking the quoted job is the tenant site's (`/quote/s/:id/book`, §8.1):
there is no `/api/public/intake/*/book` yet. The pure pieces it needs — slot
generation, local-day grouping and labels, and the `job_slots` guard — live in
`libs/shared/scheduling` so GP-105 (change-or-cancel) can reach them from
`apps/api` without a second definition.

### 6.19 Platform admin (`/api/admin/*`)

A separate authority from a workspace session: `admin_users` +
`admin_webauthn_credentials`, a `gp_admin_session` cookie, and `requireAdmin`.
No frontend in this repo serves it (`apps/admin` was deleted — see §4.1).

| Method | Path                                                                          | Description                                                                                                                                                                                                                                                                                                                                         | Auth             |
| ------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| POST   | `/api/admin/auth/setup`                                                       | Create the first platform admin. Requires `X-Admin-Setup-Token` matching the Worker's `ADMIN_SETUP_TOKEN`, and answers 404 — indistinguishable from an unmounted path — when no secret is configured or the token is wrong. Refuses (403 `ADMIN_EXISTS`) once any admin row exists, enforced by the `INSERT` itself. See `docs/admin-bootstrap.md`. | Bootstrap secret |
| GET    | `/api/admin/auth/status`                                                      | Whether this environment has an admin yet                                                                                                                                                                                                                                                                                                           | No               |
| POST   | `/api/admin/auth/webauthn/login/options`                                      | Admin passkey challenge                                                                                                                                                                                                                                                                                                                             | No               |
| POST   | `/api/admin/auth/webauthn/login/verify`                                       | Authenticate, sets `gp_admin_session`                                                                                                                                                                                                                                                                                                               | No               |
| POST   | `/api/admin/auth/webauthn/register/*`                                         | Enrol an admin passkey                                                                                                                                                                                                                                                                                                                              | Admin            |
| GET    | `/api/admin/auth/me`                                                          | The current admin                                                                                                                                                                                                                                                                                                                                   | Admin            |
| POST   | `/api/admin/auth/logout`                                                      | Clear the admin session                                                                                                                                                                                                                                                                                                                             | No               |
| GET    | `/api/admin/metrics`, `/workspaces`, `/workspaces/:id`, `/users`, `/activity` | Platform-wide reads                                                                                                                                                                                                                                                                                                                                 | Admin            |
| DELETE | `/api/admin/workspaces/:id`                                                   | Delete a workspace                                                                                                                                                                                                                                                                                                                                  | Admin            |
| GET    | `/api/admin/feature-flags`                                                    | Every platform flag and whether it is on                                                                                                                                                                                                                                                                                                            | Admin            |
| PATCH  | `/api/admin/feature-flags/:name`                                              | Turn a platform flag on or off. Platform-wide, so platform-admin authority — a workspace `admin` role cannot reach it (GP-107)                                                                                                                                                                                                                      | Admin            |

**Mount order matters.** `apps/api/src/index.ts` registers these with
itty-router, which matches in registration order and stops at the first handler
returning a Response — so every specific path must precede the
`/api/admin/auth/*` catch-all. `/auth/me` sat after it until 2026-09-11, which
made its `requireAdmin` dead code and answered 401 to signed-in admins.
Budgets follow §6.1's split: credential submissions (`setup`,
`webauthn/login/verify`) on `authRateLimit`, everything a page fires on load on
`generalRateLimit`.

### 6.20 Audit / Activity Log

| Method | Path         | Description                             | Auth |
| ------ | ------------ | --------------------------------------- | ---- |
| GET    | `/api/audit` | Paginated activity log with actor names | Yes  |

### 6.21 Chat (GP-055)

| Method | Path                                                                                 | Description                                                                                                                                                                                                                                                                                                                                | Auth |
| ------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| GET    | `/api/chat/rooms`                                                                    | The workspace's rooms, newest first (`ChatRoom[]`, `WIRE_CHAT_ROOM`); `?entityType=&entityId=` narrows to the room about one record                                                                                                                                                                                                        | Yes  |
| POST   | `/api/chat/rooms`                                                                    | Start a room `{ name?, entityType?, entityId? }`. **Dedupes on the entity**: a second POST for the same customer or job answers the existing room (200), not a new one (201)                                                                                                                                                               | Yes  |
| GET    | `/api/chat/rooms/:id`                                                                | One room                                                                                                                                                                                                                                                                                                                                   | Yes  |
| GET    | `/api/chat/rooms/:id/messages`                                                       | History, oldest first (`ChatMessage[]`; `?before=&limit=`)                                                                                                                                                                                                                                                                                 | Yes  |
| GET    | `/api/chat/unread`                                                                   | Per room, how many messages by others the caller has not read (`ChatUnread[]`)                                                                                                                                                                                                                                                             | Yes  |
| GET    | `/api/chat/rooms/:id/ws`                                                             | WebSocket upgrade to the room's Durable Object. Behind `requireAuth` since GP-055 (the cookie rides the handshake — same-site); the room is checked against the caller's workspace first, and the verified identity + room id go to the DO on the URL, which trusts them over the `join` frame                                             | Yes  |
| POST   | `/api/chat/rooms/:id/session`, `/tracks/publish`, `/tracks/pull`; PUT `/renegotiate` | Cloudflare Calls (video). 503 `CALLS_NOT_CONFIGURED` when the Worker has no `CALLS_APP_ID` / `CALLS_APP_SECRET`; the platform says so before asking for the camera                                                                                                                                                                         | Yes  |
| POST   | `/api/chat/rooms/:id/sms-fallback`                                                   | SMS fallback reinstated in its safe shape (GP-110 step 2): body names `recipientUserId` + `message` only; the number is resolved server-side from `users.mobile_phone`, the recipient must be in the workspace and a participant in the room, under a per-workspace daily cap (50, `sms_fallback_sends`). Nothing in the UI offers SMS yet | Yes  |

Every handler reads the principal `requireAuth` attaches (`req.user`,
`req.workspaceId`) — never `req.session`, which nothing sets and which every
chat handler read until 2026-09-14, answering 500 to every authenticated
request behind a green spec that drove no handler with a session. A 101 from
the DO passes through `index.ts` and the error handler untouched: a Response
carrying a WebSocket cannot be rebuilt.

### Query parameters (all list endpoints)

| Param     | Type   | Default | Notes                                 |
| --------- | ------ | ------- | ------------------------------------- |
| `page`    | number | 1       | 1-indexed                             |
| `perPage` | number | 25      | Max 100                               |
| `q`       | string | —       | Full-text search (name, email, phone) |
| `status`  | string | —       | Filter by status enum                 |
| `source`  | string | —       | Filter by source (leads only)         |

---

## 7. USER JOURNEYS

### 7.1 Onboarding

```
1. Contractor lands on greenput.com → clicks "Start Free Trial"
2. Fills out workspace name, trade, contact info
3. Creates owner account (name, email, password)
4. Redirected to app.greenput.com/dashboard
5. Sees empty-state prompts: "Add your first lead"
```

The wizard at `/onboarding` (`apps/platform/src/routes/onboarding`) is seven
steps: 1 account + company + address, 2 services (multi-select), 3 service
area + radius, 4 branding (colour, logo URL — optional), 5 review (the button
that registers), 6 passkey enrolment, 7 done. Every answer it asks for reaches
`POST /api/auth/register` (GP-039); steps 2 and 3 are the only gates, and
both gate on an answer that is stored. There is no team-size or integrations
step — nothing consumed either.

### 7.2 Lead → Opportunity → Job (the core pipeline)

```
1. Lead arrives (manual entry, website form, campaign)
   → status: "new"
2. Contractor contacts lead
   → status: "contacted"
3. Contractor qualifies lead
   → status: "qualified"
4. Contractor converts lead to opportunity
   → POST /api/leads/:id/convert
   → Lead status: "converted", Opportunity created (status: "open")
5. Contractor sends proposal
   → Opportunity status: "proposal_sent"
6. Customer accepts
   → Opportunity status: "won"
7. Contractor converts opportunity to job + customer record
   → POST /api/opportunities/:id/convert
   → Job created (status: "scheduled"), Customer created/linked
8. Technician performs work
   → Job status: "in_progress" → "completed"
9. Office sends invoice
   → Job status: "invoiced"
10. Payment received
    → Job status: "paid"
```

### 7.3 Campaign workflow

```
1. Contractor creates a campaign (channel, target area, budget, dates)
2. Campaign goes "active"
3. Leads flow in with source = "campaign" + campaignId link
4. Dashboard shows campaign ROI: spend vs. lead count vs. converted revenue
5. Campaign ends → status: "completed"
```

### 7.4 Daily dashboard usage

```
1. Contractor opens app.greenput.com → /dashboard
2. Sees KPI cards: leads this month (+ growth %), active jobs, due this week,
   revenue this month (+ growth %), conversion rate
3. Sees recent activity feed (last 10 actions across all entities)
4. Clicks through to leads, jobs, customers for detail views
```

---

## 8. ROUTE MAP (BaseNative SPA)

Routes live in [`apps/platform/src/routes/table.ts`](apps/platform/src/routes/table.ts). Each route exports a `render(deps): RouteView` function from its folder; the shell maps the matched route name to the renderer in [`shell.ts`](apps/platform/src/shell/shell.ts). Routes with `:id` params go through `PARAM_ROUTE_RENDERERS` and remount on param change.

| Path                    | Renderer                       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                     | (redirect)                     | Placeholder route → `/dashboard`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/login`                | `renderLoginRoute`             | Passkey-only sign-in                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/recover`              | `renderRecoverRoute`           | One-time-code recovery, when no passkey works                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/accept-invite/:token` | `renderAcceptInviteRoute`      | Where an invited teammate lands (GP-008): previews the invitation, then one button accepts it (session), enrols a passkey and goes to `/dashboard`; says plainly when enrolment fails after the accept                                                                                                                                                                                                                                                                                                                                                                                    |
| `/onboarding`           | `renderOnboardingRoute`        | 8-step workspace setup wizard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/dashboard`            | `renderDashboardRoute`         | KPI cards + activity feed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/leads`                | `renderLeadsRoute`             | List + kanban with status/source filters; one lifecycle action per lead (Qualify → Accept → Withdraw, read from `qualifiedAt`/`acceptedAt`/`withdrawnAt`), Accept and Withdraw behind an `alertdialog` that states the fee first; the name column links to `/leads/:id`                                                                                                                                                                                                                                                                                                                   |
| `/leads/:id`            | `renderLeadDetailRoute`        | One lead (GP-003): definition list of its fields, Edit swaps them for a `buildPanel()` form that PATCHes only what changed (`contact`/`address` nested), Delete (owner/admin) behind an `alertdialog` that shows the API's refusal, plus the same lifecycle action and Convert as the list row. Frame: `routes/shared/detail.ts`                                                                                                                                                                                                                                                          |
| `/opportunities`        | `renderOpportunitiesRoute`     | Kanban + list, convert-to-job                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/opportunities/:id`    | `renderOpportunityDetailRoute` | One deal (GP-003): fields, Edit (value typed in dollars, sent in cents) and Delete through the shared detail frame, plus the same Convert the card carries — `routes/opportunities/convert.ts` is the one convert panel both mount; a deal with a job is refused by `ON DELETE RESTRICT` and the dialog says so in the API's words                                                                                                                                                                                                                                                        |
| `/jobs`                 | `renderJobsRoute`              | List + week-grid calendar with drag-drop; `?view=calendar&week=YYYY-MM-DD` opens the calendar on that week; Request review on a paid row shows the message to copy and records a `pending` request (GP-047); "Mark invoiced" and "Copy invoice link" show the share card (`routes/shared/share-link.ts`, GP-008)                                                                                                                                                                                                                                                                          |
| `/jobs/:id`             | `renderJobDetailRoute`         | One job (GP-003): status, technician (the entity-select over `GET /api/workspace/users`, assignable roles only; `assignedTo: null` unassigns), schedule editor (`datetime-local` in, ISO out; a `409 SLOT_TAKEN` keeps the form open with the API's message), address, read-only line items, Delete, and "Copy invoice link" showing the share card when `invoiceToken` exists (GP-008)                                                                                                                                                                                                   |
| `/customers`            | `renderCustomersRoute`         | Directory + search + create panel; the name column links to `/customers/:id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `/customers/:id`        | `renderCustomerDetailRoute`    | One customer (GP-003): contact and service address, Edit/Delete through the shared detail frame, and the job history `GET /api/customers/:id` carries; a customer with active jobs cannot be deleted and the dialog says so in the API's words                                                                                                                                                                                                                                                                                                                                            |
| `/estimates`            | `renderEstimatesRoute`         | Dynamic line-item editor + computed margin; "Mark sent" and "Copy proposal link" show the share card (GP-008)                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/estimates/:id`        | `renderEstimateDetailRoute`    | One proposal (GP-003): fields, the line items with their type and the labor / materials split (GP-038), Edit through the same costing editor as New estimate (`routes/estimates/costing.ts`; totals are the API's, never sent), Delete (draft only — the API's refusal is shown), Mark sent / Mark accepted and the proposal share card                                                                                                                                                                                                                                                   |
| `/campaigns`            | `renderCampaignsRoute`         | Status-badged table + channel filter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/inventory`            | `renderInventoryRoute`         | Stock-level table + adjust modal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/vehicles`             | `renderVehiclesRoute`          | Card grid with inline status select                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/activity`             | `renderActivityRoute`          | Paginated audit log                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/reviews`              | `renderReviewsRoute`           | Stats card + reviews/requests tabs; connected to no platform, so the copy promises none (GP-047)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/plugins`              | `renderPluginsRoute`           | Marketplace / Installed tabs + categories                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/reports`              | `renderReportsRoute`           | 4-tab analytics: revenue / pipeline / etc.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/settings`             | `renderSettingsRoute`          | 9 tabs incl. availability (booking hours, GP-101; `?tab=availability` opens it — onboarding's last step links there) and passkey enrollment                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/chat`                 | `renderChatListRoute`          | Messages (GP-055): every room in the workspace, linked to `/chat/:id`, what each is about and its unread count (`GET /api/chat/rooms` + `/unread`); "New conversation" starts one for the crew. In the nav under The work                                                                                                                                                                                                                                                                                                                                                                 |
| `/chat/:id`             | `renderChatRoute`              | One room: WebSocket messaging + Cloudflare Calls video. Named from `GET /api/chat/rooms/:id`, links to the customer or job it is about, back to `/chat`. The socket goes to the API origin (`chatSocketUrl`: `resolveGreenPutApiBase` with `wss:`), never to the page's host. Video degrades to a plain message on `CALLS_NOT_CONFIGURED`, before any camera prompt; there is no "send as SMS" (GP-110). Reached from Message on `/customers/:id` and `/jobs/:id` (`routes/shared/conversation.ts`: look the room up by entity, create it named after the record only when there is none) |

### 8.1 Tenant micro-site routes (`apps/tenant-site`)

Server-rendered HTML strings from `@basenative/server` + `@basenative/components`
— no SPA, no client bundle. Handled in `src/index.ts` after the host has been
resolved to a workspace.

| Path                                   | Handler                                                                       | Description                                                                                                                                                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`, `/services`, `/about`, `/contact` | `renderTenantPage`                                                            | The marketing pages, with LocalBusiness JSON-LD                                                                                                                                                                                                                         |
| `POST /leads`                          | `handleLeadSubmission`                                                        | The contact form — JSON for the page's own fetch(), or a form-encoded post answered with a 303 to `/contact?sent=1` / `?error=<key>` (GP-004)                                                                                                                           |
| `/proposal/:id`                        | `renderProposalPage`                                                          | Read-only estimate for a customer                                                                                                                                                                                                                                       |
| `/invoice/:token`                      | `generateInvoiceHtml` (`libs/shared/documents`)                               | The invoice for `jobs.invoice_token`, status `invoiced` / `paid`, scoped to this workspace (GP-008); wrong, foreign or pre-032 token → 404; `Cache-Control: no-store`, noindex                                                                                          |
| `/quote`                               | `renderIntakeIndexPage`                                                       | The jobs this contractor prices instantly                                                                                                                                                                                                                               |
| `POST /quote/start`                    | `handleQuoteRequest`                                                          | Begins a session, 303 to its first screen                                                                                                                                                                                                                               |
| `/quote/s/:id`                         | `renderIntakeScreenPage` / `renderIntakeQuotePage` / `renderIntakeBookedPage` | One screen of the form, the finished price, or — once booked — the confirmation                                                                                                                                                                                         |
| `POST /quote/s/:id`                    | `handleQuoteRequest`                                                          | Answers that screen and advances — including the panel photo, as `multipart/form-data`. With `nav=back` (+ the screen's hidden `prevStateId`) or `nav=restart` it steps back a screen or starts over on the same id instead, handled before any answer is read (GP-014) |
| `/quote/s/:id/book`                    | `renderIntakeBookingPage`                                                     | The times this quote can be booked for, grouped by the contractor's local day (GP-103)                                                                                                                                                                                  |
| `POST /quote/s/:id/book`               | `handleQuoteRequest`                                                          | Books the `startUtc` slot through the `job_slots` batch (GP-104), 303 to `/booked`; a taken or stale slot re-renders the picker                                                                                                                                         |
| `/quote/s/:id/booked`                  | `renderIntakeBookedPage`                                                      | The slot in local time, the price band, the contractor's number, and the two things they can do next: pick a different time, or cancel — both free (GP-105)                                                                                                             |
| `/quote/s/:id/reschedule`              | `renderIntakeBookingPage` (reschedule mode)                                   | The times the booking could move to — its own half-hours offered as free, sized by the length on the calendar (GP-105)                                                                                                                                                  |
| `POST /quote/s/:id/reschedule`         | `handleQuoteRequest`                                                          | Moves the job to `startUtc` in ONE `bookInFreeLane` batch (schedule, old slots out, new slots in), 303 to `/booked`; a taken or stale slot re-renders the picker and the original booking is untouched                                                                  |
| `/quote/s/:id/cancel`                  | `renderIntakeCancelPage`                                                      | The reason radios and one button; says cancelling costs nothing before it asks                                                                                                                                                                                          |
| `POST /quote/s/:id/cancel`             | `handleQuoteRequest`                                                          | Cancels the job, frees its `job_slots` rows and withdraws the lead through `withdrawLead` in ONE batch, 303 to `/quote/s/:id`, which now shows the cancelled state with the offer to book again                                                                         |

`renderTenantPage` publishes only what the workspace row backs (GP-011): a
licence line only when `license_num` is set, and never "insured"; the About
page's hours block and the LocalBusiness `openingHoursSpecification` only from
`workspace_availability` rows (GP-101), which `src/index.ts` reads and passes
as the `availability` option — no rows, no hours; the FAQ and its FAQPage
JSON-LD are built from one array. No 24/7 line, no free-estimates promise.

The quote form posts to the tenant's **own** origin, not to `api.greenput.com`:
the site's CSP is `connect-src 'self'` and `form-action 'self'`, so a
cross-origin form would be blocked by the browser. It is POST-redirect-GET and
needs no JavaScript — a homeowner in a garage on one bar can finish it. The
`/api/public/intake/*` endpoints in §6.18 are the same flow for any other
client; both go through `libs/shared/pricing`, so they cannot drift.

**Back and Start over (GP-014).** Every screen is the same URL and the screen
shown is derived from the stored answers, so the browser's Back button cannot
move the form. Going back is a write. The screen form carries two more named
submits — `name="nav" value="back"` (only when the event log has a previous
screen; `renderIntakeScreenPage` gets it as `prevStateId`, read by
`previousStateId(events)` in the route, never from the client) and
`name="nav" value="restart"` (always, least prominent, last) — both
`formnovalidate`, on the same form, so nothing leaves `form-action 'self'`
and no route is added. `submitScreen` branches on `nav` BEFORE the finished-
session redirect and BEFORE the stale-tab guard (which would otherwise
swallow a Back as a stale answer). A screen stepped back to shows what was
chosen (`undoneInputFor`, through the same coercion) — shown, not stored.
The price page offers the same reset as "Start over" in its "What happens
next" footer. A BOOKED session (`findBookedJob`) ignores both and the
redirect renders the confirmation.

**Booking (GP-103).** A PRICED outcome (`qualifies()` in `libs/shared/pricing`:
kind `quote`, never `span` / `no_quote` / `urgent` / `referral`) on a workspace
that is bookable (§6.15.1) gets a "Book a time" card on the price page. The
slots come from `offerSlots` in `apps/tenant-site/src/booking.ts`: the
workspace's week, exceptions and policy from D1, its scheduled / in-progress
jobs, `generateSlots` from `libs/shared/scheduling`, and the duration from
`estimatedDurationMinutes(result)`. Booking writes the customer, the
opportunity (`lead_id` = the session's lead), the job (`scheduled`, at the
slot), its `job_slots` rows, the lead's conversion and the `activity_log` rows
in ONE `bookInFreeLane` batch — the guard in `libs/shared/scheduling/job-slots.ts`
that `POST /api/jobs` uses too; there is no check-then-insert. The job is
created BEFORE the contractor accepts the lead: what they are then charged
for is a booked job with a time on it. Availability absent (no timezone, no
open weekday) degrades to the "someone will be in touch" card, never to an
empty picker, and slot generation never guesses UTC. The session → job link
is the pipeline's own (session `lead_id` → `opportunities.lead_id` →
`jobs.opportunity_id`); no new column.

**Change or cancel (GP-105).** The same capability, no account. GP-105's
original policy — the contractor's fee is waived unconditionally,
platform-wide — is **retired, superseded by Canonical Model v14 + WS-1
(2026-10-25)**: the fee bills at booking, and cancel after booking means
**the fee stands at any distance** — a `pending` row stays `pending` and
collectible, an invoiced row is untouched, and the only reversal is
`refundLeadFee` for proven fraud or platform fault (FR-1.4).
`cancelQuotedJob` in `apps/tenant-site/src/booking.ts` sets the
job `cancelled`, deletes its `job_slots` rows and calls `withdrawLead`
(§6.3) with those statements `alongside`, so the slot and the withdrawal land in one
transaction; the reason from the form is stored on `leads.withdrawn_reason`
and nothing is decided by it. `rescheduleQuotedJob` moves the ONE job row
through `bookInFreeLane` — the homeowner never passes through a state with no
slot, and a lost race leaves them the time they had. Booking again after a
cancellation reuses the customer and the opportunity the first booking wrote
(`bookQuotedJob` re-points `converted_to_job_id`); the lead's `withdrawn_at`
is NOT cleared by a re-book, so a lead withdrawn and re-booked stays
unacceptable — whether a re-book should reopen the lead is an owner decision
this code does not make. No lead id or job id ever crosses to the browser.

**Error pages (GP-040).** Once the host has resolved to a workspace, every
404 is still the contractor's site: `renderTenantErrorShell(workspace,
{ title, message, actions })` in `src/render.ts` goes through
`renderTenantShell` (nav, footer, phone), always `noindex`, with the
caller's own `actions` (`{ href, label, variant? }`) as the way out —
`/quote/s/*` (any action, `intake-routes.ts` `notFound`) offers "Start a new
quote" → `/quote` and home; `/proposal/:id` and `/invoice/:token` offer home
and "Get in touch" → `/contact`, `Cache-Control: no-store`. The bare
`renderTenantErrorPage` is only for a host or slug that resolves to nothing.
The branded `notFoundTemplate` gates its second CTA on `hasQuote` like the
nav: `/quote` "Get a price" when a flow is published, else `/contact`.

---

## 9. IMPLEMENTATION PHASES

### Phase 1 — Foundation (DONE)

- [x] Nx monorepo scaffold with apps and libs
- [x] Cloudflare D1 schema (`schema.sql`)
- [x] Shared domain types (`libs/shared/models`)
- [x] Cloudflare Workers API skeleton (`apps/api`)
- [x] Auth endpoints (login, logout, me) with session cookies + KV
- [x] Leads CRUD + convert endpoint
- [x] Dashboard stats endpoint
- [x] Platform shell with lazy-mounted routes (originally Angular, since fully rewritten on BaseNative — see §4.1 for the removal record and ADR 001)
- [x] Signal stores (auth, leads, jobs, customers)
- [x] ApiService for HTTP calls
- [x] Shared pipes (RelativeTimePipe, CurrencyPipe) and directives (StatusBadgeDirective)

### Phase 2 — Core Pipeline

- [x] Opportunities CRUD + convert-to-job endpoint
- [x] Jobs CRUD + invoice/paid status endpoints
- [x] Job line items management
- [x] Customers CRUD with job history
- [x] Full dashboard wiring (live data in all KPI cards)
- [x] Activity log entries for all entity mutations

### Phase 3 — Campaigns & Marketing

- [x] Campaigns CRUD
- [x] Campaign ROI metrics (`/api/reports/campaigns` — leads generated, cost per lead, revenue attributed)
- [x] Marketing site (`apps/marketing`) — landing pages, pricing, signup
- [x] Tenant micro-site (`apps/tenant-site`) — per-contractor public page with lead capture

### Phase 4 — Polish & Production

- [x] Workspace settings + user management endpoints
- [x] Role-based access control (owner > admin > office > tech) — `requireRole` middleware in `apps/api/src/middleware/rbac.ts`; applied to billing routes; workspace routes use inline role checks
- [x] Proper password hashing (Web Crypto PBKDF2 via `apps/api/src/lib/password.ts`)
- [x] Input validation with Zod (`libs/shared/validators`)
- [x] E2E tests (Playwright)
- [x] Pact contract tests
- [x] CI/CD pipeline (GitHub Actions → Cloudflare via `.github/workflows/`)
- [ ] Error tracking, logging, monitoring

---

## 10. IMPLEMENTATION RULES

### 10.0 Tests must not stub the thing they are testing

Two defects shipped to production behind a fully green suite, on the same day, for the same
reason: **the test supplied the very shape it was supposed to be checking.**

**`PATCH /api/workspace` returned 500 on every call it ever received.** It opened its UPDATE
with `updated_at = ?` and `workspaces` had no such column. Eleven tests covered that
endpoint and all passed, because they build `env.DB` from `vi.fn()` mocks — `prepare()`
returns a stub that never parses the SQL. One of them even asserted the `activity_log` write
happened, by counting `run()` calls on the mock. A mock cannot know a column is missing.

**Leads and Customers threw on every load.** `apps/api` returns D1 rows verbatim
(`data: rows.results` — flat, snake_case, the literal column names); `apps/platform` reads
the nested camelCase shapes in `libs/shared/models`, e.g. `lead.contact.email`. There is no
`contact` column, so `lead.contact` was `undefined`. All **sixteen** e2e specs intercept
`**/api/**` and serve hand-written camelCase fixtures containing a `contact: {}` object the
real API has never returned. The suite was green against a shape that did not exist for as
long as the product has existed. Money had the same disease: the platform treats amount
columns as cents, `apps/api/src/lib/pdf/invoice.ts` printed them as dollars, so invoices
rendered 100x wrong.

Neither is a diligence failure. A fixture is written by whoever wrote the consumer, from the
consumer's point of view — it encodes what the reader _wishes_ it received, and can never
discover that the producer disagrees.

**So, two rules.**

1. **Schema-dependent code is tested against the real schema.** If correctness depends on a
   column existing, on NOT NULL, on a CHECK or a FOREIGN KEY, use `createSqliteD1` from
   `@greenput/shared/testing` over the real `schema.sql`. It speaks D1's
   `prepare().bind().run()` surface over `node:sqlite` with foreign keys on, so the handler
   runs unmodified and a missing column is an error exactly as it is in production. Mocks
   remain fine for routing, auth guards and status codes — they are worthless for anything
   the database would have rejected.

2. **Producer and consumer are exercised from ONE definition.** Where both live in this
   repo, at least one test must drive the real Worker and parse its real response with the
   real consumer. The check that tells you it is a real test:
   **rename one field in the producer and something must fail.** If everything still passes,
   the tests are fiction.

Note also that `schema.sql` and the live databases disagree about constraints: four columns
on `workspaces` are declared `UNIQUE` or `CHECK` in `schema.sql` and have neither in
production, because they were added by `ALTER TABLE ADD COLUMN` and SQLite cannot attach
those that way. `check-migration-coverage.mjs` tracks only name and NOT NULL. So a test
against `schema.sql` can pass while the same code is unconstrained live — if your
correctness rests on a constraint, verify it exists on the live database.

### 10.1 File creation

- One component / route handler / service per file.
- Co-locate test files: `foo.ts` → `foo.spec.ts`.
- Name files in `kebab-case`. Name classes/interfaces in `PascalCase`.

### 10.2 API route handlers

- Each resource gets its own file in `apps/api/src/routes/`.
- Use `itty-router` sub-routers with a `base` path.
- Always scope queries to `workspace_id` from the authenticated session.
- Return responses through the `json()` / `error()` / `notFound()` helpers
  in `apps/api/src/lib/response.ts`.
- Log all mutations to `activity_log`.

### 10.3 BaseNative routes

- Each route is a folder under `apps/platform/src/routes/` exporting a
  `render(deps): RouteView` function. The shell calls it with the typed
  `PlatformDeps` and mounts `view.element`; on navigation it calls
  `view.dispose()` to free signal subscriptions, listeners, and resources.
- State is `signal()` / `computed()` / `effect()` from `@basenative/runtime`.
  No global stores — instantiate per-route, derive cross-route state
  through `deps`.
- Async data uses `createResource(fetcher)` from `@basenative/fetch` —
  exposes reactive `data` / `loading` / `error` plus imperative
  `reload()` / `mutate()` / `set()` / `dispose()`.
- DOM is built with the `el(tag, attrs, ...children)` helper from
  `apps/platform/src/lib/dom.ts`. Returned views are real `HTMLElement`s,
  not strings.
- Form panels reuse `buildPanel()` from `routes/shared/panel.ts` so
  every create / edit flow has the same submitting / error / footer
  behavior.

### 10.4 Styling

- **No CSS classes.** Every styling hook is a `data-bn-*` attribute on
  semantic HTML. Selectors target attribute presence + values
  (`[data-bn-card]`, `[data-bn-badge][data-bn-status='active']`).
- **Adopted stylesheets.** Each route or component declares its CSS via
  `defineSheet(\`…\`)`and adopts it once on mount with`adoptSheet()`.
No `<style>` tags, no inline styles, no class-based scoping.
- **CSS custom properties** for every color, spacing, radius, font size,
  shadow, and z-index — defined once in `apps/platform/src/styles/tokens.ts`.
- **Mobile-first.** Base styles target small screens; opt into larger
  layouts with `@media (min-width: …)`.
- No CSS frameworks (no Tailwind, no Bootstrap).
- When a `[hidden]` attribute is set on an element styled with
  `display: grid` / `inline-flex`, add an explicit
  `[data-bn-x][hidden] { display: none }` rule — browser default
  `[hidden] { display: none }` loses the cascade fight otherwise.

### 10.5 Testing

- **Unit tests:** Vitest with happy-dom, configured per-app
  (`apps/platform/vitest.config.ts`). Each route lives next to a
  `*.spec.ts` that mounts the route into `document.body` via the
  `buildTestDeps` + `createFakeFetch` helpers in `src/test/helpers.ts`,
  then asserts on rendered DOM.
- **Contract tests:** Pact + `@pactflow/pact-msw-adapter` for API
  contracts (unchanged from Angular — the API surface didn't move).
- **E2E tests:** Playwright for critical user journeys. Two projects:
  `chromium` drives the platform SPA against the static build (`SERVE_STATIC=1`),
  and `tenant-site` drives the consumer quote form against a real Worker —
  `scripts/e2e/tenant-dev.sh` stands up `wrangler dev` over a local D1 with the
  real schema and the real seeded machines, and Chromium reaches it as
  `demo.greenput.site` via `--host-resolver-rules`. It is served over HTTPS
  because the site's own CSP carries `upgrade-insecure-requests`.
- **Product screenshots:** `node scripts/screenshots/capture.mjs` shoots the five
  tiles greenput.com/features shows from the real product — the platform build
  plus apps/api and apps/tenant-site in-process over `createSqliteD1` and
  `scripts/screenshots/seed.sql` — into `apps/marketing/assets/screens/`; the
  header of `capture.ts` has the build step and what each shot must show.
- Run: `pnpm exec nx run platform:test` (unit), `pnpm exec nx run-many --target=test`
  (everything), `pnpm exec nx e2e <project>` (E2E).

### 10.6 Database

- Schema changes go in **two** places: the `CREATE TABLE` body in `schema.sql`
  (what a fresh database gets) **and** a new file in `migrations/` (what an
  existing database gets). `schema.sql` alone does nothing for `greenput` or
  `greenput-staging`. CI fails the build if they disagree — run `pnpm db:check`.
  See `migrations/README.md`.
- Use parameterised queries (`env.DB.prepare(...).bind(...)`) — never
  string-concatenate SQL.
- UUID v4 for all primary keys, generated via `crypto.randomUUID()`.
- Timestamps are ISO 8601 strings stored as `TEXT`.

### 10.7 Security

- Auth via `HttpOnly; SameSite=Strict; Secure` session cookies.
- Sessions stored in Cloudflare KV (`SESSIONS` binding).
- CORS restricted to known origins.
- Security headers applied to every response (CSP, X-Frame-Options, etc.).
- Never expose `password_hash` in API responses.
- All inputs must be validated before touching the database.

---

## 11. PLAN MODE INSTRUCTIONS

When asked to plan (rather than implement), follow this protocol:

1. **Restate the goal** in one sentence.
2. **List affected files** — every file that will be created or modified.
3. **Describe changes per file** — bullet points, not full code.
4. **Identify risks / open questions** — things that could go wrong or need
   clarification.
5. **Propose a testing strategy** — what unit tests, contract tests, or E2E
   tests to add.
6. **Wait for approval** before writing any code.

Do not generate implementation code during plan mode. Plans should be
detailed enough that a developer (or Claude Code in implementation mode)
can execute them without ambiguity.

---

## 12. COMPLETION CRITERIA

A task is **done** when:

1. All new/changed code compiles with zero TypeScript errors.
2. All new/changed code has co-located `.spec.ts` tests that pass.
3. `npx nx lint <project>` passes with zero warnings.
4. The feature works end-to-end: API endpoint → BaseNative UI → visible result.
5. No regressions — existing tests still pass.
6. Code follows every rule in Section 2 (CONSTITUTION).
7. Any new API endpoint is documented in Section 6 (API ENDPOINTS) of this
   file.
8. Any new route is documented in Section 8 (ROUTE MAP) of this file.
9. Commit message follows Conventional Commits format.

---

## 13. CLAUDE CODE PIPELINE / BACKLOG

You will continuously pull from this backlog to develop Greenput. Proceed in this order:

### Epic 1: Schedule-Aware Lead Routing (Phase 2 Focus) **[DOGFOODING REQUIRED]**

- **Task A**: Do not build a native UI calendar block here. You must pause, go to the upstream `basenative` monorepo, and build a generic Drag-and-Drop Calendar/Pipeline block component utilizing CSS grid natively.
- **Task B**: Add an endpoint `GET /api/jobs/schedule` that returns block coordinates for all `scheduled` or `in_progress` jobs.
- **Task C**: Implement the drag-and-drop dispatcher in the UI by consuming the `@basenative/components` block, tying lead cards from the Opportunity Kanban board directly onto the timeline.

### Epic 2: Estimates & Proposals Module (Phase 3 Focus)

- **Task A**: Create 'Estimates' feature module in `apps/platform/src/app/features/estimates`.
- **Task B**: Implement a dynamic form for 'Job Costing' that allows the user to append labor rows and material rows, computing estimated margin using signal `computed()` properties.
- **Task C**: **[DOGFOODING REQUIRED]** Build the read-only proposal route in `apps/tenant-site`. This micro-site must be built entirely utilizing `@basenative/server`, `@basenative/router`, and `@basenative/components`. Do not write raw HTML templates or use a separate framework here.

### Epic 3: Real-Time Persistent Chat (Phase 3 Focus)

- **Status (2026-09-14, GP-055 — owner decided: ship it).** Tasks A and B are shipped and reachable: `/chat` (Messages) is in the nav, and Message on a customer or a job opens the room about it (§6.21, §8). The DO endpoint is `/api/chat/rooms/:id/ws` (not `/api/chat/sync`), now authenticated; the socket manager is the route's own reconnecting client — no `@basenative/realtime` exists upstream, and nothing here should be blocked on building one. Read receipts (Task C, first half) ship. The SMS fallback (Task C, second half) is closed at 410 and its proper shape is GP-110, now unblocked: `recipientUserId`, a new `users.mobile_phone`, a per-workspace daily cap. Video (Cloudflare Calls) ships as-is behind `CALLS_APP_ID` / `CALLS_APP_SECRET`.
- **Task A**: Implement a Durable Objects WebSocket endpoint (`/api/chat/sync`) in the Cloudflare Worker to act as a centralized messaging hub between dispatchers and technicians.
- **Task B**: Build the real-time chat UI across `apps/platform`. Utilize the upstream `@basenative/realtime` socket connection manager (verify it exists, if not build it upstream!).
- **Task C**: Implement message read-receipts and SMS fallback logic via Twilio for offline clients.

### Epic 4: Physical Asset Catalog Engine (Phase 3 Focus)

- **Task A**: Build the `Asset Inventory` data model in the D1 edge database (`assets`, `maintenance_logs`, `assignments`).
- **Task B**: Implement QR-Code generation API endpoints for tagging physical inventory.
- **Task C**: Create the scanner web-interface in `apps/platform` — NOT `apps/tenant-site`, which has no session and served the asset register to anyone with a label until 2026-09-13 (GP-022) — for fast, mobile-friendly technician check-ins over `GET /api/assets/lookup/:qrCode`, utilizing the device camera stream and `@basenative/components`.

---

_Last verified against the code: 2026-09-14. §6.21 and the `/chat` rows in §8 record chat as shipped (GP-055): the list route, the Message action, the authenticated socket on the API origin, and the `req.session` bug that had 500ed every chat request. §3/§4.2/§6.1.1 gain `apps/brand-assets` at brand.greenput.com (GP-108); §4.2 gains the R2 bucket both Workers bind; §6.18 gains the panel-photo upload, the contractor review queue, the qualification rule and the honest note that photo interpretation is unsolved; the feature-flag control surface that turns that dark surface on lives under §6.19's platform-admin authority (GP-107); §10.5 documents the second Playwright project._

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
