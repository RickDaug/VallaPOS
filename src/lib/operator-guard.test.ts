import { describe, it, expect, beforeEach, vi } from "vitest";

const requireMembership = vi.fn();
const getActiveOperator = vi.fn();

vi.mock("@/lib/tenant", () => {
  class ForbiddenError extends Error {}
  return { ForbiddenError, requireMembership: (...a: unknown[]) => requireMembership(...a) };
});
vi.mock("@/lib/operator", () => ({
  getActiveOperator: (...a: unknown[]) => getActiveOperator(...a),
}));

import { requireCapability, pageHasCapability, OperatorLockedError } from "./operator-guard";

const BIZ = "biz_1";

beforeEach(() => {
  vi.clearAllMocks();
  requireMembership.mockResolvedValue({ userId: "u1", businessId: BIZ, membershipId: "dev1", role: "OWNER" });
});

describe("requireCapability", () => {
  it("throws OperatorLockedError when no operator is active", async () => {
    getActiveOperator.mockResolvedValue(null);
    await expect(requireCapability(BIZ, "take_orders")).rejects.toBeInstanceOf(OperatorLockedError);
  });

  it("throws when the operator lacks the capability", async () => {
    getActiveOperator.mockResolvedValue({ membershipId: "m1", role: "CASHIER", permissions: ["take_orders"], name: "Sam" });
    await expect(requireCapability(BIZ, "refund_void")).rejects.toThrow(/REQUIRES_CAPABILITY_refund_void/);
  });

  it("returns the operator context (with device membership) when permitted", async () => {
    getActiveOperator.mockResolvedValue({ membershipId: "m1", role: "CASHIER", permissions: ["take_orders"], name: "Sam" });
    const ctx = await requireCapability(BIZ, "take_orders");
    expect(ctx.membershipId).toBe("m1"); // the operator, used for attribution
    expect(ctx.businessId).toBe(BIZ);
    expect(ctx.deviceMembershipId).toBe("dev1");
  });

  it("OWNER passes any capability regardless of stored permissions", async () => {
    getActiveOperator.mockResolvedValue({ membershipId: "own", role: "OWNER", permissions: [], name: "Boss" });
    await expect(requireCapability(BIZ, "manage_settings")).resolves.toMatchObject({ membershipId: "own" });
  });
});

describe("pageHasCapability", () => {
  it("false when locked, true/false by capability when unlocked", async () => {
    getActiveOperator.mockResolvedValue(null);
    expect(await pageHasCapability(BIZ, "view_reports")).toBe(false);

    getActiveOperator.mockResolvedValue({ membershipId: "m1", role: "CASHIER", permissions: ["view_reports"], name: "S" });
    expect(await pageHasCapability(BIZ, "view_reports")).toBe(true);
    expect(await pageHasCapability(BIZ, "manage_team")).toBe(false);
  });
});
