/**
 * One-time signed LICENSE KEY format for the offline (local) edition
 * (docs/EDITIONS.md §3). PURE + crypto-agnostic: the Ed25519 sign/verify primitive
 * is INJECTED, so this module has no dependency and is fully unit-testable. The
 * WebCrypto-backed injectors live in `./webcrypto.ts`; the real trust anchor is the
 * Rust `ed25519-dalek` gate at boot (`src-tauri/src/license.rs`) — the JS verify is
 * UX only (a webview is user-modifiable).
 *
 * Wire format (before signing is applied over the payload):
 *   packed = MAGIC("VLK1") ‖ version(1) ‖ len(payload, uint16 BE) ‖ payload ‖ sig(64)
 *   blob   = Crockford-Base32(packed)      // copy-paste friendly, case-insensitive
 *
 * PAYLOAD ENCODING: the spec calls for compact CBOR; to avoid a CBOR dependency on
 * BOTH the TS signer and the Rust verifier we use a CANONICAL JSON encoding instead
 * (fixed key order → identical bytes on both sides; `serde_json` parses it in Rust).
 * The signature covers exactly these payload bytes.
 */
import { z } from "zod";

/** Format version. Bump only on an incompatible wire-format change. */
export const LICENSE_VERSION = 1;

const MAGIC = new Uint8Array([0x56, 0x4c, 0x4b, 0x31]); // "VLK1"
const SIG_LEN = 64; // Ed25519 detached signature

/**
 * License claims. `ex: null` is a PERPETUAL key (the recommended default); `dev`
 * (device binding) is RESERVED but off for v1 (see docs/EDITIONS.md §3/§5).
 */
export const licenseClaimsSchema = z.object({
  v: z.literal(LICENSE_VERSION),
  /** Product: only the offline edition is licensed this way. */
  p: z.literal("offline"),
  /** SKU / plan identifier. */
  sku: z.string().min(1),
  /** Unique license id (also the revocation key). */
  id: z.string().min(1),
  /** Issued-at, epoch ms. */
  iat: z.number().int().nonnegative(),
  /** Expiry, epoch ms — or null for perpetual. */
  ex: z.number().int().nonnegative().nullable(),
  /** Reserved device binding (off for v1) — null. */
  dev: z.string().min(1).nullable(),
});

export type LicenseClaims = z.infer<typeof licenseClaimsSchema>;

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Canonical claims → payload bytes. Keys are emitted in a FIXED order so the
 * signer and verifier hash identical bytes. Any input is validated first, so a
 * malformed claim can't be signed.
 */
export function encodeClaims(claims: LicenseClaims): Uint8Array {
  const c = licenseClaimsSchema.parse(claims);
  // Fixed key order — do NOT reorder (the signature covers these exact bytes).
  const canonical = { v: c.v, p: c.p, sku: c.sku, id: c.id, iat: c.iat, ex: c.ex, dev: c.dev };
  return enc.encode(JSON.stringify(canonical));
}

/** Parse payload bytes back into validated claims (throws on malformed input). */
export function decodeClaims(payload: Uint8Array): LicenseClaims {
  return licenseClaimsSchema.parse(JSON.parse(dec.decode(payload)));
}

// ─────────────────────────────── packaging ──────────────────────────────────

/** Assemble MAGIC ‖ version ‖ len ‖ payload ‖ sig and Crockford-Base32 it. */
export function packLicense(payload: Uint8Array, signature: Uint8Array): string {
  if (signature.length !== SIG_LEN) {
    throw new Error(`signature must be ${SIG_LEN} bytes, got ${signature.length}`);
  }
  if (payload.length > 0xffff) throw new Error("payload too large");
  const packed = new Uint8Array(MAGIC.length + 1 + 2 + payload.length + SIG_LEN);
  let o = 0;
  packed.set(MAGIC, o);
  o += MAGIC.length;
  packed[o++] = LICENSE_VERSION;
  packed[o++] = (payload.length >> 8) & 0xff;
  packed[o++] = payload.length & 0xff;
  packed.set(payload, o);
  o += payload.length;
  packed.set(signature, o);
  return crockfordBase32Encode(packed);
}

export interface UnpackedLicense {
  payload: Uint8Array;
  signature: Uint8Array;
}

/** Reverse `packLicense`. Returns null on any structural problem (never throws). */
export function unpackLicense(blob: string): UnpackedLicense | null {
  const packed = crockfordBase32Decode(blob);
  if (!packed) return null;
  const header = MAGIC.length + 1 + 2;
  if (packed.length < header + SIG_LEN) return null;
  for (let i = 0; i < MAGIC.length; i++) if (packed[i] !== MAGIC[i]) return null;
  if (packed[MAGIC.length] !== LICENSE_VERSION) return null;
  const len = (packed[MAGIC.length + 1]! << 8) | packed[MAGIC.length + 2]!;
  if (packed.length !== header + len + SIG_LEN) return null;
  const payload = packed.slice(header, header + len);
  const signature = packed.slice(header + len);
  return { payload, signature };
}

// ─────────────────────────────── sign / verify ──────────────────────────────

export type SignFn = (payload: Uint8Array) => Promise<Uint8Array> | Uint8Array;
export type VerifyFn = (
  payload: Uint8Array,
  signature: Uint8Array,
) => Promise<boolean> | boolean;

/** Sign claims into a distributable license blob (vallahub issuance side). */
export async function signLicense(claims: LicenseClaims, sign: SignFn): Promise<string> {
  const payload = encodeClaims(claims);
  const signature = await sign(payload);
  return packLicense(payload, new Uint8Array(signature));
}

export type LicenseResult =
  | { valid: true; claims: LicenseClaims }
  | {
      valid: false;
      reason: "malformed" | "bad_signature" | "unsupported_version" | "expired" | "revoked";
    };

/**
 * Verify a license blob: structure → SIGNATURE (before trusting the payload) →
 * claims → version → expiry → revocation. The signature check comes before parsing
 * the claims so an unsigned/forged payload is never interpreted.
 */
export async function verifyLicense(
  blob: string,
  verify: VerifyFn,
  opts: { now?: number; revokedIds?: Iterable<string> } = {},
): Promise<LicenseResult> {
  const unpacked = unpackLicense(blob);
  if (!unpacked) return { valid: false, reason: "malformed" };

  const sigOk = await verify(unpacked.payload, unpacked.signature);
  if (!sigOk) return { valid: false, reason: "bad_signature" };

  let claims: LicenseClaims;
  try {
    claims = decodeClaims(unpacked.payload);
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (claims.v !== LICENSE_VERSION) return { valid: false, reason: "unsupported_version" };

  const now = opts.now ?? Date.now();
  if (claims.ex !== null && claims.ex < now) return { valid: false, reason: "expired" };

  if (opts.revokedIds && new Set(opts.revokedIds).has(claims.id)) {
    return { valid: false, reason: "revoked" };
  }
  return { valid: true, claims };
}

// ─────────────────────────── Crockford Base32 ────────────────────────────────
// No padding; case-insensitive; I/L→1, O→0 on decode; excludes I L O U.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CROCKFORD_INDEX: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < CROCKFORD.length; i++) m[CROCKFORD[i]!] = i;
  m["I"] = m["L"] = 1;
  m["O"] = 0;
  return m;
})();

export function crockfordBase32Encode(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 0x1f];
  return out;
}

/** Decode Crockford Base32 (case-insensitive). Returns null on an invalid char. */
export function crockfordBase32Decode(text: string): Uint8Array | null {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of text.trim().toUpperCase()) {
    if (ch === "-") continue; // allow group separators
    const idx = CROCKFORD_INDEX[ch];
    if (idx === undefined) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}
