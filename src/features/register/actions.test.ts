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

// The manager-approval PIN verification is exercised in its own unit test
// (manager-approval.test.ts) against a stubbed membership/throttle. Here we stub
// the verifier so the gate logic in `checkout` is tested in isolation: it decides
// WHEN to require approval (unverified tender + operator can't approve) and how it
// reacts to a valid/invalid PIN.
const verifyManagerApproval = vi.fn();
vi.mock("./manager-approval", () => ({
  APPROVE_UNVERIFIED_TENDER: "approve_unverified_tender",
  verifyManagerApproval: (...args: unknown[]) => verifyManagerApproval(...args),
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
import { isReceipt, type CheckoutInput, type Receipt } from "./schema";

// Most tests expect the sale to COMPLETE (a Receipt). This runs checkout and
// asserts it wasn't a manager-approval rejection, narrowing the union so the
// existing receipt-property assertions type-check. The manager-gate tests below
// call `checkout` directly to inspect the rejection branch.
async function checkoutReceipt(input: CheckoutInput): Promise<Receipt> {
  const result = await checkout(input);
  if (!isReceipt(result)) {
    throw new Error(`expected a Receipt, got rejection: ${result.error}`);
  }
  return result;
}

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
  verifyManagerApproval.mockResolvedValue(false); // default: no PIN authorizes
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
    const receipt = await checkoutReceipt({
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
    const receipt = await checkoutReceipt(
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
    const receipt = await checkoutReceipt(input());
    expect(receipt.taxCents).toBe(76); // embedded
    expect(receipt.totalCents).toBe(1000); // sticker price, not 1083
  });

  it("computes correct change from the server total", async () => {
    const receipt = await checkoutReceipt(input({ cashTenderedCents: 2000 }));
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

    const receipt = await checkoutReceipt(input());

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

    const receipt = await checkoutReceipt(input());

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
    const receipt = await checkoutReceipt(
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
    const receipt = await checkoutReceipt(
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
  // These verify the RECORDING mechanics of an unverified tender, not the gate,
  // so the operator here HOLDS approve_unverified_tender (an owner/manager rings
  // their own sale → no friction). The gate itself is covered in its own block.
  beforeEach(() => {
    requireCapability.mockResolvedValue({
      businessId: BUSINESS_ID,
      membershipId: "mem_mgr",
      role: "MANAGER",
      permissions: ["take_orders", "approve_unverified_tender"],
      name: "Manager",
      deviceMembershipId: "mem_mgr",
    });
  });

  it("records a MANUAL payment with no tender/change and a reference note", async () => {
    const receipt = await checkoutReceipt(
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
    const receipt = await checkoutReceipt(input({ method: "MANUAL", cashTenderedCents: 0 }));
    expect(receipt.method).toBe("MANUAL");
    expect(orderCreate).toHaveBeenCalledTimes(1);
  });

  it("stores a null reference when the note is blank/whitespace", async () => {
    await checkout(input({ method: "MANUAL", manualNote: "   ", cashTenderedCents: 0 }));
    expect(createdOrderData().payments.create.processorRef).toBeNull();
  });

  it("records a QR payment like a confirmed external tender (no cash/change)", async () => {
    const receipt = await checkoutReceipt(
      input({ method: "QR", manualNote: "txn-9", cashTenderedCents: 0 }),
    );
    expect(receipt.method).toBe("QR");
    expect(receipt.cashTenderedCents).toBe(0);
    expect(receipt.changeCents).toBe(0);
    expect(createdOrderData().payments.create).toMatchObject({
      method: "QR",
      status: "CAPTURED",
      amountCents: 1083,
      tenderedCents: null,
      changeCents: null,
      processorRef: "txn-9",
    });
  });
});

describe("checkout — offline price snapshot (bounded trust relaxation)", () => {
  const QUOTED = 800; // what the customer was quoted offline
  const CURRENT = 1500; // what the catalog says NOW (price went up post-sale)

  it("records the QUOTED total from the snapshot even when the current DB price differs", async () => {
    // Catalog price moved to $15 after the offline sale; the snapshot quoted $8.
    variationFindMany.mockResolvedValue([variation({ priceCents: CURRENT })]);
    const receipt = await checkoutReceipt(
      input({
        priceSnapshot: { quoted: true, lines: [{ unitPriceCents: QUOTED }] },
        cashTenderedCents: 1000,
      }),
    );
    // Must reflect the QUOTED $8.00 @ 8.25% (tax 66, total 866), NOT $15.
    expect(receipt.subtotalCents).toBe(QUOTED);
    expect(receipt.taxCents).toBe(66);
    expect(receipt.totalCents).toBe(866);
    // The persisted line stores the quoted unit price, not the current catalog.
    expect(createdOrderData().lines.create[0].unitPriceCents).toBe(QUOTED);
  });

  it("recomputes tax FROM the snapshot prices (not from the snapshot's own total)", async () => {
    businessFindUniqueOrThrow.mockResolvedValue({ taxRateBps: 1000, taxInclusive: false });
    variationFindMany.mockResolvedValue([variation({ priceCents: CURRENT })]);
    const receipt = await checkoutReceipt(
      input({
        priceSnapshot: { quoted: true, lines: [{ unitPriceCents: QUOTED }] },
        cashTenderedCents: 1000,
      }),
    );
    // $8.00 @ 10% => tax 80, total 880 — tax derived from the snapshot price.
    expect(receipt.subtotalCents).toBe(800);
    expect(receipt.taxCents).toBe(80);
    expect(receipt.totalCents).toBe(880);
  });

  it("trusts the quoted modifier delta but still validates the modifier is linked", async () => {
    const group: TestGroup = {
      id: "grp_milk",
      minSelect: 0,
      maxSelect: 2,
      modifiers: [{ id: "mod_oat", name: "Oat milk", priceDeltaCents: 75 }],
    };
    // Catalog: base $15, oat +$2 now; snapshot quoted base $8, oat +$0.50.
    variationFindMany.mockResolvedValue([variation({ priceCents: CURRENT, groups: [group] })]);
    const receipt = await checkoutReceipt(
      input({
        lines: [{ variationId: "var_1", quantity: 1, modifierIds: ["mod_oat"] }],
        priceSnapshot: {
          quoted: true,
          lines: [{ unitPriceCents: 800, modifierDeltas: { mod_oat: 50 } }],
        },
        cashTenderedCents: 1000,
      }),
    );
    // (800 + 50) = 850 @ 8.25% => tax 70, total 920 — quoted prices, not catalog.
    expect(receipt.subtotalCents).toBe(850);
    expect(receipt.taxCents).toBe(70);
    expect(receipt.totalCents).toBe(920);
    // The snapshotted modifier delta is persisted (faithful to what was quoted).
    expect(createdOrderData().lines.create[0].modifiers.create).toEqual([
      { nameSnapshot: "Oat milk", priceDeltaCents: 50 },
    ]);
  });

  it("still rejects a snapshotted modifier that is not linked to the item", async () => {
    variationFindMany.mockResolvedValue([variation({ priceCents: CURRENT })]); // no groups
    await expect(
      checkout(
        input({
          lines: [{ variationId: "var_1", quantity: 1, modifierIds: ["mod_evil"] }],
          priceSnapshot: {
            quoted: true,
            lines: [{ unitPriceCents: 800, modifierDeltas: { mod_evil: 50 } }],
          },
          cashTenderedCents: 1000,
        }),
      ),
    ).rejects.toThrow("Unknown modifier");
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it("ignores the snapshot when its line count does not match (fail safe = catalog price)", async () => {
    // Two cart lines but a one-line snapshot => not index-aligned, so it's dropped
    // and BOTH lines fall back to the authoritative catalog price.
    variationFindMany.mockResolvedValue([
      variation({ id: "var_a", priceCents: 1000, itemName: "A" }),
      variation({ id: "var_b", priceCents: 1000, itemName: "B" }),
    ]);
    const receipt = await checkoutReceipt(
      input({
        lines: [
          { variationId: "var_a", quantity: 1 },
          { variationId: "var_b", quantity: 1 },
        ],
        priceSnapshot: { quoted: true, lines: [{ unitPriceCents: 1 }] },
        cashTenderedCents: 5000,
      }),
    );
    // Catalog $10 + $10 = 2000 (snapshot's bogus $0.01 ignored).
    expect(receipt.subtotalCents).toBe(2000);
  });

  it("ONLINE path is unchanged: with no snapshot it recomputes from the current DB price", async () => {
    variationFindMany.mockResolvedValue([variation({ priceCents: CURRENT })]);
    const receipt = await checkoutReceipt(input({ cashTenderedCents: 2000 }));
    // No snapshot => authoritative catalog $15.00 @ 8.25% => tax 124, total 1624.
    expect(receipt.subtotalCents).toBe(CURRENT);
    expect(receipt.taxCents).toBe(124);
    expect(receipt.totalCents).toBe(1624);
    expect(createdOrderData().lines.create[0].unitPriceCents).toBe(CURRENT);
  });

  it("rejects a negative snapshot price via zod before any DB access", async () => {
    await expect(
      checkout(
        input({
          priceSnapshot: { quoted: true, lines: [{ unitPriceCents: -100 }] },
        } as never),
      ),
    ).rejects.toThrow();
    expect(requireCapability).not.toHaveBeenCalled();
  });
});

describe("checkout — manager-approval gate for unverified tenders", () => {
  // Operator fixtures.
  function asCashier() {
    requireCapability.mockResolvedValue({
      businessId: BUSINESS_ID,
      membershipId: "mem_cashier",
      role: "CASHIER",
      permissions: ["take_orders"], // NO approve_unverified_tender
      name: "Cashier",
      deviceMembershipId: "mem_cashier",
    });
  }
  function asManager() {
    requireCapability.mockResolvedValue({
      businessId: BUSINESS_ID,
      membershipId: "mem_mgr",
      role: "MANAGER",
      permissions: ["take_orders", "approve_unverified_tender"],
      name: "Manager",
      deviceMembershipId: "mem_mgr",
    });
  }
  function asOwner() {
    requireCapability.mockResolvedValue({
      businessId: BUSINESS_ID,
      membershipId: "mem_owner",
      role: "OWNER",
      permissions: [], // OWNER is all-access in code regardless of stored perms
      name: "Owner",
      deviceMembershipId: "mem_owner",
    });
  }

  describe("operator HOLDS the capability → no friction", () => {
    it("manager rings a QR sale with no PIN and it completes", async () => {
      asManager();
      const result = await checkout(input({ method: "QR", cashTenderedCents: 0 }));
      expect(isReceipt(result)).toBe(true);
      expect(orderCreate).toHaveBeenCalledTimes(1);
      expect(verifyManagerApproval).not.toHaveBeenCalled();
    });

    it("owner rings an Other/MANUAL sale with no PIN and it completes", async () => {
      asOwner();
      const result = await checkout(input({ method: "MANUAL", cashTenderedCents: 0 }));
      expect(isReceipt(result)).toBe(true);
      expect(orderCreate).toHaveBeenCalledTimes(1);
      expect(verifyManagerApproval).not.toHaveBeenCalled();
    });
  });

  describe("operator LACKS the capability (a cashier)", () => {
    it("blocks a QR sale with no manager PIN (manager_approval_required, nothing written)", async () => {
      asCashier();
      const result = await checkout(input({ method: "QR", cashTenderedCents: 0 }));
      expect(result).toEqual({ error: "manager_approval_required" });
      expect(orderCreate).not.toHaveBeenCalled();
      // We never even tried to verify a (missing) PIN.
      expect(verifyManagerApproval).not.toHaveBeenCalled();
    });

    it("blocks an Other/MANUAL sale with no manager PIN", async () => {
      asCashier();
      const result = await checkout(input({ method: "MANUAL", cashTenderedCents: 0 }));
      expect(result).toEqual({ error: "manager_approval_required" });
      expect(orderCreate).not.toHaveBeenCalled();
    });

    it("rejects an INVALID/foreign manager PIN (invalid_manager_pin, nothing written)", async () => {
      asCashier();
      verifyManagerApproval.mockResolvedValue(false); // PIN matches no capability-holder
      const result = await checkout(
        input({ method: "QR", cashTenderedCents: 0, managerPin: "0000" }),
      );
      expect(result).toEqual({ error: "invalid_manager_pin" });
      expect(verifyManagerApproval).toHaveBeenCalledWith(BUSINESS_ID, "0000");
      expect(orderCreate).not.toHaveBeenCalled();
    });

    it("authorizes with a VALID manager PIN and completes the sale", async () => {
      asCashier();
      verifyManagerApproval.mockResolvedValue(true); // PIN held by a capability-holder
      const result = await checkout(
        input({ method: "MANUAL", manualNote: "Zelle", cashTenderedCents: 0, managerPin: "4321" }),
      );
      expect(isReceipt(result)).toBe(true);
      expect(verifyManagerApproval).toHaveBeenCalledWith(BUSINESS_ID, "4321");
      expect(orderCreate).toHaveBeenCalledTimes(1);
    });

    it("attributes the authorized sale to the CASHIER, not the approving manager", async () => {
      asCashier();
      verifyManagerApproval.mockResolvedValue(true);
      await checkout(input({ method: "QR", cashTenderedCents: 0, managerPin: "4321" }));
      // cashierId is the operator who rang it (the cashier), unchanged by approval.
      expect(createdOrderData().cashierId).toBe("mem_cashier");
    });
  });

  describe("CASH is never gated", () => {
    it("a cashier completes a CASH sale with no PIN and no approval check", async () => {
      asCashier();
      const result = await checkout(input({ method: "CASH", cashTenderedCents: 5000 }));
      expect(isReceipt(result)).toBe(true);
      expect(verifyManagerApproval).not.toHaveBeenCalled();
      expect(orderCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe("offline replay is exempt (already rung + collected)", () => {
    it("a cashier's QR sale carrying a quoted snapshot replays without approval", async () => {
      asCashier();
      const result = await checkout(
        input({
          method: "QR",
          cashTenderedCents: 0,
          priceSnapshot: { quoted: true, lines: [{ unitPriceCents: 1000 }] },
        }),
      );
      expect(isReceipt(result)).toBe(true);
      expect(verifyManagerApproval).not.toHaveBeenCalled();
      expect(orderCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe("idempotency wins before the gate", () => {
    it("returns the existing order for a duplicate clientUuid without requiring approval", async () => {
      asCashier();
      orderFindUnique.mockResolvedValue({
        id: "order_existing",
        number: 3,
        subtotalCents: 1000,
        discountCents: 0,
        taxCents: 83,
        tipCents: 0,
        totalCents: 1083,
        payments: [{ method: "QR", tenderedCents: null, changeCents: null, processorRef: "ref" }],
      });
      const result = await checkout(input({ method: "QR", cashTenderedCents: 0 }));
      expect(isReceipt(result)).toBe(true);
      expect(verifyManagerApproval).not.toHaveBeenCalled();
      expect(orderCreate).not.toHaveBeenCalled();
    });
  });
});

describe("checkout — input validation", () => {
  it("rejects an invalid payload before any DB access", async () => {
    await expect(checkout(input({ lines: [] }) as never)).rejects.toThrow();
    expect(requireCapability).not.toHaveBeenCalled();
  });
});
