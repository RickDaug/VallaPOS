import { describe, expect, it } from "vitest";
import {
  decryptJson,
  encryptJson,
  generateOfflineKey,
  isEncryptedEnvelope,
} from "./crypto";

/**
 * R-7 crypto core. The Web Crypto API (`crypto.subtle`) is available natively in
 * the Vitest node env (Node 18+), so these need no polyfill. We exercise the
 * pure encrypt/decrypt path (the IndexedDB key-persistence layer is covered
 * separately by the integration paths); the guarantees under test are:
 *   1. encrypt → decrypt round-trips to the original value,
 *   2. a tampered ciphertext fails the AES-GCM auth check (no silent corruption),
 *   3. a wrong key cannot decrypt,
 *   4. the envelope is genuinely opaque (no plaintext leaks into it).
 */
const SAMPLE = {
  clientUuid: "11111111-1111-1111-1111-111111111111",
  customerName: "Jane Q. Customer",
  lines: [{ variationId: "v1", quantity: 2, modifierIds: ["m1"] }],
  tenderedCents: 2599,
  discountCents: 100,
};

describe("offline crypto — AES-GCM round-trip", () => {
  it("encrypts then decrypts back to the original value", async () => {
    const key = await generateOfflineKey();
    const env = await encryptJson(key, SAMPLE);
    expect(isEncryptedEnvelope(env)).toBe(true);
    const out = await decryptJson(key, env);
    expect(out).toEqual(SAMPLE);
  });

  it("produces a different IV/ciphertext each time (random IV)", async () => {
    const key = await generateOfflineKey();
    const a = await encryptJson(key, SAMPLE);
    const b = await encryptJson(key, SAMPLE);
    expect(Buffer.from(a.iv)).not.toEqual(Buffer.from(b.iv));
    expect(Buffer.from(a.ct)).not.toEqual(Buffer.from(b.ct));
  });

  it("does not leak plaintext into the envelope bytes", async () => {
    const key = await generateOfflineKey();
    const env = await encryptJson(key, SAMPLE);
    const ctText = new TextDecoder().decode(env.ct);
    expect(ctText).not.toContain("Jane Q. Customer");
    expect(ctText).not.toContain("clientUuid");
  });
});

describe("offline crypto — tamper + wrong-key rejection", () => {
  it("fails to decrypt a tampered ciphertext", async () => {
    const key = await generateOfflineKey();
    const env = await encryptJson(key, SAMPLE);
    // Flip a byte in the ciphertext — AES-GCM auth tag must reject it.
    const tampered = { ...env, ct: new Uint8Array(env.ct) };
    tampered.ct.set([tampered.ct[0]! ^ 0xff], 0);
    await expect(decryptJson(key, tampered)).rejects.toThrow();
  });

  it("fails to decrypt a tampered IV", async () => {
    const key = await generateOfflineKey();
    const env = await encryptJson(key, SAMPLE);
    const tampered = { ...env, iv: new Uint8Array(env.iv) };
    tampered.iv.set([tampered.iv[0]! ^ 0xff], 0);
    await expect(decryptJson(key, tampered)).rejects.toThrow();
  });

  it("cannot decrypt with a different key", async () => {
    const k1 = await generateOfflineKey();
    const k2 = await generateOfflineKey();
    const env = await encryptJson(k1, SAMPLE);
    await expect(decryptJson(k2, env)).rejects.toThrow();
  });

  it("generates a non-extractable key (raw bytes never leave the browser)", async () => {
    const key = await generateOfflineKey();
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });
});

describe("isEncryptedEnvelope guard", () => {
  it("accepts a real envelope and rejects legacy/plaintext shapes", async () => {
    const key = await generateOfflineKey();
    const env = await encryptJson(key, SAMPLE);
    expect(isEncryptedEnvelope(env)).toBe(true);
    expect(isEncryptedEnvelope(null)).toBe(false);
    expect(isEncryptedEnvelope(undefined)).toBe(false);
    expect(isEncryptedEnvelope({ payload: SAMPLE })).toBe(false);
    expect(isEncryptedEnvelope({ v: 1, iv: [1, 2, 3], ct: [4, 5] })).toBe(false);
    expect(isEncryptedEnvelope({ v: 99, iv: new Uint8Array(), ct: new Uint8Array() })).toBe(
      false,
    );
  });
});
