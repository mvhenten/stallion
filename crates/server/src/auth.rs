use std::collections::HashMap;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rsa::pkcs1v15::{Signature, VerifyingKey};
use rsa::signature::Verifier;
use rsa::{BigUint, RsaPublicKey};
use serde::Deserialize;
use sha2::Sha256;

pub const ASSERTION_HEADER: &str = "Cf-Access-Jwt-Assertion";
pub const COOKIE_NAME: &str = "CF_Authorization";
pub const KEYS_TTL_MS: u64 = 60 * 60 * 1000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccessApp {
    pub team_domain: String,
    pub aud: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Access {
    Disabled,
    Enabled(AccessApp),
}

impl Access {
    pub fn from_vars(team_domain: &str, aud: &str) -> Result<Self, String> {
        let team_domain = team_domain
            .trim()
            .trim_start_matches("https://")
            .trim_end_matches('/');
        let aud = aud.trim();
        match (team_domain.is_empty(), aud.is_empty()) {
            (true, true) => Ok(Access::Disabled),
            (false, false) => Ok(Access::Enabled(AccessApp {
                team_domain: team_domain.to_string(),
                aud: aud.to_string(),
            })),
            _ => Err("set both ACCESS_TEAM_DOMAIN and ACCESS_AUD, or neither".into()),
        }
    }
}

impl AccessApp {
    pub fn certs_url(&self) -> String {
        format!("https://{}/cdn-cgi/access/certs", self.team_domain)
    }

    pub fn issuer(&self) -> String {
        format!("https://{}", self.team_domain)
    }
}

pub fn token<'a>(assertion: Option<&'a str>, cookie: Option<&'a str>) -> Option<&'a str> {
    if let Some(value) = assertion.map(str::trim).filter(|v| !v.is_empty()) {
        return Some(value);
    }
    cookie?
        .split(';')
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(name, _)| *name == COOKIE_NAME)
        .map(|(_, value)| value)
        .filter(|v| !v.is_empty())
}

pub type Keys = HashMap<String, RsaPublicKey>;

#[derive(Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}

#[derive(Deserialize)]
struct Jwk {
    kid: String,
    kty: String,
    n: String,
    e: String,
}

pub fn parse_keys(jwks: &str) -> Result<Keys, String> {
    let jwks: Jwks = serde_json::from_str(jwks).map_err(|e| format!("invalid JWKS: {e}"))?;
    jwks.keys
        .into_iter()
        .filter(|k| k.kty == "RSA")
        .map(|k| {
            let n = BigUint::from_bytes_be(&b64(&k.n)?);
            let e = BigUint::from_bytes_be(&b64(&k.e)?);
            let key = RsaPublicKey::new(n, e).map_err(|e| format!("invalid RSA key: {e}"))?;
            Ok((k.kid, key))
        })
        .collect()
}

fn b64(part: &str) -> Result<Vec<u8>, String> {
    URL_SAFE_NO_PAD
        .decode(part)
        .map_err(|e| format!("invalid base64url: {e}"))
}

#[derive(Deserialize)]
struct Header {
    alg: String,
    kid: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Audience {
    One(String),
    Many(Vec<String>),
}

impl Audience {
    fn contains(&self, aud: &str) -> bool {
        match self {
            Audience::One(a) => a == aud,
            Audience::Many(all) => all.iter().any(|a| a == aud),
        }
    }
}

#[derive(Deserialize)]
struct Claims {
    aud: Audience,
    iss: String,
    exp: u64,
    #[serde(default)]
    nbf: Option<u64>,
    #[serde(default)]
    email: String,
    #[serde(default)]
    common_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    pub name: String,
}

pub fn verify(
    token: &str,
    keys: &Keys,
    app: &AccessApp,
    now_secs: u64,
) -> Result<Identity, String> {
    let mut parts = token.split('.');
    let (Some(header), Some(payload), Some(signature), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err("malformed JWT".into());
    };
    let head: Header =
        serde_json::from_slice(&b64(header)?).map_err(|e| format!("invalid JWT header: {e}"))?;
    if head.alg != "RS256" {
        return Err(format!("unsupported alg {:?}", head.alg));
    }
    let key = keys
        .get(&head.kid)
        .ok_or_else(|| format!("unknown kid {:?}", head.kid))?;
    let signature = Signature::try_from(b64(signature)?.as_slice())
        .map_err(|e| format!("invalid signature: {e}"))?;
    let signed = &token[..header.len() + 1 + payload.len()];
    VerifyingKey::<Sha256>::new(key.clone())
        .verify(signed.as_bytes(), &signature)
        .map_err(|_| "bad signature".to_string())?;
    let claims: Claims =
        serde_json::from_slice(&b64(payload)?).map_err(|e| format!("invalid JWT claims: {e}"))?;
    if !claims.aud.contains(&app.aud) {
        return Err("wrong audience".into());
    }
    if claims.iss != app.issuer() {
        return Err("wrong issuer".into());
    }
    if claims.exp <= now_secs {
        return Err("expired".into());
    }
    if claims.nbf.is_some_and(|nbf| nbf > now_secs) {
        return Err("not yet valid".into());
    }
    let name = if claims.email.is_empty() {
        claims.common_name
    } else {
        claims.email
    };
    if name.is_empty() {
        return Err("no email or common_name".into());
    }
    Ok(Identity { name })
}

#[cfg(test)]
mod tests {
    use std::sync::OnceLock;

    use rsa::RsaPrivateKey;
    use rsa::pkcs1v15::SigningKey;
    use rsa::signature::{SignatureEncoding, Signer};
    use rsa::traits::PublicKeyParts;
    use serde_json::json;

    use super::*;

    const NOW: u64 = 1_800_000_000;

    fn app() -> AccessApp {
        AccessApp {
            team_domain: "team.cloudflareaccess.com".into(),
            aud: "app-aud".into(),
        }
    }

    fn private_key() -> &'static RsaPrivateKey {
        static KEY: OnceLock<RsaPrivateKey> = OnceLock::new();
        KEY.get_or_init(|| RsaPrivateKey::new(&mut rand::thread_rng(), 1024).unwrap())
    }

    fn keys() -> Keys {
        let public = private_key().to_public_key();
        let jwks = json!({ "keys": [{
            "kid": "k1",
            "kty": "RSA",
            "alg": "RS256",
            "n": URL_SAFE_NO_PAD.encode(public.n().to_bytes_be()),
            "e": URL_SAFE_NO_PAD.encode(public.e().to_bytes_be()),
        }]});
        parse_keys(&jwks.to_string()).unwrap()
    }

    fn sign(claims: serde_json::Value) -> String {
        let header = URL_SAFE_NO_PAD.encode(json!({ "alg": "RS256", "kid": "k1" }).to_string());
        let payload = URL_SAFE_NO_PAD.encode(claims.to_string());
        let signed = format!("{header}.{payload}");
        let signature = SigningKey::<Sha256>::new(private_key().clone()).sign(signed.as_bytes());
        format!("{signed}.{}", URL_SAFE_NO_PAD.encode(signature.to_bytes()))
    }

    fn claims(aud: &str, exp: u64) -> serde_json::Value {
        json!({
            "aud": [aud],
            "iss": "https://team.cloudflareaccess.com",
            "exp": exp,
            "email": "user@example.com",
        })
    }

    #[test]
    fn accepts_a_valid_token() {
        let identity = verify(&sign(claims("app-aud", NOW + 60)), &keys(), &app(), NOW).unwrap();
        assert_eq!(identity.name, "user@example.com");
    }

    #[test]
    fn accepts_a_service_token_by_its_common_name() {
        let token = sign(json!({
            "aud": ["app-aud"],
            "iss": "https://team.cloudflareaccess.com",
            "exp": NOW + 60,
            "type": "app",
            "sub": "",
            "common_name": "client-id.access",
        }));
        let identity = verify(&token, &keys(), &app(), NOW).unwrap();
        assert_eq!(identity.name, "client-id.access");
    }

    #[test]
    fn rejects_a_token_without_a_name() {
        let token = sign(json!({
            "aud": ["app-aud"],
            "iss": "https://team.cloudflareaccess.com",
            "exp": NOW + 60,
        }));
        assert_eq!(
            verify(&token, &keys(), &app(), NOW),
            Err("no email or common_name".into())
        );
    }

    #[test]
    fn rejects_a_wrong_audience() {
        let token = sign(claims("other-aud", NOW + 60));
        assert_eq!(
            verify(&token, &keys(), &app(), NOW),
            Err("wrong audience".into())
        );
    }

    #[test]
    fn rejects_an_expired_token() {
        let token = sign(claims("app-aud", NOW - 1));
        assert_eq!(verify(&token, &keys(), &app(), NOW), Err("expired".into()));
    }

    #[test]
    fn rejects_a_bad_signature() {
        let token = sign(claims("app-aud", NOW + 60));
        let forged = URL_SAFE_NO_PAD.encode(claims("app-aud", NOW + 6000).to_string());
        let mut parts: Vec<&str> = token.split('.').collect();
        parts[1] = &forged;
        assert_eq!(
            verify(&parts.join("."), &keys(), &app(), NOW),
            Err("bad signature".into())
        );
    }

    #[test]
    fn disables_only_when_both_vars_are_empty() {
        assert_eq!(Access::from_vars("", ""), Ok(Access::Disabled));
        assert!(Access::from_vars("team.cloudflareaccess.com", "").is_err());
        assert_eq!(
            Access::from_vars("https://team.cloudflareaccess.com/", "app-aud"),
            Ok(Access::Enabled(app()))
        );
    }

    #[test]
    fn reads_the_header_before_the_cookie() {
        assert_eq!(token(Some("h"), Some("CF_Authorization=c")), Some("h"));
        assert_eq!(token(None, Some("a=1; CF_Authorization=c")), Some("c"));
        assert_eq!(token(None, Some("a=1")), None);
    }
}
