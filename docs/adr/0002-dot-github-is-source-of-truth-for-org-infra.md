# ADR 0002 — `DuganLabs/.github` is the source of truth for org GitHub infrastructure

- Status: **partly superseded by ADR 0007**
- Date: 2026-04-26
- Owner: Warren Dugan

## Context

GitHub Actions reusable workflows, issue templates, PR templates, profile README, and org-wide automation (auto-close milestones, stale-issue sweeps, PR labelers) all need a stable home that every other repo can `uses:` against.

The natural home is the special `.github` repo at the org root.

## Decision

**`DuganLabs/.github` holds:**

1. Reusable workflows under `.github/workflows/`:
   - `cf-deploy.yml` — Cloudflare Pages deploy via Doppler
   - `d1-migrate.yml` — idempotent D1 schema apply (uses `wrangler d1 migrations apply`)
   - `ci.yml` — lint/typecheck/test
   - `lighthouse.yml` — 4-metric Lighthouse audit + PR comment
   - `bundle-size.yml` — JS/CSS gzipped size budget + PR comment
   - `labeler.yml` — path-based PR auto-labeling
   - `auto-close-milestone.yml` — close empty milestones automatically
   - `stale-state-sweep.yml` — weekly stale issue/PR sweep
2. `.github/ISSUE_TEMPLATE/` — `feature.yml`, `bug.yml`, `config.yml`
3. `.github/PULL_REQUEST_TEMPLATE.md`
4. `profile/README.md` — public org face
5. `.github/labeler.yml` — config for the path labeler
6. `.github/CODEOWNERS`
7. `.github/dependabot.yml`

**Versioning:** tag `v1`, `v2`, etc. Per-project callers pin to a major (`@v1`) so patches propagate. Breaking changes require a major bump.

**Boundary rule:** these workflows take secrets and inputs at the call site only — never embed any project-specific value. Proprietary projects (greenput, pendingbusiness, warrendugan) consume them the same way OSS projects do, passing their own Doppler service tokens at call time.

## Consequences

- Per-project `deploy.yml` files become 10-line thin callers.
- Cross-project upgrades are a single change in `.github` + a tag bump.
- Workflows are publicly auditable (`.github` is a public repo).

## Open issues

- **Private→public reusable workflow access** — t4bs was private when first wired; GitHub blocks calls from a private repo to a public reusable workflow by default. Resolved by making t4bs public. Other private repos (greenput, pendingbusiness, warrendugan) need the org-level `actions/permissions/access` setting flipped, OR they keep inline workflows. (Superseded by ADR 0007: the monorepo is public and owns its own CI.)

## Alternatives considered

- **Per-project copies of workflows.** Rejected — that's the problem this solves.
- **Mono-repo all projects.** Rejected — each project deploys independently and has its own visibility/license tier.
