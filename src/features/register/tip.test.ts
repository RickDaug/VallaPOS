import { describe, it, expect } from "vitest";
import { tipCentsFor, TIP_PERCENTS, NO_TIP, type TipSelection } from "@/features/register/tip";

describe("tipCentsFor", () => {
  it("returns 0 for No-Tip regardless of base", () => {
    expect(tipCentsFor(NO_TIP, 0)).toBe(0);
    expect(tipCentsFor(NO_TIP, 123_45)).toBe(0);
  });

  it("computes anchored percentages, rounded to the nearest cent", () => {
    // $50.00 base
    expect(tipCentsFor({ kind: "percent", rate: 0.15 }, 5000)).toBe(750);
    expect(tipCentsFor({ kind: "percent", rate: 0.2 }, 5000)).toBe(1000);
    expect(tipCentsFor({ kind: "percent", rate: 0.25 }, 5000)).toBe(1250);
  });

  it("rounds fractional percentage cents (never leaks a float)", () => {
    // $10.83 * 15% = 162.45c → 162c
    const cents = tipCentsFor({ kind: "percent", rate: 0.15 }, 1083);
    expect(cents).toBe(162);
    expect(Number.isInteger(cents)).toBe(true);
  });

  it("passes a custom amount through as whole cents", () => {
    expect(tipCentsFor({ kind: "custom", cents: 300 }, 5000)).toBe(300);
  });

  it("clamps custom and negative bases to non-negative integers", () => {
    expect(tipCentsFor({ kind: "custom", cents: -50 }, 5000)).toBe(0);
    expect(tipCentsFor({ kind: "custom", cents: 199.6 }, 5000)).toBe(200);
    expect(tipCentsFor({ kind: "percent", rate: 0.2 }, -100)).toBe(0);
  });

  it("exposes exactly the three anchored options", () => {
    expect(TIP_PERCENTS).toEqual([0.15, 0.2, 0.25]);
  });

  it("is exhaustive over the selection union", () => {
    const selections: TipSelection[] = [
      { kind: "none" },
      { kind: "percent", rate: 0.2 },
      { kind: "custom", cents: 100 },
    ];
    for (const s of selections) {
      expect(Number.isInteger(tipCentsFor(s, 4200))).toBe(true);
    }
  });
});
