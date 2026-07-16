import { describe, it, expect, beforeEach, vi } from "vitest";

// The public submit + merchant transitions are exercised end-to-end with REAL
// money math (resolveOrderLines + computePricedOrder) and REAL zod validation,
// with the DB, tenant gate, rate limiter, and next/headers|cache stubbed. We
// assert the security controls: enable-gate, IP rate limit, server-authoritative
// pricing, idempotency, tenant scope, input caps, and stock-on-accept.

const rateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => (k === "x-forwarded-for" ? "203.0.113.7" : null) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const requireCapability = vi.fn();
vi.mock("@/lib/operator-guard", () => ({
  requireCapability: (...a: unknown[]) => requireCapability(...a),
}));

const businessFindUnique = vi.fn();
const orderFindUnique = vi.fn();
const orderFindFirst = vi.fn();
const orderCreate = vi.fn();
const orderUpdate = vi.fn();
const orderCounterUpsert = vi.fn();
const variationFindMany = vi.fn();
const variationUpdate = vi.fn();

vi.mock("@/lib/db", () => {
  const tx = {
    orderCounter: { upsert: (...a: unknown[]) => orderCounterUpsert(...a) },
    order: { create: (...a: unknown[]) => orderCreate(...a), update: (...a: unknown[]) => orderUpdate(...a) },
    variation: {
      findMany: (...a: unknown[]) => variationFindMany(...a),
      update: (...a: unknown[]) => variationUpdate(...a),
    },
  };
  return {
    db: {
      business: { findUnique: (...a: unknown[]) => businessFindUnique(...a) },
      order: {
        findUnique: (...a: unknown[]) => orderFindUnique(...a),
        findFirst: (...a: unknown[]) => orderFindFirst(...a),
      },
      variation: { findMany: (...a: unknown[]) => variationFindMany(...a) },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { submitOnlineOrder, transitionOnlineOrder } from "./actions";
import { isOnlineConfirmation, type SubmitOnlineOrderInput } from "./schema";

const BUSINESS_ID = "biz_1";
const UUID = "00000000-0000-4000-8000-000000000001";

// A variation row as returned by resolveOrderLines' findMany (item + groups).
function variation(
  over: Partial<{ id: string; name: string; priceCents: number; itemName: string; trackStock: boolean; groups: unknown[] }> = {},
) {
  const { id = "var_1", name = "Default", priceCents = 1000, itemName = "Coffee", trackStock = false, groups = [] } = over;
  return {
    id,
    businessId: BUSINESS_ID,
    name,
    priceCents,
    item: { name: itemName, trackStock, modifierLinks: (groups as { id: string }[]).map((group) => ({ group })) },
  };
}

function input(over: Partial<SubmitOnlineOrderInput> = {}): SubmitOnlineOrderInput {
  return {
    businessId: BUSINESS_ID,
    clientUuid: UUID,
    lines: [{ variationId: "var_1", quantity: 1 }],
    tipCents: 0,
    ...over,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createdOrderData(): Record<string, any> {
  const call = orderCreate.mock.calls.at(0);
  if (!call) throw new Error("order.create was not called");
  return call[0].data;
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockResolvedValue({ ok: true, remaining: 7, resetSeconds: 60 });
  businessFindUnique.mockResolvedValue({
    onlineOrderingEnabled: true,
    taxRateBps: 825,
    taxInclusive: false,
  });
  orderFindUnique.mockResolvedValue(null);
  variationFindMany.mockResolvedValue([variation()]);
  orderCounterUpsert.mockResolvedValue({ lastNumber: 5 });
  variationUpdate.mockResolvedValue({});
  orderCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "order_1",
    number: data.number,
    totalCents: data.totalCents,
  }));
});

describe("submitOnlineOrder — enable-gate", () => {
  it("rejects when the business has online ordering disabled", async () => {
    businessFindUnique.mockResolvedValue({ onlineOrderingEnabled: false, taxRateBps: 0, taxInclusive: false });
    const result = await submitOnlineOrder(input());
    expect(result).toEqual({ error: "unavailable" });
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it("rejects when the business does not exist", async () => {
    businessFindUnique.mockResolvedValue(null);
    expect(await submitOnlineOrder(input())).toEqual({ error: "unavailable" });
    expect(orderCreate).not.toHaveBeenCalled();
  });
});

describe("submitOnlineOrder — IP rate limit", () => {
  it("rejects when the limiter is exhausted, before any DB work", async () => {
    rateLimit.mockResolvedValue({ ok: false, remaining: 0, resetSeconds: 60 });
    const result = await submitOnlineOrder(input());
    expect(result).toEqual({ error: "rate_limited" });
    expect(businessFindUnique).not.toHaveBeenCalled();
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it("keys the limiter by businessId + caller IP", async () => {
    await submitOnlineOrder(input());
    expect(rateLimit).toHaveBeenCalledWith(
      `online-submit:${BUSINESS_ID}:203.0.113.7`,
      expect.objectContaining({ limit: expect.any(Number), windowSeconds: expect.any(Number) }),
    );
  });
});

describe("submitOnlineOrder — server-authoritative pricing", () => {
  it("recomputes totals from DB prices + business tax (client sends no money)", async () => {
    const result = await submitOnlineOrder(input({ lines: [{ variationId: "var_1", quantity: 2 }] }));
    if (!isOnlineConfirmation(result)) throw new Error("expected confirmation");
    // 2 x $10 @ 8.25% => subtotal 2000, tax 165, total 2165.
    expect(result.totalCents).toBe(2165);
    expect(createdOrderData().subtotalCents).toBe(2000);
    expect(createdOrderData().taxCents).toBe(165);
  });

  it("re-looks-up modifier prices and folds them into tax (ignores client names/prices)", async () => {
    const group = {
      id: "grp_milk",
      minSelect: 0,
      maxSelect: 2,
      modifiers: [{ id: "mod_oat", name: "Oat milk", priceDeltaCents: 75 }],
    };
    variationFindMany.mockResolvedValue([variation({ groups: [group] })]);
    const result = await submitOnlineOrder(
      input({ lines: [{ variationId: "var_1", quantity: 1, modifierIds: ["mod_oat"] }] }),
    );
    if (!isOnlineConfirmation(result)) throw new Error("expected confirmation");
    // (1000 + 75) = 1075 @ 8.25% => tax 89, total 1164.
    expect(result.totalCents).toBe(1164);
  });

  it("returns `invalid` for an unknown/foreign item (leaks nothing, writes nothing)", async () => {
    variationFindMany.mockResolvedValue([]); // price lookup finds nothing
    expect(await submitOnlineOrder(input())).toEqual({ error: "invalid" });
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it("returns `invalid` for a modifier not linked to the item", async () => {
    variationFindMany.mockResolvedValue([variation()]); // no groups
    const result = await submitOnlineOrder(
      input({ lines: [{ variationId: "var_1", quantity: 1, modifierIds: ["mod_evil"] }] }),
    );
    expect(result).toEqual({ error: "invalid" });
    expect(orderCreate).not.toHaveBeenCalled();
  });
});

describe("submitOnlineOrder — tenant scope", () => {
  it("scopes the variation lookup + created order to the input businessId", async () => {
    await submitOnlineOrder(input());
    expect(variationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: BUSINESS_ID }) }),
    );
    expect(createdOrderData().businessId).toBe(BUSINESS_ID);
  });
});

describe("submitOnlineOrder — order shape", () => {
  it("creates an OPEN, ONLINE, SUBMITTED, unpaid, cashier-less order with no payment", async () => {
    await submitOnlineOrder(input({ customerName: "Ada", customerPhone: "555-1212" }));
    const data = createdOrderData();
    expect(data).toMatchObject({
      status: "OPEN",
      channel: "ONLINE",
      onlineStatus: "SUBMITTED",
      cashierId: null,
      customerName: "Ada",
      customerPhone: "555-1212",
    });
    // Unpaid: no payment is written at submit.
    expect(data.payments).toBeUndefined();
  });

  it("does NOT decrement stock at submit (deferred to accept)", async () => {
    variationFindMany.mockResolvedValue([variation({ trackStock: true })]);
    await submitOnlineOrder(input({ lines: [{ variationId: "var_1", quantity: 3 }] }));
    expect(variationUpdate).not.toHaveBeenCalled();
  });
});

describe("submitOnlineOrder — idempotency", () => {
  it("returns the existing order for a repeated clientUuid without creating another", async () => {
    orderFindUnique.mockResolvedValue({ id: "order_existing", number: 3, totalCents: 1083 });
    const result = await submitOnlineOrder(input());
    if (!isOnlineConfirmation(result)) throw new Error("expected confirmation");
    expect(result.orderId).toBe("order_existing");
    expect(result.number).toBe(3);
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it("returns the winner on a concurrent P2002 insert race", async () => {
    orderFindUnique
      .mockResolvedValueOnce(null) // pre-check
      .mockResolvedValueOnce({ id: "order_winner", number: 9, totalCents: 1083 }); // re-read
    orderCreate.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    const result = await submitOnlineOrder(input());
    if (!isOnlineConfirmation(result)) throw new Error("expected confirmation");
    expect(result.orderId).toBe("order_winner");
  });
});

describe("submitOnlineOrder — input caps (zod)", () => {
  it("rejects an empty cart before any DB access", async () => {
    await expect(submitOnlineOrder(input({ lines: [] }))).rejects.toThrow();
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid clientUuid", async () => {
    await expect(submitOnlineOrder(input({ clientUuid: "not-a-uuid" }))).rejects.toThrow();
  });

  it("rejects an over-cap quantity", async () => {
    await expect(
      submitOnlineOrder(input({ lines: [{ variationId: "var_1", quantity: 1000 }] })),
    ).rejects.toThrow();
  });
});

// ── Merchant transitions ──────────────────────────────────────────────────────

function order(over: Partial<{ onlineStatus: string; lines: { variationId: string; quantity: number }[] }> = {}) {
  const { onlineStatus = "SUBMITTED", lines = [{ variationId: "var_1", quantity: 2 }] } = over;
  return { id: "order_1", onlineStatus, lines };
}

describe("transitionOnlineOrder — gating + tenant scope", () => {
  beforeEach(() => {
    requireCapability.mockResolvedValue({ businessId: BUSINESS_ID, membershipId: "mem_1", role: "CASHIER", permissions: ["take_orders"] });
    orderFindFirst.mockResolvedValue(order());
    variationFindMany.mockResolvedValue([{ id: "var_1", item: { trackStock: false } }]);
  });

  it("gates on take_orders for the businessId", async () => {
    await transitionOnlineOrder({ businessId: BUSINESS_ID, orderId: "order_1", action: "accept" });
    expect(requireCapability).toHaveBeenCalledWith(BUSINESS_ID, "take_orders");
  });

  it("scopes the ownership lookup to businessId + ONLINE channel", async () => {
    await transitionOnlineOrder({ businessId: BUSINESS_ID, orderId: "order_1", action: "accept" });
    expect(orderFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "order_1", businessId: BUSINESS_ID, channel: "ONLINE" }),
      }),
    );
  });

  it("throws when the order isn't found in this business", async () => {
    orderFindFirst.mockResolvedValue(null);
    await expect(
      transitionOnlineOrder({ businessId: BUSINESS_ID, orderId: "x", action: "accept" }),
    ).rejects.toThrow("not found");
  });
});

describe("transitionOnlineOrder — transitions + stock", () => {
  beforeEach(() => {
    requireCapability.mockResolvedValue({ businessId: BUSINESS_ID, membershipId: "mem_1", role: "MANAGER", permissions: ["take_orders"] });
  });

  it("accept → ACCEPTED and decrements tracked stock", async () => {
    orderFindFirst.mockResolvedValue(order({ onlineStatus: "SUBMITTED" }));
    variationFindMany.mockResolvedValue([{ id: "var_1", item: { trackStock: true } }]);
    await transitionOnlineOrder({ businessId: BUSINESS_ID, orderId: "order_1", action: "accept" });
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ onlineStatus: "ACCEPTED" }) }),
    );
    expect(variationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "var_1" }, data: { stock: { decrement: 2 } } }),
    );
  });

  it("accept does NOT decrement an untracked item", async () => {
    orderFindFirst.mockResolvedValue(order({ onlineStatus: "SUBMITTED" }));
    variationFindMany.mockResolvedValue([{ id: "var_1", item: { trackStock: false } }]);
    await transitionOnlineOrder({ businessId: BUSINESS_ID, orderId: "order_1", action: "accept" });
    expect(variationUpdate).not.toHaveBeenCalled();
  });

  it("reject from SUBMITTED → REJECTED + VOIDED, no restock (never decremented)", async () => {
    orderFindFirst.mockResolvedValue(order({ onlineStatus: "SUBMITTED" }));
    variationFindMany.mockResolvedValue([{ id: "var_1", item: { trackStock: true } }]);
    await transitionOnlineOrder({ businessId: BUSINESS_ID, orderId: "order_1", action: "reject" });
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ onlineStatus: "REJECTED", status: "VOIDED" }) }),
    );
    expect(variationUpdate).not.toHaveBeenCalled();
  });

  it("reject from ACCEPTED → REJECTED + VOIDED and RESTOCKS", async () => {
    orderFindFirst.mockResolvedValue(order({ onlineStatus: "ACCEPTED" }));
    variationFindMany.mockResolvedValue([{ id: "var_1", item: { trackStock: true } }]);
    await transitionOnlineOrder({ businessId: BUSINESS_ID, orderId: "order_1", action: "reject" });
    expect(variationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "var_1" }, data: { stock: { increment: 2 } } }),
    );
  });

  it("ready + complete move status without touching stock", async () => {
    orderFindFirst.mockResolvedValue(order({ onlineStatus: "ACCEPTED" }));
    variationFindMany.mockResolvedValue([{ id: "var_1", item: { trackStock: true } }]);
    await transitionOnlineOrder({ businessId: BUSINESS_ID, orderId: "order_1", action: "ready" });
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ onlineStatus: "READY" }) }),
    );
    expect(variationUpdate).not.toHaveBeenCalled();
  });

  it("throws on an invalid transition (complete from SUBMITTED)", async () => {
    orderFindFirst.mockResolvedValue(order({ onlineStatus: "SUBMITTED" }));
    await expect(
      transitionOnlineOrder({ businessId: BUSINESS_ID, orderId: "order_1", action: "complete" }),
    ).rejects.toThrow("Cannot complete");
    expect(orderUpdate).not.toHaveBeenCalled();
  });
});
