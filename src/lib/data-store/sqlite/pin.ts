/**
 * Web Crypto (PBKDF2-SHA256) PIN hashing for the OFFLINE edition's local store.
 *
 * The cloud PIN path uses `node:crypto` scrypt (server-only, `employees/pin.ts`),
 * but the desktop store runs in the Tauri WEBVIEW — a browser with no Node — so it
 * must use `SubtleCrypto`. `crypto.subtle` + `crypto.getRandomValues` exist in
 * browsers AND Node 20+, so this is also unit-testable headlessly.
 *
 * Format: `pbkdf2$<iterations>$<saltHex>$<hashHex>`. Self-contained — the local
 * store both hashes (seedFirstRun) and verifies (verifyOperatorPin) with this, so
 * the format never crosses editions.
 */
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

/** Constant-time byte comparison (no early-out on length-equal inputs). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Hash a PIN into the storable `pbkdf2$…` string (random per-hash salt). */
export async function hashPinWebcrypto(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(pin, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

/** Constant-time verify of a PIN against a stored `pbkdf2$…` hash. */
export async function verifyPinWebcrypto(
  pin: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  const salt = fromHex(parts[2] ?? "");
  const expected = fromHex(parts[3] ?? "");
  const actual = await derive(pin, salt, iterations);
  return timingSafeEqual(actual, expected);
}
