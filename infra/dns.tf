# DNS records for duganlabs.com Worker routes

resource "cloudflare_record" "root" {
  zone_id         = var.cloudflare_zone_id
  name            = "@"
  content         = "192.0.2.1"
  type            = "A"
  proxied         = true
  allow_overwrite = true
}

resource "cloudflare_record" "www" {
  zone_id         = var.cloudflare_zone_id
  name            = "www"
  content         = "192.0.2.1"
  type            = "A"
  proxied         = true
  allow_overwrite = true
}
