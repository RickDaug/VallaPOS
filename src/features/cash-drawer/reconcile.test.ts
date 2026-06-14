import { describe, it, expect } from "vitest";
import {
  expectedCash,
  computeVariance,
  varianceKind,
  reconcile,
} from "./reconcile";

describe("expectedCash", () => {
  it("is opening float plus cash collected", () => {
    expect(expectedCash(10000, 25000)).toBe(35000);
    expect(expectedCash(0, 0)).toBe(0);
    expect(expectedCash(10000, 0)).toBe(10000); // no sales yet
  });

  it("falls when a cash refund nets out of cash collected", () => {
    // Reconciliation counts NET cash movement: a cash refund writes a negative
    // CASH payment, so `cashCollectedCents` is sale cash minus refund cash. A
    // $50 refund against $250 of sales leaves $200 net → expected drops to $300.
    const saleCash = 25000;
    const refundCash = -5000; // negative reversing payment
    const netCash = saleCash + refundCash; // 20000
    expect(expectedCash(10000, netCash)).toBe(30000);
    // Without the refund it would have been 35000 — the refund reduced expected.
    expect(expectedCash(10000, saleCash)).toBe(35000);
  });

  it("can go below the opening float if refunds exceed sale cash", () => {
    // Edge: a refund larger than the day's cash sales (e.g. refunding a prior
    // session's sale) pulls expected cash below the float.
    expect(expectedCash(10000, -3000)).toBe(7000);
  });
});

describe("computeVariance", () => {
  it("is counted minus expected", () => {
    expect(computeVariance(35000, 35000)).toBe(0);
    expect(computeVariance(35500, 35000)).toBe(500); // over
    expect(computeVariance(34500, 35000)).toBe(-500); // short
  });
});

describe("varianceKind", () => {
  it("labels over / short / exact", () => {
    expect(varianceKind(500)).toBe("OVER");
    expect(varianceKind(-500)).toBe("SHORT");
    expect(varianceKind(0)).toBe("EXACT");
  });
});

describe("reconcile", () => {
  it("computes an exact drawer", () => {
    const r = reconcile(10000, 25000, 35000);
    expect(r).toEqual({
      expectedCents: 35000,
      countedCents: 35000,
      varianceCents: 0,
      kind: "EXACT",
    });
  });

  it("flags an over drawer", () => {
    const r = reconcile(10000, 25000, 35500);
    expect(r.expectedCents).toBe(35000);
    expect(r.varianceCents).toBe(500);
    expect(r.kind).toBe("OVER");
  });

  it("flags a short drawer", () => {
    const r = reconcile(10000, 25000, 34000);
    expect(r.varianceCents).toBe(-1000);
    expect(r.kind).toBe("SHORT");
  });

  it("handles a drawer with no sales (counted vs float only)", () => {
    const r = reconcile(10000, 0, 10000);
    expect(r.expectedCents).toBe(10000);
    expect(r.varianceCents).toBe(0);
    expect(r.kind).toBe("EXACT");
  });

  it("a cash refund reduces expected cash so the count still reconciles", () => {
    // Float $100, $250 cash sales, then a $50 cash refund → net cash $200.
    // Expected = 100 + 200 = $300. A drawer counted at exactly $300 is EXACT,
    // proving the refunded cash left the till and the drawer still balances.
    const netCash = 25000 - 5000; // sale cash + negative refund payment
    const r = reconcile(10000, netCash, 30000);
    expect(r.expectedCents).toBe(30000);
    expect(r.varianceCents).toBe(0);
    expect(r.kind).toBe("EXACT");
    // If the refunded cash were NOT removed (status-only accounting), the count
    // would look $50 short against a stale $350 expected — the bug this fixes.
    const stale = reconcile(10000, 25000, 30000);
    expect(stale.varianceCents).toBe(-5000);
    expect(stale.kind).toBe("SHORT");
  });

  it("never produces NaN from non-finite inputs", () => {
    const r = reconcile(NaN, Infinity, -Infinity);
    expect(Number.isNaN(r.expectedCents)).toBe(false);
    expect(Number.isNaN(r.varianceCents)).toBe(false);
    expect(r).toEqual({
      expectedCents: 0,
      countedCents: 0,
      varianceCents: 0,
      kind: "EXACT",
    });
  });
});
