# Greenput — Product Requirements Document

> Status: **active** · Owner: Warren Dugan · Last updated: 2026-10-16 (corrected against the code — the FSM pricing engine has landed since the 2026-09-11 pass; see the Goal 1 correction below. Original framing: the owner's 2026-09-10 statement of the product premise — see `duganlabs-survey/greenput-consent-model.md` and `greenput-fsm-pricing.md`)

## 1. Overview

Greenput is a commercial SaaS platform for residential trade contractors —
electricians, plumbers, HVAC techs, roofers. The owner's own framing:
Greenput is the contractor's **host, engineering center of excellence, and
UX** — it hosts the contractor's site, runs their ads, and captures and
prices the lead the contractor receives. **This includes sourcing traffic**,
not just managing leads a contractor already has (see §Non-goals below,
corrected from an earlier version of this document that said the opposite).

The consumer, not any single contractor's workspace, is the durable asset:
Greenput owns the consumer's data as a single party, and a consumer can
withdraw their data from one contractor and route it to another — driven by
price, responsiveness, or availability — a reciprocity network mediated by
consumer consent, not a one-way lead-sale marketplace. Economically,
**whichever contractor receives a lead that qualifies and is accepted owes
the fee, regardless of who sourced the traffic** — including a contractor
who sourced their own lead. There is no credit or rebate for whoever
originated the traffic; the benefit to an "originating" contractor whose
lead ports away is avoided waste (storage and follow-up cost on a lead they
would never have converted), not compensation.

Longer-term, the tradesperson authors their own intake flows — the FSM
pricing model in Goal 1 below — and Greenput grows into Greenput OS: a
full business operating system running on BaseNative hardware over a
multi-year arc. **The Goal 1 pricing ENGINE is built today** (an
operator-seeded finite-state-machine evaluator with five seeded
electrical services — see Goal 1); what is not built is the
tradesperson-facing AUTHORING of flows. Materials must say exactly
"pricing engines defined as FSMs per service" — the engine is real, the
authoring is not. See the "Built vs. not built" callouts throughout this
document, and `greenput-fsm-pricing.md` for the full design sketch.

## 2. Goals

1. **Tradesperson-authored dynamic pricing (FSM)** — the contractor defines
   an enrichment flow (a directed graph of questions with guarded
   transitions) that deterministically yields a price range at the terminal
   state, combined with the contractor's own rate card.
   **Engine built; authoring not built.** The 2026-09-11 version of this
   document said no FSM concept existed in the pricing code — that is no
   longer true. `libs/shared/pricing` is a complete FSM pricing engine
   (graph traversal, evaluation, validation, rate cards, quote sessions;
   migration 010 created `pricing_fsms` / `pricing_fsm_versions` /
   `rate_cards` / `rate_card_versions` / `pricing_quote_sessions` /
   `pricing_photo_reviews`), seeded with five electrical services
   (`seeds/pricing/*.fsm.json` + `rate-card.default.json`) and exercised
   by the intake routes. The machines are OPERATOR-seeded: a contractor
   cannot yet author or edit their own flow — the authoring UX (Goal 1's
   original promise) remains unbuilt, and `/estimates`
   (`apps/platform/src/routes/estimates/`) is still the separate
   contractor-facing, human-typed labor/material calculator used *after*
   a job is already won. See `greenput-fsm-pricing.md` for the design
   and `docs/pricing-fsm-designs.md` for the seeded machines' rationale.
2. **Schedule-aware lead delivery** — leads route to open calendar slots;
   when full they queue rather than drop.
   **Built (2026-10-16); no production enrollments yet.** The
   capacity layer landed first: workspace availability + exceptions
   (migration 027), the `job_slots` double-booking guard (migration
   028, `bookInFreeLane` in `libs/shared/scheduling`), pure slot
   generation (`generateSlots`), and the per-user
   `availability_windows` / `availability_blackouts` /
   `schedule_buffers` / `schedule_settings` tables (captured into
   migrations 2026-10-16, 035). The delivery engine is now on top of
   it: `POST /api/leads/:id/deliver`
   (`apps/api/src/lib/schedule-delivery.ts`, pure slot-finding in
   `libs/shared/scheduling` `findAutoBookSlot`) books the job into the
   first in-scope slot, accepts the lead, and meters the delivery fee
   — delivery into the schedule IS the billing event. Scope is
   shop-configured enrollment (migration 038,
   `schedule_delivery_enrollments`): which windows are exposed
   (TIME), which services may auto-book (SERVICE), which team members
   are in (TEAM). Enrollment is configuration, not a paid tier.
   Out of scope returns a typed miss and the lead stays on the
   request-and-confirm flow; `POST /api/leads/:id/delivery/undo` is
   the one-tap undo (job cancelled, slots freed; the booking fee stands —
   undo is not a waiver, WS-1). The MCP
   `request_booking` returns a confirmed slot when a booking lands in
   scope. Still true: the public capture paths do not yet call
   delivery automatically at intake — delivery is an explicit action
   on the lead until shops have enrolled and the flow is proven.
3. **Per-lead billing, receiver-pays** — revenue scales with leads that
   qualify and are accepted, billed to whichever workspace receives them.
   **Built**, though not "tied to schedule density" as an earlier version
   of this document claimed. `apps/api/src/lib/lead-meter.ts`
   (`recordLeadMeter`) bills the per-lead rate at **booking commit**
   (WS-1, canonical model v14); `POST /api/leads/:id/accept` and pool
   accept are state transitions that bill nothing. Both require
   `qualified_at IS NOT NULL`. Rates and classification live in the
   single rate-card file, `apps/api/src/lib/lead-rate-card.ts`: an
   explicit service→vertical map (exact match; FSM slugs and display
   names included) with placeholder rates pending the pilot. The
   substring inference this document's earlier drafts implied is gone
   (it priced "evaluation" as an EV-charger lead), and an unmapped
   service now fails loudly (422 `UNMAPPED_SERVICE`) instead of billing
   a silent $0. Withdrawal before a booking bills nothing; after a
   booking the fee stands — withdrawal never waives it, and only
   `refundLeadFee` reverses it (fraud or platform fault;
   `leads.withdrawn_at`, `schema.sql`). No schedule-density variable exists in the pricing.
4. **First-party, portable data** — no third-party tracking; the consumer's
   data is portable between contractors, not "owned" by any one workspace.
   **Mechanism built (2026-10-16); no production pool traffic yet.** The
   2026-09-11 pass recorded no cross-workspace consumer identity, no
   consent grant record, and no reassignment path. All three now exist:
   `consumers` (one row per person, matched by phone then email —
   migration 037), `consent_records` (the persisted grant record:
   grantee workspace, fields, purpose, reroute flag, granted/revoked
   timestamps — migration 036, `libs/shared/consent`), and the pool
   reassignment path (`lead_offers` / `lead_transfers`,
   `apps/api/src/lib/pool.ts`): a lead may be offered only under the
   consumer's reroute consent, and on acceptance it moves, the receiver
   gets its own grant record, and the per-lead fee bills to the receiver
   when the lead is booked (pool accept itself bills nothing).
   A lead still belongs to exactly one workspace at a time
   (`leads.workspace_id NOT NULL`); portability is a MOVE, not a share.
   Contractor-side export exists (`apps/api/src/routes/compliance.ts`)
   but exports a workspace's own data, not a consumer-portable record.
   See `greenput-consent-model.md` §1, §3 for the original gap analysis.
5. **Pilot conversion** — electrician pilot converts leads at 2× the
   rate of their previous CRM within 90 days. Not verifiable from code;
   carried forward as stated.

## Non-goals

- ~~Consumer-facing lead generation (Greenput manages leads the contractor
  already receives, it does not source them).~~ **This was backwards and
  is corrected:** consumer-facing lead generation is core to the premise,
  not a non-goal. Greenput hosts the contractor's site and ads and
  captures the lead itself — see §1.
- Accounting or bookkeeping (integrates with QuickBooks/Xero, does not
  replace them). Not verified against code either way.
- Field service dispatch optimization (Phase 5+ consideration).
- Hardware manufacturing (deferred to BaseNative hardware track).
- International markets (US-only for first 3 years).

## 3. Users

- **Trade contractors** — electricians, plumbers, HVAC techs, roofers,
  general contractors. Primary users who manage their pipeline; FSM
  intake authoring (Goal 1) is not yet available to them.
- **Office managers / dispatchers** — secondary users who handle
  scheduling, customer communication, and invoicing.
- **Consumers / customers** — the party whose data Greenput owns as a
  single party per §1. Today they interact only through a single
  workspace's `portal_tokens`-based customer portal
  (`apps/api/src/routes/customer-portal.ts`) and tenant micro-sites for
  booking, status updates, and payments — there is no cross-workspace
  consumer surface yet (see Goal 4).
- **Pilot user** — electrician in the Tesla installer network; first
  production deployment validates the FSM intake model. Not verifiable
  from code.

## 4. Key flows

### Lead → Opportunity → Job pipeline (built)

```
Lead (new → contacted → qualified → accepted → converted, or withdrawn)
  → Opportunity (open → proposal_sent → negotiating → won/lost)
    → Job (scheduled → in_progress → completed → invoiced → paid)
```

`qualified_at` / `accepted_at` / `withdrawn_at` on `leads` (`schema.sql`)
gate the billing lifecycle in Goal 3 above — see
`apps/api/src/routes/leads.ts`'s `/qualify`, `/accept`, `/withdraw`
endpoints.

### Schedule-aware routing — built 2026-10-16 (see Goal 2)

The aspiration: leads arrive (manual, website form, campaign) → checked
against open calendar slots → route to dispatcher or queue if full → no
lead is dropped. What exists today: `GET /api/jobs/schedule` returns a
crew calendar view of already-created jobs, `apps/platform`'s `/jobs`
route renders it as a drag-drop week grid, and the capacity layer
(availability, slot generation, the double-booking guard — see Goal 2)
is built and tested. Nothing upstream of that (lead intake) is
schedule-aware yet: no delivery engine routes a lead into a slot.

### FSM pricing — engine built, authoring not built (see Goal 1)

The aspiration, worked through the EV-charger vertical in
`greenput-fsm-pricing.md`: a consumer-facing enrichment form backed by a
finite-state-machine graph (questions with guarded transitions) that
deterministically yields a price range at a terminal state, combined with
the contractor's rate card and an uncertainty policy. The graph data
model and evaluator now exist (`libs/shared/pricing`, migration 010,
five operator-seeded electrical machines in `seeds/pricing/`) and the
intake routes run quote sessions against them. What does not exist is
the AUTHORING surface: no contractor-facing GUI or wizard for defining
or editing a flow. (`visual-builder`/`builder` in BaseNative model a UI
containment tree, not a directed graph with guarded edges; see that
document §4 for the verified comparison.)

### Customer portal (built, single-workspace scope)

Customers book, view job progress, receive invoices, and pay via
Stripe Connect through their tenant micro-site at `{slug}.greenput.com`,
authenticated via a magic-link OTP into `apps/api`'s `portalRouter`
(`apps/api/src/routes/customer-portal.ts`) — scoped to the one workspace
that captured them, not portable (see Goal 4).

## 5. Data model

Cloudflare D1 (SQLite); workspace-scoped isolation; foreign keys with
cascade (see Goal 4 for why unconditional cascade-on-workspace-delete is a
gap against the single-consumer-owner premise). Canonical TypeScript types
live in `libs/shared/models/src/index.ts`:

- `Lead` (includes the billing-lifecycle fields `qualifiedAt`/`acceptedAt`/
  `withdrawnAt`), `Opportunity`, `Job`, `Customer`, `Campaign`
- `Estimate`, `JobLineItem`
- `WorkspaceUser`, `Workspace`
- `ApiResponse<T>`, `ApiError` envelope

`lead_meter_events` (`schema.sql`) is the per-lead billing ledger —
`UNIQUE(lead_id)`, one row per lead, `status ∈ {pending, invoiced,
refunded, waived}`. See `apps/api/src/lib/lead-meter.ts`.

Validation: Zod schemas in `libs/shared/validators/`, shared FE↔BE.
SQL via D1 bindings only — `env.DB.prepare(...).bind(...)`. No ORMs,
no query builders.

## 6. Design principles

1. **Signal-based state, no framework store** — `@basenative/runtime`
   `signal()` / `computed()` / `effect()`. No NgRx, no RxJS subjects, no
   external state libraries. (There is no Angular in this repo — see §7.)
2. **TypeScript strict mode everywhere** — no `any`, no barrel exports,
   no ambient types.
3. **Mobile-first CSS** — base styles target small screens; larger
   breakpoints layered on with `@media (min-width: …)`.
4. **First-party only** — no third-party tracking, no data brokering.
   ("No consent banners" from an earlier version of this document is
   dropped: a consent-mediated exchange, per §1, is the opposite of
   consent-banner-free — see `greenput-consent-model.md`.)
5. **BaseNative defaults** — inherit from BaseNative shared configs
   unless explicitly overridden.

## 7. Architecture

**Monorepo**: pnpm + Nx workspace.

**Frontend**:
- `apps/platform` — the contractor dashboard. A **BaseNative** SPA
  (`@basenative/runtime` signals, `@basenative/router`,
  `@basenative/components`, `@basenative/fetch`) — **not Angular**. Each
  route is a folder under `apps/platform/src/routes/` exporting
  `render(deps): RouteView`; see `CLAUDE.md` §8 for the full route map.
- `apps/tenant-site` — per-contractor public micro-site, also BaseNative
  (`@basenative/server`/`@basenative/router`).
- `apps/marketing` — marketing/landing pages.
- **`apps/admin` and `apps/customer-portal` do not exist.** The original
  Angular admin dashboard (`apps/admin`) and its `@greenput/ui` library
  were deleted 2026-09-10 (never built once `@angular/build` was dropped,
  never in CI). The standalone customer-portal Worker (`apps/customer-portal`)
  was deleted the same day — its magic-link/jobs/estimates/invoices flow
  is covered by `apps/api`'s `portalRouter`
  (`apps/api/src/routes/customer-portal.ts`, mounted at `/api/portal`).
  Neither app was ever deployed. See `CLAUDE.md` §4.1 for the full removal
  record.

**Backend (Cloudflare Workers)**:
- `apps/api` — itty-router REST API.
- Middleware stack: `apps/api/src/middleware/` — auth, CORS, security
  headers, rate-limit, API-key auth, admin-auth, RBAC, plan-limits,
  billing-gate.

**Data layer**:
- Cloudflare D1 (SQLite) — workspace-scoped tables.
- Cloudflare KV (`greenput-sessions`) — session storage. Sessions **slide**:
  they idle out 7 days after their last use (rounded up to the next 1.75-day
  renewal slot, so at most 8.75), and die unconditionally 30 days after first
  sign-in however much they are used. Signing out writes a `revoked:<token>`
  tombstone that every read outranks the record with, so logout is final even
  against a renewal that was already in flight. `apps/api/src/lib/session.ts`
  owns every number and why a renewal is quantized and best-effort.
- Durable Objects — real-time WebSocket chat (`/api/chat/sync`).

**Shared libraries** (`libs/`):
- `shared/models`, `shared/validators`, `shared/utils`.
- `basenative/{fetch,auth-webauthn}` — GreenPut-owned BaseNative glue not
  yet upstreamed; see `CLAUDE.md` §4 for what has and hasn't moved
  upstream. There is no `libs/ui` — it was Angular-only and was deleted
  with `apps/admin`.

**Auth**: WebAuthn (`@basenative/auth-webauthn`, wrapping
`@simplewebauthn/*`) + session cookies (HttpOnly, SameSite=Strict, Secure)
+ OTP fallback + API key auth for programmatic access.

**Billing**: Per-lead metered billing (`lead_meter_events`, rate from the
explicit service→vertical map in `apps/api/src/lib/lead-rate-card.ts` —
see Goal 3). A workspace override (`workspaces.lead_fee_override_usd`,
or the grandfathered slug `hi-power` at $1) wins over that card. A saved
card is required before a workspace can accept or auto-book a lead.
Booking a lead — the booking commit (WS-1) — charges that fee
immediately, off-session, to the card. Accepting a lead
(`POST /api/leads/:id/accept`) or a pool accept bills nothing. One Stripe PaymentIntent per lead, idempotent on the meter
row. A decline leaves the fee `pending` and pauses further delivery until
the card is updated and that fee is collected. A withdrawal, cancel,
undo or no-show never waives a pending fee and does not refund a
captured one; only `refundLeadFee` (fraud or platform fault) does. See
`docs/billing-lead-fees.md`. Stripe Connect Express covers per-job
customer payments. Stripe *subscriptions* exist in
`apps/api/src/lib/stripe.ts` as a capability but are not the lead-billing
mechanism. Outbound SMS the contractor sends is paid from a prepaid
balance (`workspaces.usage_balance_micro_usd`, micro-USD): list price at
send time, then Twilio's reported price. The saved card tops that balance
up (default $10 when it falls below $2). A failed top-up pauses lead
delivery the same way a failed lead fee does. SMS that
`dispatchNotification` sends for a contractor workspace reserves that
same balance, because the API injects a billing hook; a blocked send is
emailed instead of dropped. The marketing contact form does not inject
the hook, and account-recovery codes stay GreenPut-paid. Cloudflare
request volume is not metered. See `docs/billing-lead-fees.md`.

**Infrastructure**: Terraform (`infra/`) was retired 2026-09-10, org-wide
decision — CI + `wrangler` are the only provisioning source of truth now.
See `CLAUDE.md` §4.2.

**Deploy**: Cloudflare Pages/Workers via GitHub Actions
(`.github/workflows/ci.yml`). Doppler **is** wired for the production
Worker secret push: when `DOPPLER_TOKEN` is set, that step runs
`doppler run` against the `greenput/repository` config and falls back to
a GitHub secret of the same name where the script names one
(`CALLS_*`, `ADMIN_SETUP_TOKEN`). Twilio and Stripe values are read from
Doppler only. Cloudflare account credentials (`CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`) stay GitHub Actions secrets. There is no
`@basenative/doppler` package dependency — the CLI action is what CI
calls. The same push runs from a laptop via `scripts/deploy/local.sh`.
Env var list: `docs/stripe-twilio-setup.md`. Lint/TS via
`@basenative/eslint-config` + `@basenative/tsconfig`.

**Subdomain topology**: `app.greenput.com` (platform),
`api.greenput.com`, `{slug}.greenput.com` (tenant sites),
`greenput.com` (marketing). `admin.greenput.com` and
`portal.greenput.com` are not live app domains — `apps/admin` never
deployed there, and the customer portal is served through `apps/api`
under `/api/portal`, not a dedicated subdomain.

## 8. Milestones

### Phase 1 — Foundation (complete)
D1 schema, auth (login/logout/me), session cookies + KV, Lead CRUD,
dashboard stats, signal stores. The platform shell was originally built
in Angular with lazy-loaded routes; it has since been fully rewritten on
BaseNative (see §7) — no Angular code remains in `apps/platform`.

### Phase 2 — Core Pipeline (complete)
Opportunity / Job / Customer / Campaign CRUD, FSM-*named* status
transitions (plain enum state machines on `status` columns — not the
FSM-authored pricing of Goal 1), the crew schedule endpoint, customer
portal, Stripe Connect checkout per job.

### Phase 3 — Operational Excellence (in progress)
Real-time chat (Durable Objects; SMS fallback reinstated in its safe
GP-110 shape 2026-10-16 — server-side recipient resolution from
`users.mobile_phone` under a per-workspace daily cap), reviews,
inventory / vehicles / asset catalog with QR codes, estimates &
proposals, webhooks, plugins, branding & white-label. Also shipped since
the last PRD pass, not previously tracked here: qualify/accept/withdraw
lead-billing lifecycle (Goal 3).

### Phase 4 — Market Expansion (Year 2-3)
Multi-trade support beyond electrical, advanced reporting, API
marketplace for third-party integrations, FSM-authored dynamic pricing
(Goal 1 — the engine is built and operator-seeded; the contractor
authoring surface is not started).

### Phase 5 — Greenput OS (Year 5-7)
Float-based operator cash flow module (PendingBusiness integration),
full business operating system for trades, BaseNative runtime as
frontend substrate. **$150M ARR target.**

### Phase 6 — Hardware Integration (Year 7-10)
Greenput OS running on BaseNative reference hardware. Vertical
integration complete: specs → runtime → hardware → operating system.

## 9. Open questions

1. **Qualification and acceptance semantics** — what makes a lead
   "qualified," and does "accepted" mean a consumer action, a contractor
   action, or both? (`qualified_at`/`accepted_at` exist in schema; the
   business rule for setting them is not yet codified beyond the
   endpoints themselves.)
2. **Dispute adjudication** — who adjudicates whether a lead qualified or
   was accepted — Greenput, the contractor, or an automatic rule?
3. **FSM authoring UX** — visual drag-and-drop graph editor, or guided
   wizard? (The Goal 1 ENGINE is built and operator-seeded; only the
   authoring surface is unbuilt — this is the design question for it.)
4. **Consumer portability mechanics** — can a consumer port to a
   contractor who isn't on Greenput at all, or only between Greenput
   workspaces? What happens to a first contractor's in-progress work when
   a consumer ports away mid-engagement?
5. **Multi-trade expansion order** — after electricians: plumbing,
   HVAC, or roofing first?
6. **PendingBusiness integration timing** — when does float-based cash
   flow become a Greenput module vs. staying standalone?
7. **Cloudflare scaling limits** — at what scale do D1 and Durable
   Objects hit practical ceilings, and what's the migration path?
8. **Doppler** — resolved for the production Worker: `ci.yml` runs
   `doppler run` when `DOPPLER_TOKEN` is set (config `greenput/repository`),
   with a GitHub-secret fallback for the values the script names.
   Cloudflare account tokens stay in GitHub. See `docs/stripe-twilio-setup.md`.

## 10. Glossary

- **Qualify / Accept / Withdraw** — the lead billing lifecycle.
  `qualified_at`: the receiving workspace confirms a lead is real,
  contactable, and in-scope — necessary but not sufficient for billing.
  `accepted_at`: the receiving workspace commits to servicing the lead —
  a state change, **not** a charge. **The billable event is the booking
  commit** (WS-1): `recordLeadMeter` fires once per (lead, workspace)
  when a job is booked, regardless of who sourced the lead.
  `withdrawn_at`: the consumer withdraws; bills nothing before a booking,
  and after one the fee stands (never waived, deleted or refunded by a
  withdrawal). See `schema.sql`'s
  `leads` table comments and `apps/api/src/lib/lead-meter.ts`.
- **Schedule density** — a billing variable named in an earlier version
  of this document. **Not implemented** — per-lead billing today is the
  rate card's explicit per-vertical rate (`lead-rate-card.ts`),
  independent of schedule occupancy. Retained here only so the term isn't
  silently reused for something else later.
- **Tenant micro-site** — per-contractor public Worker site at
  `{slug}.greenput.com` (booking + portal).
- **BaseNative** — DuganLabs upstream runtime substrate that Greenput
  dogfoods: `runtime`, `router`, `server`, `components`, `fetch`
  packages are live dependencies (see `package.json`); `auth-webauthn`
  and part of `fetch` are still GreenPut-owned glue aliased under the
  `@basenative/*` namespace pending upstreaming (`CLAUDE.md` §4).
- **Pilot user** — first production contractor (Tesla installer network
  electrician) validating the intake model. Not verifiable from code.

---

_Last verified against the code: 2026-10-16 (FSM engine, rate-card and
scheduling-infrastructure corrections; consent record, pool mechanism
and schedule-aware delivery were still unbuilt at this pass and their
sections say so)._
