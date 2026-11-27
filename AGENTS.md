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
   `Warren Dugan <23459839+warrendugan@users.noreply.github.com>`, never a personal or work
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

## Browser support: Baseline target

This repo's Baseline target is Baseline Widely available.

Use a web platform feature (HTML, CSS, JavaScript or a Web API) without a
fallback only when it is Baseline Widely available (see `standards/web-platform.md`).
Anything newer is allowed only as progressive enhancement or with a fallback,
and the PR should say so.

## Modern Web Guidance

Install the [Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance)
skill locally before writing or reviewing HTML, CSS or front-end JavaScript,
and follow it within the Baseline target above:

```sh
DISABLE_TELEMETRY=1 npx modern-web-guidance@latest install
```

It writes `.agents/skills/modern-web-guidance/` and `skills-lock.json`.
Both are gitignored (see `.gitignore`); never commit its output. Before
opening a PR that changes a page, also run the local browser check in
[Chrome DevTools MCP: local pre-deploy check](#chrome-devtools-mcp-local-pre-deploy-check).

## Chrome DevTools MCP: local pre-deploy check

Before opening a PR that changes a page, check it in a real browser with
[Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp).
It is a local check only; CI never runs it.

Always run it against a fresh, throwaway Chrome profile:

- Pass `--isolated`, which creates a temporary user-data-dir and deletes it
  when the browser closes.
- Pass `--no-performance-crux`, so performance traces do not send page URLs
  to the CrUX API.
- Pass `--headless` optionally (drop `--headless` to watch the browser).
- Never pass `--autoConnect`, never point it at an everyday or signed-in
  Chrome profile, and do not use an agent's attach-to-running-Chrome browser
  mode for this check.
- Point it at local dev or staging URLs (use production only for read-only
  checks).

Example MCP config (lives in the user's MCP config, e.g.
`~/.gemini/config/mcp_config.json` for Antigravity or `.cursor/mcp.json`,
never committed):

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-mcp@latest",
        "--isolated",
        "--headless",
        "--no-performance-crux"
      ]
    }
  }
}
```
