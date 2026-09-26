output "access_team_domain" {
  description = "Team domain host for ACCESS_TEAM_DOMAIN."
  value       = cloudflare_zero_trust_organization.this.auth_domain
}

output "access_aud" {
  description = "Application audience tag for ACCESS_AUD."
  value       = cloudflare_zero_trust_access_application.stallion.aud
}
