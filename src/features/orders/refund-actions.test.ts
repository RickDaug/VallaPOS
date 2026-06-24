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
const orderUpdate = vi.fn();

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
    order: {
      findFirst: (...a: unknown[]) => orderFindFirst(...a),
      update: (...a: unknown[]) => orderUpdate(...a),
    },
    payment: {
      createMany: (...a: unknown[]) => paymentCreateMany(...a),
      updateMany: (...a: unknown[]) => paymentUpdateMany(...a),
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
    expect(res).toEqual({ ok: true, status: "VOIDED", reversedCents: 1500 });

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
    expect(res).toEqual({ ok: true, status: "REFUNDED", reversedCents: 1083 });
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
    expect(res).toEqual({ ok: true, status: "PARTIALLY_REFUNDED", reversedCents: 300 });
    expect(createdReversals()).toEqual([
      expect.objectContaining({ method: "CASH", amountCents: -300 }),
    ]);
    // Partial refund must NOT flip the original captures (further partials remain valid).
    expect(paymentUpdateMany).not.toHaveBeenCalled();
  });

  it("promotes a partial that drains the balance to a full REFUNDED", async () => {
    orderFindFirst.mockResolvedValue(order("PAID", [{ id: "p1", method: "CASH", amountCents: 1000 }]));
    const res = await refundOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID, amountCents: 1000 });
    expect(res).toEqual({ ok: true, status: "REFUNDED", reversedCents: 1000 });
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
    expect(res).toEqual({ ok: true, status: "REFUNDED", reversedCents: 600 });
  });

  it("rejects a non-positive partial amount via zod (negative) or guard (zero coerced)", async () => {
    orderFindFirst.mockResolvedValue(order("PAID", [{ id: "p1", method: "CASH", amountCents: 1000 }]));
    await expect(
      refundOrder({ businessId: BUSINESS_ID, orderId: ORDER_ID, amountCents: -5 }),
    ).rejects.toThrow(); // zod: positive
  });
});
