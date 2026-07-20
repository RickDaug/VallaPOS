import { describe, it, expect, beforeEach, vi } from "vitest";
import { verifyPin } from "./pin";

// addStaffMember + setMemberPermissions exercised with REAL zod + REAL capability
// logic, DB + tenant choke point stubbed. We assert: PIN-only staff are created
// with userId:null + a hashed PIN + role-default capabilities; setMemberPermissions
// is OWNER-only and drops unknown capability keys.
const requireMembership = vi.fn();
const membershipCreate = vi.fn();
const membershipFindFirst = vi.fn();
const membershipUpdateMany = vi.fn();

vi.mock("@/lib/tenant", () => ({
  requireMembership: (...a: unknown[]) => requireMembership(...a),
  // assertRole is pure (no DB); re-implement against roleAtLeast semantics.
  assertRole: (ctx: { role: string }, min: string) => {
    const rank: Record<string, number> = { CASHIER: 0, MANAGER: 1, OWNER: 2 };
    if (rank[ctx.role]! < rank[min]!) throw new Error(`REQUIRES_${min}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// pin-throttle pulls in env/redis at import; these two actions don't use it.
vi.mock("@/lib/pin-throttle", () => ({
  assertNotLocked: vi.fn(),
  recordFailure: vi.fn(),
  recordSuccess: vi.fn(),
}));
// operator.ts imports env (cookies); the operator actions aren't tested here.
vi.mock("@/lib/operator", () => ({
  setActiveOperator: vi.fn(),
  clearActiveOperator: vi.fn(),
  getActiveOperator: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    membership: {
      create: (...a: unknown[]) => membershipCreate(...a),
      findFirst: (...a: unknown[]) => membershipFindFirst(...a),
      updateMany: (...a: unknown[]) => membershipUpdateMany(...a),
    },
  },
}));

import { addStaffMember, setMemberPermissions } from "./actions";

const BUSINESS_ID = "biz_1";

beforeEach(() => {
  vi.clearAllMocks();
  requireMembership.mockResolvedValue({ userId: "u1", businessId: BUSINESS_ID, membershipId: "m1", role: "OWNER" });
});

describe("addStaffMember", () => {
  it("creates a PIN-only membership (userId null, hashed pin, role-default caps)", async () => {
    requireMembership.mockResolvedValue({ userId: "u1", businessId: BUSINESS_ID, membershipId: "m1", role: "MANAGER" });
    membershipCreate.mockResolvedValue({ id: "mem_new" });

    const res = await addStaffMember({ businessId: BUSINESS_ID, name: "Sam", role: "CASHIER", pin: "4321" });
    expect(res).toEqual({ membershipId: "mem_new" });

    const data = membershipCreate.mock.calls[0]![0].data;
    expect(data.userId).toBeNull();
    expect(data.name).toBe("Sam");
    expect(data.businessId).toBe(BUSINESS_ID);
    expect(data.role).toBe("CASHIER");
    // CASHIER role default capabilities
    expect([...data.permissions].sort()).toEqual(["cash_drawer", "take_orders", "view_reports"].sort());
    // PIN is hashed, never stored/echoed in plaintext
    expect(typeof data.pinHash).toBe("string");
    expect(data.pinHash).toMatch(/^scrypt\$/);
    // Hashed + verifiable — never the plaintext PIN. (Asserting the hash string
    // merely "doesn't contain 4321" was FLAKY: a 128-hex-char scrypt hash can
    // contain those four digits by chance. Prove it's a real hash instead —
    // verifyPin recomputes scrypt from the embedded salt, so this is deterministic.)
    expect(verifyPin("4321", data.pinHash)).toBe(true);
    expect(verifyPin("0000", data.pinHash)).toBe(false);
  });

  it("requires MANAGER+ (a cashier cannot add staff)", async () => {
    requireMembership.mockResolvedValue({ userId: "u1", businessId: BUSINESS_ID, membershipId: "m1", role: "CASHIER" });
    await expect(
      addStaffMember({ businessId: BUSINESS_ID, name: "Sam", role: "CASHIER", pin: "4321" }),
    ).rejects.toThrow(/REQUIRES_MANAGER/);
    expect(membershipCreate).not.toHaveBeenCalled();
  });

  it("rejects an invalid PIN (too short)", async () => {
    requireMembership.mockResolvedValue({ userId: "u1", businessId: BUSINESS_ID, membershipId: "m1", role: "MANAGER" });
    await expect(
      addStaffMember({ businessId: BUSINESS_ID, name: "Sam", role: "CASHIER", pin: "12" }),
    ).rejects.toThrow();
    expect(membershipCreate).not.toHaveBeenCalled();
  });
});

describe("setMemberPermissions", () => {
  it("is OWNER-only (a manager cannot change permissions)", async () => {
    requireMembership.mockResolvedValue({ userId: "u1", businessId: BUSINESS_ID, membershipId: "m1", role: "MANAGER" });
    await expect(
      setMemberPermissions({ businessId: BUSINESS_ID, membershipId: "mem_2", permissions: ["take_orders"] }),
    ).rejects.toThrow(/REQUIRES_OWNER/);
    expect(membershipUpdateMany).not.toHaveBeenCalled();
  });

  it("drops unknown capability keys before persisting", async () => {
    membershipFindFirst.mockResolvedValue({ id: "mem_2" });
    await setMemberPermissions({
      businessId: BUSINESS_ID,
      membershipId: "mem_2",
      permissions: ["take_orders", "bogus", "refund_void", "take_orders"],
    });
    const data = membershipUpdateMany.mock.calls[0]![0].data;
    expect(data.permissions).toEqual(["take_orders", "refund_void"]);
  });

  it("throws when the target member isn't in this business", async () => {
    membershipFindFirst.mockResolvedValue(null);
    await expect(
      setMemberPermissions({ businessId: BUSINESS_ID, membershipId: "ghost", permissions: ["take_orders"] }),
    ).rejects.toThrow(/Member not found/);
  });
});
