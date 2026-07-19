import { describe, it, expect } from "vitest";
import { extractSaleSettlement } from "./sale-webhook";

const cs = (over: Record<string, unknown> = {}) => ({
  id: "cs_test_1",
  amount_total: 1599,
  currency: "usd",
  payment_intent: "pi_123",
  ...over,
});

describe("extractSaleSettlement", () => {
  it("maps a PAID checkout.session.completed → capture", () => {
    const s = extractSaleSettlement({
      type: "checkout.session.completed",
      object: cs({ payment_status: "paid" }),
    });
    expect(s).toEqual({
      kind: "capture",
      stripeSessionId: "cs_test_1",
      amountTotal: 1599,
      currency: "usd",
      paymentIntentId: "pi_123",
      cardBrand: null,
      cardLast4: null,
    });
  });

  it("ignores an UNPAID completed (async method settles later) → null", () => {
    expect(
      extractSaleSettlement({
        type: "checkout.session.completed",
        object: cs({ payment_status: "unpaid" }),
      }),
    ).toBeNull();
  });

  it("maps async_payment_succeeded → capture", () => {
    const s = extractSaleSettlement({
      type: "checkout.session.async_payment_succeeded",
      object: cs(),
    });
    expect(s?.kind).toBe("capture");
    expect(s?.paymentIntentId).toBe("pi_123");
  });

  it("maps async_payment_failed → fail", () => {
    const s = extractSaleSettlement({ type: "checkout.session.async_payment_failed", object: cs() });
    expect(s?.kind).toBe("fail");
    expect(s?.stripeSessionId).toBe("cs_test_1");
  });

  it("maps expired → expire", () => {
    const s = extractSaleSettlement({
      type: "checkout.session.expired",
      object: cs({ payment_intent: null }),
    });
    expect(s?.kind).toBe("expire");
    expect(s?.paymentIntentId).toBeNull();
  });

  it("resolves an expanded payment_intent object to its id", () => {
    const s = extractSaleSettlement({
      type: "checkout.session.async_payment_succeeded",
      object: cs({ payment_intent: { id: "pi_expanded" } }),
    });
    expect(s?.paymentIntentId).toBe("pi_expanded");
  });

  it("extracts card brand/last4 when the event carries them", () => {
    const s = extractSaleSettlement({
      type: "checkout.session.completed",
      object: cs({
        payment_status: "paid",
        payment_intent: {
          id: "pi_1",
          latest_charge: { payment_method_details: { card: { brand: "visa", last4: "4242" } } },
        },
      }),
    });
    expect(s?.cardBrand).toBe("visa");
    expect(s?.cardLast4).toBe("4242");
    expect(s?.paymentIntentId).toBe("pi_1");
  });

  it("returns null for unrelated events and garbage", () => {
    expect(extractSaleSettlement({ type: "payment_intent.succeeded", object: cs() })).toBeNull();
    expect(extractSaleSettlement({ type: "checkout.session.completed", object: null })).toBeNull();
    expect(
      extractSaleSettlement({ type: "checkout.session.expired", object: { id: "sub_1" } }),
    ).toBeNull(); // not a cs_ id
    expect(extractSaleSettlement({ type: "checkout.session.expired", object: "nope" })).toBeNull();
  });
});
