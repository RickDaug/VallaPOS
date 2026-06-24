import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Mocks ----------------------------------------------------------------
// The checkout action is exercised end-to-end with REAL money math + REAL zod
// validation, but with the DB and the tenant choke point stubbed. We assert
// that the server recomputes totals from DB prices + the business tax rate
// (ignoring any client-sent totals), enforces clientUuid idempotency, and
// writes Order/OrderLine/Payment on the success path.
const requireCapability = vi.fn();
const orderFindUnique = vi.fn();
const businessFindUniqueOrThrow = vi.fn();
const variationFindMany = vi.fn();
const orderCounterUpsert = vi.fn();
const orderCreate = vi.fn();

// checkout now gates on the active operator's capability; the operator's
// membershipId is the cashierId. Mock the gate to return a fixed operator.
vi.mock("@/lib/operator-guard", () => ({
  requireCapability: (...args: unknown[]) => requireCapability(...args),
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

// A modifier group as returned nested under item.modifierLinks[].group.
type TestGroup = {
  id: string;
  minSelect: number;
  maxSelect: number;
  modifiers: { id: string; name: string; priceDeltaCents: number }[];
};

// A variation row as returned by `findMany` with the item + modifier groups
// included. `groups` are the item's linked modifier groups (default: none).
function variation(
  over: Partial<{
    id: string;
    name: string;
    priceCents: number;
    itemName: string;
    groups: TestGroup[];
  }> = {},
) {
  const { id = "var_1", name = "Default", priceCents = 1000, itemName = "Coffee", groups = [] } = over;
  return {
    id,
    businessId: BUSINESS_ID,
    name,
    priceCents,
    item: { name: itemName, modifierLinks: groups.map((group) => ({ group })) },
  };
}

// Returns a fully-defaulted CheckoutInput (the shape the action receives after
// zod parsing). `over` overrides any field; the action re-parses anyway.
function input(over: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    businessId: BUSINESS_ID,
    clientUuid: UUID,
    lines: [{ variationId: "var_1", quantity: 1 }],
    method: "CASH",
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
  requireCapability.mockResolvedValue({
    businessId: BUSINESS_ID,
    membershipId: "mem_1",
    role: "CASHIER",
    permissions: ["take_orders"],
    name: "Cashier",
    deviceMembershipId: "mem_1",
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
  it("gates on take_orders for the input businessId (operator attribution)", async () => {
    await checkout(input());
    expect(requireCapability).toHaveBeenCalledWith(BUSINESS_ID, "take_orders");
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

  it("returns the existing receipt when a concurrent send loses the insert race (P2002)", async () => {
    // The fast-path pre-check sees no prior order (both racers passed it), but the
    // create loses the @@unique([businessId, clientUuid]) race and throws P2002.
    // The action must catch it, re-read the winner, and return its receipt — not
    // surface an unhandled error to the offline double-send.
    orderFindUnique
      .mockResolvedValueOnce(null) // pre-check: nothing yet
      .mockResolvedValueOnce({
        // re-read after P2002: the winning concurrent order
        id: "order_winner",
        number: 9,
        subtotalCents: 1000,
        discountCents: 0,
        taxCents: 83,
        tipCents: 0,
        totalCents: 1083,
        payments: [{ tenderedCents: 1500, changeCents: 417 }],
      });
    orderCreate.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const receipt = await checkout(input());

    // No throw; the loser gets the winner's receipt (idempotent).
    expect(receipt.orderId).toBe("order_winner");
    expect(receipt.number).toBe(9);
    expect(receipt.cashTenderedCents).toBe(1500);
    expect(receipt.changeCents).toBe(417);
    expect(receipt.totalCents).toBe(1083);
    // The create was attempted (race), then the re-read happened (2nd findUnique).
    expect(orderCreate).toHaveBeenCalledTimes(1);
    expect(orderFindUnique).toHaveBeenCalledTimes(2);
    expect(orderFindUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { businessId_clientUuid: { businessId: BUSINESS_ID, clientUuid: UUID } },
      }),
    );
  });

  it("rethrows a non-P2002 transaction error (does not swallow real failures)", async () => {
    orderCreate.mockRejectedValueOnce(new Error("connection reset"));
    await expect(checkout(input())).rejects.toThrow("connection reset");
    // Only the pre-check read; no re-read on a non-unique error.
    expect(orderFindUnique).toHaveBeenCalledTimes(1);
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
      cashierId: "mem_1", // the signed-in member who rang the sale (R-11)
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

describe("checkout — modifiers + per-line tax", () => {
  const group: TestGroup = {
    id: "grp_milk",
    minSelect: 0,
    maxSelect: 2,
    modifiers: [
      { id: "mod_oat", name: "Oat milk", priceDeltaCents: 75 },
      { id: "mod_soy", name: "Soy milk", priceDeltaCents: 50 },
    ],
  };

  it("re-looks-up modifier prices from the DB and folds them into the taxable base", async () => {
    variationFindMany.mockResolvedValue([variation({ groups: [group] })]);
    // Client lies about the modifier price; the server ignores client prices.
    const receipt = await checkout(
      input({ lines: [{ variationId: "var_1", quantity: 1, modifierIds: ["mod_oat"] }] }),
    );
    // (1000 + 75) = 1075; tax @ 8.25% = round(88.6875) = 89; total 1164
    expect(receipt.subtotalCents).toBe(1075);
    expect(receipt.taxCents).toBe(89);
    expect(receipt.totalCents).toBe(1164);
  });

  it("snapshots each chosen modifier on the order line and sets per-line tax", async () => {
    variationFindMany.mockResolvedValue([variation({ groups: [group] })]);
    await checkout(
      input({ lines: [{ variationId: "var_1", quantity: 1, modifierIds: ["mod_oat", "mod_soy"] }] }),
    );
    const line = createdOrderData().lines.create[0];
    // (1000 + 75 + 50) = 1125; tax = round(92.8125) = 93
    expect(line.taxCents).toBe(93);
    expect(line.totalCents).toBe(1125);
    expect(line.modifiers.create).toEqual([
      { nameSnapshot: "Oat milk", priceDeltaCents: 75 },
      { nameSnapshot: "Soy milk", priceDeltaCents: 50 },
    ]);
  });

  it("reconciles order tax with the sum of per-line taxes", async () => {
    variationFindMany.mockResolvedValue([
      variation({ id: "var_a", priceCents: 1000, itemName: "A", groups: [group] }),
      variation({ id: "var_b", priceCents: 199, itemName: "B" }),
    ]);
    await checkout(
      input({
        lines: [
          { variationId: "var_a", quantity: 2, modifierIds: ["mod_oat"] },
          { variationId: "var_b", quantity: 3 },
        ],
      }),
    );
    const data = createdOrderData();
    const sumLineTax = data.lines.create.reduce(
      (s: number, l: { taxCents: number }) => s + l.taxCents,
      0,
    );
    expect(data.taxCents).toBe(sumLineTax);
  });

  it("rejects a modifier that is not linked to the item (foreign / unknown id)", async () => {
    variationFindMany.mockResolvedValue([variation({ groups: [group] })]);
    await expect(
      checkout(input({ lines: [{ variationId: "var_1", quantity: 1, modifierIds: ["mod_evil"] }] })),
    ).rejects.toThrow("Unknown modifier");
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it("rejects when a required group's minSelect is not met", async () => {
    const required: TestGroup = { ...group, id: "grp_req", minSelect: 1, maxSelect: 1 };
    variationFindMany.mockResolvedValue([variation({ groups: [required] })]);
    await expect(
      checkout(input({ lines: [{ variationId: "var_1", quantity: 1, modifierIds: [] }] })),
    ).rejects.toThrow();
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it("rejects when more than maxSelect modifiers are chosen", async () => {
    const single: TestGroup = { ...group, id: "grp_one", minSelect: 0, maxSelect: 1 };
    variationFindMany.mockResolvedValue([variation({ groups: [single] })]);
    await expect(
      checkout(
        input({ lines: [{ variationId: "var_1", quantity: 1, modifierIds: ["mod_oat", "mod_soy"] }] }),
      ),
    ).rejects.toThrow();
    expect(orderCreate).not.toHaveBeenCalled();
  });
});

describe("checkout — MANUAL / Other tender", () => {
  it("records a MANUAL payment with no tender/change and a reference note", async () => {
    const receipt = await checkout(
      input({ method: "MANUAL", manualNote: "Check #12", cashTenderedCents: 0 }),
    );

    // $10 @ 8.25% => 1083; the manual payment captures exactly the total.
    expect(receipt.method).toBe("MANUAL");
    expect(receipt.totalCents).toBe(1083);
    expect(receipt.cashTenderedCents).toBe(0);
    expect(receipt.changeCents).toBe(0);
    expect(receipt.manualNote).toBe("Check #12");

    expect(createdOrderData().payments.create).toMatchObject({
      businessId: BUSINESS_ID,
      method: "MANUAL",
      status: "CAPTURED",
      amountCents: 1083,
      tenderedCents: null,
      changeCents: null,
      processorRef: "Check #12",
    });
  });

  it("does NOT require cash to cover the total for a MANUAL tender", async () => {
    // cashTenderedCents below the total would reject a CASH sale; MANUAL ignores it.
    const receipt = await checkout(input({ method: "MANUAL", cashTenderedCents: 0 }));
    expect(receipt.method).toBe("MANUAL");
    expect(orderCreate).toHaveBeenCalledTimes(1);
  });

  it("stores a null reference when the note is blank/whitespace", async () => {
    await checkout(input({ method: "MANUAL", manualNote: "   ", cashTenderedCents: 0 }));
    expect(createdOrderData().payments.create.processorRef).toBeNull();
  });
});

describe("checkout — input validation", () => {
  it("rejects an invalid payload before any DB access", async () => {
    await expect(checkout(input({ lines: [] }) as never)).rejects.toThrow();
    expect(requireCapability).not.toHaveBeenCalled();
  });
});
