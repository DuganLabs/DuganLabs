variable "account_id" {
  type        = string
  description = "Cloudflare account id of Dugan Labs (TF_VAR_account_id from Doppler)."
}

variable "owner_emails" {
  type        = list(string)
  sensitive   = true
  description = "Who may open private areas. Public repo: set via TF_VAR_owner_emails in Doppler, never here."
}

variable "session_duration" {
  type    = string
  default = "24h"
}

locals {
  # Every coming-soon site. Its /app area is private; for the six live sites the
  # previous site also moves to private.<domain>, protected in full.
  sites = {
    greenput        = { domain = "greenput.com", private_host = true }
    pendingbusiness = { domain = "pendingbusiness.com", private_host = true }
    basenative      = { domain = "basenative.com", private_host = true }
    t4bs            = { domain = "t4bs.com", private_host = true }
    warrendugan     = { domain = "warrendugan.com", private_host = true }
    duganlabs       = { domain = "duganlabs.com", private_host = true }
    boxsized        = { domain = "boxsized.com", private_host = false }
    hipowerinc      = { domain = "hipowerinc.com", private_host = false }
    theduganhouse   = { domain = "theduganhouse.com", private_host = false }
    visitnorthwood  = { domain = "visitnorthwood.com", private_host = false }
    warrenmd        = { domain = "warrenmd.com", private_host = false }
  }
}
