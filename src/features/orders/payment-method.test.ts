import { describe, it, expect } from "vitest";
import { paymentMethodLabel } from "./payment-method";

describe("paymentMethodLabel", () => {
  it("maps the stored enum values to human labels", () => {
    expect(paymentMethodLabel("CASH")).toBe("Cash");
    expect(paymentMethodLabel("CARD")).toBe("Card");
    expect(paymentMethodLabel("QR")).toBe("QR");
    // MANUAL is surfaced as "Other" everywhere it's shown.
    expect(paymentMethodLabel("MANUAL")).toBe("Other");
  });

  it("falls back to the raw value for an unknown method", () => {
    expect(paymentMethodLabel("CRYPTO")).toBe("CRYPTO");
  });
});
