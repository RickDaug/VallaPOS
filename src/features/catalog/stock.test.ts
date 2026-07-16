import { describe, it, expect } from "vitest";
import {
  LOW_STOCK_THRESHOLD,
  isOutOfStock,
  isLowStock,
  stockStatus,
  type StockStatus,
} from "./stock";

describe("stock helpers", () => {
  it("pins the low-stock threshold at 5", () => {
    expect(LOW_STOCK_THRESHOLD).toBe(5);
  });

  describe("isOutOfStock", () => {
    it("is true only when tracking and depleted (<= 0)", () => {
      expect(isOutOfStock(0)).toBe(true);
      expect(isOutOfStock(-3)).toBe(true); // oversold — honestly negative
    });

    it("is false above zero", () => {
      expect(isOutOfStock(1)).toBe(false);
      expect(isOutOfStock(999)).toBe(false);
    });

    it("is false when not tracking (null/undefined)", () => {
      expect(isOutOfStock(null)).toBe(false);
      expect(isOutOfStock(undefined)).toBe(false);
    });
  });

  describe("isLowStock", () => {
    it("is true across the whole (0, threshold] band", () => {
      for (let s = 1; s <= LOW_STOCK_THRESHOLD; s++) {
        expect(isLowStock(s)).toBe(true);
      }
    });

    it("is false at zero (that's out, not low)", () => {
      expect(isLowStock(0)).toBe(false);
      expect(isLowStock(-1)).toBe(false);
    });

    it("is false just above the threshold", () => {
      expect(isLowStock(LOW_STOCK_THRESHOLD + 1)).toBe(false);
      expect(isLowStock(100)).toBe(false);
    });

    it("is false when not tracking (null/undefined)", () => {
      expect(isLowStock(null)).toBe(false);
      expect(isLowStock(undefined)).toBe(false);
    });
  });

  describe("stockStatus", () => {
    const cases: [number | null | undefined, StockStatus][] = [
      [null, "untracked"],
      [undefined, "untracked"],
      [-2, "out"],
      [0, "out"],
      [1, "low"],
      [5, "low"],
      [6, "ok"],
      [1000, "ok"],
    ];
    it.each(cases)("classifies %s as %s", (stock, expected) => {
      expect(stockStatus(stock)).toBe(expected);
    });

    it("agrees with the boolean helpers", () => {
      for (const s of [null, undefined, -1, 0, 3, 5, 6, 42]) {
        const status = stockStatus(s);
        expect(status === "out").toBe(isOutOfStock(s));
        expect(status === "low").toBe(isLowStock(s));
      }
    });
  });
});
