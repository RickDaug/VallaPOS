import { describe, it, expect } from "vitest";
import { openDrawerSchema, closeDrawerSchema } from "./schema";

describe("openDrawerSchema", () => {
  it("accepts a valid opening float", () => {
    const parsed = openDrawerSchema.parse({ businessId: "biz_1", openingFloatCents: 10000 });
    expect(parsed.openingFloatCents).toBe(10000);
  });

  it("accepts a zero float", () => {
    expect(() => openDrawerSchema.parse({ businessId: "biz_1", openingFloatCents: 0 })).not.toThrow();
  });

  it("rejects a negative float", () => {
    expect(() =>
      openDrawerSchema.parse({ businessId: "biz_1", openingFloatCents: -1 }),
    ).toThrow();
  });

  it("rejects a non-integer (fractional cent) float", () => {
    expect(() =>
      openDrawerSchema.parse({ businessId: "biz_1", openingFloatCents: 100.5 }),
    ).toThrow();
  });

  it("rejects a missing businessId", () => {
    expect(() => openDrawerSchema.parse({ businessId: "", openingFloatCents: 100 })).toThrow();
  });

  it("rejects an absurdly large float (fat-finger guard)", () => {
    expect(() =>
      openDrawerSchema.parse({ businessId: "biz_1", openingFloatCents: 10_000_001 }),
    ).toThrow();
  });
});

describe("closeDrawerSchema", () => {
  const base = { businessId: "biz_1", sessionId: "sess_1", countedCents: 35000 };

  it("accepts a valid close payload", () => {
    expect(() => closeDrawerSchema.parse(base)).not.toThrow();
  });

  it("rejects negative counted cents", () => {
    expect(() => closeDrawerSchema.parse({ ...base, countedCents: -1 })).toThrow();
  });

  it("rejects a non-integer counted amount", () => {
    expect(() => closeDrawerSchema.parse({ ...base, countedCents: 1.25 })).toThrow();
  });

  it("rejects a missing sessionId", () => {
    expect(() => closeDrawerSchema.parse({ ...base, sessionId: "" })).toThrow();
  });

  it("rejects a missing businessId", () => {
    expect(() => closeDrawerSchema.parse({ ...base, businessId: "" })).toThrow();
  });
});
