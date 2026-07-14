import { describe, expect, it } from "vitest";
import { resolveLicenseState, isLicensed } from "./gate";
import { issueLicense, buildLicenseClaims } from "./issue";
import { createLicenseStore, LICENSE_STORE_KEY, type LicenseKv } from "./store";
import { webcryptoEd25519Signer, webcryptoEd25519Verifier } from "./webcrypto";
import { LICENSE_VERSION } from "./license";

async function keypair() {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { sign: webcryptoEd25519Signer(kp.privateKey), verify: webcryptoEd25519Verifier(raw) };
}

function memoryKv() {
  const data = new Map<string, string>();
  const kv: LicenseKv = {
    get: (k) => data.get(k) ?? null,
    set: (k, v) => {
      data.set(k, v);
    },
    delete: (k) => {
      data.delete(k);
    },
  };
  return { kv, data };
}

const ISSUE = { sku: "vallapos-desktop", id: "cs_test_123", iat: 1_700_000_000_000 };

describe("buildLicenseClaims", () => {
  it("produces a canonical, perpetual, non-device-bound offline claim", () => {
    expect(buildLicenseClaims(ISSUE)).toEqual({
      v: LICENSE_VERSION,
      p: "offline",
      sku: "vallapos-desktop",
      id: "cs_test_123",
      iat: 1_700_000_000_000,
      ex: null,
      dev: null,
    });
  });
});

describe("license store", () => {
  it("saves, loads, and clears the blob; treats empty as unset", async () => {
    const { kv } = memoryKv();
    const store = createLicenseStore(kv);
    expect(await store.load()).toBeNull();

    await store.save("BLOB");
    expect(await store.load()).toBe("BLOB");

    await store.clear();
    expect(await store.load()).toBeNull();

    await kv.set(LICENSE_STORE_KEY, ""); // an empty string is "no license"
    expect(await store.load()).toBeNull();
  });
});

describe("resolveLicenseState (issue → store → gate)", () => {
  it("reports 'licensed' for a freshly issued + stored perpetual license", async () => {
    const { sign, verify } = await keypair();
    const { kv } = memoryKv();
    const store = createLicenseStore(kv);
    await store.save(await issueLicense(ISSUE, sign));

    const state = await resolveLicenseState({ loadBlob: () => store.load(), verify });
    expect(isLicensed(state)).toBe(true);
    if (state.status !== "licensed") throw new Error("expected licensed");
    expect(state.claims.id).toBe("cs_test_123");
    expect(state.claims.sku).toBe("vallapos-desktop");
  });

  it("reports 'unlicensed' when nothing is stored", async () => {
    const { verify } = await keypair();
    const { kv } = memoryKv();
    const store = createLicenseStore(kv);
    expect(await resolveLicenseState({ loadBlob: () => store.load(), verify })).toEqual({
      status: "unlicensed",
    });
  });

  it("reports 'invalid'/bad_signature for a tampered stored blob", async () => {
    const { sign, verify } = await keypair();
    const { kv } = memoryKv();
    const store = createLicenseStore(kv);
    const blob = await issueLicense(ISSUE, sign);
    const i = Math.floor(blob.length / 2);
    await store.save(blob.slice(0, i) + (blob[i] === "0" ? "1" : "0") + blob.slice(i + 1));

    const state = await resolveLicenseState({ loadBlob: () => store.load(), verify });
    expect(state.status).toBe("invalid");
  });

  it("reports 'invalid'/expired past the expiry", async () => {
    const { sign, verify } = await keypair();
    const { kv } = memoryKv();
    const store = createLicenseStore(kv);
    await store.save(await issueLicense({ ...ISSUE, ex: 1_700_000_100_000 }, sign));

    expect(
      await resolveLicenseState({ loadBlob: () => store.load(), verify, now: 1_700_000_200_000 }),
    ).toEqual({ status: "invalid", reason: "expired" });
  });

  it("reports 'invalid'/revoked when the id is on the blocklist", async () => {
    const { sign, verify } = await keypair();
    const { kv } = memoryKv();
    const store = createLicenseStore(kv);
    await store.save(await issueLicense(ISSUE, sign));

    expect(
      await resolveLicenseState({
        loadBlob: () => store.load(),
        verify,
        revokedIds: ["cs_test_123"],
      }),
    ).toEqual({ status: "invalid", reason: "revoked" });
  });
});
