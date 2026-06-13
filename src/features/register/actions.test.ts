import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Mocks ----------------------------------------------------------------
// The checkout action is exercised end-to-end with REAL money math + REAL zod
// validation, but with the DB and the tenant choke point stubbed. We assert
// that the server recomputes totals from DB prices + the business tax rate
// (ignoring any client-sent totals), enforces clientUuid idempotency, and
// writes Order/OrderLine/Payment on the success path.
const requireMembership = vi.fn();
const orderFindUnique = vi.fn();
const businessFindUniqueOrThrow = vi.fn();
const variationFindMany = vi.fn();
const orderCounterUpsert = vi.fn();
const orderCreate = vi.fn();

vi.mock("@/lib/tenant", () => ({
  requireMembership: (...args: unknown[]) => requireMembership(...args),
}));

vi.mock("@/lib/db", () => {
  const tx = {
    orderCounter: { upsert: (...a: unknown[]) => orderCounterUpsert(...a) },
    order: { create: (...a: unknown[]) => orderCreate(...a) },
  };
  return {
    db: {
      order: { findUnique: (...a: unknown[]) => orderFindUnique(...a) },
      business: { findUniqueOrThrow: (...a: unknown[]) => businessFindUniqueOrThrow(...a) },
      variation: { findMany: (...a: unknown[]) => variationFindMany(...a) },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { checkout } from "./actions";
import type { CheckoutInput } from "./schema";

const BUSINESS_ID = "biz_1";
const UUID = "00000000-0000-4000-8000-000000000001";

// A variation row as returned by `findMany` with `include: { item: { name } }`.
function variation(over: Partial<{ id: string; name: string; priceCents: number; itemName: string }> = {}) {
  const { id = "var_1", name = "Default", priceCents = 1000, itemName = "Coffee" } = over;
  return { id, businessId: BUSINESS_ID, name, priceCents, item: { name: itemName } };
}

// Returns a fully-defaulted CheckoutInput (the shape the action receives after
// zod parsing). `over` overrides any field; the action re-parses anyway.
function input(over: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    businessId: BUSINESS_ID,
    clientUuid: UUID,
    lines: [{ variationId: "var_1", quantity: 1 }],
    cashTenderedCents: 5000,
    tipCents: 0,
    cartDiscountCents: 0,
    ...over,
  };
}

// Pull the `data` payload passed to the (single) order.create call. The mock
// is untyped Prisma input, so we read it loosely in assertions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createdOrderData(): Record<string, any> {
  const call = orderCreate.mock.calls.at(0);
  if (!call) throw new Error("order.create was not called");
  return call[0].data;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMembership.mockResolvedValue({
    userId: "user_1",
    businessId: BUSINESS_ID,
    membershipId: "mem_1",
    role: "CASHIER",
  });
  orderFindUnique.mockResolvedValue(null); // no prior order by default
  businessFindUniqueOrThrow.mockResolvedValue({ taxRateBps: 825, taxInclusive: false });
  variationFindMany.mockResolvedValue([variation()]);
  orderCounterUpsert.mockResolvedValue({ lastNumber: 7 });
  // order.create echoes back the persisted totals so toReceipt reflects them.
  orderCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "order_1",
    number: data.number,
    subtotalCents: data.subtotalCents,
    discountCents: data.discountCents,
    taxCents: data.taxCents,
    tipCents: data.tipCents,
    totalCents: data.totalCents,
  }));
});

describe("checkout — tenant isolation", () => {
  it("goes through requireMembership with the input businessId", async () => {
    await checkout(input());
    expect(requireMembership).toHaveBeenCalledWith(BUSINESS_ID);
  });

  it("scopes the variation price lookup by businessId", async () => {
    await checkout(input());
    expect(variationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessId: BUSINESS_ID }),
      }),
    );
  });
});

describe("checkout — server recomputes totals", () => {
  it("uses DB prices + business tax rate, ignoring any client-sent totals", async () => {
    // Client lies about the price/total via extra fields; the server must
    // ignore them (zod strips unknown keys; totals are recomputed from the DB).
    const receipt = await checkout({
      ...input(),
      totalCents: 1,
      subtotalCents: 1,
      taxCents: 0,
    } as CheckoutInput);
    // $10.00 @ 8.25% exclusive => tax 83, total 1083.
    expect(receipt.subtotalCents).toBe(1000);
    expect(receipt.taxCents).toBe(83);
    expect(receipt.totalCents).toBe(1083);
    expect(receipt.discountCents).toBe(0);
  });

  it("recomputes across quantities and lines from real prices", async () => {
    variationFindMany.mockResolvedValue([
      variation({ id: "var_a", priceCents: 999, itemName: "A" }),
      variation({ id: "var_b", priceCents: 199, itemName: "B" }),
    ]);
    const receipt = await checkout(
      input({
        lines: [
          { variationId: "var_a", quantity: 2 },
          { variationId: "var_b", quantity: 2 },
        ],
        cashTenderedCents: 5000,
      }),
    );
    expect(receipt.subtotalCents).toBe(2396);
    expect(receipt.taxCents).toBe(198);
    expect(receipt.totalCents).toBe(2594);
  });

  it("honors the business tax-inclusive flag (embedded tax)", async () => {
    businessFindUniqueOrThrow.mockResolvedValue({ taxRateBps: 825, taxInclusive: true });
    const receipt = await checkout(input());
    expect(receipt.taxCents).toBe(76); // embedded
    expect(receipt.totalCents).toBe(1000); // sticker price, not 1083
  });

  it("computes correct change from the server total", async () => {
    const receipt = await checkout(input({ cashTenderedCents: 2000 }));
    expect(receipt.totalCents).toBe(1083);
    expect(receipt.cashTenderedCents).toBe(2000);
    expect(receipt.changeCents).toBe(917);
  });

  it("rejects when cash tendered is below the server-computed total", async () => {
    await expect(checkout(input({ cashTenderedCents: 1000 }))).rejects.toThrow(
      "Cash tendered is less than the total.",
    );
    expect(orderCreate).not.toHaveBeenCalled();
  });
});

describe("checkout — idempotency", () => {
  it("returns the existing order and writes nothing when clientUuid was already used", async () => {
    orderFindUnique.mockResolvedValue({
      id: "order_existing",
      number: 3,
      subtotalCents: 1000,
      discountCents: 0,
      taxCents: 83,
      tipCents: 0,
      totalCents: 1083,
      payments: [{ tenderedCents: 1200, changeCents: 117 }],
    });

    const receipt = await checkout(input());

    expect(receipt.orderId).toBe("order_existing");
    expect(receipt.number).toBe(3);
    expect(receipt.cashTenderedCents).toBe(1200);
    expect(receipt.changeCents).toBe(117);
    // The duplicate must NOT create a new order.
    expect(orderCreate).not.toHaveBeenCalled();
    expect(variationFindMany).not.toHaveBeenCalled();
    expect(orderFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId_clientUuid: { businessId: BUSINESS_ID, clientUuid: UUID } },
      }),
    );
  });
});

describe("checkout — success path writes Order/OrderLine/Payment", () => {
  it("allocates a number and persists the order graph in one transaction", async () => {
    const receipt = await checkout(
      input({ customerName: "Ada", tipCents: 100, lines: [{ variationId: "var_1", quantity: 2 }] }),
    );

    expect(orderCounterUpsert).toHaveBeenCalledTimes(1);
    expect(orderCreate).toHaveBeenCalledTimes(1);

    const data = createdOrderData();
    // Order header
    expect(data).toMatchObject({
      businessId: BUSINESS_ID,
      clientUuid: UUID,
      number: 7, // from the counter upsert
      status: "PAID",
      customerName: "Ada",
      tipCents: 100,
    });
    // 2 x $10 => subtotal 2000, tax 165, +100 tip => 2265
    expect(data.subtotalCents).toBe(2000);
    expect(data.taxCents).toBe(165);
    expect(data.totalCents).toBe(2265);

    // OrderLine nested write (price snapshot from DB, scoped businessId)
    const line = data.lines.create[0];
    expect(line).toMatchObject({
      businessId: BUSINESS_ID,
      variationId: "var_1",
      nameSnapshot: "Coffee", // "Default" variation collapses to item name
      unitPriceCents: 1000,
      quantity: 2,
      totalCents: 2000,
    });

    // Payment nested write
    expect(data.payments.create).toMatchObject({
      businessId: BUSINESS_ID,
      method: "CASH",
      status: "CAPTURED",
      amountCents: 2265,
      tenderedCents: 5000,
      changeCents: 2735,
    });

    expect(receipt.number).toBe(7);
    expect(receipt.orderId).toBe("order_1");
  });

  it("snapshots a non-Default variation name as 'Item — Variation'", async () => {
    variationFindMany.mockResolvedValue([
      variation({ id: "var_1", name: "Large", itemName: "Latte", priceCents: 1000 }),
    ]);
    await checkout(input());
    expect(createdOrderData().lines.create[0].nameSnapshot).toBe("Latte — Large");
  });

  it("throws when a requested variation does not exist in this business", async () => {
    variationFindMany.mockResolvedValue([]); // price lookup returns nothing
    await expect(checkout(input())).rejects.toThrow("Unknown item: var_1");
    expect(orderCreate).not.toHaveBeenCalled();
  });
});

describe("checkout — input validation", () => {
  it("rejects an invalid payload before any DB access", async () => {
    await expect(checkout(input({ lines: [] }) as never)).rejects.toThrow();
    expect(requireMembership).not.toHaveBeenCalled();
  });
});
