import { describe, it, expect } from "vitest";
import {
  formatMoney,
  roundCents,
  taxOf,
  embeddedTaxOf,
  computeTotals,
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
