import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Role } from "@prisma/client";

// --- Mock the server-only collaborators tenant.ts pulls in ---------------
// next/headers is unavailable outside a request; auth + db hit the network/DB.
// We stub all three so requireMembership/assertRole are tested in isolation.
const getSession = vi.fn();
const membershipFindUnique = vi.fn();

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => getSession(...args) } },
}));
vi.mock("@/lib/db", () => ({
  db: { membership: { findUnique: (...args: unknown[]) => membershipFindUnique(...args) } },
}));

import {
  requireSession,
  requireMembership,
  assertRole,
  AuthError,
  ForbiddenError,
  type TenantContext,
} from "./tenant";

beforeEach(() => {
  vi.clearAllMocks();
});

function asMember(role: Role) {
  getSession.mockResolvedValue({ user: { id: "user_1" } });
  membershipFindUnique.mockResolvedValue({ id: "mem_1", role });
}

describe("requireSession", () => {
  it("throws AuthError when there is no session", async () => {
    getSession.mockResolvedValue(null);
    await expect(requireSession()).rejects.toBeInstanceOf(AuthError);
  });

  it("returns the session when authenticated", async () => {
    const session = { user: { id: "user_1" } };
    getSession.mockResolvedValue(session);
    await expect(requireSession()).resolves.toBe(session);
  });
});

describe("requireMembership — tenant isolation", () => {
  it("denies a user who is NOT a member of the business", async () => {
    getSession.mockResolvedValue({ user: { id: "outsider" } });
    membershipFindUnique.mockResolvedValue(null); // no membership row

    await expect(requireMembership("biz_1")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requireMembership("biz_1")).rejects.toThrow("NOT_A_MEMBER");
  });

  it("denies an unauthenticated request before touching the DB", async () => {
    getSession.mockResolvedValue(null);
    await expect(requireMembership("biz_1")).rejects.toBeInstanceOf(AuthError);
    expect(membershipFindUnique).not.toHaveBeenCalled();
  });

  it("allows a member and returns the scoped context", async () => {
    getSession.mockResolvedValue({ user: { id: "user_1" } });
    membershipFindUnique.mockResolvedValue({ id: "mem_1", role: "CASHIER" });

    const ctx = await requireMembership("biz_1");
    expect(ctx).toEqual({
      userId: "user_1",
      businessId: "biz_1",
      membershipId: "mem_1",
      role: "CASHIER",
    });
  });

  it("scopes the membership lookup by the (userId, businessId) compound key", async () => {
    getSession.mockResolvedValue({ user: { id: "user_1" } });
    membershipFindUnique.mockResolvedValue({ id: "mem_1", role: "OWNER" });

    await requireMembership("biz_42");
    expect(membershipFindUnique).toHaveBeenCalledWith({
      where: { userId_businessId: { userId: "user_1", businessId: "biz_42" } },
    });
  });
});

describe("assertRole — role gating", () => {
  const ctx = (role: Role): TenantContext => ({
    userId: "user_1",
    businessId: "biz_1",
    membershipId: "mem_1",
    role,
  });

  it("denies an insufficient role", () => {
    expect(() => assertRole(ctx("CASHIER"), "MANAGER")).toThrow(ForbiddenError);
    expect(() => assertRole(ctx("CASHIER"), "MANAGER")).toThrow("REQUIRES_MANAGER");
    expect(() => assertRole(ctx("MANAGER"), "OWNER")).toThrow("REQUIRES_OWNER");
  });

  it("allows a role that meets the minimum", () => {
    expect(() => assertRole(ctx("MANAGER"), "MANAGER")).not.toThrow();
  });

  it("allows a role that exceeds the minimum", () => {
    expect(() => assertRole(ctx("OWNER"), "MANAGER")).not.toThrow();
    expect(() => assertRole(ctx("OWNER"), "CASHIER")).not.toThrow();
  });

  it("integrates with requireMembership: a member is gated by their role", async () => {
    asMember("MANAGER");
    const resolved = await requireMembership("biz_1");
    expect(() => assertRole(resolved, "OWNER")).toThrow("REQUIRES_OWNER");
    expect(() => assertRole(resolved, "MANAGER")).not.toThrow();
  });
});
