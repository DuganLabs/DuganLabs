# Reusable workflows

Moved here from `DuganLabs/.github` on 2026-11-26 (that repo now holds only the org profile and
default issue/PR templates; its history keeps the originals). They live in `.github/workflows/`
as `reusable-*.yml` and are callable as
`uses: DuganLabs/public/.github/workflows/reusable-<name>.yml@main`, or `./.github/workflows/...`
from this repo. Nothing in this repo calls them today (deploys go through `tools/deploy/` and the
per-product workflows); they are kept for products that want a thin caller.

| Workflow | Purpose |
|---|---|
| `reusable-ci.yml` | lint + typecheck + test |
| `reusable-cf-deploy.yml` | Cloudflare Pages deploy |
| `reusable-cf-worker-deploy.yml` | single Cloudflare Worker deploy |
| `reusable-d1-migrate.yml` | idempotent D1 schema apply |
| `reusable-bundle-size.yml` | bundle size report |
| `reusable-lighthouse.yml` | Lighthouse gate against a deployed URL |

Caller example:

```yaml
jobs:
  deploy:
    uses: DuganLabs/public/.github/workflows/reusable-cf-deploy.yml@main
    with:
      project-name: example
    secrets:
      DOPPLER_TOKEN: ${{ secrets.DOPPLER_TOKEN }}
```

**Boundary rule:** these workflows never embed any project-specific value.
Cloudflare credentials are passed at call time — via a Doppler service token
(preferred) or direct GitHub Actions secrets (fallback, for a project not
yet on Doppler). See `../../DOPPLER.md` for the naming convention and which
secret wins when both are present.

## Org-wide automation (run in this repo)

Workflows that run on **this** `.github` repo to keep the org's GitHub state honest. They're triggered by issue/PR events on member repos via the `org` event scope when permissions allow, or are invoked by per-project workflows that delegate to them.

| Workflow | Trigger | Purpose |
|---|---|---|
| `labeler.yml` | PR opened/sync | Auto-applies path-based labels (frontend, backend, infra, db, docs, deps, basenative) |
| `auto-close-milestone.yml` | Issue/PR closed | Closes a milestone when its last open issue lands |
| `stale-state-sweep.yml` | Weekly cron | Marks/closes stale issues + PRs |

## Versioning

Tag this repo `v1`, `v2`, etc. Per-project callers pin to a major version (`@v1`) so patches propagate. Breaking changes require a major bump.
