output "access_team_domain" {
  description = "Team domain host for ACCESS_TEAM_DOMAIN."
  value       = cloudflare_zero_trust_organization.this.auth_domain
}

output "access_aud" {
  description = "Application audience tag for ACCESS_AUD."
  value       = cloudflare_zero_trust_access_application.stallion.aud
}

output "access_client_id" {
  description = "Client id of the stallion-automation service token."
  value       = cloudflare_zero_trust_access_service_token.automation.client_id
}

output "access_client_secret" {
  description = "Client secret of the stallion-automation service token."
  value       = cloudflare_zero_trust_access_service_token.automation.client_secret
  sensitive   = true
}
