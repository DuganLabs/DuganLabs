# AGENTS.md: rules for every agent (and human) working in this repo

This monorepo is the **single home** of every Dugan Labs domain (`apps/<domain>`),
the shared libraries, the standards, and the control plane (CI, deploy, Doppler,
Cloudflare infra). If a rule is not here or in `standards/`, it is not a rule.

**This repository is PUBLIC.** Read `standards/public-repo.md` before your first commit.

## Map
| Path | What |
|---|---|
| `apps/<domain>/` | One per domain. `content.json` + `src/index.js` (coming-soon kit), `wrangler.toml`, `deploy.json`, `project.json`. |
| `apps/leads/` | `dl-leads` Worker + D1: the one lead store. No public route; reached only via the `LEADS` service binding. |
| `apps/duganlabs-private/` | The previous duganlabs.com site, now served at private.duganlabs.com behind Cloudflare Access. |
| `libs/coming-soon/` | Landing, login, privacy, private hub, leads view, Access JWT check, security headers. |
| `tools/deploy/` | `build-worker.mjs` (build once), `deploy.sh <app> <stage>`, `deploy.schema.json`. |
| `tools/ci/guard.sh` | Public-repo guards (Plaid, secret files, PII). |
| `tools/audit/post-deploy.sh` | Lighthouse on production after deploy (report-only). |
| `tools/scripts/` | `new-app.mjs` generator, `check-content.mjs`. |
| `infra/cloudflare/` | Terraform: Access, Turnstile, D1. Applied only with Warren's yes. |
| `standards/` | Design, accessibility, web platform, CI, deploy, secrets, public repo, feedback loop. |

## Non-negotiables
1. **No secrets or personal data in the repo, in CI logs, or in commit metadata.** This covers
   config, tests, fixtures, docs, and commit author emails. Secrets live in Doppler.
   Leads live only in D1. The owner email lives only in the Cloudflare Access policy and
   Worker secrets. `tools/ci/guard.sh` and gitleaks enforce this.
2. **Plaid is runtime-only.** `PLAID_*` never appears in workflows, GitHub secrets, the
   GitHub-synced Doppler config, or CI logs (`docs/PLAID-SECRETS.md`).
3. **Commit identity.** Agents commit as the single owner identity
   `Warren Dugan <warrendugan@users.noreply.github.com>`, never a personal or work
   address. Nx Cloud bills per distinct commit author, and the public repo would expose
   the address. Bots (Dependabot) never use Nx Cloud (`standards/ci.md`).
4. **Consequential actions need Warren's explicit yes.** That means merging to main,
   approving the production environment, `terraform apply`, DNS, Access, Doppler, deleting
   anything, and deploying a site whose `deploy.json` stage is `blocked`.
5. **Show it before you ship it.** Render locally, screenshot desktop and mobile (light and
   dark), critique like a senior designer, and meet the budgets in `standards/web-platform.md`
   (`standards/feedback.md`).
6. **Don't invent facts.** Product copy comes from the live site, the repo, or Warren.
   Unknowns stay `status: todo` with no copy.

## Everyday commands
```bash
pnpm install
pnpm exec nx run-many -t check test build       # everything
pnpm exec nx affected -t check test build       # what changed
bash tools/ci/guard.sh                          # public-repo guards
pnpm run dev:leads:migrate                      # local D1 schema
pnpm exec wrangler dev -c apps/leads/wrangler.toml --persist-to .wrangler/state --port 8700
pnpm exec wrangler dev -c apps/greenput/wrangler.toml --port 8701 \
  --var TURNSTILE_SITE_KEY:1x00000000000000000000AA --var DEV_ACCESS_EMAIL:dev@example.com
node tools/scripts/new-app.mjs example.com [--todo|--live]
bash tools/deploy/deploy.sh greenput staging --dry-run
```
`apps/leads/.dev.vars` (gitignored) holds Cloudflare's always-pass Turnstile **test**
secret and a local salt. `DEV_ACCESS_EMAIL` works only on localhost.
