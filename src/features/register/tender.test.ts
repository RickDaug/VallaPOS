import { describe, it, expect } from "vitest";
import { applyNumpadKey, dollarsToCents, quickTenderOptions } from "@/features/register/tender";

describe("applyNumpadKey", () => {
  it("appends digits and replaces a lone leading zero", () => {
    expect(applyNumpadKey("", "5")).toBe("5");
    expect(applyNumpadKey("0", "5")).toBe("5");
    expect(applyNumpadKey("1", "2")).toBe("12");
  });

  it("handles the decimal point: one only, and seeds a leading zero", () => {
    expect(applyNumpadKey("", ".")).toBe("0.");
    expect(applyNumpadKey("12", ".")).toBe("12.");
    expect(applyNumpadKey("12.5", ".")).toBe("12.5"); // already has one
  });

  it("caps at two fractional digits", () => {
    expect(applyNumpadKey("1.2", "5")).toBe("1.25");
    expect(applyNumpadKey("1.25", "9")).toBe("1.25"); // ignored
  });

  it("backspaces and ignores unexpected keys", () => {
    expect(applyNumpadKey("1.25", "back")).toBe("1.2");
    expect(applyNumpadKey("", "back")).toBe("");
    expect(applyNumpadKey("5", "x")).toBe("5");
  });
});

describe("dollarsToCents", () => {
  it("parses to integer cents, 0 for blank/invalid", () => {
    expect(dollarsToCents("10.83")).toBe(1083);
    expect(dollarsToCents("5")).toBe(500);
    expect(dollarsToCents("")).toBe(0);
    expect(dollarsToCents("abc")).toBe(0);
  });
});

describe("quickTenderOptions", () => {
  it("offers exact, next dollar, and covering bills, sorted & deduped", () => {
    // $12.40 → exact 1240, next dollar 1300, then $20/$50/$100 (capped to 4)
    expect(quickTenderOptions(1240)).toEqual([1240, 1300, 2000, 5000]);
  });

  it("dedupes when the total is already a round bill", () => {
    // $20.00 → exact==nextDollar==the $20 bill; next distinct bills follow
    expect(quickTenderOptions(2000)).toEqual([2000, 5000, 10000]);
  });

  it("returns nothing for a non-positive total", () => {
    expect(quickTenderOptions(0)).toEqual([]);
  });
});
