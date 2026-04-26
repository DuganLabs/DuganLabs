# ADR 0004 — Doppler is the org-wide secret store

- Status: **accepted** (rollout in progress)
- Date: 2026-04-26
- Owner: Warren Dugan

## Decision

**Doppler stores all secrets for every DuganLabs project.** Local dev uses `doppler run --`. CI uses Doppler service tokens passed in as `secrets.DOPPLER_TOKEN`. The reusable workflows in `DuganLabs/.github` know nothing about specific secrets — they `doppler run` whatever the project's command line is.

Each project gets its own Doppler project + dev/preview/prod configs. Secrets stay scoped per-project; nothing leaks between greenput / pendingbusiness / warrendugan / etc.

## Why

- No secrets in source. No `.env.production` to forget about.
- Single place to rotate Cloudflare tokens, API keys, OAuth secrets.
- Per-environment configs are first-class (Doppler "configs": dev, preview, prod, ephemeral).
- Cloudflare Workers + Doppler integrate cleanly via `wrangler secret` injected at deploy time.

## Why not Cloudflare-only secrets, GitHub Actions secrets, or 1Password?

- **Wrangler secrets** are CF-only. Doesn't cover non-CF projects (warrendugan/sys, possibly future ones).
- **GitHub Actions secrets** are tied to a single repo. Sharing across repos is ugly. Proprietary projects can't depend on org-level GH secrets without admin intervention.
- **1Password** is great for personal but lacks first-class CI integration paths we trust.

## Tooling

- `@basenative/doppler` package wraps `doppler run` for cross-platform consistency.
- `bn-doppler init <project>` interactively bootstraps a new Doppler project.
- `bn-doppler verify` checks all secrets listed in `doppler-required.json` are present.
- Reusable workflow `cf-deploy.yml` (in `DuganLabs/.github`) installs the Doppler CLI and runs `doppler run -- npx wrangler pages deploy`.

## Migration path per project

1. `doppler login` (one-time, per-developer).
2. `bn-doppler init <project-name>` — creates the Doppler project + dev/preview/prod configs.
3. Drop `doppler-required.json` listing required secret names.
4. Move existing secrets into Doppler. Delete from `wrangler.toml [vars]` (publish via secrets layer, not config).
5. CI: mint a service token for prod (`bn-doppler ci-token --config prod`), set as `DOPPLER_TOKEN` in repo secrets.
6. Switch `deploy.yml` to call `DuganLabs/.github/.github/workflows/cf-deploy.yml@v1` and pass `DOPPLER_TOKEN`.

## Status by project

| Project | Doppler? | Migrated to reusable workflow? |
|---|---|---|
| basenative | ✓ | n/a (no deploy) |
| t4bs | ✓ | partial (inline workflow today; reusable blocked by access policy) |
| pendingbusiness | ✓ | inline |
| greenput | ✓ | inline |
| warrendugan | ? | inline |
| warren-sys | ? | inline |
| ralph-station | not yet | n/a (just bootstrapped) |
