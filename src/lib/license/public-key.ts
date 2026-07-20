/**
 * The Ed25519 PUBLIC key that verifies offline-desktop licenses (docs/EDITIONS.md
 * §6). The matching PRIVATE key signs licenses on vallahub (`LICENSE_SIGNING_SK`);
 * the same 32 bytes are also compiled into the Rust trust anchor
 * (`src-tauri/src/license.rs`). Public — safe to ship.
 *
 * To rotate: generate a new keypair, replace these bytes AND `license.rs`, and set
 * the new private key as `LICENSE_SIGNING_SK` on vallahub.
 */
const PUBLIC_KEY_HEX = "88afc7aea9b9f50d6aa035d077be4fed97248d98737cfafeaf23a8e9e68bb2c5";

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const LICENSE_PUBLIC_KEY: Uint8Array = hexToBytes(PUBLIC_KEY_HEX);
