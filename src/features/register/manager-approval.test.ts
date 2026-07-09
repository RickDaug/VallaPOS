import { describe, it, expect, beforeEach, vi } from "vitest";

// manager-approval verifies a submitted PIN against active, capability-holding
// members of the business. Brute-force protection lives on a SEPARATE, business-
// scoped APPROVAL throttle namespace — never on the candidate managers' personal
// PIN keys (which are shared with operator-unlock / clock-in). We stub the DB
// membership lookup, the approval throttle, and the scrypt verifier so the
// candidate selection + matching + throttle wiring are tested in isolation.
const membershipFindMany = vi.fn();
const assertApprovalNotLocked = vi.fn();
const recordApprovalFailure = vi.fn();
const recordApprovalSuccess = vi.fn();
const recordSuccess = vi.fn();
const recordFailure = vi.fn();
const verifyPin = vi.fn();

vi.mock("@/lib/db", () => ({
  db: { membership: { findMany: (...a: unknown[]) => membershipFindMany(...a) } },
}));
vi.mock("@/lib/pin-throttle", () => ({
  assertApprovalNotLocked: (...a: unknown[]) => assertApprovalNotLocked(...a),
  recordApprovalFailure: (...a: unknown[]) => recordApprovalFailure(...a),
  recordApprovalSuccess: (...a: unknown[]) => recordApprovalSuccess(...a),
  recordSuccess: (...a: unknown[]) => recordSuccess(...a),
  recordFailure: (...a: unknown[]) => recordFailure(...a),
}));
vi.mock("@/features/employees/pin", () => ({
  verifyPin: (...a: unknown[]) => verifyPin(...a),
}));

import { verifyManagerApproval, APPROVE_UNVERIFIED_TENDER } from "./manager-approval";

const BUSINESS_ID = "biz_1";

beforeEach(() => {
  vi.clearAllMocks();
  assertApprovalNotLocked.mockResolvedValue(undefined);
  recordApprovalFailure.mockResolvedValue(undefined);
  recordApprovalSuccess.mockResolvedValue(undefined);
  recordSuccess.mockResolvedValue(undefined);
  recordFailure.mockResolvedValue(undefined);
  verifyPin.mockReturnValue(false);
  membershipFindMany.mockResolvedValue([]);
});

describe("verifyManagerApproval — candidate selection", () => {
  it("queries active, PIN-set members of THIS business who are OWNER or hold the capability", async () => {
    await verifyManagerApproval(BUSINESS_ID, "1234");
    expect(membershipFindMany).toHaveBeenCalledWith({
      where: {
        businessId: BUSINESS_ID,
        active: true,
        pinHash: { not: null },
        OR: [{ role: "OWNER" }, { permissions: { has: APPROVE_UNVERIFIED_TENDER } }],
      },
      select: { id: true, pinHash: true },
    });
  });

  it("returns false when NO member can approve (no manager/owner PIN configured)", async () => {
    membershipFindMany.mockResolvedValue([]);
    expect(await verifyManagerApproval(BUSINESS_ID, "1234")).toBe(false);
    expect(verifyPin).not.toHaveBeenCalled();
  });
});

describe("verifyManagerApproval — matching", () => {
  it("returns true when the PIN matches a capability-holder and records success", async () => {
    membershipFindMany.mockResolvedValue([{ id: "mgr_1", pinHash: "scrypt$a$b" }]);
    verifyPin.mockReturnValue(true);

    expect(await verifyManagerApproval(BUSINESS_ID, "4321")).toBe(true);
    expect(verifyPin).toHaveBeenCalledWith("4321", "scrypt$a$b");
    // Success resets ONLY the matching manager's own throttle + the approval one.
    expect(recordSuccess).toHaveBeenCalledWith(BUSINESS_ID, "mgr_1");
    expect(recordApprovalSuccess).toHaveBeenCalledWith(BUSINESS_ID);
    // No failure is ever recorded on a manager's personal key or the approval key.
    expect(recordFailure).not.toHaveBeenCalled();
    expect(recordApprovalFailure).not.toHaveBeenCalled();
  });

  it("returns false and records a SINGLE approval-namespace failure when the PIN matches no holder", async () => {
    membershipFindMany.mockResolvedValue([{ id: "mgr_1", pinHash: "scrypt$a$b" }]);
    verifyPin.mockReturnValue(false);

    expect(await verifyManagerApproval(BUSINESS_ID, "0000")).toBe(false);
    // The failure lands on the approval namespace, NOT the manager's own key.
    expect(recordApprovalFailure).toHaveBeenCalledTimes(1);
    expect(recordApprovalFailure).toHaveBeenCalledWith(BUSINESS_ID);
    expect(recordFailure).not.toHaveBeenCalled();
    expect(recordSuccess).not.toHaveBeenCalled();
  });

  it("tries each candidate and matches the right one WITHOUT failing the others' keys", async () => {
    membershipFindMany.mockResolvedValue([
      { id: "mgr_1", pinHash: "hash1" },
      { id: "mgr_2", pinHash: "hash2" },
    ]);
    // Only the SECOND manager's PIN matches.
    verifyPin.mockImplementation((_pin: string, hash: string) => hash === "hash2");

    expect(await verifyManagerApproval(BUSINESS_ID, "2222")).toBe(true);
    // BUG #8 regression: the non-matching manager (mgr_1) must NOT be failed.
    expect(recordFailure).not.toHaveBeenCalled();
    expect(recordApprovalFailure).not.toHaveBeenCalled();
    // Only the matcher's own key is reset (plus the approval namespace).
    expect(recordSuccess).toHaveBeenCalledTimes(1);
    expect(recordSuccess).toHaveBeenCalledWith(BUSINESS_ID, "mgr_2");
    expect(recordApprovalSuccess).toHaveBeenCalledWith(BUSINESS_ID);
  });

  it("does not lock innocent managers: 5 valid approvals never fail owner A's key", async () => {
    // Owner A + manager B are both capable; only B's PIN matches the entry.
    membershipFindMany.mockResolvedValue([
      { id: "owner_A", pinHash: "hash_A" },
      { id: "mgr_B", pinHash: "hash_B" },
    ]);
    verifyPin.mockImplementation((_pin: string, hash: string) => hash === "hash_B");

    for (let i = 0; i < 5; i++) {
      expect(await verifyManagerApproval(BUSINESS_ID, "B-pin")).toBe(true);
    }
    // Owner A (and B) were never failure-counted — no self-inflicted lockout.
    expect(recordFailure).not.toHaveBeenCalled();
    expect(recordFailure).not.toHaveBeenCalledWith(BUSINESS_ID, "owner_A");
    expect(recordApprovalFailure).not.toHaveBeenCalled();
  });
});

describe("verifyManagerApproval — approval throttle", () => {
  it("denies generically (without a DB lookup) when the approval surface is locked out", async () => {
    assertApprovalNotLocked.mockRejectedValue(new Error("locked"));

    expect(await verifyManagerApproval(BUSINESS_ID, "1234")).toBe(false);
    expect(membershipFindMany).not.toHaveBeenCalled();
    expect(verifyPin).not.toHaveBeenCalled();
    expect(recordApprovalFailure).not.toHaveBeenCalled();
  });

  it("checks the approval lockout before doing anything else", async () => {
    membershipFindMany.mockResolvedValue([{ id: "mgr_1", pinHash: "h" }]);
    verifyPin.mockReturnValue(false);

    await verifyManagerApproval(BUSINESS_ID, "1234");
    expect(assertApprovalNotLocked).toHaveBeenCalledWith(BUSINESS_ID);
  });
});
