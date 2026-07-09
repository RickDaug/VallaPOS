import { describe, it, expect, beforeEach, vi } from "vitest";

// Tab actions exercised with REAL money math + REAL zod, DB + tenant choke point
// stubbed. We assert: openTab rejects double-open and stamps an OPEN order;
// addTabLines recomputes server-side + rejects foreign modifiers; settleTab
// computes the amount itself, validates tender, closes only when fully settled.
const requireCapability = vi.fn();

const orderFindFirst = vi.fn();
const floorTableFindFirst = vi.fn();
const businessFindUniqueOrThrow = vi.fn();
const variationFindMany = vi.fn();

const orderCounterUpsert = vi.fn();
const orderCreate = vi.fn();
const orderUpdate = vi.fn();
const orderFindFirstOrThrow = vi.fn();
const orderLineCreate = vi.fn();
const orderLineFindMany = vi.fn();
const orderLineUpdateMany = vi.fn();
const orderLineDeleteMany = vi.fn();
const orderLineCount = vi.fn();
const paymentCreate = vi.fn();
const orderTableCreateMany = vi.fn();
const orderTableDeleteMany = vi.fn();

vi.mock("@/lib/operator-guard", () => ({
  requireCapability: (...args: unknown[]) => requireCapability(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// The manager-approval gate for unverified (QR/MANUAL) tab settlements. Mocked so
// the test controls whether a submitted PIN is accepted; APPROVE_UNVERIFIED_TENDER
// keeps its real value so `can(...)` (real, unmocked) resolves correctly.
const verifyManagerApproval = vi.fn();
vi.mock("@/features/register/manager-approval", () => ({
  APPROVE_UNVERIFIED_TENDER: "approve_unverified_tender",
  verifyManagerApproval: (...args: unknown[]) => verifyManagerApproval(...args),
}));

vi.mock("@/lib/db", () => {
  const tx = {
    orderCounter: { upsert: (...a: unknown[]) => orderCounterUpsert(...a) },
    order: {
      create: (...a: unknown[]) => orderCreate(...a),
      update: (...a: unknown[]) => orderUpdate(...a),
      findFirstOrThrow: (...a: unknown[]) => orderFindFirstOrThrow(...a),
    },
    orderLine: {
      create: (...a: unknown[]) => orderLineCreate(...a),
      findMany: (...a: unknown[]) => orderLineFindMany(...a),
      updateMany: (...a: unknown[]) => orderLineUpdateMany(...a),
      deleteMany: (...a: unknown[]) => orderLineDeleteMany(...a),
      count: (...a: unknown[]) => orderLineCount(...a),
    },
    payment: { create: (...a: unknown[]) => paymentCreate(...a) },
    orderTable: {
      createMany: (...a: unknown[]) => orderTableCreateMany(...a),
      deleteMany: (...a: unknown[]) => orderTableDeleteMany(...a),
    },
  };
  return {
    db: {
      order: { findFirst: (...a: unknown[]) => orderFindFirst(...a) },
      floorTable: { findFirst: (...a: unknown[]) => floorTableFindFirst(...a) },
      business: { findUniqueOrThrow: (...a: unknown[]) => businessFindUniqueOrThrow(...a) },
      variation: { findMany: (...a: unknown[]) => variationFindMany(...a) },
      orderTable: { createMany: (...a: unknown[]) => orderTableCreateMany(...a) },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { openTab, addTabLines, settleTab } from "./actions";

const BUSINESS_ID = "biz_1";

/** Narrow a settle result to the success shape (throws if it was a manager-approval
 *  rejection) so a test can read amountCents/changeCents/closed off it. */
function settled(res: Awaited<ReturnType<typeof settleTab>>) {
  if ("error" in res) throw new Error(`unexpected settle rejection: ${res.error}`);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireCapability.mockResolvedValue({
    businessId: BUSINESS_ID,
    membershipId: "m1",
    role: "CASHIER",
    permissions: ["take_orders"],
    name: "Cashier",
    deviceMembershipId: "m1",
  });
});

function variationRow(over: Partial<{ id: string; priceCents: number; itemName: string }> = {}) {
  const { id = "var_1", priceCents = 1000, itemName = "Burger" } = over;
  return { id, businessId: BUSINESS_ID, name: "Default", priceCents, item: { name: itemName, modifierLinks: [] } };
}

describe("openTab", () => {
  it("rejects opening a table that already has an open tab", async () => {
    floorTableFindFirst.mockResolvedValue({ id: "t1" });
    orderFindFirst.mockResolvedValue({ id: "existing" }); // occupied
    await expect(openTab({ businessId: BUSINESS_ID, tableId: "t1" })).rejects.toThrow(/already has an open tab/);
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it("rejects an unknown table", async () => {
    floorTableFindFirst.mockResolvedValue(null);
    await expect(openTab({ businessId: BUSINESS_ID, tableId: "nope" })).rejects.toThrow(/Table not found/);
  });

  it("creates an OPEN order with the next number, cashier and table", async () => {
    floorTableFindFirst.mockResolvedValue({ id: "t1" });
    orderFindFirst.mockResolvedValue(null); // free
    orderCounterUpsert.mockResolvedValue({ lastNumber: 7 });
    orderCreate.mockResolvedValue({ id: "order_1" });

    const id = await openTab({ businessId: BUSINESS_ID, tableId: "t1" });
    expect(id).toBe("order_1");
    const data = orderCreate.mock.calls[0]![0].data;
    expect(data.status).toBe("OPEN");
    expect(data.number).toBe(7);
    expect(data.cashierId).toBe("m1");
    expect(data.businessId).toBe(BUSINESS_ID);
    expect(data.tables.create).toEqual({ tableId: "t1" });
  });
});

describe("addTabLines", () => {
  it("rejects a modifier that doesn't belong to the item", async () => {
    orderFindFirst.mockResolvedValue({ id: "order_1" }); // open
    businessFindUniqueOrThrow.mockResolvedValue({ taxRateBps: 825, taxInclusive: false });
    variationFindMany.mockResolvedValue([variationRow()]); // no modifier groups

    await expect(
      addTabLines({
        businessId: BUSINESS_ID,
        orderId: "order_1",
        seat: 1,
        lines: [{ variationId: "var_1", quantity: 1, modifierIds: ["foreign"] }],
      }),
    ).rejects.toThrow(/Unknown modifier/);
    expect(orderLineCreate).not.toHaveBeenCalled();
  });

  it("recomputes per-line tax + order totals server-side (8.25% on $20)", async () => {
    orderFindFirst.mockResolvedValue({ id: "order_1" });
    businessFindUniqueOrThrow.mockResolvedValue({ taxRateBps: 825, taxInclusive: false });
    variationFindMany.mockResolvedValue([variationRow({ priceCents: 1000 })]);
    orderLineCreate.mockResolvedValue({ id: "line_1" });
    // recompute reads back the persisted line(s):
    orderLineFindMany.mockResolvedValue([{ totalCents: 2000, discountCents: 0, taxCents: 165 }]);
    orderFindFirstOrThrow.mockResolvedValue({ tipCents: 0 });

    await addTabLines({
      businessId: BUSINESS_ID,
      orderId: "order_1",
      seat: 2,
      lines: [{ variationId: "var_1", quantity: 2 }],
    });

    const lineData = orderLineCreate.mock.calls[0]![0].data;
    expect(lineData.totalCents).toBe(2000); // 1000 * 2
    expect(lineData.taxCents).toBe(165); // round(2000 * 0.0825)
    expect(lineData.seat).toBe(2);

    const totals = orderUpdate.mock.calls.at(-1)![0].data;
    expect(totals.subtotalCents).toBe(2000);
    expect(totals.taxCents).toBe(165);
    expect(totals.totalCents).toBe(2165); // base + tax + tip(0)
  });

  it("persists a cashier-typed custom modifier and includes its upcharge", async () => {
    orderFindFirst.mockResolvedValue({ id: "order_1" });
    businessFindUniqueOrThrow.mockResolvedValue({ taxRateBps: 0, taxInclusive: false });
    variationFindMany.mockResolvedValue([variationRow({ priceCents: 1000 })]);
    orderLineCreate.mockResolvedValue({ id: "line_1" });
    orderLineFindMany.mockResolvedValue([{ totalCents: 1150, discountCents: 0, taxCents: 0 }]);
    orderFindFirstOrThrow.mockResolvedValue({ tipCents: 0 });

    await addTabLines({
      businessId: BUSINESS_ID,
      orderId: "order_1",
      seat: null,
      lines: [
        {
          variationId: "var_1",
          quantity: 1,
          customModifiers: [{ name: "Extra cheese", priceDeltaCents: 150 }],
        },
      ],
    });

    const lineData = orderLineCreate.mock.calls[0]![0].data;
    // Base $10 + $1.50 upcharge = $11.50; the custom modifier is snapshotted.
    expect(lineData.totalCents).toBe(1150);
    expect(lineData.modifiers.create).toEqual([
      { nameSnapshot: "Extra cheese", priceDeltaCents: 150 },
    ]);
  });

  it("rejects a negative custom-modifier upcharge (upcharge only adds)", async () => {
    orderFindFirst.mockResolvedValue({ id: "order_1" });
    businessFindUniqueOrThrow.mockResolvedValue({ taxRateBps: 0, taxInclusive: false });
    variationFindMany.mockResolvedValue([variationRow()]);

    await expect(
      addTabLines({
        businessId: BUSINESS_ID,
        orderId: "order_1",
        seat: null,
        lines: [
          {
            variationId: "var_1",
            quantity: 1,
            customModifiers: [{ name: "Discount hack", priceDeltaCents: -500 }],
          },
        ],
      }),
    ).rejects.toThrow();
    expect(orderLineCreate).not.toHaveBeenCalled();
  });
});

describe("settleTab", () => {
  // seat 1: $10 + 83¢ tax; seat 2: $5 + 41¢ tax (exclusive).
  const openOrder = {
    id: "order_1",
    business: { taxInclusive: false },
    lines: [
      { id: "a", seat: 1, totalCents: 1000, taxCents: 83, settledByPaymentId: null },
      { id: "b", seat: 2, totalCents: 500, taxCents: 41, settledByPaymentId: null },
    ],
  };

  beforeEach(() => {
    paymentCreate.mockResolvedValue({ id: "pay_1" });
    orderLineFindMany.mockResolvedValue([
      { totalCents: 1000, discountCents: 0, taxCents: 83 },
      { totalCents: 500, discountCents: 0, taxCents: 41 },
    ]);
    orderFindFirstOrThrow.mockResolvedValue({ tipCents: 0 });
    // Default: both planned lines get settled, none remain (whole-tab close).
    orderLineUpdateMany.mockResolvedValue({ count: 2 });
    orderLineCount.mockResolvedValue(0);
  });

  it("settles the whole tab and closes it to PAID", async () => {
    orderFindFirst.mockResolvedValue(openOrder);
    const res = settled(await settleTab({ businessId: BUSINESS_ID, orderId: "order_1", tipCents: 0, cashTenderedCents: 2000 }));
    expect(res.amountCents).toBe(1083 + 541);
    expect(res.changeCents).toBe(2000 - 1624);
    expect(res.closed).toBe(true);
    // the order.update carries the close (status PAID)
    const closeData = orderUpdate.mock.calls[0]![0].data;
    expect(closeData.status).toBe("PAID");
    expect(paymentCreate.mock.calls[0]![0].data.amountCents).toBe(1624);
  });

  it("settles a single seat and leaves the tab open", async () => {
    orderFindFirst.mockResolvedValue(openOrder);
    orderLineUpdateMany.mockResolvedValue({ count: 1 }); // only seat-1 line
    orderLineCount.mockResolvedValue(1); // seat-2 line remains
    const res = settled(await settleTab({ businessId: BUSINESS_ID, orderId: "order_1", seats: [1], tipCents: 0, cashTenderedCents: 2000 }));
    expect(res.amountCents).toBe(1083);
    expect(res.closed).toBe(false);
    const closeData = orderUpdate.mock.calls[0]![0].data;
    expect(closeData.status).toBeUndefined(); // not closed
    // only seat-1 line is marked settled
    expect(orderLineUpdateMany.mock.calls[0]![0].where.id).toEqual({ in: ["a"] });
  });

  it("adds the tip to the collected amount", async () => {
    orderFindFirst.mockResolvedValue(openOrder);
    orderLineUpdateMany.mockResolvedValue({ count: 1 });
    orderLineCount.mockResolvedValue(1);
    const res = settled(await settleTab({ businessId: BUSINESS_ID, orderId: "order_1", seats: [1], tipCents: 200, cashTenderedCents: 2000 }));
    expect(paymentCreate.mock.calls[0]![0].data.amountCents).toBe(1083 + 200);
    expect(res.changeCents).toBe(2000 - 1283);
  });

  it("aborts (no over-collect) if a planned line was already settled by a concurrent settle", async () => {
    orderFindFirst.mockResolvedValue(openOrder);
    // Plan covers 2 lines, but only 1 was still unsettled when we wrote — race lost.
    orderLineUpdateMany.mockResolvedValue({ count: 1 });
    await expect(
      settleTab({ businessId: BUSINESS_ID, orderId: "order_1", tipCents: 0, cashTenderedCents: 2000 }),
    ).rejects.toThrow(/changed while you were settling/);
    // The transaction rolls back; closure is never decided.
    expect(orderLineCount).not.toHaveBeenCalled();
  });

  it("rejects tender below the amount due", async () => {
    orderFindFirst.mockResolvedValue(openOrder);
    await expect(
      settleTab({ businessId: BUSINESS_ID, orderId: "order_1", tipCents: 0, cashTenderedCents: 1000 }),
    ).rejects.toThrow(/less than the amount due/);
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("defaults the payment method to CASH with tender + change", async () => {
    orderFindFirst.mockResolvedValue(openOrder);
    await settleTab({ businessId: BUSINESS_ID, orderId: "order_1", tipCents: 0, cashTenderedCents: 2000 });
    const pay = paymentCreate.mock.calls[0]![0].data;
    expect(pay.method).toBe("CASH");
    expect(pay.tenderedCents).toBe(2000);
    expect(pay.changeCents).toBe(2000 - 1624);
  });

  it("settles with QR out-of-band (no tender, no change, no cash-cover check)", async () => {
    // Operator can self-approve the unverified tender (owner/manager) — no PIN.
    requireCapability.mockResolvedValue({
      businessId: BUSINESS_ID,
      membershipId: "m1",
      role: "CASHIER",
      permissions: ["take_orders", "approve_unverified_tender"],
      name: "Cashier",
      deviceMembershipId: "m1",
    });
    orderFindFirst.mockResolvedValue(openOrder);
    // No cash is sent for QR; the out-of-band guard must NOT reject it.
    const res = settled(await settleTab({ businessId: BUSINESS_ID, orderId: "order_1", method: "QR", tipCents: 0, cashTenderedCents: 0 }));
    const pay = paymentCreate.mock.calls[0]![0].data;
    expect(pay.method).toBe("QR");
    expect(pay.tenderedCents).toBeNull();
    expect(pay.changeCents).toBe(0);
    expect(pay.amountCents).toBe(1624); // still the server-computed amount + tip
    expect(res.changeCents).toBe(0);
    expect(res.closed).toBe(true);
  });

  it("settles with MANUAL (Other) out-of-band, including a tip", async () => {
    // Operator can self-approve the unverified tender (owner/manager) — no PIN.
    requireCapability.mockResolvedValue({
      businessId: BUSINESS_ID,
      membershipId: "m1",
      role: "CASHIER",
      permissions: ["take_orders", "approve_unverified_tender"],
      name: "Cashier",
      deviceMembershipId: "m1",
    });
    orderFindFirst.mockResolvedValue(openOrder);
    orderLineUpdateMany.mockResolvedValue({ count: 1 });
    orderLineCount.mockResolvedValue(1);
    const res = settled(await settleTab({ businessId: BUSINESS_ID, orderId: "order_1", seats: [1], method: "MANUAL", tipCents: 200, cashTenderedCents: 0 }));
    const pay = paymentCreate.mock.calls[0]![0].data;
    expect(pay.method).toBe("MANUAL");
    expect(pay.tenderedCents).toBeNull();
    expect(pay.amountCents).toBe(1083 + 200); // seat-1 goods + tip
    expect(res.changeCents).toBe(0);
    expect(res.closed).toBe(false);
  });

  it("throws when the tab isn't this business's open order (tenant scope)", async () => {
    orderFindFirst.mockResolvedValue(null);
    await expect(
      settleTab({ businessId: BUSINESS_ID, orderId: "order_x", tipCents: 0, cashTenderedCents: 5000 }),
    ).rejects.toThrow(/Open tab not found/);
  });

  // ── Manager-approval gate for UNVERIFIED tenders (QR/MANUAL) — Round-4 #1 ──────
  describe("manager-approval gate (QR/MANUAL)", () => {
    it("requires a manager PIN for a QR settle by a cashier — writes nothing", async () => {
      // Default operator is a CASHIER (no approve_unverified_tender), no PIN sent.
      const res = await settleTab({ businessId: BUSINESS_ID, orderId: "order_1", method: "QR", tipCents: 0 });
      expect(res).toEqual({ error: "manager_approval_required" });
      // Fails fast before any order lookup / payment write.
      expect(orderFindFirst).not.toHaveBeenCalled();
      expect(paymentCreate).not.toHaveBeenCalled();
      expect(verifyManagerApproval).not.toHaveBeenCalled();
    });

    it("rejects a wrong manager PIN for a MANUAL settle (invalid_manager_pin)", async () => {
      verifyManagerApproval.mockResolvedValue(false);
      const res = await settleTab({
        businessId: BUSINESS_ID,
        orderId: "order_1",
        method: "MANUAL",
        tipCents: 0,
        managerPin: "0000",
      });
      expect(res).toEqual({ error: "invalid_manager_pin" });
      expect(verifyManagerApproval).toHaveBeenCalledWith(BUSINESS_ID, "0000");
      expect(paymentCreate).not.toHaveBeenCalled();
    });

    it("settles an unverified tender once a manager PIN is approved", async () => {
      verifyManagerApproval.mockResolvedValue(true);
      orderFindFirst.mockResolvedValue(openOrder);
      const res = await settleTab({
        businessId: BUSINESS_ID,
        orderId: "order_1",
        method: "QR",
        tipCents: 0,
        managerPin: "1234",
      });
      expect(verifyManagerApproval).toHaveBeenCalledWith(BUSINESS_ID, "1234");
      expect("error" in res).toBe(false);
      expect(paymentCreate.mock.calls[0]![0].data.method).toBe("QR");
      if (!("error" in res)) expect(res.closed).toBe(true);
    });

    it("does NOT gate a CASH settle (verified in-drawer, no PIN needed)", async () => {
      orderFindFirst.mockResolvedValue(openOrder);
      const res = settled(await settleTab({ businessId: BUSINESS_ID, orderId: "order_1", tipCents: 0, cashTenderedCents: 2000 }));
      expect("error" in res).toBe(false);
      expect(verifyManagerApproval).not.toHaveBeenCalled();
      expect(paymentCreate.mock.calls[0]![0].data.method).toBe("CASH");
    });
  });
});
