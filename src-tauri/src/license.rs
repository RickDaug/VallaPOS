//! Ed25519 LICENSE GATE — the trust anchor for the offline edition
//! (docs/EDITIONS.md §3/§6). The JS webview verify (`src/lib/license/`) is UX only;
//! THIS is the real gate — the app refuses to proceed unless the embedded public
//! key verifies the license signature. It mirrors the wire format in
//! `src/lib/license/license.ts` exactly:
//!
//!   packed = "VLK1" ‖ version(1) ‖ len(payload, u16 BE) ‖ payload(canonical JSON) ‖ sig(64)
//!   blob   = Crockford-Base32(packed)
//!
//! ⚠ Scaffold — NOT `cargo build`-verified (no local Rust toolchain). Boot-gating
//! the SQLite open on a valid license + the signed embedded revocation blocklist is
//! wired in Stage 6b.

use ed25519_dalek::{Signature, VerifyingKey};
use serde::Deserialize;

/// The 32-byte Ed25519 PUBLIC key, compiled into the binary. Its private
/// counterpart (`LICENSE_SIGNING_SK`) lives ONLY on vallahub. REPLACE these zeros
/// with the real public key bytes before shipping (docs/EDITIONS.md §6).
const PUBLIC_KEY: [u8; 32] = [0u8; 32];

const MAGIC: &[u8; 4] = b"VLK1";
const VERSION: u8 = 1;
const SIG_LEN: usize = 64;

#[derive(Debug, Deserialize)]
pub struct LicenseClaims {
    pub v: u8,
    pub p: String,
    pub sku: String,
    pub id: String,
    pub iat: u64,
    pub ex: Option<u64>,
    pub dev: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum LicenseError {
    Malformed,
    BadSignature,
    UnsupportedVersion,
    Expired,
    Revoked,
}

/// Verify a license blob against the embedded public key. `now_ms` enforces expiry
/// (`ex`); `revoked` is the signed embedded blocklist (offline CRL analog). The
/// SIGNATURE is checked before the payload is parsed, so a forged claim is never
/// interpreted. `verify_strict` rejects Ed25519 malleability edge cases.
pub fn verify_license(
    blob: &str,
    now_ms: u64,
    revoked: &[String],
) -> Result<LicenseClaims, LicenseError> {
    let packed = crockford_base32_decode(blob).ok_or(LicenseError::Malformed)?;
    let header = MAGIC.len() + 1 + 2;
    if packed.len() < header + SIG_LEN {
        return Err(LicenseError::Malformed);
    }
    if &packed[..MAGIC.len()] != MAGIC {
        return Err(LicenseError::Malformed);
    }
    if packed[MAGIC.len()] != VERSION {
        return Err(LicenseError::UnsupportedVersion);
    }
    let len = ((packed[MAGIC.len() + 1] as usize) << 8) | packed[MAGIC.len() + 2] as usize;
    if packed.len() != header + len + SIG_LEN {
        return Err(LicenseError::Malformed);
    }
    let payload = &packed[header..header + len];
    let sig_bytes = &packed[header + len..];

    let vk = VerifyingKey::from_bytes(&PUBLIC_KEY).map_err(|_| LicenseError::Malformed)?;
    let sig = Signature::from_slice(sig_bytes).map_err(|_| LicenseError::Malformed)?;
    vk.verify_strict(payload, &sig)
        .map_err(|_| LicenseError::BadSignature)?;

    let claims: LicenseClaims =
        serde_json::from_slice(payload).map_err(|_| LicenseError::Malformed)?;
    if claims.v != VERSION {
        return Err(LicenseError::UnsupportedVersion);
    }
    if let Some(ex) = claims.ex {
        if ex < now_ms {
            return Err(LicenseError::Expired);
        }
    }
    if revoked.iter().any(|r| r == &claims.id) {
        return Err(LicenseError::Revoked);
    }
    Ok(claims)
}

/// Crockford Base32 decode (case-insensitive; I/L→1, O→0; excludes U). Matches
/// `crockfordBase32Decode` in `src/lib/license/license.ts`.
fn crockford_base32_decode(text: &str) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut bits: u32 = 0;
    let mut value: u32 = 0;
    for ch in text.trim().to_uppercase().chars() {
        if ch == '-' {
            continue;
        }
        let idx: u32 = match ch {
            '0' | 'O' => 0,
            '1' | 'I' | 'L' => 1,
            '2'..='9' => ch as u32 - '0' as u32,
            'A'..='H' => ch as u32 - 'A' as u32 + 10,
            'J' | 'K' => ch as u32 - 'J' as u32 + 18,
            'M' | 'N' => ch as u32 - 'M' as u32 + 20,
            'P'..='T' => ch as u32 - 'P' as u32 + 22,
            'V'..='Z' => ch as u32 - 'V' as u32 + 27,
            _ => return None,
        };
        value = (value << 5) | idx;
        bits += 5;
        if bits >= 8 {
            bytes.push((value >> (bits - 8)) as u8);
            bits -= 8;
        }
    }
    Some(bytes)
}
