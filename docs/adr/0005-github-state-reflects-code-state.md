# ADR 0005 — GitHub state reflects code state automatically

- Status: **accepted**
- Date: 2026-04-26
- Owner: Warren Dugan

## Hard rule

> Warren never wants to "click on anything in PRs/Issues."

GitHub Issues, Milestones, PR statuses, and Project board column moves should *reflect* the state of code, features, and applications — not be a parallel manual to-do list.

If you find yourself dragging cards between columns, something is misconfigured.

## Mechanisms

1. **Issue auto-close on PR merge.** Use `Closes #N` in the PR description. GitHub closes the issue when the PR merges. The PR template enforces this convention.

2. **Milestone auto-close.** When the last open issue in a milestone closes, [`auto-close-milestone.yml`](https://github.com/DuganLabs/.github/blob/main/.github/workflows/auto-close-milestone.yml) closes the milestone.

3. **Path-based PR auto-labeling.** [`labeler.yml`](https://github.com/DuganLabs/.github/blob/main/.github/workflows/labeler.yml) applies labels based on which files a PR touches (`frontend`, `backend`, `infra`, `db`, `docs`, `deps`, `basenative`).

4. **Stale state sweep.** [`stale-state-sweep.yml`](https://github.com/DuganLabs/.github/blob/main/.github/workflows/stale-state-sweep.yml) marks and closes inactive issues/PRs weekly. Exempt labels: `pinned`, `roadmap`, `security`.

5. **Project board column automation.** GitHub's built-in workflows on org-level Projects: PR opened → "In Progress", PR merged → "Done", issue closed → "Done", issue reopened → "Backlog". Configured once per project board.

6. **PRD-to-issues sync.** `bn prd sync` reads `docs/PRD.md` and emits `.bn/prd-issues.json` listing milestones + issues to create. `bn gh sync` pushes that to GH (idempotent via embedded `<!-- bn:external_id=... -->` HTML comments). The PRD stays the canonical source; issues are mechanical reflections.

## Consequence

The product board is real. Looking at the GitHub Project = looking at reality. No grooming tax.

## What this is NOT

- Not a license to skip writing good issue descriptions. Automation handles **state transitions**, not authorship.
- Not a replacement for milestones — milestones still group work into named phases.
- Not "no humans review PRs" — review still happens; only the bookkeeping is automated.

## Failure mode to watch for

If the automation drifts and stops reflecting reality (e.g. labeler.yml has wrong globs and PRs miss labels), the value disappears immediately. Treat the .github reusable workflows as a load-bearing piece of infra: include them in the regular review cadence.
