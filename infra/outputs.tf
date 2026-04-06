output "dns_root" {
  description = "Root DNS record"
  value       = cloudflare_record.root.hostname
}

output "dns_www" {
  description = "WWW DNS record"
  value       = cloudflare_record.www.hostname
}
