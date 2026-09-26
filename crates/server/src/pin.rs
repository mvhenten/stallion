use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

pub const PIN_DIGITS: usize = 6;
pub const ITERATIONS: u32 = 100_000;
pub const SALT_BYTES: usize = 16;
pub const HASH_BYTES: usize = 32;
pub const ATTEMPTS_PER_WINDOW: usize = 5;
pub const WINDOW_MS: u64 = 60_000;
pub const PASS_TTL_SECS: u64 = 30 * 24 * 60 * 60;

const SCHEME: &str = "pbkdf2-sha256";

pub fn check_pin(pin: &str) -> Result<(), String> {
    if pin.len() == PIN_DIGITS && pin.bytes().all(|b| b.is_ascii_digit()) {
        return Ok(());
    }
    Err(format!("a PIN is exactly {PIN_DIGITS} digits"))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PinHash {
    pub iterations: u32,
    pub salt: Vec<u8>,
    pub hash: Vec<u8>,
}

impl PinHash {
    pub fn encode(&self) -> String {
        format!(
            "{SCHEME}${}${}${}",
            self.iterations,
            URL_SAFE_NO_PAD.encode(&self.salt),
            URL_SAFE_NO_PAD.encode(&self.hash)
        )
    }

    pub fn decode(stored: &str) -> Result<Self, String> {
        let mut parts = stored.split('$');
        let (Some(SCHEME), Some(iterations), Some(salt), Some(hash), None) = (
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
        ) else {
            return Err("the stored PIN hash is malformed".into());
        };
        let b64 = |part: &str| {
            URL_SAFE_NO_PAD
                .decode(part)
                .map_err(|e| format!("the stored PIN hash has invalid base64: {e}"))
        };
        Ok(PinHash {
            iterations: iterations
                .parse()
                .map_err(|e| format!("the stored PIN hash has invalid iterations: {e}"))?,
            salt: b64(salt)?,
            hash: b64(hash)?,
        })
    }

    pub fn matches(&self, derived: &[u8]) -> bool {
        derived.len() == self.hash.len()
            && derived
                .iter()
                .zip(&self.hash)
                .fold(0u8, |diff, (a, b)| diff | (a ^ b))
                == 0
    }
}

pub fn admit(history: &mut Vec<u64>, now_ms: u64) -> Result<usize, u64> {
    history.retain(|&at| now_ms.saturating_sub(at) < WINDOW_MS);
    if history.len() >= ATTEMPTS_PER_WINDOW {
        let oldest = history.iter().copied().min().unwrap_or(now_ms);
        return Err((oldest + WINDOW_MS).saturating_sub(now_ms).div_ceil(1000));
    }
    history.push(now_ms);
    Ok(ATTEMPTS_PER_WINDOW - history.len())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PassClaims {
    board_id: String,
    exp: u64,
    generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PassError {
    Malformed,
    BadSignature,
    WrongBoard,
    Expired,
    Superseded,
}

impl PassError {
    pub fn message(&self) -> &'static str {
        match self {
            PassError::Malformed => "the board pass is malformed",
            PassError::BadSignature => "the board pass signature does not match",
            PassError::WrongBoard => "the board pass is for another board",
            PassError::Expired => "the board pass has expired",
            PassError::Superseded => "the board PIN changed since this pass was issued",
        }
    }
}

type HmacSha256 = Hmac<Sha256>;

fn mac(secret: &[u8], payload: &str) -> HmacSha256 {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(payload.as_bytes());
    mac
}

pub fn issue_pass(secret: &[u8], board_id: &str, generation: u64, now_secs: u64) -> (String, u64) {
    let exp = now_secs + PASS_TTL_SECS;
    let claims = PassClaims {
        board_id: board_id.to_owned(),
        exp,
        generation,
    };
    let payload =
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).expect("pass claims serialize to JSON"));
    let signature = URL_SAFE_NO_PAD.encode(mac(secret, &payload).finalize().into_bytes());
    (format!("{payload}.{signature}"), exp)
}

pub fn check_pass(
    secret: &[u8],
    pass: &str,
    board_id: &str,
    generation: u64,
    now_secs: u64,
) -> Result<(), PassError> {
    let (payload, signature) = pass.split_once('.').ok_or(PassError::Malformed)?;
    let signature = URL_SAFE_NO_PAD
        .decode(signature)
        .map_err(|_| PassError::Malformed)?;
    mac(secret, payload)
        .verify_slice(&signature)
        .map_err(|_| PassError::BadSignature)?;
    let claims: PassClaims = URL_SAFE_NO_PAD
        .decode(payload)
        .ok()
        .and_then(|json| serde_json::from_slice(&json).ok())
        .ok_or(PassError::Malformed)?;
    if claims.board_id != board_id {
        return Err(PassError::WrongBoard);
    }
    if claims.exp <= now_secs {
        return Err(PassError::Expired);
    }
    if claims.generation != generation {
        return Err(PassError::Superseded);
    }
    Ok(())
}

#[cfg(target_arch = "wasm32")]
mod platform {
    use worker::js_sys::{Array, Reflect, Uint8Array};
    use worker::wasm_bindgen::{JsCast, JsValue};
    use worker::wasm_bindgen_futures::JsFuture;
    use worker::web_sys::{Crypto, CryptoKey, Pbkdf2Params};

    fn js_error(context: &str, error: JsValue) -> String {
        format!("{context}: {error:?}")
    }

    fn crypto() -> Result<Crypto, String> {
        Reflect::get(&worker::js_sys::global(), &JsValue::from_str("crypto"))
            .map_err(|e| js_error("no global crypto", e))?
            .dyn_into::<Crypto>()
            .map_err(|e| js_error("global crypto is not a Crypto", e))
    }

    pub fn random_bytes(len: usize) -> Result<Vec<u8>, String> {
        let mut bytes = vec![0u8; len];
        crypto()?
            .get_random_values_with_u8_array(&mut bytes)
            .map_err(|e| js_error("getRandomValues failed", e))?;
        Ok(bytes)
    }

    pub async fn derive(pin: &str, salt: &[u8], iterations: u32) -> Result<Vec<u8>, String> {
        let subtle = crypto()?.subtle();
        let usages = Array::of1(&JsValue::from_str("deriveBits"));
        let key = JsFuture::from(
            subtle
                .import_key_with_str(
                    "raw",
                    &Uint8Array::from(pin.as_bytes()),
                    "PBKDF2",
                    false,
                    &usages,
                )
                .map_err(|e| js_error("importKey failed", e))?,
        )
        .await
        .map_err(|e| js_error("importKey rejected", e))?
        .dyn_into::<CryptoKey>()
        .map_err(|e| js_error("importKey did not return a CryptoKey", e))?;
        let params = Pbkdf2Params::new(
            "PBKDF2",
            &JsValue::from_str("SHA-256"),
            iterations,
            &Uint8Array::from(salt),
        );
        let bits = JsFuture::from(
            subtle
                .derive_bits_with_object(&params, &key, (super::HASH_BYTES * 8) as u32)
                .map_err(|e| js_error("deriveBits failed", e))?,
        )
        .await
        .map_err(|e| js_error("deriveBits rejected", e))?;
        Ok(Uint8Array::new(&bits).to_vec())
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod platform {
    use rand::RngCore;

    pub fn random_bytes(len: usize) -> Result<Vec<u8>, String> {
        let mut bytes = vec![0u8; len];
        rand::thread_rng().fill_bytes(&mut bytes);
        Ok(bytes)
    }

    pub async fn derive(pin: &str, salt: &[u8], iterations: u32) -> Result<Vec<u8>, String> {
        let mut hash = vec![0u8; super::HASH_BYTES];
        pbkdf2::pbkdf2_hmac::<sha2::Sha256>(pin.as_bytes(), salt, iterations, &mut hash);
        Ok(hash)
    }
}

pub use platform::random_bytes;

pub async fn hash_pin(pin: &str) -> Result<PinHash, String> {
    let salt = random_bytes(SALT_BYTES)?;
    let hash = platform::derive(pin, &salt, ITERATIONS).await?;
    Ok(PinHash {
        iterations: ITERATIONS,
        salt,
        hash,
    })
}

pub async fn verify_pin(stored: &PinHash, pin: &str) -> Result<bool, String> {
    let derived = platform::derive(pin, &stored.salt, stored.iterations).await?;
    Ok(stored.matches(&derived))
}

#[cfg(test)]
mod tests {
    use std::future::Future;
    use std::pin::pin;
    use std::task::{Context, Poll, Waker};

    use super::*;

    const SECRET: &[u8] = b"test-secret";
    const NOW: u64 = 1_800_000_000;

    fn ready<T>(future: impl Future<Output = T>) -> T {
        match pin!(future).poll(&mut Context::from_waker(Waker::noop())) {
            Poll::Ready(value) => value,
            Poll::Pending => panic!("native crypto never awaits"),
        }
    }

    #[test]
    fn accepts_only_six_digits() {
        assert!(check_pin("123456").is_ok());
        assert!(check_pin("12345").is_err());
        assert!(check_pin("1234567").is_err());
        assert!(check_pin("12345a").is_err());
        assert!(check_pin("").is_err());
    }

    #[test]
    fn verifies_the_pin_it_hashed() {
        let stored = ready(hash_pin("123456")).unwrap();
        let decoded = PinHash::decode(&stored.encode()).unwrap();
        assert_eq!(decoded, stored);
        assert_eq!(decoded.salt.len(), SALT_BYTES);
        assert!(ready(verify_pin(&decoded, "123456")).unwrap());
        assert!(!ready(verify_pin(&decoded, "123457")).unwrap());
    }

    #[test]
    fn salts_every_hash() {
        let first = ready(hash_pin("123456")).unwrap();
        let second = ready(hash_pin("123456")).unwrap();
        assert_ne!(first.hash, second.hash);
    }

    #[test]
    fn allows_five_attempts_a_minute() {
        let mut history = Vec::new();
        for left in (0..ATTEMPTS_PER_WINDOW).rev() {
            assert_eq!(admit(&mut history, 1_000), Ok(left));
        }
        assert_eq!(admit(&mut history, 1_500), Err(60));
        assert_eq!(admit(&mut history, 60_999), Err(1));
        assert_eq!(admit(&mut history, 61_000), Ok(ATTEMPTS_PER_WINDOW - 1));
        assert_eq!(history, vec![61_000]);
    }

    #[test]
    fn accepts_a_pass_it_issued() {
        let (pass, exp) = issue_pass(SECRET, "board", 3, NOW);
        assert_eq!(exp, NOW + PASS_TTL_SECS);
        assert_eq!(check_pass(SECRET, &pass, "board", 3, NOW + 60), Ok(()));
    }

    #[test]
    fn rejects_a_pass_for_another_board_generation_or_secret() {
        let (pass, _) = issue_pass(SECRET, "board", 3, NOW);
        assert_eq!(
            check_pass(SECRET, &pass, "other", 3, NOW),
            Err(PassError::WrongBoard)
        );
        assert_eq!(
            check_pass(SECRET, &pass, "board", 4, NOW),
            Err(PassError::Superseded)
        );
        assert_eq!(
            check_pass(b"other-secret", &pass, "board", 3, NOW),
            Err(PassError::BadSignature)
        );
        assert_eq!(
            check_pass(SECRET, &pass, "board", 3, NOW + PASS_TTL_SECS),
            Err(PassError::Expired)
        );
        assert_eq!(
            check_pass(SECRET, "garbage", "board", 3, NOW),
            Err(PassError::Malformed)
        );
    }

    #[test]
    fn rejects_a_tampered_pass() {
        let (pass, _) = issue_pass(SECRET, "board", 3, NOW);
        let (_, signature) = pass.split_once('.').unwrap();
        let forged = URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&PassClaims {
                board_id: "board".into(),
                exp: NOW + 10 * PASS_TTL_SECS,
                generation: 3,
            })
            .unwrap(),
        );
        assert_eq!(
            check_pass(SECRET, &format!("{forged}.{signature}"), "board", 3, NOW),
            Err(PassError::BadSignature)
        );
    }
}
