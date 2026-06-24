import { describe, it, expect } from "vitest";
import { updateSettingsSchema } from "./schema";

function base() {
  return {
    businessId: "biz_1",
    name: "Taco Stand",
    taxRateBps: 825,
    currency: "USD" as const,
    taxInclusive: false,
    mode: "STORE" as const,
  };
}

describe("updateSettingsSchema — QR payment", () => {
  it("defaults QR off and leaves label/value null when omitted", () => {
    const parsed = updateSettingsSchema.parse(base());
    expect(parsed.qrPayEnabled).toBe(false);
    expect(parsed.qrPayValue ?? null).toBeNull();
  });

  it("trims label/value and coerces blanks to null", () => {
    const parsed = updateSettingsSchema.parse({
      ...base(),
      qrPayEnabled: false,
      qrPayLabel: "  ",
      qrPayValue: "  https://venmo.com/u/me  ",
    });
    expect(parsed.qrPayLabel).toBeNull();
    expect(parsed.qrPayValue).toBe("https://venmo.com/u/me");
  });

  it("rejects enabling QR with no value", () => {
    expect(() =>
      updateSettingsSchema.parse({ ...base(), qrPayEnabled: true, qrPayValue: "   " }),
    ).toThrow(/QR payment value/i);
  });

  it("accepts enabling QR with a value + label", () => {
    const parsed = updateSettingsSchema.parse({
      ...base(),
      qrPayEnabled: true,
      qrPayLabel: "PIX",
      qrPayValue: "pix-key-123",
    });
    expect(parsed.qrPayEnabled).toBe(true);
    expect(parsed.qrPayLabel).toBe("PIX");
    expect(parsed.qrPayValue).toBe("pix-key-123");
  });

  it("rejects an over-long QR value", () => {
    expect(() =>
      updateSettingsSchema.parse({ ...base(), qrPayEnabled: true, qrPayValue: "x".repeat(513) }),
    ).toThrow();
  });
});
