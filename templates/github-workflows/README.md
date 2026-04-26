# DuganLabs reusable GitHub Actions workflows

These are the canonical reusable workflows every DuganLabs project should call into. Putting one definition in one place means every project gets the same lint/test/deploy posture, and changes propagate by version-bumping a single ref.

## Where these live (target)

Move this directory to a new public org-level repo `DuganLabs/.github` at path `.github/workflows/`:

```
DuganLabs/.github/
└── .github/
    └── workflows/
        ├── ci.yml          # reusable: lint + typecheck + test
        ├── cf-deploy.yml   # reusable: Cloudflare Pages deploy via Doppler
        └── d1-migrate.yml  # reusable: idempotent D1 schema apply
```

Once that repo exists, every per-project workflow becomes a thin caller:

```yaml
# t4bs/.github/workflows/deploy.yml
name: deploy
on:
  push: { branches: [main] }
  workflow_dispatch:

jobs:
  ci:
    uses: DuganLabs/.github/.github/workflows/ci.yml@v1
    secrets:
      DOPPLER_TOKEN: ${{ secrets.DOPPLER_TOKEN }}

  deploy:
    needs: ci
    uses: DuganLabs/.github/.github/workflows/cf-deploy.yml@v1
    with:
      project-name: t4bs
      build-command: npm run build
    secrets:
      DOPPLER_TOKEN: ${{ secrets.DOPPLER_TOKEN }}

  migrate:
    needs: deploy
    if: github.event_name == 'push'
    uses: DuganLabs/.github/.github/workflows/d1-migrate.yml@v1
    with:
      database: tabs-db
      migrations-glob: "migrations/*.sql"
    secrets:
      DOPPLER_TOKEN: ${{ secrets.DOPPLER_TOKEN }}
```

## Boundary rule

These workflows must be safe to publish. They take **secrets and inputs at the call site only** — never embed any project-specific value (project name, account id, secret name). Proprietary projects (greenput, pendingbusiness, warrendugan) consume them the same way OSS projects do, passing their own Doppler service tokens at call time.

## Versioning

Tag the `DuganLabs/.github` repo with `v1`, `v2`, etc. Per-project callers pin to a major (`@v1`) so patch fixes propagate automatically. Breaking changes require a major bump.

## Migration path for current projects

Each DuganLabs project has its own deploy.yml today. Order of conversion (lowest risk first):

1. basenative
2. duganlabs (this repo)
3. ralph-station, warren-sys
4. t4bs
5. warrendugan
6. pendingbusiness
7. greenput

For each: replace the project's deploy.yml with a thin caller that `uses:` the appropriate reusable workflow. Verify a no-op PR runs green, then merge.
