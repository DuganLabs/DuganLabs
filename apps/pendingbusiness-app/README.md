# PendingBusiness app (imported product, owner-only)

The working PendingBusiness app (Worker `pending-business`, D1 `pendingbusiness`) at
`https://private.pendingbusiness.com`, behind Cloudflare Access (owner only). The public
`pendingbusiness.com` serves the coming-soon page (`apps/pendingbusiness`).

- **Code:** `workspace/` is the app's own Nx + pnpm workspace, imported from the private
  `DuganLabs/PendingBusiness` repo at c2fd2c3 **without history** (Warren, Nov 26 2026). The seed
  user's address is a placeholder; seeded figures are illustrative.
- **Deploy:** `.github/workflows/pendingbusiness-app.yml`, manual (`workflow_dispatch`) like the
  original: lint, typecheck, test, build, D1 migrations, `wrangler deploy`.
- **Secrets:** Cloudflare credentials from Doppler `duganlabs/repository` (GitHub sync). Runtime
  secrets live only on the Worker: `OWNER_EMAIL` (source of truth Doppler `duganlabs/repository`)
  and the Plaid secrets (`PLAID_*`, see `workspace/docs/PLAID-SECRETS.md`). CI never references
  Plaid secrets; `wrangler deploy` keeps existing Worker secrets.
- **Passkeys:** `RP_ID = "pendingbusiness.com"`, `RP_ORIGIN = "https://private.pendingbusiness.com"`.
