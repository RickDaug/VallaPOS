import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * resetOwnOperatorPin — the forgotten-PIN escape hatch.
 *
 * Without it the device is a brick: the lock screen renders INSTEAD of the app
 * shell, becomeSelfOperator refuses once a PIN exists, and signing out and back
 * in returns to the same lock screen.
 *
 * The security property under test is the one that makes it safe to exist: the
 * PIN protects a SHARED terminal whose session belongs to the owner, so recovery
 * must demand the ACCOUNT PASSWORD (which co-workers don't have) and must never
 * become a bypass for whoever is holding the device.
 */
const requireMembership = vi.fn();
const membershipUpdate = vi.fn();
const userFindUnique = vi.fn();
const signInEmail = vi.fn();
const setActiveOperator = vi.fn();
const assertNotLocked = vi.fn();
const recordFailure = vi.fn();
const recordSuccess = vi.fn();

vi.mock("@/lib/tenant", () => ({
  requireMembership: (...a: unknown[]) => requireMembership(...a),
  assertRole: vi.fn(),
  ForbiddenError: class extends Error {},
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/pin-throttle", () => ({
  assertNotLocked: (...a: unknown[]) => assertNotLocked(...a),
  recordFailure: (...a: unknown[]) => recordFailure(...a),
  recordSuccess: (...a: unknown[]) => recordSuccess(...a),
}));
vi.mock("@/lib/operator", () => ({
  setActiveOperator: (...a: unknown[]) => setActiveOperator(...a),
  clearActiveOperator: vi.fn(),
  getActiveOperator: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { signInEmail: (...a: unknown[]) => signInEmail(...a) } },
}));
vi.mock("@/lib/edition", () => ({ authMode: "session" }));
vi.mock("@/lib/db", () => ({
  db: {
    membership: { update: (...a: unknown[]) => membershipUpdate(...a), create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
  },
}));

import { resetOwnOperatorPin } from "./actions";

const BUSINESS_ID = "biz_1";
const CTX = { userId: "u1", businessId: BUSINESS_ID, membershipId: "m1", role: "OWNER" };

beforeEach(() => {
  vi.clearAllMocks();
  requireMembership.mockResolvedValue(CTX);
  userFindUnique.mockResolvedValue({ email: "owner@shop.test" });
  assertNotLocked.mockResolvedValue(undefined);
});

describe("resetOwnOperatorPin", () => {
  it("clears the caller's OWN pin and signs them in when the password is right", async () => {
    signInEmail.mockResolvedValue({ user: { id: "u1" } });

    const res = await resetOwnOperatorPin({ businessId: BUSINESS_ID, password: "correct-horse" });

    expect(res).toEqual({ ok: true });
    // Own membership only — never a target id from the client.
    expect(membershipUpdate).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { pinHash: null },
    });
    expect(setActiveOperator).toHaveBeenCalledWith(BUSINESS_ID, "m1");
    expect(recordSuccess).toHaveBeenCalled();
  });

  it("refuses a wrong password and does NOT clear the pin", async () => {
    signInEmail.mockRejectedValue(new Error("invalid credentials"));

    const res = await resetOwnOperatorPin({ businessId: BUSINESS_ID, password: "wrong" });

    expect(res).toEqual({ ok: false, reason: "bad_password" });
    expect(membershipUpdate).not.toHaveBeenCalled();
    expect(setActiveOperator).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalled(); // feeds the throttle
  });

  it("refuses when the password belongs to a DIFFERENT user than the device session", async () => {
    // Better Auth resolved a user, but not the one whose membership we'd clear.
    signInEmail.mockResolvedValue({ user: { id: "someone-else" } });

    const res = await resetOwnOperatorPin({ businessId: BUSINESS_ID, password: "other-persons-password" });

    expect(res).toEqual({ ok: false, reason: "bad_password" });
    expect(membershipUpdate).not.toHaveBeenCalled();
  });

  it("is throttled — a locked-out caller is refused before any password check", async () => {
    assertNotLocked.mockRejectedValue(new Error("LOCKED"));

    const res = await resetOwnOperatorPin({ businessId: BUSINESS_ID, password: "guess" });

    expect(res).toEqual({ ok: false, reason: "locked" });
    // The point: no password attempt is made at all, so this can't be used as an
    // unlimited password oracle against a device someone picked up.
    expect(signInEmail).not.toHaveBeenCalled();
    expect(membershipUpdate).not.toHaveBeenCalled();
  });

  it("rejects an empty password at the schema boundary", async () => {
    await expect(
      resetOwnOperatorPin({ businessId: BUSINESS_ID, password: "" }),
    ).rejects.toThrow();
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it("is tenant-scoped — it never trusts a businessId the caller isn't a member of", async () => {
    requireMembership.mockRejectedValue(new Error("NOT_A_MEMBER"));

    await expect(
      resetOwnOperatorPin({ businessId: "biz_someone_else", password: "x" }),
    ).rejects.toThrow();
    expect(membershipUpdate).not.toHaveBeenCalled();
  });
});
