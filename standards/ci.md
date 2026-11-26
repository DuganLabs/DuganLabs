# CI

`.github/workflows/ci.yml`. The repo is public, so standard runners cost $0.
This replaces the org's Sep 14 manual-only (`workflow_dispatch`) rule **for this repo only**.

- **Triggers:**
  - PRs and pushes to `main`;
  - `workflow_dispatch`;
  - docs-only changes (`*.md` at root, `docs/`, `standards/`) are skipped.
- **verify (one job, one install):**
  - Nx Cloud decision;
  - public-repo guards;
  - gitleaks on the new commits;
  - `nx affected -t check test build` against the last green `main` (`nrwl/nx-set-shas`);
  - upload a single `dist-<sha>` artifact.
- **e2e** runs only when a project with an `e2e` target is affected.
- **deploy-staging -> deploy-production:**
  - an affected-only matrix using the same artifact;
  - production waits for the `production` environment approval.
- **audit:** one post-deploy Lighthouse job, report-only.

## Nx Cloud (Team plan: $29/mo with a $29 usage credit; $19 per extra contributor)
A contributor is any **commit author** of a CI pipeline execution, bots included. So:
- The cache is used only when the head commit author equals repo variable
  `NX_CLOUD_AUTHOR_EMAIL` (the owner noreply identity) **and** the actor is not a `[bot]`.
  Otherwise `NX_NO_CLOUD=true` and the token is never exposed to the step.
- Agents commit as the owner identity (AGENTS.md rule 3).
- Dependabot PRs run without Nx Cloud (local cache only; small, so cheap).
- Docs-only changes do not run CI at all.
- Fork PRs get no secrets, so Nx Cloud is off.
- Not yet connected: `nxCloudId` is added to `nx.json` when Warren approves the plan.
