# DuganLabs (org meta) — Product Requirements Document

> Status: **draft** · Owner: Warren Dugan · Last updated: 2026-04-26

## 1. Overview

`DuganLabs/duganlabs` is the org meta-repo. **Going forward, BaseNative is the source of truth for code/runtime/CLI patterns, and `DuganLabs/.github` is the source of truth for org-level GitHub infrastructure.** This repo's role narrows to: org-wide documentation that doesn't fit either of those (org policies, ADRs, this PRD index, infrastructure setup notes).

### One-line pitch
"The org's documentation home — pointing every project at where its real source of truth lives."

## 2. Goals

1. Maintain `docs/PRD.md` for every DuganLabs project (or link to where they live).
2. House setup and migration runbooks (Doppler bootstrap, Cloudflare account setup, GitHub project board).
3. Be the place where org-wide ADRs live.

## Non-goals

- Reusable workflows — those live in `DuganLabs/.github`.
- Shared code, types, or configs — those live in `BaseNative`.
- Project-specific work — that lives in the project's own repo.

## 3. Users

- Warren (org owner) — uses this for high-level navigation and policy.
- Future collaborators — onboarding entry point.

## 4. Key flows

### 4.1 New project bootstrap
1. `bn create <name>` from the BaseNative CLI scaffolds the repo.
2. Update this repo's project index (`docs/PROJECTS.md` if present).
3. Add `docs/PRD.md` to the new project (`bn prd init`).
4. Wire deploy.yml to use `DuganLabs/.github/.github/workflows/cf-deploy.yml@v1`.

### 4.2 Org-wide policy change
1. ADR drafted here in `docs/adr/NNNN-title.md`.
2. Reviewed via PR.
3. Once merged, propagated by editing reusable workflows in `DuganLabs/.github` and/or shared configs in BaseNative.

## 5. Data model

N/A — documentation repo.

## 6. Design principles

- **Pointers, not copies.** When in doubt, link to the real source rather than restating.
- **Versioned policy.** ADRs are immutable; superseded by newer ADRs that explicitly close them.

## 7. Architecture

- Git repo. Markdown. No build.
- A future `nx build` may emit a static site; not in scope today.

## 8. Milestones

### M0 — Org documentation baseline (in progress)
- PRD-TEMPLATE.md ✓
- SETUP-ORG-PROJECT-BOARD.md ✓
- REUSABLE-WORKFLOWS-ACCESS.md ✓
- This PRD ✓

### M1 — ADR backlog
- ADR 0001: BaseNative is source of truth for code patterns
- ADR 0002: `DuganLabs/.github` is source of truth for org infra
- ADR 0003: All projects extend `@basenative/eslint-config` + `@basenative/tsconfig`
- ADR 0004: Doppler is the org-wide secret store
- ADR 0005: GitHub state reflects code state automatically (no manual board grooming)

### M2 — Project index
- `docs/PROJECTS.md` listing every DuganLabs repo with one-line description + status.

## 9. Open questions

- Should this repo eventually deprecate (BaseNative absorbs the meta role), or keep doc-only forever?
- Where do ADRs live long-term — here or in BaseNative under `docs/adr/`?
