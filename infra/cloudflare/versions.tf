# Cloudflare control plane for the monorepo: Access (Warren-only private areas),
# Turnstile (one widget for every landing), D1 (leads). NOT APPLIED YET (Phase 3).
#
#   doppler run -- terraform -chdir=infra/cloudflare plan
#
# Inputs come from Doppler duganlabs/repository as TF_VAR_* (never committed):
#   TF_VAR_account_id, TF_VAR_owner_emails (JSON list), TF_VAR_access_team_domain,
#   CLOUDFLARE_API_TOKEN (scopes: Access Apps+Policies Edit, Turnstile Edit, D1 Edit).
# State: local by default and gitignored; move to a remote backend before team use.
terraform {
  required_version = ">= 1.6"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

provider "cloudflare" {}
