variable "account_id" {
  type        = string
  description = "Cloudflare account that owns the Worker and the Zero Trust organization."
  default     = "f496802dcadb597e5939f6449c759a43"
}

variable "app_domains" {
  type        = list(string)
  description = "Hostnames of the stallion Worker that Access guards; the first is the primary domain."
  default     = ["stallion.kattebak.fyi", "stallion.matthijs-f49.workers.dev"]
}

variable "access_paths" {
  type        = list(string)
  description = "Paths on every app domain that Access guards, each with its subpaths; the rest of the hostname is public."
  default     = ["/api", "/sign-in"]
}
