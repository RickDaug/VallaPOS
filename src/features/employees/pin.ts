/**
 * PIN hashing + verification. A Membership PIN is a short numeric code used to
 * unlock a cashier on a shared device (and, later, to clock in/out); it is a
 * low-entropy secret, so we treat it like a password: a per-PIN random salt and
 * a slow KDF (scrypt) so a leaked `pinHash` can't be brute-forced trivially.
 *
 * NEVER store or log a plaintext PIN. Only the salted hash (this module's
 * output) is persisted in `Membership.pinHash`. The stored format is
 * `scrypt$<saltHex>$<hashHex>` so the verifier can recover the salt without a
 * second column.
 *
 * Kept free of `server-only`/Prisma imports so it can be unit tested directly
 * (round-trip verify) and reused without dragging server modules into a bundle.
 * It uses `node:crypto`, so it only runs on the server (which is where the
 * actions that call it live).
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { PIN_MIN_LENGTH, PIN_MAX_LENGTH } from "./schema";

/** PINs are 4–8 digits. Numeric-only keeps the on-device entry a simple keypad. */
const PIN_RE = new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`);

const KEYLEN = 32; // 256-bit derived key
const SALT_BYTES = 16;

/** True if `pin` is a syntactically valid PIN (4–8 ASCII digits). */
export function isValidPin(pin: string): boolean {
  return PIN_RE.test(pin);
}

/**
 * Hash a PIN into the storable `scrypt$<salt>$<hash>` string. Throws on a
 * malformed PIN so a bad value can never silently produce a hash. The salt is
 * fresh per call, so the same PIN hashes differently each time.
 */
export function hashPin(pin: string): string {
  if (!isValidPin(pin)) {
    throw new Error("PIN must be 4–8 digits.");
  }
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(pin, salt, KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/**
 * Verify a candidate PIN against a stored hash. Returns false (never throws) for
 * any malformed input or stored value, so a corrupt row simply fails to match.
 * Uses a constant-time comparison to avoid leaking the hash via timing.
 */
export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored || !isValidPin(pin)) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const saltHex = parts[1] ?? "";
  const hashHex = parts[2] ?? "";
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (expected.length !== KEYLEN) return false;

  const actual = scryptSync(pin, salt, KEYLEN);
  // Lengths are equal by construction (both KEYLEN), so timingSafeEqual is safe.
  return timingSafeEqual(actual, expected);
}
