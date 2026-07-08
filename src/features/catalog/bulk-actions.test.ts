import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for `bulkCreateItems` — the DB + choke point are stubbed so we exercise
 * the REAL orchestration: row validation/skip reporting, case-insensitive
 * category reuse/creation, and SKU conflict handling (batch + DB), plus the
 * exact item/variation write shape. Money/parse rules live in bulk-parse.test.ts.
 */

const requireCapability = vi.fn();
const variationFindMany = vi.fn();
const categoryFindMany = vi.fn();
const categoryCreate = vi.fn();
const itemCreate = vi.fn();
const itemFindFirst = vi.fn();
const modifierGroupCreate = vi.fn();
const itemModifierGroupCreate = vi.fn();

vi.mock("@/lib/operator-guard", () => ({
  requireCapability: (...args: unknown[]) => requireCapability(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/db", () => {
  const tx = {
    category: { create: (...a: unknown[]) => categoryCreate(...a) },
    item: { create: (...a: unknown[]) => itemCreate(...a) },
    modifierGroup: { create: (...a: unknown[]) => modifierGroupCreate(...a) },
    itemModifierGroup: { create: (...a: unknown[]) => itemModifierGroupCreate(...a) },
  };
  return {
    db: {
      variation: { findMany: (...a: unknown[]) => variationFindMany(...a) },
      category: { findMany: (...a: unknown[]) => categoryFindMany(...a) },
      item: { findFirst: (...a: unknown[]) => itemFindFirst(...a) },
      $transaction: (fn: (t: typeof tx) => Promise<void>) => fn(tx),
    },
  };
});

import { bulkCreateItems, addItemIngredientOptions } from "./actions";

const BIZ = "biz_1";

beforeEach(() => {
  vi.clearAllMocks();
  requireCapability.mockResolvedValue({ businessId: BIZ });
  variationFindMany.mockResolvedValue([]); // no existing SKUs by default
  categoryFindMany.mockResolvedValue([]); // no existing categories by default
  categoryCreate.mockImplementation(async ({ data }: { data: { name: string } }) => ({
    id: `cat_${data.name.toLowerCase()}`,
    name: data.name,
  }));
  itemCreate.mockResolvedValue({});
  itemFindFirst.mockResolvedValue({ id: "item_1" });
  modifierGroupCreate.mockResolvedValue({ id: "grp_1" });
  itemModifierGroupCreate.mockResolvedValue({});
});

describe("bulkCreateItems", () => {
  it("creates items, auto-creates a new category, and skips blank rows", async () => {
    const res = await bulkCreateItems({
      businessId: BIZ,
      preset: "retail",
      rows: [
        { name: "Coca-Cola 12oz", price: "1.50", category: "Drinks", sku: "049000" },
        {}, // blank — ignored, not an error
        { name: "Chips", price: "2.25", category: "Snacks" },
      ],
    });

    expect(res.created).toBe(2);
    expect(res.skipped).toEqual([]);
    expect(res.categoriesCreated.sort()).toEqual(["Drinks", "Snacks"]);
    expect(itemCreate).toHaveBeenCalledTimes(2);

    // First item wrote name/type + a Default variation carrying the SKU.
    const firstArg = itemCreate.mock.calls[0]![0] as {
      data: {
        name: string;
        type: string;
        businessId: string;
        variations: { create: { name: string; priceCents: number; sku: string | null }[] };
      };
    };
    expect(firstArg.data.name).toBe("Coca-Cola 12oz");
    expect(firstArg.data.type).toBe("PRODUCT");
    expect(firstArg.data.businessId).toBe(BIZ);
    expect(firstArg.data.variations.create[0]).toMatchObject({
      name: "Default",
      priceCents: 150,
      sku: "049000",
    });
  });

  it("reuses an existing category case-insensitively (no duplicate)", async () => {
    categoryFindMany.mockResolvedValue([{ id: "cat_existing", name: "Drinks" }]);

    const res = await bulkCreateItems({
      businessId: BIZ,
      preset: "retail",
      rows: [{ name: "Sprite", price: "1.50", category: "drinks" }],
    });

    expect(res.created).toBe(1);
    expect(res.categoriesCreated).toEqual([]); // reused, not created
    expect(categoryCreate).not.toHaveBeenCalled();
    const arg = itemCreate.mock.calls[0]![0] as { data: { categoryId: string | null } };
    expect(arg.data.categoryId).toBe("cat_existing");
  });

  it("reports invalid rows without creating them", async () => {
    const res = await bulkCreateItems({
      businessId: BIZ,
      preset: "retail",
      rows: [
        { name: "Good", price: "1.00" },
        { name: "NoPrice" }, // invalid — missing price
        { price: "5.00" }, // invalid — missing name
      ],
    });

    expect(res.created).toBe(1);
    expect(res.skipped).toHaveLength(2);
    expect(res.skipped.map((s) => s.name)).toContain("NoPrice");
    expect(itemCreate).toHaveBeenCalledTimes(1);
  });

  it("skips SKU conflicts against the DB and duplicates within the batch", async () => {
    variationFindMany.mockResolvedValue([{ sku: "TAKEN" }]); // already in DB

    const res = await bulkCreateItems({
      businessId: BIZ,
      preset: "retail",
      rows: [
        { name: "A", price: "1", sku: "TAKEN" }, // conflicts with DB
        { name: "B", price: "1", sku: "DUP" },
        { name: "C", price: "1", sku: "DUP" }, // duplicate within batch
        { name: "D", price: "1", sku: "FRESH" }, // fine
      ],
    });

    expect(res.created).toBe(2); // B and D
    const reasons = res.skipped.map((s) => `${s.name}:${s.reason}`);
    expect(reasons.some((r) => r.startsWith("A:") && /already exists/.test(r))).toBe(true);
    expect(reasons.some((r) => r.startsWith("C:") && /Duplicate SKU/.test(r))).toBe(true);
  });

  it("returns nothing created when every row is invalid", async () => {
    const res = await bulkCreateItems({
      businessId: BIZ,
      preset: "retail",
      rows: [{ name: "OnlyName" }],
    });
    expect(res.created).toBe(0);
    expect(itemCreate).not.toHaveBeenCalled();
    expect(res.skipped).toHaveLength(1);
  });
});

describe("addItemIngredientOptions", () => {
  it("creates the No/Extra group with an option per line and links it to the item", async () => {
    await addItemIngredientOptions({
      businessId: BIZ,
      itemId: "item_1",
      groupName: "Modifications",
      options: [
        { name: "No Onion", priceDeltaCents: 0 },
        { name: "Extra Onion", priceDeltaCents: 0 },
        { name: "No Cheese", priceDeltaCents: 0 },
        { name: "Extra Cheese", priceDeltaCents: 75 },
      ],
    });

    // The group is optional (minSelect 0) and each option is independently tappable.
    const groupArg = modifierGroupCreate.mock.calls[0]![0] as {
      data: { name: string; minSelect: number; maxSelect: number; modifiers: { create: unknown[] } };
    };
    expect(groupArg.data.name).toBe("Modifications");
    expect(groupArg.data.minSelect).toBe(0);
    expect(groupArg.data.maxSelect).toBe(4);
    expect(groupArg.data.modifiers.create).toHaveLength(4);

    // It's linked to the item.
    const linkArg = itemModifierGroupCreate.mock.calls[0]![0] as {
      data: { itemId: string; groupId: string };
    };
    expect(linkArg.data).toEqual({ itemId: "item_1", groupId: "grp_1" });
  });

  it("rejects when the item isn't in this business", async () => {
    itemFindFirst.mockResolvedValue(null);
    await expect(
      addItemIngredientOptions({
        businessId: BIZ,
        itemId: "nope",
        groupName: "Modifications",
        options: [{ name: "No Onion", priceDeltaCents: 0 }],
      }),
    ).rejects.toThrow(/not found/i);
    expect(modifierGroupCreate).not.toHaveBeenCalled();
  });
});
