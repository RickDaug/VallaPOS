import { describe, it, expect } from "vitest";
import {
  lineAmountDue,
  groupBySeat,
  tabTotals,
  allSettled,
  planSettlement,
  SettlementError,
  type TabLine,
} from "./tab-math";

// Helper to build a line; tax exclusive unless the test passes taxInclusive.
function line(p: Partial<TabLine> & { id: string }): TabLine {
  return { seat: null, totalCents: 0, taxCents: 0, settledByPaymentId: null, ...p };
}

describe("lineAmountDue", () => {
  it("adds tax on top when exclusive", () => {
    expect(lineAmountDue({ totalCents: 1000, taxCents: 83 }, false)).toBe(1083);
  });
  it("uses the embedded price when inclusive (tax already inside totalCents)", () => {
    expect(lineAmountDue({ totalCents: 1000, taxCents: 76 }, true)).toBe(1000);
  });
});

describe("groupBySeat", () => {
  const lines: TabLine[] = [
    line({ id: "a", seat: 1, totalCents: 1000, taxCents: 83 }),
    line({ id: "b", seat: 2, totalCents: 500, taxCents: 41 }),
    line({ id: "c", seat: 1, totalCents: 200, taxCents: 17, settledByPaymentId: "pay1" }),
    line({ id: "d", seat: null, totalCents: 300, taxCents: 25 }),
  ];

  it("groups by seat with the shared/null group last", () => {
    const groups = groupBySeat(lines, false);
    expect(groups.map((g) => g.seat)).toEqual([1, 2, null]);
  });

  it("computes per-seat amounts and settled flags", () => {
    const groups = groupBySeat(lines, false);
    const seat1 = groups.find((g) => g.seat === 1)!;
    expect(seat1.amountDueCents).toBe(1000 + 83 + 200 + 17); // 1300
    expect(seat1.settled).toBe(false); // line a still unsettled
    expect(seat1.unsettledAmountCents).toBe(1083); // only line a
  });
});

describe("tabTotals", () => {
  it("sums tab + remaining (exclusive)", () => {
    const lines = [
      line({ id: "a", totalCents: 1000, taxCents: 83 }),
      line({ id: "b", totalCents: 500, taxCents: 41, settledByPaymentId: "p" }),
    ];
    const t = tabTotals(lines, false);
    expect(t.amountDueCents).toBe(1083 + 541);
    expect(t.remainingCents).toBe(1083); // line a only
    expect(t.taxCents).toBe(124);
  });
});

describe("allSettled", () => {
  it("false when any line is unsettled, true when all are, false for empty", () => {
    expect(allSettled([line({ id: "a", settledByPaymentId: "p" }), line({ id: "b" })])).toBe(false);
    expect(allSettled([line({ id: "a", settledByPaymentId: "p" })])).toBe(true);
    expect(allSettled([])).toBe(false);
  });
});

describe("planSettlement", () => {
  const lines: TabLine[] = [
    line({ id: "a", seat: 1, totalCents: 1000, taxCents: 83 }),
    line({ id: "b", seat: 2, totalCents: 500, taxCents: 41 }),
    line({ id: "c", seat: null, totalCents: 300, taxCents: 25 }),
  ];

  it("plans the whole tab and flags it closes", () => {
    const plan = planSettlement(lines, { seats: "all", taxInclusive: false });
    expect(plan.lineIds.sort()).toEqual(["a", "b", "c"]);
    expect(plan.amountCents).toBe(1083 + 541 + 325);
    expect(plan.closesTab).toBe(true);
  });

  it("plans a single seat and does NOT close the tab", () => {
    const plan = planSettlement(lines, { seats: [1], taxInclusive: false });
    expect(plan.lineIds).toEqual(["a"]);
    expect(plan.amountCents).toBe(1083);
    expect(plan.closesTab).toBe(false);
  });

  it("can settle the shared (null) group", () => {
    const plan = planSettlement(lines, { seats: [null], taxInclusive: false });
    expect(plan.lineIds).toEqual(["c"]);
    expect(plan.amountCents).toBe(325);
  });

  it("excludes already-settled lines and closes when the last unsettled are covered", () => {
    const partial: TabLine[] = [
      line({ id: "a", seat: 1, totalCents: 1000, taxCents: 83, settledByPaymentId: "p1" }),
      line({ id: "b", seat: 2, totalCents: 500, taxCents: 41 }),
    ];
    const plan = planSettlement(partial, { seats: [2], taxInclusive: false });
    expect(plan.lineIds).toEqual(["b"]);
    expect(plan.closesTab).toBe(true); // b was the last unsettled line
  });

  it("throws when the tab is already fully settled", () => {
    const settled = [line({ id: "a", settledByPaymentId: "p" })];
    expect(() => planSettlement(settled, { seats: "all", taxInclusive: false })).toThrow(SettlementError);
  });

  it("throws when the selected seats have no unsettled lines", () => {
    expect(() => planSettlement(lines, { seats: [9], taxInclusive: false })).toThrow(SettlementError);
  });

  it("uses inclusive amounts when taxInclusive", () => {
    const plan = planSettlement(lines, { seats: [1], taxInclusive: true });
    expect(plan.amountCents).toBe(1000); // tax embedded, not added
  });
});
