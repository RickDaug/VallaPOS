import { describe, expect, it } from "vitest";
import {
  signLicense,
  verifyLicense,
  encodeClaims,
  decodeClaims,
  packLicense,
  unpackLicense,
  crockfordBase32Encode,
  crockfordBase32Decode,
  LICENSE_VERSION,
  type LicenseClaims,
} from "./license";
import { webcryptoEd25519Signer, webcryptoEd25519Verifier } from "./webcrypto";

const CLAIMS: LicenseClaims = {
  v: LICENSE_VERSION,
  p: "offline",
  sku: "vallapos-desktop",
  id: "lic_abc123",
  iat: 1_700_000_000_000,
  ex: null,
  dev: null,
};

/** A fresh Ed25519 keypair as injected sign/verify functions. */
async function keypair() {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return {
    sign: webcryptoEd25519Signer(kp.privateKey),
    verify: webcryptoEd25519Verifier(raw),
    otherVerify: webcryptoEd25519Verifier(
      new Uint8Array(
        await crypto.subtle.exportKey(
          "raw",
          ((await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
            "sign",
            "verify",
          ])) as CryptoKeyPair).publicKey,
        ),
      ),
    ),
  };
}

describe("Crockford Base32", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 31, 32, 127, 128, 255, 200, 7]);
    expect(Array.from(crockfordBase32Decode(crockfordBase32Encode(bytes))!)).toEqual(
      Array.from(bytes),
    );
  });

  it("is case-insensitive, maps I/L→1 and O→0, and ignores '-' separators", () => {
    const enc = crockfordBase32Encode(new Uint8Array([0xff, 0x10]));
    const withDashes = enc.slice(0, 2) + "-" + enc.slice(2);
    expect(Array.from(crockfordBase32Decode(withDashes.toLowerCase())!)).toEqual([0xff, 0x10]);
  });

  it("returns null on an invalid character (U is excluded)", () => {
    expect(crockfordBase32Decode("ABCU")).toBeNull();
  });
});

describe("claims encoding", () => {
  it("round-trips claims through canonical payload bytes", () => {
    expect(decodeClaims(encodeClaims(CLAIMS))).toEqual(CLAIMS);
  });

  it("is deterministic regardless of input key order (signature stability)", () => {
    const reordered = { dev: null, ex: null, iat: CLAIMS.iat, id: CLAIMS.id, sku: CLAIMS.sku, p: "offline", v: 1 } as LicenseClaims;
    expect(Array.from(encodeClaims(reordered))).toEqual(Array.from(encodeClaims(CLAIMS)));
  });
});

describe("pack/unpack", () => {
  it("round-trips a payload + 64-byte signature", () => {
    const payload = encodeClaims(CLAIMS);
    const sig = new Uint8Array(64).fill(7);
    const un = unpackLicense(packLicense(payload, sig));
    expect(un).not.toBeNull();
    expect(Array.from(un!.payload)).toEqual(Array.from(payload));
    expect(Array.from(un!.signature)).toEqual(Array.from(sig));
  });

  it("rejects a wrong-length signature at pack time", () => {
    expect(() => packLicense(encodeClaims(CLAIMS), new Uint8Array(10))).toThrow(/64 bytes/);
  });

  it("unpack returns null on garbage / wrong magic", () => {
    expect(unpackLicense("not a license")).toBeNull();
    expect(unpackLicense(crockfordBase32Encode(new Uint8Array([1, 2, 3])))).toBeNull();
  });
});

describe("sign + verify (Ed25519)", () => {
  it("verifies a freshly-signed perpetual license", async () => {
    const { sign, verify } = await keypair();
    const blob = await signLicense(CLAIMS, sign);
    const result = await verifyLicense(blob, verify);
    expect(result).toEqual({ valid: true, claims: CLAIMS });
  });

  it("rejects a blob signed by a different key (bad_signature)", async () => {
    const { sign, otherVerify } = await keypair();
    const blob = await signLicense(CLAIMS, sign);
    expect(await verifyLicense(blob, otherVerify)).toEqual({ valid: false, reason: "bad_signature" });
  });

  it("rejects a tampered payload (bad_signature)", async () => {
    const { sign, verify } = await keypair();
    const blob = await signLicense(CLAIMS, sign);
    // Flip a character in the middle of the blob to corrupt the payload/signature.
    const i = Math.floor(blob.length / 2);
    const tampered = blob.slice(0, i) + (blob[i] === "0" ? "1" : "0") + blob.slice(i + 1);
    const result = await verifyLicense(tampered, verify);
    expect(result.valid).toBe(false);
  });

  it("honors expiry (ex in the past → expired)", async () => {
    const { sign, verify } = await keypair();
    const expiring: LicenseClaims = { ...CLAIMS, ex: 1_700_000_100_000 };
    const blob = await signLicense(expiring, sign);
    expect(await verifyLicense(blob, verify, { now: 1_700_000_200_000 })).toEqual({
      valid: false,
      reason: "expired",
    });
    // still valid just before expiry
    expect((await verifyLicense(blob, verify, { now: 1_700_000_050_000 })).valid).toBe(true);
  });

  it("honors a revocation blocklist", async () => {
    const { sign, verify } = await keypair();
    const blob = await signLicense(CLAIMS, sign);
    expect(await verifyLicense(blob, verify, { revokedIds: ["lic_abc123"] })).toEqual({
      valid: false,
      reason: "revoked",
    });
  });
});
