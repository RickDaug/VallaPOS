import { describe, it, expect } from "vitest";
import { roleAtLeast, ROLE_RANK } from "./roles";

describe("roleAtLeast", () => {
  it("OWNER satisfies every requirement", () => {
    expect(roleAtLeast("OWNER", "OWNER")).toBe(true);
    expect(roleAtLeast("OWNER", "MANAGER")).toBe(true);
    expect(roleAtLeast("OWNER", "CASHIER")).toBe(true);
  });

  it("MANAGER satisfies MANAGER and below, not OWNER", () => {
    expect(roleAtLeast("MANAGER", "OWNER")).toBe(false);
    expect(roleAtLeast("MANAGER", "MANAGER")).toBe(true);
    expect(roleAtLeast("MANAGER", "CASHIER")).toBe(true);
  });

  it("CASHIER only satisfies CASHIER", () => {
    expect(roleAtLeast("CASHIER", "OWNER")).toBe(false);
    expect(roleAtLeast("CASHIER", "MANAGER")).toBe(false);
    expect(roleAtLeast("CASHIER", "CASHIER")).toBe(true);
  });

  it("ranks are strictly ordered", () => {
    expect(ROLE_RANK.CASHIER).toBeLessThan(ROLE_RANK.MANAGER);
    expect(ROLE_RANK.MANAGER).toBeLessThan(ROLE_RANK.OWNER);
  });
});
