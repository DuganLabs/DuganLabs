output "dns_root" {
  description = "Root DNS record"
  value       = cloudflare_record.root.hostname
}

output "dns_www" {
  description = "WWW DNS record"
  value       = cloudflare_record.www.hostname
}

output "blog_kv_id" {
  description = "KV namespace ID for blog posts"
  value       = cloudflare_workers_kv_namespace.blog.id
}

output "registry_kv_id" {
  description = "KV namespace ID for ecosystem registry"
  value       = cloudflare_workers_kv_namespace.registry.id
}
