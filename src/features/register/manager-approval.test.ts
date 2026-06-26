import { describe, it, expect, beforeEach, vi } from "vitest";

// manager-approval verifies a submitted PIN against active, capability-holding
// members of the business, with per-member brute-force throttling. We stub the
// DB membership lookup, the throttle, and the scrypt verifier so the candidate
// selection + matching + throttle wiring are tested in isolation.
const membershipFindMany = vi.fn();
const assertNotLocked = vi.fn();
const recordFailure = vi.fn();
const recordSuccess = vi.fn();
const verifyPin = vi.fn();

vi.mock("@/lib/db", () => ({
  db: { membership: { findMany: (...a: unknown[]) => membershipFindMany(...a) } },
}));
vi.mock("@/lib/pin-throttle", () => ({
  assertNotLocked: (...a: unknown[]) => assertNotLocked(...a),
  recordFailure: (...a: unknown[]) => recordFailure(...a),
  recordSuccess: (...a: unknown[]) => recordSuccess(...a),
}));
vi.mock("@/features/employees/pin", () => ({
  verifyPin: (...a: unknown[]) => verifyPin(...a),
}));

import { verifyManagerApproval, APPROVE_UNVERIFIED_TENDER } from "./manager-approval";

const BUSINESS_ID = "biz_1";

beforeEach(() => {
  vi.clearAllMocks();
  assertNotLocked.mockResolvedValue(undefined);
  recordFailure.mockResolvedValue(undefined);
  recordSuccess.mockResolvedValue(undefined);
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
    expect(recordSuccess).toHaveBeenCalledWith(BUSINESS_ID, "mgr_1");
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("returns false and records a failure when the PIN matches no holder (foreign PIN)", async () => {
    membershipFindMany.mockResolvedValue([{ id: "mgr_1", pinHash: "scrypt$a$b" }]);
    verifyPin.mockReturnValue(false);

    expect(await verifyManagerApproval(BUSINESS_ID, "0000")).toBe(false);
    expect(recordFailure).toHaveBeenCalledWith(BUSINESS_ID, "mgr_1");
    expect(recordSuccess).not.toHaveBeenCalled();
  });

  it("tries each candidate and matches the right one (multi-manager business)", async () => {
    membershipFindMany.mockResolvedValue([
      { id: "mgr_1", pinHash: "hash1" },
      { id: "mgr_2", pinHash: "hash2" },
    ]);
    // Only the SECOND manager's PIN matches.
    verifyPin.mockImplementation((_pin: string, hash: string) => hash === "hash2");

    expect(await verifyManagerApproval(BUSINESS_ID, "2222")).toBe(true);
    expect(recordFailure).toHaveBeenCalledWith(BUSINESS_ID, "mgr_1");
    expect(recordSuccess).toHaveBeenCalledWith(BUSINESS_ID, "mgr_2");
  });
});

describe("verifyManagerApproval — throttle", () => {
  it("skips a locked-out candidate and still matches a non-locked one", async () => {
    membershipFindMany.mockResolvedValue([
      { id: "locked", pinHash: "h_locked" },
      { id: "ok", pinHash: "h_ok" },
    ]);
    // The first candidate is locked out; the second is fine and matches.
    assertNotLocked.mockImplementation(async (_b: string, id: string) => {
      if (id === "locked") throw new Error("locked");
    });
    verifyPin.mockImplementation((_pin: string, hash: string) => hash === "h_ok");

    expect(await verifyManagerApproval(BUSINESS_ID, "1234")).toBe(true);
    // The locked candidate was never verified nor failure-counted.
    expect(verifyPin).not.toHaveBeenCalledWith("1234", "h_locked");
    expect(recordFailure).not.toHaveBeenCalledWith(BUSINESS_ID, "locked");
    expect(recordSuccess).toHaveBeenCalledWith(BUSINESS_ID, "ok");
  });

  it("returns false when every capable candidate is locked out", async () => {
    membershipFindMany.mockResolvedValue([{ id: "locked", pinHash: "h" }]);
    assertNotLocked.mockRejectedValue(new Error("locked"));

    expect(await verifyManagerApproval(BUSINESS_ID, "1234")).toBe(false);
    expect(verifyPin).not.toHaveBeenCalled();
  });
});
