import { describe, it, expect } from "vitest";
import {
  formatMoney,
  roundCents,
  taxOf,
  embeddedTaxOf,
  computeTotals,
  allocateCartDiscount,
} from "./money";

describe("formatMoney", () => {
  it("formats integer cents as USD", () => {
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(999)).toBe("$9.99");
    expect(formatMoney(123456)).toBe("$1,234.56");
  });
  it("respects currency", () => {
    expect(formatMoney(1000, "EUR", "en-US")).toBe("€10.00");
  });
});

describe("taxOf / embeddedTaxOf", () => {
  it("computes exclusive tax rounded to the cent", () => {
    expect(taxOf(1000, 825)).toBe(83); // 82.5 -> 83
    expect(taxOf(2396, 825)).toBe(198); // 197.67 -> 198
    expect(taxOf(1000, 0)).toBe(0);
  });
  it("computes embedded (inclusive) tax", () => {
    expect(embeddedTaxOf(1000, 825)).toBe(76); // 1000 - round(923.79)
    expect(embeddedTaxOf(1000, 0)).toBe(0);
  });
  it("embedded + net reconstructs the gross price", () => {
    const gross = 1083;
    const tax = embeddedTaxOf(gross, 825);
    expect(gross - tax).toBe(1000); // net
  });
});

describe("roundCents", () => {
  it("rounds half up", () => {
    expect(roundCents(82.5)).toBe(83);
    expect(roundCents(82.4)).toBe(82);
  });
});

describe("computeTotals — exclusive", () => {
  it("single line, no discount/tip", () => {
    const t = computeTotals([{ unitPriceCents: 1000, quantity: 1 }], { taxRateBps: 825 });
    expect(t).toEqual({
      subtotalCents: 1000,
      discountCents: 0,
      taxCents: 83,
      tipCents: 0,
      totalCents: 1083,
    });
  });

  it("multiple lines and quantities", () => {
    const t = computeTotals(
      [
        { unitPriceCents: 999, quantity: 2 },
        { unitPriceCents: 199, quantity: 2 },
      ],
      { taxRateBps: 825 },
    );
    expect(t.subtotalCents).toBe(2396);
    expect(t.taxCents).toBe(198);
    expect(t.totalCents).toBe(2594);
  });

  it("applies line discount before tax", () => {
    const t = computeTotals([{ unitPriceCents: 1000, quantity: 1, lineDiscountCents: 200 }], {
      taxRateBps: 1000,
    });
    expect(t.subtotalCents).toBe(1000);
    expect(t.discountCents).toBe(200);
    expect(t.taxCents).toBe(80); // tax on 800
    expect(t.totalCents).toBe(880);
  });

  it("applies cart discount and tip", () => {
    const t = computeTotals([{ unitPriceCents: 1000, quantity: 1 }], {
      taxRateBps: 0,
      cartDiscountCents: 100,
      tipCents: 150,
    });
    expect(t.discountCents).toBe(100);
    expect(t.tipCents).toBe(150);
    expect(t.totalCents).toBe(1050); // 1000 - 100 + 0 tax + 150 tip
  });

  it("includes modifier deltas in the taxable base", () => {
    const t = computeTotals([{ unitPriceCents: 1000, modifierDeltaCents: 200, quantity: 2 }], {
      taxRateBps: 1000,
    });
    expect(t.subtotalCents).toBe(2400); // (1000+200)*2
    expect(t.taxCents).toBe(240);
    expect(t.totalCents).toBe(2640);
  });

  it("never lets discount push the total below zero", () => {
    const t = computeTotals([{ unitPriceCents: 500, quantity: 1 }], {
      taxRateBps: 0,
      cartDiscountCents: 99999,
    });
    expect(t.totalCents).toBe(0);
    expect(t.discountCents).toBe(500); // capped at subtotal
  });
});

describe("allocateCartDiscount", () => {
  it("returns zeros when there is no discount or no base", () => {
    expect(allocateCartDiscount([1000, 500], 0)).toEqual([0, 0]);
    expect(allocateCartDiscount([0, 0], 100)).toEqual([0, 0]);
    expect(allocateCartDiscount([], 100)).toEqual([]);
  });

  it("allocates proportionally to each line's base", () => {
    // 300 over bases 3000 / 1000 => 225 / 75
    expect(allocateCartDiscount([3000, 1000], 300)).toEqual([225, 75]);
  });

  it("sums to exactly the discount even when the split doesn't divide evenly", () => {
    // 10 over three equal bases: 3.33.. each -> largest-remainder gives 4/3/3.
    const alloc = allocateCartDiscount([1000, 1000, 1000], 10);
    expect(alloc.reduce((s, x) => s + x, 0)).toBe(10);
    expect(alloc).toEqual([4, 3, 3]);
  });

  it("never allocates more than the total base (caps at Σ bases)", () => {
    const alloc = allocateCartDiscount([500, 500], 99999);
    expect(alloc.reduce((s, x) => s + x, 0)).toBe(1000);
    expect(alloc[0]).toBeLessThanOrEqual(500);
    expect(alloc[1]).toBeLessThanOrEqual(500);
  });

  it("never allocates a cent to a zero-base line", () => {
    const alloc = allocateCartDiscount([0, 1000], 7);
    expect(alloc[0]).toBe(0);
    expect(alloc[1]).toBe(7);
  });
});

describe("computeTotals — cart discount reduces the taxable base (HIGH #1)", () => {
  it("a cart discount lowers tax identically to an equal line discount", () => {
    const asLineDiscount = computeTotals(
      [{ unitPriceCents: 10000, quantity: 1, lineDiscountCents: 1000 }],
      { taxRateBps: 1000 },
    );
    const asCartDiscount = computeTotals([{ unitPriceCents: 10000, quantity: 1 }], {
      taxRateBps: 1000,
      cartDiscountCents: 1000,
    });
    // Both discount $10 off a $100 line @ 10% => tax on $90 = 900.
    expect(asLineDiscount.taxCents).toBe(900);
    expect(asCartDiscount.taxCents).toBe(900);
    expect(asCartDiscount.taxCents).toBe(asLineDiscount.taxCents);
    expect(asCartDiscount.totalCents).toBe(asLineDiscount.totalCents);
  });

  it("splits the cart discount's tax reduction across multiple lines", () => {
    // Two lines, $30 + $10 = $40 base; $8 cart discount @ 10% tax.
    const t = computeTotals(
      [
        { unitPriceCents: 3000, quantity: 1 },
        { unitPriceCents: 1000, quantity: 1 },
      ],
      { taxRateBps: 1000, cartDiscountCents: 800 },
    );
    // Net base 3200; tax = 320 (equivalently: line1 net 2400 -> 240, line2 net 800 -> 80).
    expect(t.taxCents).toBe(320);
    expect(t.discountCents).toBe(800);
    expect(t.totalCents).toBe(3520); // 3200 net + 320 tax
  });
});

describe("computeTotals — inclusive", () => {
  it("tax is embedded; total equals the sticker price", () => {
    const t = computeTotals([{ unitPriceCents: 1000, quantity: 1 }], {
      taxRateBps: 825,
      taxInclusive: true,
    });
    expect(t.subtotalCents).toBe(1000);
    expect(t.taxCents).toBe(76);
    expect(t.totalCents).toBe(1000); // not 1000 + tax
  });

  it("adds tip on top of an inclusive price", () => {
    const t = computeTotals([{ unitPriceCents: 1000, quantity: 1 }], {
      taxRateBps: 825,
      taxInclusive: true,
      tipCents: 200,
    });
    expect(t.totalCents).toBe(1200);
  });
});
