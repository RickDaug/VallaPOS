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
});
