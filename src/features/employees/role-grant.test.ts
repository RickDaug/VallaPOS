import { describe, it, expect, beforeEach, vi } from "vitest";

// Privilege-escalation regression: a MANAGER must NOT be able to grant/assign the
// OWNER role via any member-management action (addMember / addStaffMember /
// changeMemberRole). roleSchema accepts "OWNER" as a target, so the gate lives in
// the action (canGrantRole). Only an OWNER may grant OWNER. The real (pure)
// canGrantRole from @/lib/roles is used; only tenant + db are stubbed.
const requireMembership = vi.fn();
const userFindUnique = vi.fn();
const membershipCreate = vi.fn();
const membershipFindUnique = vi.fn();
const membershipFindFirst = vi.fn();
const membershipCount = vi.fn();
const membershipUpdateMany = vi.fn();

// ForbiddenError is defined INSIDE the factory: vi.mock is hoisted above the file
// body, so a top-level class would be in the temporal dead zone when the factory
// evaluates. Tests assert on the thrown message ("CANNOT_GRANT_ROLE") instead of
// the class identity, so they don't need a top-level reference to it.
vi.mock("@/lib/tenant", () => {
  class ForbiddenError extends Error {}
  return {
    requireMembership: (...a: unknown[]) => requireMembership(...a),
    // assertRole is pure (no DB); re-implement against roleAtLeast semantics.
    assertRole: (ctx: { role: string }, min: string) => {
      const rank: Record<string, number> = { CASHIER: 0, MANAGER: 1, OWNER: 2 };
      if (rank[ctx.role]! < rank[min]!) throw new ForbiddenError(`REQUIRES_${min}`);
    },
    ForbiddenError,
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/pin-throttle", () => ({
  assertNotLocked: vi.fn(),
  recordFailure: vi.fn(),
  recordSuccess: vi.fn(),
}));
vi.mock("@/lib/operator", () => ({
  setActiveOperator: vi.fn(),
  clearActiveOperator: vi.fn(),
  getActiveOperator: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    membership: {
      create: (...a: unknown[]) => membershipCreate(...a),
      findUnique: (...a: unknown[]) => membershipFindUnique(...a),
      findFirst: (...a: unknown[]) => membershipFindFirst(...a),
      count: (...a: unknown[]) => membershipCount(...a),
      updateMany: (...a: unknown[]) => membershipUpdateMany(...a),
    },
  },
}));

import { addMember, addStaffMember, changeMemberRole } from "./actions";

const BUSINESS_ID = "biz_1";

function asManager() {
  requireMembership.mockResolvedValue({ userId: "u1", businessId: BUSINESS_ID, membershipId: "m1", role: "MANAGER" });
}
function asOwner() {
  requireMembership.mockResolvedValue({ userId: "u1", businessId: BUSINESS_ID, membershipId: "m1", role: "OWNER" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MANAGER cannot grant OWNER (privilege-escalation guard)", () => {
  it("changeMemberRole → OWNER is rejected without touching the DB", async () => {
    asManager();
    await expect(
      changeMemberRole({ businessId: BUSINESS_ID, membershipId: "mem_2", role: "OWNER" }),
    ).rejects.toThrow("CANNOT_GRANT_ROLE");
    // Guard fires BEFORE the target lookup / update — no write, no read.
    expect(membershipFindFirst).not.toHaveBeenCalled();
    expect(membershipUpdateMany).not.toHaveBeenCalled();
  });

  it("addMember with role OWNER is rejected without touching the DB", async () => {
    asManager();
    await expect(
      addMember({ businessId: BUSINESS_ID, email: "new@example.com", role: "OWNER" }),
    ).rejects.toThrow("CANNOT_GRANT_ROLE");
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(membershipCreate).not.toHaveBeenCalled();
  });

  it("addStaffMember with role OWNER is rejected without touching the DB", async () => {
    asManager();
    await expect(
      addStaffMember({ businessId: BUSINESS_ID, name: "Sam", role: "OWNER", pin: "4321" }),
    ).rejects.toThrow("CANNOT_GRANT_ROLE");
    expect(membershipCreate).not.toHaveBeenCalled();
  });

  it("a MANAGER can still grant MANAGER (rank at/below own is allowed)", async () => {
    asManager();
    membershipCreate.mockResolvedValue({ id: "mem_new" });
    const res = await addStaffMember({ businessId: BUSINESS_ID, name: "Sam", role: "MANAGER", pin: "4321" });
    expect(res).toEqual({ membershipId: "mem_new" });
    expect(membershipCreate).toHaveBeenCalledTimes(1);
  });
});

describe("OWNER can grant OWNER", () => {
  it("changeMemberRole → OWNER succeeds for an OWNER caller", async () => {
    asOwner();
    membershipFindFirst.mockResolvedValue({ id: "mem_2", role: "MANAGER" });
    membershipUpdateMany.mockResolvedValue({ count: 1 });

    await changeMemberRole({ businessId: BUSINESS_ID, membershipId: "mem_2", role: "OWNER" });

    expect(membershipUpdateMany).toHaveBeenCalledTimes(1);
    expect(membershipUpdateMany.mock.calls[0]![0].data).toEqual({ role: "OWNER" });
  });

  it("addStaffMember with role OWNER succeeds for an OWNER caller", async () => {
    asOwner();
    membershipCreate.mockResolvedValue({ id: "mem_new" });

    const res = await addStaffMember({ businessId: BUSINESS_ID, name: "Boss", role: "OWNER", pin: "4321" });
    expect(res).toEqual({ membershipId: "mem_new" });
    expect(membershipCreate.mock.calls[0]![0].data.role).toBe("OWNER");
  });

  it("addMember with role OWNER succeeds for an OWNER caller", async () => {
    asOwner();
    userFindUnique.mockResolvedValue({ id: "u2" });
    membershipFindUnique.mockResolvedValue(null);
    membershipCreate.mockResolvedValue({ id: "mem_new" });

    const res = await addMember({ businessId: BUSINESS_ID, email: "boss@example.com", role: "OWNER" });
    expect(res).toEqual({ membershipId: "mem_new" });
    expect(membershipCreate.mock.calls[0]![0].data.role).toBe("OWNER");
  });
});
