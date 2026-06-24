import { describe, it, expect } from "vitest";
import {
  CAPABILITIES,
  can,
  defaultCapabilitiesFor,
  sanitizeCapabilities,
  isCapability,
} from "./capabilities";

describe("can", () => {
  it("OWNER passes every capability regardless of stored permissions", () => {
    for (const cap of CAPABILITIES) {
      expect(can("OWNER", [], cap)).toBe(true);
    }
  });

  it("non-owners are granted a capability only if it's listed", () => {
    expect(can("CASHIER", ["take_orders"], "take_orders")).toBe(true);
    expect(can("CASHIER", ["take_orders"], "refund_void")).toBe(false);
    expect(can("MANAGER", [], "manage_products")).toBe(false); // empty perms => denied
  });
});

describe("defaultCapabilitiesFor", () => {
  it("MANAGER defaults to all capabilities", () => {
    expect(defaultCapabilitiesFor("MANAGER").sort()).toEqual([...CAPABILITIES].sort());
  });
  it("CASHIER defaults to the looser set (no refunds/products/team/settings)", () => {
    expect(defaultCapabilitiesFor("CASHIER").sort()).toEqual(
      ["cash_drawer", "take_orders", "view_reports"].sort(),
    );
  });
  it("returns a fresh array (callers can mutate safely)", () => {
    const a = defaultCapabilitiesFor("CASHIER");
    a.push("refund_void");
    expect(defaultCapabilitiesFor("CASHIER")).not.toContain("refund_void");
  });
});

describe("sanitizeCapabilities", () => {
  it("drops unknown keys and dedupes", () => {
    expect(sanitizeCapabilities(["take_orders", "bogus", "take_orders", "refund_void"])).toEqual([
      "take_orders",
      "refund_void",
    ]);
  });
});

describe("isCapability", () => {
  it("recognizes known keys only", () => {
    expect(isCapability("take_orders")).toBe(true);
    expect(isCapability("nope")).toBe(false);
  });
});
