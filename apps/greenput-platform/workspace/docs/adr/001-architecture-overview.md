# ADR 001: Architecture Overview & Stack Selection

> Corrected 2026-09-11 against the current code. The original decision
> below (single Nx monorepo, Cloudflare Workers + D1, signal-based state)
> stands and is unchanged; the frontend framework and app list it
> described are stale and are corrected in place rather than superseded by
> a new ADR, since the underlying architectural decision never changed —
> only which framework implements "signal-based state" did.

## Context
Greenput must be highly performant, globally distributed out of the box, and support entirely type-safe full-stack data modeling without requiring an exorbitant cloud bill prior to scaling. It also needs a frontend approach capable of scaling to hundreds of interconnected components (an entire CRM ecosystem).

## Decision
We develop Greenput as a single Nx monorepo, with the backend served through **Cloudflare Workers** using **itty-router** and **D1 SQLite**, and the frontend built on **BaseNative signal primitives** (`@basenative/runtime` `signal()`/`computed()`/`effect()`) directly — not as a layer bypassing RxJS inside Angular.

**Correction from the original text of this ADR:** `apps/platform` was originally built in **Angular 21** using BaseNative signals as a state layer on top of it. It has since been fully rewritten as a native BaseNative SPA — Angular, `@angular/build`, and RxJS are gone from this app entirely. `apps/admin` (a separate Angular app) and its `libs/ui` component library were deleted 2026-09-10, having never been migrated and unable to build once `@angular/build` was dropped from devDependencies; see `CLAUDE.md` §4.1 for the removal record. There is no Angular anywhere in this repository today.

## Consequences
- **Positive**:
  - Complete end-to-end type safety using shared Zod models located in `libs/`.
  - Negligible hosting costs for the base API due to Cloudflare's edge model.
  - Signal-based state eliminates the boilerplate of a framework store — and, since the Angular removal, eliminates the framework itself: routes are plain functions (`render(deps): RouteView`) over DOM helpers, not components.
- **Negative**:
  - D1 SQLite currently has data volume constraints requiring sharding/tenant boundaries at extreme scale.
  - Relying purely on Cloudflare limits use of standard Node.js API libraries (though edge compatibility gets better every day).
  - The Angular → BaseNative rewrite of `apps/platform` was a full-app migration, not an incremental one; the lesson carried forward is to adopt BaseNative from the start on new apps rather than layering it onto an existing framework.

## Implementation Details
- All API routing is structured within `apps/api/src/routes`.
- The frontend shell (`apps/platform`) lazy-mounts each route on navigation via its own `render(deps)`/`dispose()` lifecycle (`CLAUDE.md` §10.3) — there is no separate `apps/admin` shell; that app was deleted along with `libs/ui`, and admin-scoped API routes (`apps/api/src/routes/admin.ts`) are currently unused by any deployed frontend.
- `apps/customer-portal` (a standalone Worker) was likewise deleted 2026-09-10; its functionality lives in `apps/api`'s `portalRouter` (`apps/api/src/routes/customer-portal.ts`).
- Shared models and schema sync are enforced via standard TypeScript imports from `libs/shared/models`, validated at the boundary with Zod schemas in `libs/shared/validators`.

---

_Last verified against the code: 2026-09-11 (commit `829b634`)._
