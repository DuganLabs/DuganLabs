# Leads live only here (never in the repo). Schema: apps/leads/migrations.
resource "cloudflare_d1_database" "leads" {
  account_id = var.account_id
  name       = "dl-leads"
  read_replication = {
    mode = "disabled"
  }
}

resource "cloudflare_d1_database" "leads_staging" {
  account_id = var.account_id
  name       = "dl-leads-staging"
  read_replication = {
    mode = "disabled"
  }
}

output "d1_ids" {
  description = "-> database_id in apps/leads/wrangler.toml (prod and env.staging)."
  value = {
    production = cloudflare_d1_database.leads.id
    staging    = cloudflare_d1_database.leads_staging.id
  }
}
