import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * The LOCAL (offline desktop) edition's tenant branch (docs/EDITIONS.md §4). This
 * lives in its own file because `tenant.ts` reads the EDITION at import time, so
 * the flag must be set BEFORE the (dynamic) import below. The guarantee under
 * test: when `authMode === "pin-only"`, `requireMembership`/`requireSession`
 * resolve a FIXED single-operator OWNER context WITHOUT ever calling Better Auth
 * or the DB — both of which are stubbed to THROW so any accidental call fails.
 */

vi.stubEnv("NEXT_PUBLIC_VALLA_EDITION", "local");

const getSession = vi.fn(() => {
  throw new Error("auth.api.getSession must not be called in the local edition");
});
const membershipFindUnique = vi.fn(() => {
  throw new Error("db.membership.findUnique must not be called in the local edition");
});

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/db", () => ({ db: { membership: { findUnique: membershipFindUnique } } }));

const { requireMembership, requireSession } = await import("./tenant");

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("tenant — local (pin-only) edition", () => {
  it("requireMembership returns the fixed OWNER context, no auth/db calls", async () => {
    const ctx = await requireMembership("local");
    expect(ctx).toEqual({
      userId: "local-user",
      businessId: "local",
      membershipId: "local-user",
      role: "OWNER",
    });
    expect(getSession).not.toHaveBeenCalled();
    expect(membershipFindUnique).not.toHaveBeenCalled();
  });

  it("scopes the returned context to the caller's businessId", async () => {
    const ctx = await requireMembership("some-biz");
    expect(ctx.businessId).toBe("some-biz");
    expect(ctx.role).toBe("OWNER");
  });

  it("requireSession returns a fixed local session (user.id only), no auth call", async () => {
    const session = await requireSession();
    expect(session.user.id).toBe("local-user");
    expect(getSession).not.toHaveBeenCalled();
  });
});
