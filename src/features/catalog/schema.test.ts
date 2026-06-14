import { describe, it, expect } from "vitest";
import {
  createModifierGroupSchema,
  createModifierSchema,
  linkSchema,
  updateItemSchema,
  setItemActiveSchema,
  createVariationSchema,
  updateVariationSchema,
  updateCategorySortOrderSchema,
} from "./schema";

describe("createModifierGroupSchema", () => {
  const base = { businessId: "biz_1", name: "Milk", minSelect: 0, maxSelect: 1 };

  it("accepts a valid group", () => {
    expect(() => createModifierGroupSchema.parse(base)).not.toThrow();
  });

  it("accepts a required multi-select group", () => {
    expect(() =>
      createModifierGroupSchema.parse({ ...base, minSelect: 1, maxSelect: 3 }),
    ).not.toThrow();
  });

  it("rejects maxSelect < minSelect", () => {
    expect(() =>
      createModifierGroupSchema.parse({ ...base, minSelect: 2, maxSelect: 1 }),
    ).toThrow();
  });

  it("rejects maxSelect below 1 (a group must allow at least one choice)", () => {
    expect(() => createModifierGroupSchema.parse({ ...base, maxSelect: 0 })).toThrow();
  });

  it("rejects a negative minSelect", () => {
    expect(() => createModifierGroupSchema.parse({ ...base, minSelect: -1 })).toThrow();
  });

  it("rejects a non-integer select count", () => {
    expect(() => createModifierGroupSchema.parse({ ...base, maxSelect: 1.5 })).toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => createModifierGroupSchema.parse({ ...base, name: "" })).toThrow();
  });
});

describe("createModifierSchema", () => {
  const base = { businessId: "biz_1", groupId: "g1", name: "Oat milk", priceDeltaCents: 75 };

  it("accepts a valid modifier", () => {
    expect(() => createModifierSchema.parse(base)).not.toThrow();
  });

  it("accepts a zero price delta", () => {
    expect(() => createModifierSchema.parse({ ...base, priceDeltaCents: 0 })).not.toThrow();
  });

  it("rejects negative cents", () => {
    expect(() => createModifierSchema.parse({ ...base, priceDeltaCents: -1 })).toThrow();
  });

  it("rejects a fractional cent", () => {
    expect(() => createModifierSchema.parse({ ...base, priceDeltaCents: 75.5 })).toThrow();
  });

  it("rejects a missing groupId", () => {
    expect(() => createModifierSchema.parse({ ...base, groupId: "" })).toThrow();
  });
});

describe("linkSchema", () => {
  it("accepts a valid item/group link", () => {
    expect(() =>
      linkSchema.parse({ businessId: "biz_1", itemId: "i1", groupId: "g1" }),
    ).not.toThrow();
  });

  it("rejects a missing itemId or groupId", () => {
    expect(() => linkSchema.parse({ businessId: "biz_1", itemId: "", groupId: "g1" })).toThrow();
    expect(() => linkSchema.parse({ businessId: "biz_1", itemId: "i1", groupId: "" })).toThrow();
  });
});

describe("updateItemSchema", () => {
  const base = {
    businessId: "biz_1",
    id: "item_1",
    name: "Burger",
    type: "PRODUCT" as const,
    categoryId: "cat_1",
    priceCents: 999,
  };

  it("accepts a valid edit", () => {
    expect(() => updateItemSchema.parse(base)).not.toThrow();
  });

  it("accepts a null/omitted category (uncategorized)", () => {
    expect(() => updateItemSchema.parse({ ...base, categoryId: null })).not.toThrow();
    const { categoryId: _omit, ...noCat } = base;
    void _omit;
    expect(() => updateItemSchema.parse(noCat)).not.toThrow();
  });

  it("trims the name", () => {
    expect(updateItemSchema.parse({ ...base, name: "  Burger  " }).name).toBe("Burger");
  });

  it("rejects an empty name", () => {
    expect(() => updateItemSchema.parse({ ...base, name: "" })).toThrow();
  });

  it("rejects a missing id", () => {
    expect(() => updateItemSchema.parse({ ...base, id: "" })).toThrow();
  });

  it("rejects a negative price", () => {
    expect(() => updateItemSchema.parse({ ...base, priceCents: -1 })).toThrow();
  });

  it("rejects a fractional cent price", () => {
    expect(() => updateItemSchema.parse({ ...base, priceCents: 9.99 })).toThrow();
  });

  it("rejects an unknown item type", () => {
    expect(() => updateItemSchema.parse({ ...base, type: "BUNDLE" })).toThrow();
  });
});

describe("setItemActiveSchema", () => {
  it("accepts archive and unarchive", () => {
    expect(() => setItemActiveSchema.parse({ businessId: "biz_1", id: "i1", active: false })).not.toThrow();
    expect(() => setItemActiveSchema.parse({ businessId: "biz_1", id: "i1", active: true })).not.toThrow();
  });

  it("rejects a non-boolean active", () => {
    expect(() => setItemActiveSchema.parse({ businessId: "biz_1", id: "i1", active: "yes" })).toThrow();
  });

  it("rejects a missing id", () => {
    expect(() => setItemActiveSchema.parse({ businessId: "biz_1", id: "", active: true })).toThrow();
  });
});

describe("createVariationSchema", () => {
  const base = { businessId: "biz_1", itemId: "i1", name: "Large", priceCents: 1299 };

  it("accepts a minimal variation", () => {
    expect(() => createVariationSchema.parse(base)).not.toThrow();
  });

  it("normalizes an empty/whitespace SKU to null", () => {
    expect(createVariationSchema.parse({ ...base, sku: "" }).sku).toBeNull();
    expect(createVariationSchema.parse({ ...base, sku: "   " }).sku).toBeNull();
    expect(createVariationSchema.parse({ ...base, sku: null }).sku).toBeNull();
    expect(createVariationSchema.parse(base).sku).toBeNull();
  });

  it("trims and keeps a real SKU", () => {
    expect(createVariationSchema.parse({ ...base, sku: "  ABC-1 " }).sku).toBe("ABC-1");
  });

  it("rejects an empty name", () => {
    expect(() => createVariationSchema.parse({ ...base, name: "" })).toThrow();
  });

  it("rejects a negative price", () => {
    expect(() => createVariationSchema.parse({ ...base, priceCents: -1 })).toThrow();
  });

  it("rejects a fractional sortOrder", () => {
    expect(() => createVariationSchema.parse({ ...base, sortOrder: 1.5 })).toThrow();
  });

  it("rejects a missing itemId", () => {
    expect(() => createVariationSchema.parse({ ...base, itemId: "" })).toThrow();
  });
});

describe("updateVariationSchema", () => {
  const base = { businessId: "biz_1", id: "v1", name: "Large", priceCents: 1299 };

  it("accepts a valid edit", () => {
    expect(() => updateVariationSchema.parse(base)).not.toThrow();
  });

  it("normalizes an empty SKU to null", () => {
    expect(updateVariationSchema.parse({ ...base, sku: "" }).sku).toBeNull();
  });

  it("rejects a missing id", () => {
    expect(() => updateVariationSchema.parse({ ...base, id: "" })).toThrow();
  });

  it("rejects a negative price", () => {
    expect(() => updateVariationSchema.parse({ ...base, priceCents: -5 })).toThrow();
  });
});

describe("updateCategorySortOrderSchema", () => {
  it("accepts a valid reorder", () => {
    expect(() =>
      updateCategorySortOrderSchema.parse({ businessId: "biz_1", id: "c1", sortOrder: 3 }),
    ).not.toThrow();
  });

  it("rejects a negative sortOrder", () => {
    expect(() =>
      updateCategorySortOrderSchema.parse({ businessId: "biz_1", id: "c1", sortOrder: -1 }),
    ).toThrow();
  });

  it("rejects a fractional sortOrder", () => {
    expect(() =>
      updateCategorySortOrderSchema.parse({ businessId: "biz_1", id: "c1", sortOrder: 1.5 }),
    ).toThrow();
  });
});
