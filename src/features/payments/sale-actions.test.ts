import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeCheckoutGateway } from "./checkout-gateway";

// --- Mocks -----------------------------------------------------------------
// createStripeQrSale is exercised with REAL zod validation + the REAL
// orchestration (openCheckoutSession over a FakeCheckoutGateway), but with the
// DB, the capability gate, the env, the flags, and the server-only store stubbed.
// We assert every gate returns qr_unavailable and that a re-tap REUSES the order.
const requireCapability = vi.fn();
const businessFindUnique = vi.fn();
const orderFindUnique = vi.fn();
const orderCreate = vi.fn();
const orderCounterUpsert = vi.fn();
const createOrReuse = vi.fn();
const getState = vi.fn();
const isConfigured = vi.fn();
const isV2 = vi.fn();
const gateway = new FakeCheckoutGateway();

vi.mock("@/lib/operator-guard", () => ({
  requireCapability: (...a: unknown[]) => requireCapability(...a),
}));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://app.test" } }));
vi.mock("./connect-stripe", () => ({ isPaymentsConfigured: () => isConfigured() }));
vi.mock("./flags", () => ({ isPaymentsV2Enabled: () => isV2() }));
vi.mock("./checkout-stripe", () => ({ createStripeCheckoutGateway: () => gateway }));
vi.mock("./sale-store", () => ({
  createOrReuseCheckoutSession: (...a: unknown[]) => createOrReuse(...a),
}));
vi.mock("./sale-queries", () => ({ getSalePaymentState: (...a: unknown[]) => getState(...a) }));
vi.mock("@/lib/db", () => {
  const tx = {
    orderCounter: { upsert: (...a: unknown[]) => orderCounterUpsert(...a) },
    order: { create: (...a: unknown[]) => orderCreate(...a) },
  };
  return {
    db: {
      business: { findUnique: (...a: unknown[]) => businessFindUnique(...a) },
      order: {
        findUnique: (...a: unknown[]) => orderFindUnique(...a),
        create: (...a: unknown[]) => orderCreate(...a),
      },
      orderCounter: { upsert: (...a: unknown[]) => orderCounterUpsert(...a) },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { createStripeQrSale } from "./sale-actions";

const UUID = "00000000-0000-4000-8000-000000000001";
const INPUT = { businessId: "biz_1", clientUuid: UUID, lines: [{ variationId: "var_1", quantity: 1 }] };

const ENABLED_BUSINESS = {
  country: "US",
  currency: "USD",
  taxRateBps: 0,
  taxInclusive: false,
  stripeAccountId: "acct_1",
  stripeChargesEnabled: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  gateway.calls.length = 0;
  requireCapability.mockResolvedValue({ businessId: "biz_1", membershipId: "mem_1" });
  businessFindUnique.mockResolvedValue({ ...ENABLED_BUSINESS });
  orderFindUnique.mockResolvedValue(null);
  createOrReuse.mockResolvedValue({ id: "chk_1", stripeSessionId: "cs_fake_1", status: "OPEN" });
  isConfigured.mockReturnValue(true);
  isV2.mockReturnValue(true);
});

describe("createStripeQrSale — gates", () => {
  it("qr_unavailable when the v2 flag is off", async () => {
    isV2.mockReturnValue(false);
    expect(await createStripeQrSale(INPUT)).toEqual({ ok: false, reason: "qr_unavailable" });
  });

  it("qr_unavailable when Stripe isn't configured", async () => {
    isConfigured.mockReturnValue(false);
    expect(await createStripeQrSale(INPUT)).toEqual({ ok: false, reason: "qr_unavailable" });
  });

  it("qr_unavailable when the business isn't charges-enabled", async () => {
    businessFindUnique.mockResolvedValue({ ...ENABLED_BUSINESS, stripeChargesEnabled: false });
    expect(await createStripeQrSale(INPUT)).toEqual({ ok: false, reason: "qr_unavailable" });
  });

  it("qr_unavailable when there is no connected account", async () => {
    businessFindUnique.mockResolvedValue({ ...ENABLED_BUSINESS, stripeAccountId: null });
    expect(await createStripeQrSale(INPUT)).toEqual({ ok: false, reason: "qr_unavailable" });
  });

  it("qr_unavailable for an unsupported country", async () => {
    businessFindUnique.mockResolvedValue({ ...ENABLED_BUSINESS, country: "CA" });
    expect(await createStripeQrSale(INPUT)).toEqual({ ok: false, reason: "qr_unavailable" });
  });

  it("never opens a Stripe session when a gate blocks it", async () => {
    isV2.mockReturnValue(false);
    await createStripeQrSale(INPUT);
    expect(gateway.calls).toHaveLength(0);
    expect(createOrReuse).not.toHaveBeenCalled();
  });
});

describe("createStripeQrSale — re-tap idempotency", () => {
  it("REUSES an existing order for the same clientUuid (no new order created)", async () => {
    orderFindUnique.mockResolvedValue({ id: "ord_1", number: 7, totalCents: 1599 });

    const result = await createStripeQrSale(INPUT);

    expect(result).toEqual({
      ok: true,
      qrUrl: "https://checkout.stripe.test/pay/cs_fake_1",
      stripeSessionId: "cs_fake_1",
      expiresAt: null,
    });
    // No new order was created — the existing OPEN order is reused.
    expect(orderCreate).not.toHaveBeenCalled();
    // The session is opened for the EXISTING order's server total, on the account.
    const call = gateway.calls[0]!;
    expect(call.amountCents).toBe(1599);
    expect(call.orderId).toBe("ord_1");
    expect(call.stripeAccountId).toBe("acct_1");
    expect(call.metadata.orderNumber).toBe("7");
    // The CheckoutSession row is persisted/reused for that order + amount.
    expect(createOrReuse).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz_1",
        orderId: "ord_1",
        clientUuid: UUID,
        stripeSessionId: "cs_fake_1",
        stripeAccountId: "acct_1",
        amountCents: 1599,
        currency: "USD",
      }),
    );
  });
});
