# Secrets and Doppler

**One project, one config:** Doppler `duganlabs`, config `repository`, synced to this repo's
GitHub Actions secrets by the Doppler GitHub integration. Nobody sets GitHub secrets by hand.

| Kind | Where | Examples |
|---|---|---|
| CI secrets | `duganlabs/repository` -> GitHub sync | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `NX_CLOUD_ACCESS_TOKEN` |
| Worker runtime secrets | Same config, pushed with `doppler secrets --json \| jq … \| wrangler secret bulk` | `DL_LEADS_TURNSTILE_SECRETS`, `DL_LEADS_IP_SALT`, `<APP>_OWNER_EMAILS` |
| Terraform inputs | Same config as `TF_VAR_*`, used only on Warren's machine | `TF_VAR_account_id`, `TF_VAR_owner_emails` |
| **Plaid (exception)** | Doppler **`pendingbusiness-runtime/prd`**, NOT synced | `PLAID_CREDENTIALS_KEKS` |

- Naming: app-scoped values carry an `<APP>_` prefix in Doppler and are mapped to the plain
  name when pushed to that app's Worker.
- Worker secrets persist across deploys. CI deploys code, not secrets.
- **Plaid:** set on the `pending-business` Worker by Warren with `scripts/set-plaid-secret.sh`.
  It is never in GitHub, CI or this config. See `docs/PLAID-SECRETS.md`.
- **Developer (free) plan fit:** 10 projects, 4 environments per project, 10 configs per
  environment, 5 syncs. Target state is 2 projects and 1 sync.
  Doppler has no Workers-secrets sync (Pages only), hence the `wrangler secret` pushes.
