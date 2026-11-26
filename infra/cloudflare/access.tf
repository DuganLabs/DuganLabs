# One reusable "owner only" policy, one Access application per site that covers
# <domain>/app (hub, leads view, CSV) and, for live sites, the whole private.<domain>.
# Free plan: up to 50 users. The site Workers verify the Access JWT too (defense in
# depth) using the application AUD from the output below.
resource "cloudflare_zero_trust_access_policy" "owner" {
  account_id       = var.account_id
  name             = "Owner only"
  decision         = "allow"
  session_duration = var.session_duration
  include = [
    for e in var.owner_emails : { email = { email = e } }
  ]
}

resource "cloudflare_zero_trust_access_application" "private" {
  for_each   = local.sites
  account_id = var.account_id
  name       = "${each.key} private"
  type       = "self_hosted"
  destinations = concat(
    [
      { type = "public", uri = "${each.value.domain}/app" },
      { type = "public", uri = "${each.value.domain}/app/*" },
      { type = "public", uri = "www.${each.value.domain}/app" },
      { type = "public", uri = "www.${each.value.domain}/app/*" },
    ],
    each.value.private_host ? [{ type = "public", uri = "private.${each.value.domain}" }] : []
  )
  session_duration          = var.session_duration
  app_launcher_visible      = true
  auto_redirect_to_identity = true
  policies = [
    { id = cloudflare_zero_trust_access_policy.owner.id, precedence = 1 }
  ]
}

output "access_aud" {
  description = "Per-site Access AUD tag -> ACCESS_AUD var in apps/<app>/wrangler.toml."
  value       = { for k, a in cloudflare_zero_trust_access_application.private : k => a.aud }
}
