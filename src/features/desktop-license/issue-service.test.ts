import { describe, expect, it } from "vitest";
import { verifyLicense } from "@/lib/license/license";
import type { SignFn } from "@/lib/license/license";
import { DESKTOP_SKU, fulfillDesktopPurchase } from "./issue-service";
import type { CreateLicenseInput, DesktopLicenseStore, LicenseRecord } from "./store";

/** In-memory fake store (idempotent on stripeSessionId, like the Prisma impl). */
function fakeStore() {
  const rows: LicenseRecord[] = [];
  const store: DesktopLicenseStore = {
    async findByStripeSession(sid) {
      return rows.find((r) => r.stripeSessionId === sid) ?? null;
    },
    async create(input: CreateLicenseInput) {
      const existing = rows.find((r) => r.stripeSessionId === input.stripeSessionId);
      if (existing) return existing; // idempotent, mirrors the P2002 re-read
      const rec: LicenseRecord = { id: `lic_${rows.length + 1}`, status: "ACTIVE", ...input };
      rows.push(rec);
      return rec;
    },
  };
  return { store, rows };
}

// Deterministic 64-byte fake Ed25519 signature (issuance orchestration ≠ crypto).
const fakeSign: SignFn = () => new Uint8Array(64);
const IAT = 1_752_960_000_000;

describe("fulfillDesktopPurchase", () => {
  it("issues + persists a signed perpetual license for a paid session", async () => {
    const { store, rows } = fakeStore();
    const res = await fulfillDesktopPurchase(
      { stripeSessionId: "cs_test_1", email: "buyer@example.com", iat: IAT },
      { sign: fakeSign, store },
    );

    expect(res.newlyIssued).toBe(true);
    expect(rows).toHaveLength(1);
    expect(res.record).toMatchObject({
      sku: DESKTOP_SKU,
      stripeSessionId: "cs_test_1",
      email: "buyer@example.com",
      status: "ACTIVE",
    });
    // The stored key is a well-formed license whose claims round-trip (id = session,
    // perpetual, offline), verified with the matching public key of the fake signer.
    expect(typeof res.record.licenseKey).toBe("string");
    expect(res.record.licenseKey.length).toBeGreaterThan(0);
    const verified = await verifyLicense(res.record.licenseKey, () => true, { now: IAT });
    expect(verified.valid).toBe(true);
    if (verified.valid) {
      expect(verified.claims).toMatchObject({ sku: DESKTOP_SKU, id: "cs_test_1", p: "offline", ex: null });
    }
  });

  it("is idempotent — a re-delivered webhook returns the same license, never re-signs", async () => {
    const { store, rows } = fakeStore();
    const first = await fulfillDesktopPurchase(
      { stripeSessionId: "cs_test_2", email: "a@b.com", iat: IAT },
      { sign: fakeSign, store },
    );
    const again = await fulfillDesktopPurchase(
      { stripeSessionId: "cs_test_2", email: "a@b.com", iat: IAT + 5000 },
      { sign: fakeSign, store },
    );
    expect(again.newlyIssued).toBe(false);
    expect(again.record).toEqual(first.record); // same key, not re-signed
    expect(rows).toHaveLength(1);
  });

  it("issues distinct licenses for distinct sessions", async () => {
    const { store, rows } = fakeStore();
    await fulfillDesktopPurchase(
      { stripeSessionId: "cs_a", email: "x@y.com", iat: IAT },
      { sign: fakeSign, store },
    );
    await fulfillDesktopPurchase(
      { stripeSessionId: "cs_b", email: "x@y.com", iat: IAT },
      { sign: fakeSign, store },
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.licenseKey).not.toBe(rows[1]!.licenseKey); // different id → different blob
  });
});
