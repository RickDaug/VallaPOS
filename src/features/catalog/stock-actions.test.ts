import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for the inventory write actions — the DB + capability choke point are
 * stubbed so we exercise the REAL orchestration: the manage_products gate, the
 * tenant-scoped ownership check before every write, the null→0 seeding when
 * tracking is enabled, absolute-set clamping, and the >= 0 floor on a manual
 * adjust. Prisma is mocked (there is no DB under vitest).
 */

const requireCapability = vi.fn();
const itemFindFirst = vi.fn();
const itemUpdate = vi.fn();
const variationFindFirst = vi.fn();
const variationUpdateMany = vi.fn();
const variationUpdateManyTx = vi.fn();

vi.mock("@/lib/operator-guard", () => ({
  requireCapability: (...args: unknown[]) => requireCapability(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/db", () => {
  const tx = {
    item: { update: (...a: unknown[]) => itemUpdate(...a) },
    variation: { updateMany: (...a: unknown[]) => variationUpdateManyTx(...a) },
  };
  return {
    db: {
      item: { findFirst: (...a: unknown[]) => itemFindFirst(...a) },
      variation: {
        findFirst: (...a: unknown[]) => variationFindFirst(...a),
        updateMany: (...a: unknown[]) => variationUpdateMany(...a),
      },
      $transaction: (fn: (t: typeof tx) => Promise<void>) => fn(tx),
    },
  };
});

import {
  setItemStockTracking,
  setVariationStock,
  adjustVariationStock,
} from "./actions";

const BIZ = "biz_1";

beforeEach(() => {
  vi.clearAllMocks();
  requireCapability.mockResolvedValue({ businessId: BIZ });
  itemFindFirst.mockResolvedValue({ id: "item_1" });
  itemUpdate.mockResolvedValue({});
  variationFindFirst.mockResolvedValue({ id: "var_1", stock: 3 });
  variationUpdateMany.mockResolvedValue({ count: 1 });
  variationUpdateManyTx.mockResolvedValue({ count: 1 });
});

describe("setItemStockTracking", () => {
  it("gates on manage_products and scopes the item lookup by businessId", async () => {
    await setItemStockTracking({ businessId: BIZ, itemId: "item_1", trackStock: true });
    expect(requireCapability).toHaveBeenCalledWith(BIZ, "manage_products");
    expect(itemFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "item_1", businessId: BIZ }, select: { id: true } }),
    );
  });

  it("enabling sets trackStock true and seeds null-stock variations to 0", async () => {
    await setItemStockTracking({ businessId: BIZ, itemId: "item_1", trackStock: true });
    expect(itemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "item_1" }, data: { trackStock: true } }),
    );
    // Seed only the never-tracked (stock: null) variations, scoped by businessId.
    expect(variationUpdateManyTx).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { itemId: "item_1", businessId: BIZ, stock: null },
        data: { stock: 0 },
      }),
    );
  });

  it("disabling sets trackStock false and does NOT touch existing counts", async () => {
    await setItemStockTracking({ businessId: BIZ, itemId: "item_1", trackStock: false });
    expect(itemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { trackStock: false } }),
    );
    expect(variationUpdateManyTx).not.toHaveBeenCalled();
  });

  it("rejects when the item isn't in this business", async () => {
    itemFindFirst.mockResolvedValue(null);
    await expect(
      setItemStockTracking({ businessId: BIZ, itemId: "nope", trackStock: true }),
    ).rejects.toThrow(/not found/i);
    expect(itemUpdate).not.toHaveBeenCalled();
  });
});

describe("setVariationStock", () => {
  it("sets the absolute count, tenant-scoped", async () => {
    await setVariationStock({ businessId: BIZ, variationId: "var_1", stock: 12 });
    expect(variationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "var_1", businessId: BIZ }, select: { id: true } }),
    );
    expect(variationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "var_1", businessId: BIZ },
        data: { stock: 12 },
      }),
    );
  });

  it("rejects a negative absolute set via zod before any DB write", async () => {
    await expect(
      setVariationStock({ businessId: BIZ, variationId: "var_1", stock: -1 }),
    ).rejects.toThrow();
    expect(requireCapability).not.toHaveBeenCalled();
  });

  it("rejects when the variation isn't in this business", async () => {
    variationFindFirst.mockResolvedValue(null);
    await expect(
      setVariationStock({ businessId: BIZ, variationId: "nope", stock: 5 }),
    ).rejects.toThrow(/not found/i);
    expect(variationUpdateMany).not.toHaveBeenCalled();
  });
});

describe("adjustVariationStock", () => {
  it("applies a positive delta to the current count", async () => {
    variationFindFirst.mockResolvedValue({ id: "var_1", stock: 3 });
    await adjustVariationStock({ businessId: BIZ, variationId: "var_1", delta: 4 });
    expect(variationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "var_1", businessId: BIZ },
        data: { stock: 7 },
      }),
    );
  });

  it("floors the RESULT at 0 (a manual over-decrement can't go negative)", async () => {
    variationFindFirst.mockResolvedValue({ id: "var_1", stock: 2 });
    await adjustVariationStock({ businessId: BIZ, variationId: "var_1", delta: -10 });
    expect(variationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { stock: 0 } }),
    );
  });

  it("treats a null current count as 0 before applying the delta", async () => {
    variationFindFirst.mockResolvedValue({ id: "var_1", stock: null });
    await adjustVariationStock({ businessId: BIZ, variationId: "var_1", delta: 5 });
    expect(variationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { stock: 5 } }),
    );
  });

  it("rejects a zero delta via zod", async () => {
    await expect(
      adjustVariationStock({ businessId: BIZ, variationId: "var_1", delta: 0 }),
    ).rejects.toThrow();
    expect(requireCapability).not.toHaveBeenCalled();
  });
});
