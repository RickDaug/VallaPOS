import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Prisma mock -----------------------------------------------------------
// captureQrSale/failQrSale resolve the session by the globally-unique
// stripeSessionId, assert the account + amount, then settle inside a transaction.
// We stub each delegate op and share db.* with the tx.* the transaction callback
// receives, so a compare-and-set flip is fully observable.
const checkoutSessionFindUnique = vi.fn();
const checkoutSessionUpdateMany = vi.fn();
const checkoutSessionUpdate = vi.fn();
const paymentCreate = vi.fn();
const orderUpdate = vi.fn();
const orderLineFindMany = vi.fn();
const variationFindMany = vi.fn();
const variationUpdate = vi.fn();

vi.mock("@/lib/db", () => {
  const shared = {
    checkoutSession: {
      findUnique: (...a: unknown[]) => checkoutSessionFindUnique(...a),
      updateMany: (...a: unknown[]) => checkoutSessionUpdateMany(...a),
      update: (...a: unknown[]) => checkoutSessionUpdate(...a),
    },
    payment: { create: (...a: unknown[]) => paymentCreate(...a) },
    order: { update: (...a: unknown[]) => orderUpdate(...a) },
    orderLine: { findMany: (...a: unknown[]) => orderLineFindMany(...a) },
    variation: {
      findMany: (...a: unknown[]) => variationFindMany(...a),
      update: (...a: unknown[]) => variationUpdate(...a),
    },
  };
  return {
    db: {
      ...shared,
      $transaction: async (fn: (t: typeof shared) => unknown) => fn(shared),
    },
  };
});

import { captureQrSale, expireQrSale } from "./sale-store";
import type { SaleSettlement } from "./sale-webhook";

const OPEN_ROW = {
  id: "chk_1",
  businessId: "biz_1",
  orderId: "ord_1",
  stripeAccountId: "acct_1",
  amountCents: 1599,
  currency: "USD",
  status: "OPEN",
};

const captureSettlement: SaleSettlement = {
  kind: "capture",
  stripeSessionId: "cs_1",
  amountTotal: 1599,
  currency: "usd", // lowercase from Stripe — must match "USD" case-insensitively
  paymentIntentId: "pi_1",
  cardBrand: "visa",
  cardLast4: "4242",
};

beforeEach(() => {
  vi.clearAllMocks();
  checkoutSessionFindUnique.mockResolvedValue(OPEN_ROW);
  checkoutSessionUpdateMany.mockResolvedValue({ count: 1 });
  checkoutSessionUpdate.mockResolvedValue({});
  paymentCreate.mockResolvedValue({ id: "pay_1" });
  orderUpdate.mockResolvedValue({});
  orderLineFindMany.mockResolvedValue([]);
  variationFindMany.mockResolvedValue([]);
  variationUpdate.mockResolvedValue({});
});

describe("captureQrSale", () => {
  it("compare-and-sets OPEN→CAPTURED, writes the QR Payment, links it, marks PAID", async () => {
    const out = await captureQrSale({ settlement: captureSettlement, eventAccount: "acct_1" });

    expect(out).toEqual({
      outcome: "captured",
      paymentId: "pay_1",
      orderId: "ord_1",
      businessId: "biz_1",
    });
    // CAS is guarded on status OPEN + businessId.
    expect(checkoutSessionUpdateMany).toHaveBeenCalledWith({
      where: { id: "chk_1", businessId: "biz_1", status: "OPEN" },
      data: { status: "CAPTURED" },
    });
    // Payment uses the STORED amount, method QR, PI id + card metadata.
    expect(paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: "biz_1",
          orderId: "ord_1",
          method: "QR",
          status: "CAPTURED",
          amountCents: 1599,
          processorRef: "pi_1",
          cardBrand: "visa",
          cardLast4: "4242",
        }),
      }),
    );
    // paymentId link (the @unique double-capture guard) + order PAID.
    expect(checkoutSessionUpdate).toHaveBeenCalledWith({
      where: { id: "chk_1" },
      data: { paymentId: "pay_1" },
    });
    expect(orderUpdate).toHaveBeenCalledWith({ where: { id: "ord_1" }, data: { status: "PAID" } });
  });

  it("no-ops on a WRONG connected account (never touches tenant data)", async () => {
    const out = await captureQrSale({ settlement: captureSettlement, eventAccount: "acct_EVIL" });
    expect(out).toEqual({ outcome: "account_mismatch" });
    expect(checkoutSessionUpdateMany).not.toHaveBeenCalled();
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("no double-capture on a replayed webhook (CAS affects 0 rows → already_settled)", async () => {
    checkoutSessionUpdateMany.mockResolvedValue({ count: 0 });
    const out = await captureQrSale({ settlement: captureSettlement, eventAccount: "acct_1" });
    expect(out).toEqual({ outcome: "already_settled" });
    expect(paymentCreate).not.toHaveBeenCalled();
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it("marks FAILED + never settles when the amount is tampered", async () => {
    const tampered: SaleSettlement = { ...captureSettlement, amountTotal: 1 };
    const out = await captureQrSale({ settlement: tampered, eventAccount: "acct_1" });
    expect(out).toEqual({ outcome: "amount_mismatch" });
    // Marked FAILED (only while OPEN), no capture written.
    expect(checkoutSessionUpdateMany).toHaveBeenCalledWith({
      where: { id: "chk_1", businessId: "biz_1", status: "OPEN" },
      data: { status: "FAILED" },
    });
    expect(paymentCreate).not.toHaveBeenCalled();
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it("marks FAILED on a currency mismatch too", async () => {
    const out = await captureQrSale({
      settlement: { ...captureSettlement, currency: "mxn" },
      eventAccount: "acct_1",
    });
    expect(out).toEqual({ outcome: "amount_mismatch" });
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("no-ops on an unknown session", async () => {
    checkoutSessionFindUnique.mockResolvedValue(null);
    const out = await captureQrSale({ settlement: captureSettlement, eventAccount: "acct_1" });
    expect(out).toEqual({ outcome: "unknown_session" });
  });

  it("decrements stock for tracked lines exactly like the cash checkout", async () => {
    orderLineFindMany.mockResolvedValue([
      { variationId: "var_track", quantity: 2 },
      { variationId: "var_untrack", quantity: 5 },
    ]);
    variationFindMany.mockResolvedValue([
      { id: "var_track", item: { trackStock: true } },
      { id: "var_untrack", item: { trackStock: false } },
    ]);
    await captureQrSale({ settlement: captureSettlement, eventAccount: "acct_1" });
    // Only the stock-tracking line is decremented.
    expect(variationUpdate).toHaveBeenCalledTimes(1);
    expect(variationUpdate).toHaveBeenCalledWith({
      where: { id: "var_track" },
      data: { stock: { decrement: 2 } },
    });
  });
});

describe("expireQrSale", () => {
  it("flips OPEN→EXPIRED (asserting account) and never overrides a CAPTURED sale", async () => {
    const settlement: SaleSettlement = {
      kind: "expire",
      stripeSessionId: "cs_1",
      amountTotal: null,
      currency: null,
      paymentIntentId: null,
    };
    const out = await expireQrSale({ settlement, eventAccount: "acct_1" });
    expect(out).toEqual({ outcome: "expired" });
    expect(checkoutSessionUpdateMany).toHaveBeenCalledWith({
      where: { id: "chk_1", businessId: "biz_1", status: "OPEN" },
      data: { status: "EXPIRED" },
    });

    // A late expire after capture (0 rows flipped) is a safe no-op.
    checkoutSessionUpdateMany.mockResolvedValue({ count: 0 });
    const out2 = await expireQrSale({ settlement, eventAccount: "acct_1" });
    expect(out2).toEqual({ outcome: "already_settled" });
  });
});
