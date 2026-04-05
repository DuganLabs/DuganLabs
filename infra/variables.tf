variable "cloudflare_api_token" {
  description = "Cloudflare API token with permissions for Workers, DNS"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for duganlabs.com"
  type        = string
}

variable "domain" {
  description = "Root domain"
  type        = string
  default     = "duganlabs.com"
}
