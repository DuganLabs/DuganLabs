resource "cloudflare_worker_script" "duganlabs" {
  account_id = var.cloudflare_account_id
  name       = "duganlabs"
  content    = "// Managed by wrangler deploy — Terraform manages the resource, CI deploys the code"
  module     = true

  compatibility_date  = "2026-04-04"
  compatibility_flags = ["nodejs_compat"]
}

resource "cloudflare_worker_route" "root" {
  zone_id     = var.cloudflare_zone_id
  pattern     = "${var.domain}/*"
  script_name = cloudflare_worker_script.duganlabs.name
}

resource "cloudflare_worker_route" "www" {
  zone_id     = var.cloudflare_zone_id
  pattern     = "www.${var.domain}/*"
  script_name = cloudflare_worker_script.duganlabs.name
}
