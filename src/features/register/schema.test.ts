import { describe, it, expect } from "vitest";
import { checkoutSchema } from "./schema";

const validUuid = "00000000-0000-4000-8000-000000000001";

function base() {
  return {
    businessId: "biz_1",
    clientUuid: validUuid,
    lines: [{ variationId: "var_1", quantity: 1 }],
    cashTenderedCents: 1000,
  };
}

describe("checkoutSchema", () => {
  it("accepts a valid payload and applies defaults", () => {
    const parsed = checkoutSchema.parse(base());
    expect(parsed.tipCents).toBe(0);
    expect(parsed.cartDiscountCents).toBe(0);
  });

  it("rejects an empty cart", () => {
    expect(() => checkoutSchema.parse({ ...base(), lines: [] })).toThrow();
  });

  it("rejects a non-positive quantity", () => {
    expect(() =>
      checkoutSchema.parse({ ...base(), lines: [{ variationId: "v", quantity: 0 }] }),
    ).toThrow();
  });

  it("rejects a non-uuid idempotency key", () => {
    expect(() => checkoutSchema.parse({ ...base(), clientUuid: "not-a-uuid" })).toThrow();
  });

  it("rejects negative money fields", () => {
    expect(() => checkoutSchema.parse({ ...base(), tipCents: -1 })).toThrow();
    expect(() => checkoutSchema.parse({ ...base(), cashTenderedCents: -5 })).toThrow();
  });

  it("defaults the tender method to CASH and cashTenderedCents to 0", () => {
    const { cashTenderedCents, ...noTender } = base();
    void cashTenderedCents;
    const parsed = checkoutSchema.parse(noTender);
    expect(parsed.method).toBe("CASH");
    expect(parsed.cashTenderedCents).toBe(0);
  });

  it("accepts a MANUAL tender with an optional reference note", () => {
    const parsed = checkoutSchema.parse({
      ...base(),
      method: "MANUAL",
      manualNote: "  Check #1234  ",
    });
    expect(parsed.method).toBe("MANUAL");
    // zod trims the note.
    expect(parsed.manualNote).toBe("Check #1234");
  });

  it("accepts a QR tender (with an optional reference note)", () => {
    const parsed = checkoutSchema.parse({ ...base(), method: "QR", manualNote: "txn-9" });
    expect(parsed.method).toBe("QR");
    expect(parsed.manualNote).toBe("txn-9");
  });

  it("rejects an unknown tender method and an over-long note", () => {
    expect(() => checkoutSchema.parse({ ...base(), method: "CRYPTO" })).toThrow();
    expect(() =>
      checkoutSchema.parse({ ...base(), method: "MANUAL", manualNote: "x".repeat(121) }),
    ).toThrow();
  });

  describe("managerPin (unverified-tender approval override)", () => {
    it("is optional (most checkouts omit it)", () => {
      expect(checkoutSchema.parse(base()).managerPin).toBeUndefined();
    });

    it("accepts a 4–8 digit PIN", () => {
      expect(checkoutSchema.parse({ ...base(), method: "QR", managerPin: "1234" }).managerPin).toBe(
        "1234",
      );
      expect(
        checkoutSchema.parse({ ...base(), method: "QR", managerPin: "12345678" }).managerPin,
      ).toBe("12345678");
    });

    it("rejects a non-numeric, too-short, or too-long PIN", () => {
      expect(() => checkoutSchema.parse({ ...base(), managerPin: "12a4" })).toThrow();
      expect(() => checkoutSchema.parse({ ...base(), managerPin: "123" })).toThrow();
      expect(() => checkoutSchema.parse({ ...base(), managerPin: "123456789" })).toThrow();
    });
  });

  describe("priceSnapshot (offline price snapshot)", () => {
    it("accepts a valid snapshot with quoted unit prices + modifier deltas", () => {
      const parsed = checkoutSchema.parse({
        ...base(),
        priceSnapshot: {
          quoted: true,
          lines: [{ unitPriceCents: 1000, modifierDeltas: { mod_oat: 75 } }],
        },
      });
      expect(parsed.priceSnapshot?.quoted).toBe(true);
      expect(parsed.priceSnapshot?.lines[0]?.unitPriceCents).toBe(1000);
      expect(parsed.priceSnapshot?.lines[0]?.modifierDeltas?.mod_oat).toBe(75);
    });

    it("is optional (online payloads omit it entirely)", () => {
      const parsed = checkoutSchema.parse(base());
      expect(parsed.priceSnapshot).toBeUndefined();
    });

    it("requires the explicit quoted:true origin marker", () => {
      expect(() =>
        checkoutSchema.parse({
          ...base(),
          priceSnapshot: { quoted: false, lines: [{ unitPriceCents: 1000 }] },
        }),
      ).toThrow();
      expect(() =>
        checkoutSchema.parse({
          ...base(),
          priceSnapshot: { lines: [{ unitPriceCents: 1000 }] },
        }),
      ).toThrow();
    });

    it("rejects a negative snapshot unit price", () => {
      expect(() =>
        checkoutSchema.parse({
          ...base(),
          priceSnapshot: { quoted: true, lines: [{ unitPriceCents: -1 }] },
        }),
      ).toThrow();
    });

    it("rejects a negative snapshot modifier delta", () => {
      expect(() =>
        checkoutSchema.parse({
          ...base(),
          priceSnapshot: {
            quoted: true,
            lines: [{ unitPriceCents: 1000, modifierDeltas: { mod_oat: -5 } }],
          },
        }),
      ).toThrow();
    });

    it("rejects an out-of-bounds (absurdly large) snapshot price", () => {
      expect(() =>
        checkoutSchema.parse({
          ...base(),
          priceSnapshot: { quoted: true, lines: [{ unitPriceCents: 100_000_001 }] },
        }),
      ).toThrow();
    });

    it("rejects a non-integer snapshot price", () => {
      expect(() =>
        checkoutSchema.parse({
          ...base(),
          priceSnapshot: { quoted: true, lines: [{ unitPriceCents: 10.5 }] },
        }),
      ).toThrow();
    });

    it("rejects an empty snapshot line array", () => {
      expect(() =>
        checkoutSchema.parse({ ...base(), priceSnapshot: { quoted: true, lines: [] } }),
      ).toThrow();
    });
  });
});
