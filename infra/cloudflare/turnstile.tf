# Turnstile free plan: 10 hostnames per widget, 20 widgets per account. 11 sites,
# so they are split into groups of up to 10 apex domains (an apex covers its
# subdomains). Each site's TURNSTILE_SITE_KEY var is its group's sitekey (public).
# The dl-leads Worker gets TURNSTILE_SECRETS = {"<sitekey>": "<secret>", ...} as a
# runtime secret via Doppler; it picks the secret by the sitekey the site Worker
# forwards server-side. Secrets never enter the repo.
locals {
  turnstile_groups = {
    live = sort([for k, s in local.sites : s.domain if s.private_host])
    new  = sort([for k, s in local.sites : s.domain if !s.private_host])
  }
}

resource "cloudflare_turnstile_widget" "landing" {
  for_each   = local.turnstile_groups
  account_id = var.account_id
  name       = "DuganLabs landing pages (${each.key})"
  mode       = "managed"
  domains    = each.value
}

output "turnstile_sitekeys" {
  description = "group -> sitekey; set TURNSTILE_SITE_KEY in each app's wrangler.toml."
  value       = { for g, w in cloudflare_turnstile_widget.landing : g => w.sitekey }
}

check "turnstile_hostname_limit" {
  assert {
    condition     = alltrue([for g in local.turnstile_groups : length(g) <= 10])
    error_message = "A Turnstile widget may hold at most 10 hostnames on the free plan; add a group."
  }
}
