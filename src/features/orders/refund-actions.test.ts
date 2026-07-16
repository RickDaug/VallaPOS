import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Mocks ----------------------------------------------------------------
// voidOrder/refundOrder are exercised with REAL refund math + REAL zod, but the
// DB and tenant choke point are stubbed. We assert tenant scoping, the MANAGER
// role gate, the reversing-payment writes inside the transaction, the status
// transitions, and the guard rails (already-settled, over-refund, etc.).
const requireCapability = vi.fn();
const orderFindFirst = vi.fn();
const paymentCreateMany = vi.fn();
const paymentUpdateMany = vi.fn();
const paymentFindFirst = vi.fn();
const orderUpdate = vi.fn();
const drawerFindFirst = vi.fn();
const queryRaw = vi.fn();
const orderLineFindMany = vi.fn();
const variationFindMany = vi.fn();
const variationUpdate = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Stub the tenant module (its real impl pulls in auth.ts → env.ts, which throws
// without env). emailReceipt still imports requireMembership from here.
vi.mock("@/lib/tenant", () => {
  class ForbiddenError extends Error {}
  return { ForbiddenError, requireMembership: vi.fn() };
});
// voidOrder/refundOrder now gate on the active operator's refund_void capability.
vi.mock("@/lib/operator-guard", () => ({
  requireCapability: (...args: unknown[]) => requireCapability(...args),
}));
// actions.ts also imports the Resend send wrapper (./email → @/lib/env, which
// throws without env). These tests don't exercise email, so stub it.
vi.mock("./email", () => ({ isEmailConfigured: vi.fn(), sendReceiptEmail: vi.fn() }));
vi.mock("@/lib/db", () => {
  const tx = {
    // The refund/void transactions take a FOR UPDATE row lock via $queryRaw.
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    order: {
      findFirst: (...a: unknown[]) => orderFindFirst(...a),
      update: (...a: unknown[]) => orderUpdate(...a),
    },
    payment: {
      createMany: (...a: unknown[]) => paymentCreateMany(...a),
      updateMany: (...a: unknown[]) => paymentUpdateMany(...a),
      findFirst: (...a: unknown[]) => paymentFindFirst(...a),
    },
    cashDrawerSession: {
      findFirst: (...a: unknown[]) => drawerFindFirst(...a),
    },
    orderLine: {
      findMany: (...a: unknown[]) => orderLineFindMany(...a),
    },
    variation: {
      findMany: (...a: unknown[]) => variationFindMany(...a),
      update: (...a: unknown[]) => variationUpdate(...a),
    },
  };
  return {
    db: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) },
  };
});

import { voidOrder, refundOrder } from "./actions";

const BUSINESS_ID = "biz_1";
const ORDER_ID = "order_1";

type Payment = { id: string; method: string; amountCents: number };

function order(status: string, payments: Payment[]) {
  return { id: ORDER_ID, status, payments };
}

// The active operator is allowed to refund/void.
function allowRefund() {
  requireCapability.mockResolvedValue({
    businessId: BUSINESS_ID,
    membershipId: "m1",
    role: "MANAGER",
    permissions: ["refund_void"],
    name: "Manager",
    deviceMembershipId: "m1",
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createdReversals(): any[] {
  const call = paymentCreateMany.mock.calls.at(0);
  return call ? call[0].data : [];
}

beforeEach(() => {
  vi.clearAllMocks();
  allowRefund();
  orderUpdate.mockResolvedValue({});
  paymentCreateMany.mockResolvedValue({ count: 1 });
  paymentUpdateMany.mockResolvedValue({ count: 1 });
  // Default: the row-lock query is a no-op and no prior reversal exists.
  queryRaw.mockResolvedValue([]);
  paymentFindFirst.mockResolvedValue(null);
  // Default: a drawer IS open, so cash refunds/voids are allowed to proceed.
  drawerFindFirst.mockResolvedValue({ id: "drawer_1" });
  // Default: no order lines → restock is a no-op for the existing tests.
  orderLineFindMany.mockResolvedValue([]);
  variationFindMany.mockResolvedValue([]);
  variationUpdate.mockResolvedValue({});
});

describe("voidOrder — auth + tenant", () => {
  it("gates on the refund_void capability for this business", async () => {
    orderFindFirst.mockResolvedValue(order("PAID", [{ id: "p1", method: "CASH", amountCents: 1083 }]));
    await voidOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID });
    expect(requireCapability).toHaveBeenCalledWith(BUSINESS_ID, "refund_void");
  });

  it("rejects an operator lacking refund_void", async () => {
    requireCapability.mockRejectedValue(new Error("REQUIRES_CAPABILITY_refund_void"));
    await expect(voidOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID })).rejects.toThrow(
      "REQUIRES_CAPABILITY_refund_void",
    );
    expect(orderFindFirst).not.toHaveBeenCalled();
  });

  it("scopes the order lookup by id AND businessId", async () => {
    orderFindFirst.mockResolvedValue(order("PAID", [{ id: "p1", method: "CASH", amountCents: 500 }]));
    await voidOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID });
    expect(orderFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: ORDER_ID, businessId: BUSINESS_ID }),
      }),
    );
  });
});

describe("voidOrder — behavior", () => {
  it("voids a PAID order: writes a negative reversing payment per method, REFUNDED", async () => {
    orderFindFirst.mockResolvedValue(
      order("PAID", [
        { id: "p1", method: "CASH", amountCents: 1000 },
        { id: "p2", method: "CARD", amountCents: 500 },
      ]),
    );
    const res = await voidOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID });
    // CASH 1000 leaves the till; the CARD 500 portion has no PSP → manual refund.
    expect(res).toEqual({
      ok: true,
      status: "VOIDED",
      reversedCents: 1500,
      cashRefundedCents: 1000,
      manualRefundCents: 500,
      manualRefundRequired: true,
    });

    const reversals = createdReversals();
    expect(reversals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ businessId: BUSINESS_ID, orderId: ORDER_ID, method: "CASH", status: "REFUNDED", amountCents: -1000 }),
        expect.objectContaining({ method: "CARD", amountCents: -500 }),
      ]),
    );
    // Original captures flipped to REFUNDED, scoped by businessId.
    expect(paymentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessId: BUSINESS_ID, orderId: ORDER_ID, status: "CAPTURED" }),
        data: { status: "REFUNDED" },
      }),
    );
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "VOIDED" } }),
    );
  });

  it("rejects voiding a non-PAID order", async () => {
    orderFindFirst.mockResolvedValue(order("OPEN", [{ id: "p1", method: "CASH", amountCents: 500 }]));
    const res = await voidOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID });
    expect(res).toEqual({ ok: false, reason: "not_paid" });
    expect(paymentCreateMany).not.toHaveBeenCalled();
  });

  it("rejects voiding an already VOIDED/REFUNDED order (idempotency guard)", async () => {
    orderFindFirst.mockResolvedValue(order("VOIDED", []));
    expect(await voidOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID })).toEqual({
      ok: false,
      reason: "already_settled",
    });
    orderFindFirst.mockResolvedValue(order("REFUNDED", []));
    expect(await voidOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID })).toEqual({
      ok: false,
      reason: "already_settled",
    });
  });

  it("returns order_not_found for an order outside the business", async () => {
    orderFindFirst.mockResolvedValue(null);
    expect(await voidOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID })).toEqual({
      ok: false,
      reason: "order_not_found",
    });
  });
});

describe("refundOrder — full", () => {
  it("fully refunds, reversing the net collected and marking REFUNDED", async () => {
    orderFindFirst.mockResolvedValue(order("PAID", [{ id: "p1", method: "CASH", amountCents: 1083 }]));
    const res = await refundOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID });
    expect(res).toEqual({
      ok: true,
      status: "REFUNDED",
      reversedCents: 1083,
      cashRefundedCents: 1083,
      manualRefundCents: 0,
      manualRefundRequired: false,
    });
    expect(createdReversals()).toEqual([
      expect.objectContaining({ method: "CASH", amountCents: -1083, status: "REFUNDED" }),
    ]);
    expect(orderUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "REFUNDED" } }));
  });

  it("rejects a full refund when nothing remains collected", async () => {
    orderFindFirst.mockResolvedValue(
      order("PARTIALLY_REFUNDED", [
        { id: "p1", method: "CASH", amountCents: 1000 },
        { id: "p2", method: "CASH", amountCents: -1000 },
      ]),
    );
    expect(await refundOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID })).toEqual({
      ok: false,
      reason: "nothing_collected",
    });
  });

  it("rejects refunding an already settled order", async () => {
    orderFindFirst.mockResolvedValue(order("REFUNDED", []));
    expect(await refundOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID })).toEqual({
      ok: false,
      reason: "already_settled",
    });
  });
});

describe("refundOrder — partial", () => {
  it("refunds a specific amount and leaves the order PARTIALLY_REFUNDED", async () => {
    orderFindFirst.mockResolvedValue(order("PAID", [{ id: "p1", method: "CASH", amountCents: 1000 }]));
    const res = await refundOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID, amountCents: 300 });
    expect(res).toEqual({
      ok: true,
      status: "PARTIALLY_REFUNDED",
      reversedCents: 300,
      cashRefundedCents: 300,
      manualRefundCents: 0,
      manualRefundRequired: false,
    });
    expect(createdReversals()).toEqual([
      expect.objectContaining({ method: "CASH", amountCents: -300 }),
    ]);
    // Partial refund must NOT flip the original captures (further partials remain valid).
    expect(paymentUpdateMany).not.toHaveBeenCalled();
  });

  it("promotes a partial that drains the balance to a full REFUNDED", async () => {
    orderFindFirst.mockResolvedValue(order("PAID", [{ id: "p1", method: "CASH", amountCents: 1000 }]));
    const res = await refundOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID, amountCents: 1000 });
    expect(res).toEqual({
      ok: true,
      status: "REFUNDED",
      reversedCents: 1000,
      cashRefundedCents: 1000,
      manualRefundCents: 0,
      manualRefundRequired: false,
    });
    expect(paymentUpdateMany).toHaveBeenCalled(); // captures flipped on a full settle
  });

  it("rejects refunding more than the net collected", async () => {
    orderFindFirst.mockResolvedValue(order("PAID", [{ id: "p1", method: "CASH", amountCents: 1000 }]));
    expect(
      await refundOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID, amountCents: 1500 }),
    ).toEqual({ ok: false, reason: "exceeds_net_collected" });
    expect(paymentCreateMany).not.toHaveBeenCalled();
  });

  it("respects a prior partial refund when bounding the next", async () => {
    orderFindFirst.mockResolvedValue(
      order("PARTIALLY_REFUNDED", [
        { id: "p1", method: "CASH", amountCents: 1000 },
        { id: "p2", method: "CASH", amountCents: -400 },
      ]),
    );
    // 600 remaining; 700 must be rejected, 600 must drain to REFUNDED.
    expect(
      await refundOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID, amountCents: 700 }),
    ).toEqual({ ok: false, reason: "exceeds_net_collected" });
    const res = await refundOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID, amountCents: 600 });
    expect(res).toEqual({
      ok: true,
      status: "REFUNDED",
      reversedCents: 600,
      cashRefundedCents: 600,
      manualRefundCents: 0,
      manualRefundRequired: false,
    });
  });

  it("rejects a non-positive partial amount via zod (negative) or guard (zero coerced)", async () => {
    orderFindFirst.mockResolvedValue(order("PAID", [{ id: "p1", method: "CASH", amountCents: 1000 }]));
    await expect(
      refundOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID, amountCents: -5 }),
    ).rejects.toThrow(); // zod: positive
  });
});

describe("cash-drawer guard on cash refunds/voids", () => {
  it("throws (rolls back) a cash refund when no drawer session is open", async () => {
    orderFindFirst.mockResolvedValue(order("PAID", [{ id: "p1", method: "CASH", amountCents: 1000 }]));
    drawerFindFirst.mockResolvedValue(null); // no open drawer
    await expect(refundOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID })).rejects.toThrow(
      "NO_OPEN_DRAWER_FOR_CASH_REFUND",
    );
    // Nothing written when the guard trips.
    expect(paymentCreateMany).not.toHaveBeenCalled();
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it("throws a cash VOID when no drawer session is open", async () => {
    orderFindFirst.mockResolvedValue(order("PAID", [{ id: "p1", method: "CASH", amountCents: 500 }]));
    drawerFindFirst.mockResolvedValue(null);
    await expect(voidOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID })).rejects.toThrow(
      "NO_OPEN_DRAWER_FOR_CASH_REFUND",
    );
    expect(paymentCreateMany).not.toHaveBeenCalled();
  });

  it("scopes the open-drawer lookup by businessId", async () => {
    orderFindFirst.mockResolvedValue(order("PAID", [{ id: "p1", method: "CASH", amountCents: 500 }]));
    await refundOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID });
    expect(drawerFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessId: BUSINESS_ID, closedAt: null }),
      }),
    );
  });

  it("does NOT require an open drawer for a QR-only refund (no cash leaves the till)", async () => {
    orderFindFirst.mockResolvedValue(order("PAID", [{ id: "p1", method: "QR", amountCents: 1000 }]));
    drawerFindFirst.mockResolvedValue(null); // no drawer open, but no cash either
    const res = await refundOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID });
    // A QR reversal is RECORDED but has no PSP → manual refund required, and the
    // drawer guard never fires because no cash moves.
    expect(res).toEqual({
      ok: true,
      status: "REFUNDED",
      reversedCents: 1000,
      cashRefundedCents: 0,
      manualRefundCents: 1000,
      manualRefundRequired: true,
    });
    expect(drawerFindFirst).not.toHaveBeenCalled();
  });
});

describe("restock on reversal (inventory)", () => {
  // A tracked line + a variation whose item tracks stock.
  function withTrackedLine() {
    orderLineFindMany.mockResolvedValue([{ variationId: "var_1", quantity: 4 }]);
    variationFindMany.mockResolvedValue([{ id: "var_1", item: { trackStock: true } }]);
  }

  it("void returns the sold units to inventory (increment by line quantity)", async () => {
    orderFindFirst.mockResolvedValue(order("PAID", [{ id: "p1", method: "CASH", amountCents: 1000 }]));
    withTrackedLine();
    await voidOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID });
    expect(orderLineFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orderId: ORDER_ID, businessId: BUSINESS_ID }),
      }),
    );
    expect(variationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "var_1" }, data: { stock: { increment: 4 } } }),
    );
  });

  it("a FULL refund restocks", async () => {
    orderFindFirst.mockResolvedValue(order("PAID", [{ id: "p1", method: "CASH", amountCents: 1000 }]));
    withTrackedLine();
    await refundOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID });
    expect(variationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { stock: { increment: 4 } } }),
    );
  });

  it("a PARTIAL (amount-only) refund does NOT restock", async () => {
    orderFindFirst.mockResolvedValue(order("PAID", [{ id: "p1", method: "CASH", amountCents: 1000 }]));
    withTrackedLine();
    await refundOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID, amountCents: 300 });
    expect(orderLineFindMany).not.toHaveBeenCalled();
    expect(variationUpdate).not.toHaveBeenCalled();
  });

  it("skips lines whose variation doesn't track stock", async () => {
    orderFindFirst.mockResolvedValue(order("PAID", [{ id: "p1", method: "CASH", amountCents: 1000 }]));
    orderLineFindMany.mockResolvedValue([{ variationId: "var_1", quantity: 4 }]);
    variationFindMany.mockResolvedValue([{ id: "var_1", item: { trackStock: false } }]);
    await voidOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID });
    expect(variationUpdate).not.toHaveBeenCalled();
  });
});

describe("refund/void idempotency (clientUuid)", () => {
  const KEY = "11111111-1111-1111-1111-111111111111";

  it("takes a FOR UPDATE row lock on the order before reading it", async () => {
    orderFindFirst.mockResolvedValue(order("PAID", [{ id: "p1", method: "CASH", amountCents: 1000 }]));
    await refundOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID, clientUuid: KEY });
    expect(queryRaw).toHaveBeenCalled();
  });

  it("stamps the clientUuid tag onto the reversing payments", async () => {
    orderFindFirst.mockResolvedValue(order("PAID", [{ id: "p1", method: "CASH", amountCents: 1000 }]));
    await refundOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID, amountCents: 300, clientUuid: KEY });
    expect(createdReversals()[0]).toMatchObject({ processorRef: `refund:${KEY}` });
  });

  it("looks up a prior reversal scoped by businessId + orderId + the tag", async () => {
    orderFindFirst.mockResolvedValue(order("PAID", [{ id: "p1", method: "CASH", amountCents: 1000 }]));
    await refundOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID, clientUuid: KEY });
    expect(paymentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: BUSINESS_ID,
          orderId: ORDER_ID,
          processorRef: `refund:${KEY}`,
        }),
      }),
    );
  });

  it("makes a repeated PARTIAL refund a no-op (the double-tap the status guard misses)", async () => {
    orderFindFirst.mockResolvedValue(
      order("PARTIALLY_REFUNDED", [
        { id: "p1", method: "CASH", amountCents: 1000 },
        { id: "p2", method: "CASH", amountCents: -300 },
      ]),
    );
    paymentFindFirst.mockResolvedValue({ id: "prev_reversal" }); // this exact request already applied
    const res = await refundOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID, amountCents: 300, clientUuid: KEY });
    expect(res).toEqual({
      ok: true,
      status: "PARTIALLY_REFUNDED",
      reversedCents: 0,
      cashRefundedCents: 0,
      manualRefundCents: 0,
      manualRefundRequired: false,
    });
    // Critically: no SECOND reversing payment is written.
    expect(paymentCreateMany).not.toHaveBeenCalled();
  });

  it("makes a repeated void a no-op instead of writing a second reversal", async () => {
    orderFindFirst.mockResolvedValue(order("VOIDED", []));
    paymentFindFirst.mockResolvedValue({ id: "prev_reversal" });
    const res = await voidOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID, clientUuid: KEY });
    expect(res).toMatchObject({ ok: true, status: "VOIDED", reversedCents: 0 });
    expect(paymentCreateMany).not.toHaveBeenCalled();
  });

  it("without a clientUuid, no dedup lookup happens (back-compat)", async () => {
    orderFindFirst.mockResolvedValue(order("PAID", [{ id: "p1", method: "CASH", amountCents: 1000 }]));
    await refundOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID });
    expect(paymentFindFirst).not.toHaveBeenCalled();
  });
});
