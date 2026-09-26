variable "account_id" {
  type        = string
  description = "Cloudflare account that owns the Worker and the Zero Trust organization."
  default     = "f496802dcadb597e5939f6449c759a43"
}

variable "app_domain" {
  type        = string
  description = "Hostname of the stallion Worker that Access guards."
  default     = "stallion.matthijs-f49.workers.dev"
}
