terraform {
  required_version = ">= 1.10"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.26"
    }
  }

  backend "local" {}
}

provider "cloudflare" {}

import {
  to = cloudflare_zero_trust_organization.this
  id = var.account_id
}

resource "cloudflare_zero_trust_organization" "this" {
  account_id                                  = var.account_id
  auto_redirect_to_identity                   = true
  deny_unmatched_requests                     = false
  deny_unmatched_requests_exempted_zone_names = []

  service_token_inactivity = {
    enabled                   = false
    action                    = "disable"
    inactivity_threshold_days = 90
  }

  lifecycle {
    ignore_changes = [name, auth_domain]
  }
}

resource "cloudflare_zero_trust_access_identity_provider" "otp" {
  account_id = var.account_id
  name       = "One-time PIN"
  type       = "onetimepin"
  config     = {}
}

resource "cloudflare_zero_trust_access_policy" "anyone" {
  account_id = var.account_id
  name       = "anyone-with-email"
  decision   = "allow"
  include = [{
    everyone = {}
  }]
}

resource "cloudflare_zero_trust_access_service_token" "automation" {
  account_id = var.account_id
  name       = "stallion-automation"
  duration   = "8760h"

  lifecycle {
    create_before_destroy = true
  }
}

resource "cloudflare_zero_trust_access_policy" "automation" {
  account_id = var.account_id
  name       = "Allow the automation service token"
  decision   = "non_identity"
  include = [{
    service_token = {
      token_id = cloudflare_zero_trust_access_service_token.automation.id
    }
  }]
}

resource "cloudflare_zero_trust_access_application" "stallion" {
  account_id                = var.account_id
  name                      = "stallion"
  type                      = "self_hosted"
  domain                    = var.app_domain
  session_duration          = "720h"
  auto_redirect_to_identity = true
  enable_binding_cookie     = false
  options_preflight_bypass  = false
  allowed_idps              = [cloudflare_zero_trust_access_identity_provider.otp.id]
  policies = [{
    id         = cloudflare_zero_trust_access_policy.anyone.id
    precedence = 1
    }, {
    id         = cloudflare_zero_trust_access_policy.automation.id
    precedence = 2
  }]
}
