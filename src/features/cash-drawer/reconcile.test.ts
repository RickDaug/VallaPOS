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
