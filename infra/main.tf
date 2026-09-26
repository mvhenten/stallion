terraform {
  required_version = ">= 1.10"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.26"
    }
  }

  backend "local" {
    path = "terraform.tfstate"
  }
}

provider "cloudflare" {}

data "cloudflare_user" "owner" {}

import {
  to = cloudflare_zero_trust_organization.this
  id = var.account_id
}

resource "cloudflare_zero_trust_organization" "this" {
  account_id                                  = var.account_id
  auto_redirect_to_identity                   = true
  deny_unmatched_requests                     = false
  deny_unmatched_requests_exempted_zone_names = []

  lifecycle {
    ignore_changes = [name, auth_domain, service_token_inactivity]
  }
}

resource "cloudflare_zero_trust_access_identity_provider" "otp" {
  account_id = var.account_id
  name       = "One-time PIN"
  type       = "onetimepin"
  config     = {}
}

resource "cloudflare_zero_trust_access_policy" "owner" {
  account_id = var.account_id
  name       = "Allow the account owner"
  decision   = "allow"
  include = [{
    email = {
      email = data.cloudflare_user.owner.email
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
  allowed_idps              = [cloudflare_zero_trust_access_identity_provider.otp.id]
  policies = [{
    id         = cloudflare_zero_trust_access_policy.owner.id
    precedence = 1
  }]
}
