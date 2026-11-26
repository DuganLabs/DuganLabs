# Public repo rules

This repo is public so that CI on standard GitHub runners is free. In exchange:

- **Never commit:** secrets, tokens, keys, `.dev.vars`, `.env*`, Terraform state or tfvars,
  lead data, exports, or personal emails or phone numbers. `.gitignore` covers the common cases.
  `tools/ci/guard.sh` and gitleaks (CI, new commits) catch the rest.
- **Personal data** lives only in D1 (leads), the Cloudflare Access policy, and Worker secrets
  (`OWNER_EMAILS`, `OWNER_EMAIL`). Tests use `@example.com`.
- **Commit identity:** `Warren Dugan <23459839+warrendugan@users.noreply.github.com>`. Configure it
  per clone with `git config user.email 23459839+warrendugan@users.noreply.github.com`. Turn on GitHub
  **Settings -> Emails -> Keep my email addresses private** and
  **Block command line pushes that expose my email**.
- **History:** rewritten on Nov 26, 2026 with `git filter-repo` so that no commit (author,
  committer or trailer) carries a personal address; only GitHub noreply addresses remain.
  `tools/ci/guard.sh` fails the build if a personal address reappears in a tracked file or
  in the head commit's author/committer.
- **Repo settings (Warren, Phase 3):**
  - secret scanning and push protection on;
  - private vulnerability reporting on;
  - Dependabot alerts on;
  - branch protection on `main` (PR + passing CI + CODEOWNERS review);
  - `production` environment with Warren as required reviewer;
  - Actions: "Require approval for all outside collaborators" for fork PRs.
