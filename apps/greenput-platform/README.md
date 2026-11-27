# GreenPut platform (imported product)

The GreenPut product: `app.greenput.com` (platform, Pages `greenput-app`), `api.greenput.com`
(Worker `greenput-api`), tenant micro-sites `*.greenput.com` incl. `demo.` (Worker
`greenput-tenant`), `brand.greenput.com` (Worker `greenput-brand`), the marketing Worker at
`private.greenput.com` (behind Cloudflare Access) and D1 `greenput`.

- **Code:** `workspace/` is GreenPut's own Nx + pnpm workspace, imported from the private
  `DuganLabs/GreenPut` repo at 3611fa3 **without history** (Warren, Nov 26 2026). Personal
  addresses, a retired credential and a real phone number were replaced with placeholders.
- **CI/CD:** `.github/workflows/greenput.yml` (GreenPut's pipeline, paths-filtered to this
  folder): lint, unit/contract tests, build, staging deploy, then production Workers, D1
  migrations + seeds, Pages, hostname checks and an Observatory scan.
- **Secrets:** Cloudflare credentials come from Doppler `duganlabs/repository` (GitHub sync).
  Worker runtime secrets (Stripe, Twilio, Calls) are already set on the Workers and persist
  across deploys; to rotate them, set `GREENPUT_DOPPLER_TOKEN` (read-only token for Doppler
  `greenput/repository`) and the pipeline pushes them again. Nothing secret is in this repo.
- **Nx:** root Nx ignores `workspace/` (`.nxignore`); the wrapper project `greenput-platform`
  exposes `install`, `product-lint`, `product-test`, `product-build`, `serve`.
