/**
 * WebCrypto-backed Ed25519 injectors for the pure `license.ts` sign/verify
 * (docs/EDITIONS.md §3). Kept separate so `license.ts` stays crypto-free and
 * import-safe everywhere. `crypto.subtle` Ed25519 is available in modern browsers
 * (the Tauri webview) and in Node 20+ (tests + the vallahub signer).
 *
 *   - VERIFY (webview, UX-only gate): import the 32-byte raw public key.
 *   - SIGN (vallahub server, the trust root): a PKCS#8 private key imported from
 *     `LICENSE_SIGNING_SK`. The private key NEVER ships in the app — only the
 *     public key is embedded (and, authoritatively, in the Rust verifier).
 */
import type { SignFn, VerifyFn } from "./license";

const ALG = "Ed25519";

/** A `VerifyFn` backed by a raw (32-byte) Ed25519 public key. Key import is lazy + cached. */
export function webcryptoEd25519Verifier(rawPublicKey: Uint8Array): VerifyFn {
  let keyPromise: Promise<CryptoKey> | null = null;
  const key = () =>
    (keyPromise ??= crypto.subtle.importKey("raw", rawPublicKey, { name: ALG }, false, ["verify"]));
  return async (payload, signature) =>
    crypto.subtle.verify(ALG, await key(), signature, payload);
}

/** A `SignFn` backed by an imported Ed25519 private `CryptoKey` (vallahub side). */
export function webcryptoEd25519Signer(privateKey: CryptoKey): SignFn {
  return async (payload) => new Uint8Array(await crypto.subtle.sign(ALG, privateKey, payload));
}

/** Import a PKCS#8 Ed25519 private key (e.g. decoded from `LICENSE_SIGNING_SK`). */
export function importEd25519PrivateKey(pkcs8: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", pkcs8, { name: ALG }, false, ["sign"]);
}
