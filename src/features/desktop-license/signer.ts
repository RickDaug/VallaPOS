import "server-only";

import { env } from "@/lib/env";
import { importEd25519PrivateKey, webcryptoEd25519Signer } from "@/lib/license/webcrypto";
import type { SignFn } from "@/lib/license/license";

let cached: SignFn | null | undefined;

/**
 * The Ed25519 `SignFn` backed by `LICENSE_SIGNING_SK` (base64 PKCS#8 private key,
 * the secret half of the app's embedded public key), or `null` when unset. Cached
 * per process. `server-only` — the signing secret never reaches the client.
 */
export async function loadLicenseSigner(): Promise<SignFn | null> {
  if (cached !== undefined) return cached;
  const b64 = env.LICENSE_SIGNING_SK;
  if (!b64) {
    cached = null;
    return null;
  }
  const pkcs8 = Uint8Array.from(Buffer.from(b64, "base64"));
  const key = await importEd25519PrivateKey(pkcs8);
  cached = webcryptoEd25519Signer(key);
  return cached;
}
