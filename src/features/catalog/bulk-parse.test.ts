import { describe, it, expect } from "vitest";
import {
  parseMoneyToCents,
  parsePriceCell,
  parseType,
  isBlankRow,
  validateRow,
  parsePastedText,
  parseModifierLines,
  buildIngredientOptions,
  PRESETS,
} from "./bulk-parse";

describe("parseMoneyToCents", () => {
  it("parses plain and symboled US amounts", () => {
    expect(parseMoneyToCents("9.99")).toBe(999);
    expect(parseMoneyToCents("$9.99")).toBe(999);
    expect(parseMoneyToCents("  12 ")).toBe(1200);
    expect(parseMoneyToCents("0")).toBe(0);
    expect(parseMoneyToCents("1,234.56")).toBe(123456); // thousands + decimal
  });

  it("parses EU/LATAM decimal comma", () => {
    expect(parseMoneyToCents("9,99")).toBe(999);
    expect(parseMoneyToCents("1.234,56")).toBe(123456); // dot thousands, comma decimal
  });

  it("treats grouped commas as thousands", () => {
    expect(parseMoneyToCents("1,500")).toBe(150000); // $1,500.00
  });

  it("rejects blanks, negatives, and junk", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("   ")).toBeNull();
    expect(parseMoneyToCents("-5")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("$")).toBeNull();
  });

  it("rejects an implausibly large amount (over the cap)", () => {
    expect(parseMoneyToCents("100000.01")).toBeNull();
  });
});

describe("parsePriceCell", () => {
  it("single price → one Default variation", () => {
    expect(parsePriceCell("9.99")).toEqual({ ok: true, variations: [{ name: "Default", priceCents: 999 }] });
  });

  it("multi-size syntax → one variation per size (comma or semicolon)", () => {
    expect(parsePriceCell("Small:2.50, Large:3.50")).toEqual({
      ok: true,
      variations: [
        { name: "Small", priceCents: 250 },
        { name: "Large", priceCents: 350 },
      ],
    });
    expect(parsePriceCell("S:2; L:3")).toEqual({
      ok: true,
      variations: [
        { name: "S", priceCents: 200 },
        { name: "L", priceCents: 300 },
      ],
    });
  });

  it("flags a bad/blank size price and duplicate sizes (no silent drop)", () => {
    expect(parsePriceCell("Small:2.50, Large:").ok).toBe(false);
    expect(parsePriceCell("Small:2, Small:3").ok).toBe(false);
    expect(parsePriceCell(":2.50").ok).toBe(false);
  });

  it("requires a price", () => {
    expect(parsePriceCell("")).toEqual({ ok: false, error: "Price is required" });
    expect(parsePriceCell("free")).toEqual({ ok: false, error: expect.stringContaining("Not a valid price") });
  });
});

describe("parseType", () => {
  it("falls back when blank, and normalizes synonyms", () => {
    expect(parseType("", "PRODUCT")).toBe("PRODUCT");
    expect(parseType(undefined, "SERVICE")).toBe("SERVICE");
    expect(parseType("service", "PRODUCT")).toBe("SERVICE");
    expect(parseType("Prod", "SERVICE")).toBe("PRODUCT");
    expect(parseType("nonsense", "PRODUCT")).toBeNull();
  });
});

describe("isBlankRow", () => {
  it("detects fully-empty rows and non-empty ones", () => {
    expect(isBlankRow({})).toBe(true);
    expect(isBlankRow({ name: "  ", price: "" })).toBe(true);
    expect(isBlankRow({ name: "Burger" })).toBe(false);
    expect(isBlankRow({ price: "1.00" })).toBe(false);
  });
});

describe("validateRow", () => {
  it("validates a retail row with SKU + category", () => {
    const res = validateRow(
      { name: "Coca-Cola 12oz", price: "1.50", category: "Drinks", sku: "049000" },
      PRESETS.retail,
    );
    expect(res).toEqual({
      ok: true,
      row: {
        name: "Coca-Cola 12oz",
        type: "PRODUCT",
        categoryName: "Drinks",
        sku: "049000",
        variations: [{ name: "Default", priceCents: 150 }],
      },
    });
  });

  it("defaults the service preset's rows to SERVICE and ignores SKU", () => {
    const res = validateRow({ name: "Haircut", price: "25", sku: "IGNORED" }, PRESETS.service);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.row.type).toBe("SERVICE");
      expect(res.row.sku).toBeNull(); // service preset has no sku column
    }
  });

  it("requires a name and a valid price", () => {
    expect(validateRow({ price: "1.00" }, PRESETS.retail)).toEqual({ ok: false, error: "Name is required" });
    expect(validateRow({ name: "X" }, PRESETS.retail).ok).toBe(false); // no price
  });

  it("carries multi-size variations through", () => {
    const res = validateRow({ name: "Coffee", price: "Small:2.50, Large:3.50", category: "Drinks" }, PRESETS.menu);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.row.variations).toHaveLength(2);
  });
});

describe("parsePastedText", () => {
  it("parses tab-separated spreadsheet paste by column order", () => {
    const text = "Classic Burger\t9.99\tFood\nCoca-Cola\t1.50\tDrinks\t049000";
    const rows = parsePastedText(text, PRESETS.retail.columns);
    expect(rows).toEqual([
      { name: "Classic Burger", price: "9.99", category: "Food" },
      { name: "Coca-Cola", price: "1.50", category: "Drinks", sku: "049000" },
    ]);
  });

  it("falls back to comma when there are no tabs, and skips blank lines", () => {
    const text = "Chips,2.25,Snacks\n\n  \nGum,0.99,Snacks\n";
    const rows = parsePastedText(text, PRESETS.retail.columns);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: "Chips", price: "2.25", category: "Snacks" });
    expect(rows[1]!.name).toBe("Gum");
  });
});

describe("parseModifierLines", () => {
  it("parses names + prices in several formats and defaults to free", () => {
    const text = "Oat milk +0.75\nWhole milk\nExtra shot: 1.00\nAlmond\t0.75";
    const { options, errors } = parseModifierLines(text);
    expect(errors).toEqual([]);
    expect(options).toEqual([
      { name: "Oat milk", priceDeltaCents: 75 },
      { name: "Whole milk", priceDeltaCents: 0 },
      { name: "Extra shot", priceDeltaCents: 100 },
      { name: "Almond", priceDeltaCents: 75 },
    ]);
  });

  it("skips blank lines, flags bad prices and duplicates", () => {
    const { options, errors } = parseModifierLines("Oat milk +0.75\n\nOat milk +1.00\nCheese +abc");
    expect(options).toHaveLength(1); // only the first Oat milk
    expect(errors).toHaveLength(2); // duplicate + bad price
    expect(errors[0]!.message).toMatch(/Duplicate/);
    expect(errors[1]!.message).toMatch(/Bad price/);
  });

  it("keeps a name that contains digits when there's no trailing price", () => {
    const { options } = parseModifierLines("2% milk");
    expect(options).toEqual([{ name: "2% milk", priceDeltaCents: 0 }]);
  });
});

describe("buildIngredientOptions", () => {
  it("expands each ingredient into No (free) + Extra (+upcharge)", () => {
    const { options, errors } = buildIngredientOptions("Onion\nCheese +0.75\nBacon +1.50");
    expect(errors).toEqual([]);
    expect(options).toEqual([
      { name: "No Onion", priceDeltaCents: 0 },
      { name: "Extra Onion", priceDeltaCents: 0 },
      { name: "No Cheese", priceDeltaCents: 0 },
      { name: "Extra Cheese", priceDeltaCents: 75 },
      { name: "No Bacon", priceDeltaCents: 0 },
      { name: "Extra Bacon", priceDeltaCents: 150 },
    ]);
  });

  it("propagates parse errors (bad price, duplicate) from the ingredient lines", () => {
    const { errors } = buildIngredientOptions("Onion +abc\nCheese\nCheese");
    expect(errors.length).toBeGreaterThanOrEqual(2); // bad price + duplicate
  });
});
