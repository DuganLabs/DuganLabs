resource "cloudflare_workers_kv_namespace" "blog" {
  account_id = var.cloudflare_account_id
  title      = "duganlabs-blog"
}

resource "cloudflare_workers_kv_namespace" "registry" {
  account_id = var.cloudflare_account_id
  title      = "duganlabs-registry"
}
