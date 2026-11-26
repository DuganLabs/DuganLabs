# Plaid secrets: runtime-only, never in CI

**Rule.** Plaid key material (today `PLAID_CREDENTIALS_KEKS`; any future `PLAID_*`
secret) never goes into GitHub secrets, the GitHub-synced Doppler config, CI
logs, or the repo. It lives in one place, the Doppler project
**`pendingbusiness-runtime`** (config `prd`, no integrations, no service
tokens). From there the owner sets it on the `pending-business` Worker as a
**Cloudflare runtime secret**. Worker secrets persist across `wrangler deploy`,
so CI deploys code without ever seeing the key. The app reads it from `env` at
runtime (`worker/src/crypto/plaidCredentials.ts`).

The Plaid `client_id` and `secret` themselves are not env vars. They are entered in the
app and stored envelope-encrypted in D1 (`plaid_credentials`, migration 0003)
under this key.

Guards:
- `deploy.yml` fails if any workflow (or `scripts/pipeline.sh`) references a Plaid secret.
- In the DuganLabs monorepo, `tools/ci/guard.sh` does the same for `.github/`,
  `tools/deploy/` and every app's `deploy.json` and `wrangler.toml`.

## Why not the Doppler -> Cloudflare integration?
Doppler's Cloudflare sync targets Pages only; it has no Workers-secrets sync.
`scripts/set-plaid-secret.sh` pipes the value straight from `doppler secrets get` into
`wrangler secret put`. It is never printed, written to disk, or exported.

## Doppler plan fit (Developer, free)
Limits: 10 projects, 4 environments per project, 10 configs per environment, 5 config syncs.
- Today there are 6 projects. Adding `pendingbusiness-runtime` makes 7.
- After the monorepo cut-over retires the old per-repo projects, 2 remain:
  `duganlabs` (synced to GitHub) and `pendingbusiness-runtime` (unsynced).
- It uses 0 syncs and 0 service tokens.

## One-time migration (Warren)
Each step is yours to run; the bot changes nothing.

1. **Create the project.** Doppler dashboard -> Projects -> New: `pendingbusiness-runtime`.
   Keep only the `prd` environment (dev and stg may be deleted).
   - Add no integrations and no service tokens.
   - Access: only you.
2. **Put the current key in it.** Use the exact JSON the Worker has today, e.g. `{"1":"<base64>"}`.
   - If it is already in Doppler `pendingbusiness/repository`, copy it across without printing:
     `doppler secrets get PLAID_CREDENTIALS_KEKS --plain -p pendingbusiness -c repository | doppler secrets set PLAID_CREDENTIALS_KEKS -p pendingbusiness-runtime -c prd`
     Then delete it from `pendingbusiness/repository`:
     `doppler secrets delete PLAID_CREDENTIALS_KEKS -p pendingbusiness -c repository`
   - If it only ever lived in the GitHub secret: GitHub secrets cannot be read back.
     - Use your own copy (password manager) if you have one.
     - Otherwise generate a fresh key: `{"2":"$(openssl rand -base64 32)"}` and set
       `PLAID_CREDENTIALS_KEK_CURRENT = "2"` in `worker/wrangler.toml`. After step 3,
       re-enter the Plaid client_id/secret in PendingBusiness settings (from the
       Plaid dashboard). The old row cannot be decrypted without key "1", so Plaid
       features fail closed until you re-enter.
3. **Set it on the Worker.** Run:
   `pnpm exec wrangler login && scripts/set-plaid-secret.sh`
   - The script validates the shape (32-byte keys) without printing, then runs `wrangler secret put`.
   - Re-setting the same value is a no-op for the app.
4. **Owner email as a secret.** Run: `cd worker && pnpm exec wrangler secret put OWNER_EMAIL`
   and type the address at the prompt.
   - It is no longer a `[vars]` entry, so the address is not in the (soon public) code.
   - It is currently only declared in `env.ts`, so removing the var has no runtime effect.
5. **Verify.** Run `cd worker && pnpm exec wrangler secret list`.
   - It should list `OWNER_EMAIL` and `PLAID_CREDENTIALS_KEKS` (names only).
   - In the app, load Plaid settings to confirm decryption works.
6. **Merge and deploy this change** (your yes).
   - The deploy job no longer has the secret-push step, and the guard step passes.
   - Check the run log: there should be no `PLAID` lines except the guard's grep.
7. **Delete the GitHub secret** (your yes; irreversible):
   `gh secret delete PLAID_CREDENTIALS_KEKS -R DuganLabs/PendingBusiness`
   Also confirm no org-level secret of that name exists:
   `gh secret list --org DuganLabs`.

## Rotation
1. `openssl rand -base64 32`, then add it as a new version in Doppler
   `pendingbusiness-runtime/prd`, keeping the old one: `{"1":"<old>","2":"<new>"}`.
2. `scripts/set-plaid-secret.sh`.
3. Bump `PLAID_CREDENTIALS_KEK_CURRENT` in `worker/wrangler.toml` and deploy.
4. `worker/scripts/rewrap-plaid-credentials.mjs` re-wraps existing rows. Run it under
   `doppler run -p pendingbusiness-runtime -c prd -- ...` on your machine.
5. When every row reports the new version, remove the old version in Doppler and
   run `scripts/set-plaid-secret.sh` again.

## Residual risk (accepted, mitigated)
CI still deploys code, and that code reads the key at runtime. A malicious change could
exfiltrate it from inside the Worker.

Mitigations:
- CODEOWNERS review on `worker/src/crypto/**` and the Plaid routes.
- Branch protection on main.
- The production GitHub environment requires your approval.
- Fork PRs never receive deploy secrets.
