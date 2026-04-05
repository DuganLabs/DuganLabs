output "worker_route_root" {
  description = "Root domain Worker route"
  value       = cloudflare_worker_route.root.pattern
}

output "worker_route_www" {
  description = "WWW Worker route"
  value       = cloudflare_worker_route.www.pattern
}
