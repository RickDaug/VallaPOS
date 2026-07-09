import { describe, it, expect } from "vitest";
import {
  modifierDeltaOf,
  priceLine,
  computePricedOrder,
  validateGroupSelection,
  ModifierSelectionError,
  type ResolvedModifier,
  type GroupConstraint,
} from "./pricing";
import { computeTotals } from "@/lib/money";

function mod(id: string, priceDeltaCents: number): ResolvedModifier {
  return { id, nameSnapshot: id, priceDeltaCents };
}

describe("modifierDeltaOf", () => {
  it("sums chosen modifier deltas", () => {
    expect(modifierDeltaOf([mod("a", 75), mod("b", 150)])).toBe(225);
  });
  it("is zero for none", () => {
    expect(modifierDeltaOf(undefined)).toBe(0);
    expect(modifierDeltaOf([])).toBe(0);
  });
});

describe("priceLine — modifier deltas in the taxable base", () => {
  it("folds modifier deltas into the unit before tax (exclusive)", () => {
    // (1000 + 75) * 2 = 2150; tax @ 8.25% = round(177.375) = 177
    const p = priceLine(
      { unitPriceCents: 1000, quantity: 2, modifiers: [mod("oat", 75)] },
      825,
      false,
    );
    expect(p.modifierDeltaCents).toBe(75);
    expect(p.taxableBaseCents).toBe(2150);
    expect(p.totalCents).toBe(2150);
    expect(p.taxCents).toBe(177);
  });

  it("applies the line discount before tax", () => {
    // (1000 + 200) * 1 - 300 = 900; tax @ 10% = 90
    const p = priceLine(
      { unitPriceCents: 1000, quantity: 1, lineDiscountCents: 300, modifiers: [mod("x", 200)] },
      1000,
      false,
    );
    expect(p.taxableBaseCents).toBe(900);
    expect(p.taxCents).toBe(90);
  });

  it("caps the line discount at the gross", () => {
    const p = priceLine({ unitPriceCents: 500, quantity: 1, lineDiscountCents: 9999 }, 0, false);
    expect(p.discountCents).toBe(500);
    expect(p.taxableBaseCents).toBe(0);
  });

  it("computes embedded tax on the inclusive base (modifiers included)", () => {
    // base 1075 inclusive @ 8.25% -> embedded 82 (1075 - round(992.6))
    const p = priceLine(
      { unitPriceCents: 1000, quantity: 1, modifiers: [mod("m", 75)] },
      825,
      true,
    );
    expect(p.taxableBaseCents).toBe(1075);
    expect(p.taxCents).toBe(82);
  });
});

describe("computePricedOrder — reconciliation: order tax == Σ line tax", () => {
  it("derives order tax by summing line taxes (exclusive)", () => {
    const order = computePricedOrder(
      [
        { unitPriceCents: 1000, quantity: 2, modifiers: [mod("a", 75)] },
        { unitPriceCents: 199, quantity: 3 },
      ],
      { taxRateBps: 825 },
    );
    const sumLineTax = order.lines.reduce((s, l) => s + l.taxCents, 0);
    expect(order.taxCents).toBe(sumLineTax);
    // subtotal = (1075*2) + (199*3) = 2150 + 597 = 2747
    expect(order.subtotalCents).toBe(2747);
    expect(order.totalCents).toBe(order.subtotalCents - order.discountCents + order.taxCents);
  });

  it("derives order tax by summing line taxes (inclusive — total = subtotal + tip)", () => {
    const order = computePricedOrder(
      [
        { unitPriceCents: 1000, quantity: 1, modifiers: [mod("a", 75)] },
        { unitPriceCents: 500, quantity: 2 },
      ],
      { taxRateBps: 825, taxInclusive: true, tipCents: 100 },
    );
    const sumLineTax = order.lines.reduce((s, l) => s + l.taxCents, 0);
    expect(order.taxCents).toBe(sumLineTax);
    // inclusive: tax is embedded, not added on top
    expect(order.totalCents).toBe(order.subtotalCents - order.discountCents + order.tipCents);
  });

  it("reduces tax for a cart discount and keeps order tax == Σ line tax (HIGH #1)", () => {
    // Two lines, $30 + $10 base; an $8 cart discount at 10% tax.
    const order = computePricedOrder(
      [
        { unitPriceCents: 3000, quantity: 1 },
        { unitPriceCents: 1000, quantity: 1 },
      ],
      { taxRateBps: 1000, cartDiscountCents: 800 },
    );
    const sumLineTax = order.lines.reduce((s, l) => s + l.taxCents, 0);
    expect(order.taxCents).toBe(sumLineTax);
    // Net base 3200 @ 10% => 320 (line1 net 2400 -> 240, line2 net 800 -> 80).
    expect(order.lines[0]!.taxCents).toBe(240);
    expect(order.lines[1]!.taxCents).toBe(80);
    expect(order.taxCents).toBe(320);
    expect(order.discountCents).toBe(800);
    expect(order.totalCents).toBe(3520);
  });

  it("a cart discount lowers tax identically to an equal line discount", () => {
    const line = computePricedOrder(
      [{ unitPriceCents: 10000, quantity: 1, lineDiscountCents: 1000 }],
      { taxRateBps: 1000 },
    );
    const cart = computePricedOrder([{ unitPriceCents: 10000, quantity: 1 }], {
      taxRateBps: 1000,
      cartDiscountCents: 1000,
    });
    expect(cart.taxCents).toBe(900);
    expect(cart.taxCents).toBe(line.taxCents);
    expect(cart.lines[0]!.taxCents).toBe(line.lines[0]!.taxCents);
  });

  it("matches computeTotals from @/lib/money for the same inputs", () => {
    const lines = [
      { unitPriceCents: 1000, modifierDeltaCents: 75, quantity: 2 },
      { unitPriceCents: 199, quantity: 3, lineDiscountCents: 50 },
    ];
    const opts = { taxRateBps: 825, cartDiscountCents: 100, tipCents: 200 };
    const a = computePricedOrder(
      lines.map((l) => ({
        unitPriceCents: l.unitPriceCents,
        quantity: l.quantity,
        lineDiscountCents: l.lineDiscountCents,
        modifiers: l.modifierDeltaCents ? [mod("m", l.modifierDeltaCents)] : [],
      })),
      opts,
    );
    const b = computeTotals(lines, opts);
    expect(a.subtotalCents).toBe(b.subtotalCents);
    expect(a.discountCents).toBe(b.discountCents);
    expect(a.taxCents).toBe(b.taxCents);
    expect(a.totalCents).toBe(b.totalCents);
  });
});

describe("validateGroupSelection", () => {
  const group: GroupConstraint = {
    groupId: "g1",
    minSelect: 1,
    maxSelect: 2,
    modifierIds: ["m1", "m2", "m3"],
  };

  it("accepts a valid selection within bounds", () => {
    expect(() => validateGroupSelection(group, ["m1"])).not.toThrow();
    expect(() => validateGroupSelection(group, ["m1", "m2"])).not.toThrow();
  });

  it("rejects fewer than minSelect (required group left empty)", () => {
    expect(() => validateGroupSelection(group, [])).toThrow(ModifierSelectionError);
  });

  it("rejects more than maxSelect", () => {
    expect(() => validateGroupSelection(group, ["m1", "m2", "m3"])).toThrow(ModifierSelectionError);
  });

  it("rejects an unknown / foreign modifier id", () => {
    expect(() => validateGroupSelection(group, ["m1", "evil"])).toThrow(ModifierSelectionError);
  });

  it("allows zero selections when minSelect is 0", () => {
    const optional: GroupConstraint = { groupId: "g", minSelect: 0, maxSelect: 1, modifierIds: ["x"] };
    expect(() => validateGroupSelection(optional, [])).not.toThrow();
  });
});
