# Reusable workflows: private → public access

## Problem

When `t4bs/.github/workflows/deploy.yml` was switched to call `DuganLabs/.github/.github/workflows/cf-deploy.yml@v1`, the Actions run failed with `startup_failure` (workflow file issue, no log).

Root cause: **t4bs is a private repository, the reusable workflow lives in a public one (`DuganLabs/.github`).** GitHub blocks this by default at the org level even though the callee is public. The deploy.yml has been reverted to the inline form so prod deploys keep working.

## Two fixes (pick one)

### Option A — Make t4bs public

If the project is intended to be open source anyway (it's the BaseNative showcase), this is the right answer. One-time:

```bash
gh repo edit DuganLabs/t4bs --visibility public --accept-visibility-change-consequences
```

After flipping visibility, the existing `deploy.yml` thin caller will work. The original commit can be re-applied via:

```bash
git revert HEAD~  # the revert commit
git push origin main
```

### Option B — Allow public reusable workflows from private repos org-wide

Org admin only. Either via UI:

`https://github.com/organizations/DuganLabs/settings/actions` → "Access" → enable "Accessible from repositories in the organization".

Or via API (needs `admin:org` scope on `gh` token):

```bash
gh auth refresh -s admin:org
gh api -X PUT 'orgs/DuganLabs/actions/permissions/workflow' \
  --input - <<<'{"can_approve_pull_request_reviews":true,"default_workflow_permissions":"write"}'

# Then for each private repo that should consume:
gh api -X PUT 'repos/DuganLabs/t4bs/actions/permissions/access' \
  --input - <<<'{"access_level":"organization"}'
```

## Recommendation

Option A. t4bs is the public showcase for BaseNative — making it public is on the roadmap anyway, and "private repo using public reusable workflow" is fundamentally awkward.

For genuinely private projects (greenput, pendingbusiness, warrendugan), use Option B per-project or accept that they keep inline deploy.yml. The duplication for 3 repos is small.
