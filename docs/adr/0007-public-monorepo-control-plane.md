# ADR 0007: DuganLabs is one public monorepo and the control plane

- Status: **accepted** (Nov 26, 2026)
- Owner: Warren Dugan

## Decision
- Every Dugan Labs domain lives in this repo as `apps/<domain>`; shared code in `libs/`;
  rules in `AGENTS.md` and `standards/`; CI, deploy and Cloudflare infra live here too.
- The repo is **public** (free CI minutes). No secrets or personal data in code, tests, docs
  or commit metadata; commits use the GitHub noreply identity (`standards/public-repo.md`).
- **One Doppler project and config** (`duganlabs/repository`) synced to GitHub Actions, with one
  exception: Plaid key material lives in the unsynced `pendingbusiness-runtime` project and
  reaches its Worker as a runtime secret (`docs/PLAID-SECRETS.md`). Supersedes ADR 0004.
- Every site's root is the standard coming-soon page; previous content for live sites moves
  behind Cloudflare Access at `private.<domain>`.
- BaseNative's packages stay in the separate public BaseNative repo; only its site lives here.
- Nx Cloud is used only for the single owner commit identity, never for bots.
