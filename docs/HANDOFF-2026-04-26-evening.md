# Handoff — 2026-04-26 evening session

Continues from `HANDOFF-2026-04-26.md`. This stretch added the orchestrator
spec implementation, three migrations to BaseNative-only, and a Greenput
pricing draft.

## What's live in production

- **basenative.com** — header overflow fix LIVE on iPhone 12 Pro et al. CSS uses `flex-wrap: wrap` on the nav + `overflow-x: auto` with `scroll-snap` on the pill row. Verified via curl + visible in `https://basenative.com/styles.css`.
- **t4bs.com** — unchanged from previous handoff (Lighthouse 100s, pip OG cards, BaseNative configs adopted).
- **duganlabs.com** — unchanged.

## What's broken in production

- **warrendugan.com / sys.warrendugan.com** — still failing because `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets are unset. Doppler project `warrendugan` was created (was missing); awaiting your population. Comment-thread on https://github.com/DuganLabs/warrendugan/issues/3 has both quick-fix and Doppler paths.
- **pendingbusiness.com** — running stale code because PR #5 (auth swap) hasn't merged yet. Migration 0004 already applied to prod D1. Awaiting your review/merge.

## What landed this session

### BaseNative
- PR #51 merged: header overflow fix.
- All 36 packages live on GitHub Packages (republished with corrected repo URL casing earlier this afternoon).

### `@dugan/auto` + `@dugan/orchestrator` (NEW REPO: `DuganLabs/dugan`, private)
- `apps/auto-cli` Phase 1-4 working: `pnpm auto chat | plan | run | status` with SQLite-backed conversations, slash commands (`/scout`, `/plan`, `/run`).
- ts-morph + bge-m3 catalog indexer (Workers AI, no local model).
- Pure-code router covering 14 task kinds from spec §6.
- 10 Vitest tests passing.
- `libs/dugan/orchestrator` Phase 1: typed `Portfolio` / `Budgets` / `OrchestratorConfig` loaders + `Orchestrator` façade + tier router + runway types. `tsc -b` clean.
- `.dugan/portfolio.json`: 9 ventures with stages, blockers, active work.
- `.dugan/budgets.json`: per-venture monthly caps, runway thresholds 12/9/6/3.
- `.dugan/config.json`: model mapping, full tier routing table, BaseNative axiom version pointer.
- `.claude/agents/`: 11 subagent specs per spec §5.
- `CLAUDE.md` for the monorepo.

### ADRs in duganlabs
- `0006-axioms-are-basenative-not-angular.md` — codifies your direction that DuganLabs uses BaseNative; the four axioms are interpreted in BaseNative terms (not Angular).

### Greenput
- Draft PR https://github.com/DuganLabs/GreenPut/pull/35 — pricing page rewrite. Pass-through itemized + per-vertical table + FAQ. All placeholders ($XX.XX). Container queries for responsive table. Zero Tailwind/utility classes. **Awaiting your real numbers** to flip from Draft to Ready.

### PendingBusiness
- PR #6 + CI auth fixed: `link:../basenative/...` swapped to real `^1.0.0` semver. NPM_TOKEN set as repo secret. PB CI now installs `@basenative/auth-webauthn` from GitHub Packages.
- Migration 0004 applied to prod D1 earlier today.

### t4bs
- Closed react / react-dom / @simplewebauthn major-bump dependabot PRs as won't-merge (migrating off React; auth-webauthn pins `^11`).
- Migration `feat/basenative-migration` branch in flight.

### ralph-station
- Security hardening shipped to main: bind 127.0.0.1 by default, `IDE_TOKEN` required for non-loopback, token-gate on /api + /ws/terminal. Closes ralph-station#1.

### Org infrastructure
- `NPM_TOKEN` (PAT with read:packages) now set as repo secret across **all 9 repos**.
- Doppler project `warrendugan` created (was missing).

## In flight (background agents — likely complete by next read)

- `@basenative/station` package — queue/runner/client + 5 templates + ops + CLI.
- t4bs React → BaseNative migration on `feat/basenative-migration` branch.
- PendingBusiness itty-router → BaseNative migration on `feat/basenative-migration` branch (stacked).

## Conflicts surfaced + resolved

1. **PendingBusiness vs YieldPay** → PendingBusiness. YieldPay is dead.
2. **Angular axioms vs BaseNative stack** → BaseNative only. ADR 0006.
3. **`@dugan/auto` precedence** → built first (option b), orchestrator depends on it.
4. **Tower hardware unreachable** → confirmed expected; software stub.
5. **24h continuous work** → save questions, work until truly blocked.
6. **`@basenative/station` exists?** → no, built it (in flight).
7. **`@dugan/orchestrator` repo location** → new `DuganLabs/dugan` private monorepo.

## Things still genuinely on you

1. **Review + merge PR #5 (PendingBusiness auth swap).** Migration's already applied. https://github.com/DuganLabs/PendingBusiness/pull/5
2. **Review + merge PR #6 (PB credential mgmt + onboarding, stacked).**
3. **Populate Doppler `warrendugan` project** OR set CF secrets directly. Then deploys un-break.
4. **Real per-vertical numbers for Greenput pricing PR #35.** Edit `apps/marketing/src/worker/page-data.ts#pricingContext`.
5. **`gh auth refresh -s read:project`** if you want me to drive the org-level Project board from CLI.
6. **Tower bring-up** when you want Station to actually serve.

## Spec §13 acceptance criteria — current state

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Portfolio awareness | ✅ `.dugan/portfolio.json` live; one-line edit to add a venture |
| 2 | Runway accuracy | ⏳ Phase 2 — types in place, ledger SQLite TBD |
| 3 | Tier routing | ⏳ Pure-code router lives in `@dugan/orchestrator`; benchmark suite TBD |
| 4 | Cross-venture reuse | ⏳ catalog indexer + embedder ship in `@dugan/auto`; promotion flow TBD |
| 5 | BaseNative enforcement | ⏳ axioms codified (ADR 0006); enforcer hook TBD (Phase 4) |
| 6 | Station ROI | ⏳ Station package in flight; ROI measurement Phase 7+ |
| 7 | Auto handoff fidelity | ⏳ `auto-handoff` agent spec'd; live dispatch Phase 8 |
| 8 | Failure handling | ⏳ runway thresholds wired; force-downgrade Phase 5 |
| 9 | Comms safety | ✅ `robert-comms-drafter` agent: write-only to `.dugan/drafts/comms/`, no send tools |
| 10 | Greenput pricing page shipped | ⏳ Draft PR #35 open; awaiting your real numbers |
