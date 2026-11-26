# Public repo rules

This repo is public so that CI on standard GitHub runners is free. In exchange:

- **Never commit:** secrets, tokens, keys, `.dev.vars`, `.env*`, Terraform state or tfvars,
  lead data, exports, or personal emails or phone numbers. `.gitignore` covers the common cases.
  `tools/ci/guard.sh` and gitleaks (CI, new commits) catch the rest.
- **Personal data** lives only in D1 (leads), the Cloudflare Access policy, and Worker secrets
  (`OWNER_EMAILS`, `OWNER_EMAIL`). Tests use `@example.com`.
- **Commit identity:** `Warren Dugan <warrendugan@users.noreply.github.com>`. Configure it
  per clone with `git config user.email warrendugan@users.noreply.github.com`. Turn on GitHub
  **Settings -> Emails -> Keep my email addresses private** and
  **Block command line pushes that expose my email**.
- **History:** before the repo flips public, the existing history must be reviewed. As of
  Nov 26, 2026 gitleaks found no leaks in 73 commits, but author metadata contains a
  personal Gmail address and a work address. See PLAN.md (decision on history).
- **Repo settings (Warren, Phase 3):**
  - secret scanning and push protection on;
  - private vulnerability reporting on;
  - Dependabot alerts on;
  - branch protection on `main` (PR + passing CI + CODEOWNERS review);
  - `production` environment with Warren as required reviewer;
  - Actions: "Require approval for all outside collaborators" for fork PRs.
