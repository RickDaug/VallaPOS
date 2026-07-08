import { describe, it, expect, vi, afterEach } from "vitest";
import {
  TenantScopeError,
  whereMentionsBusinessId,
  isTenantModel,
  isGuardedOp,
  isUnscopedTenantQuery,
  enforceTenantScope,
  runBackstopOperation,
  allowCrossTenant,
} from "./tenant-backstop";

/**
 * Unit tests for the RUNTIME tenant-isolation backstop. These exercise the pure
 * detector (`whereMentionsBusinessId`) and the enforcement/extension behavior
 * WITHOUT a database — the extension just calls `enforceTenantScope`, which is
 * tested here directly. Under Vitest `NODE_ENV === "test"`, so a violation
 * THROWS (the dev/test branch); the production log-and-proceed branch is tested
 * by stubbing NODE_ENV.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("whereMentionsBusinessId", () => {
  it("returns false for nullish / non-object / empty where", () => {
    expect(whereMentionsBusinessId(undefined)).toBe(false);
    expect(whereMentionsBusinessId(null)).toBe(false);
    expect(whereMentionsBusinessId("businessId")).toBe(false); // a string, not a key
    expect(whereMentionsBusinessId(123)).toBe(false);
    expect(whereMentionsBusinessId({})).toBe(false);
  });

  it("detects a top-level businessId", () => {
    expect(whereMentionsBusinessId({ businessId: "b1" })).toBe(true);
    expect(whereMentionsBusinessId({ businessId: "b1", active: true })).toBe(true);
  });

  it("returns false when scoped only by something else (userId, id)", () => {
    expect(whereMentionsBusinessId({ userId: "u1" })).toBe(false);
    expect(whereMentionsBusinessId({ id: "x1", active: true })).toBe(false);
  });

  it("detects a compound-unique key that embeds businessId", () => {
    expect(whereMentionsBusinessId({ businessId_clientUuid: { businessId: "b1", clientUuid: "c" } })).toBe(true);
    // even if the nested object were opaque, the key name alone is enough:
    expect(whereMentionsBusinessId({ businessId_number: {} })).toBe(true);
  });

  it("detects businessId nested inside AND / OR / NOT combinators", () => {
    expect(whereMentionsBusinessId({ AND: [{ active: true }, { businessId: "b1" }] })).toBe(true);
    expect(whereMentionsBusinessId({ OR: [{ businessId: "b1" }, { businessId: "b2" }] })).toBe(true);
    expect(whereMentionsBusinessId({ NOT: { businessId: "b1" } })).toBe(true);
    expect(whereMentionsBusinessId({ AND: [{ role: "OWNER" }, { OR: [{ businessId: "b" }] }] })).toBe(true);
  });

  it("returns false for a nested where that never mentions businessId", () => {
    expect(whereMentionsBusinessId({ AND: [{ active: true }, { role: "OWNER" }] })).toBe(false);
    expect(whereMentionsBusinessId({ order: { is: { status: "PAID" } } })).toBe(false);
  });
});

describe("model / op classification", () => {
  it("recognizes tenant models (PascalCase, matching Prisma's `model`)", () => {
    for (const m of ["Category", "Item", "Order", "OrderLine", "Payment", "Membership", "FloorTable"]) {
      expect(isTenantModel(m)).toBe(true);
    }
  });

  it("excludes non-tenant models and undefined", () => {
    for (const m of ["User", "Session", "Account", "Verification", "Business", "OrderTable"]) {
      expect(isTenantModel(m)).toBe(false);
    }
    expect(isTenantModel(undefined)).toBe(false);
  });

  it("recognizes only the guarded filter/bulk ops", () => {
    for (const op of ["findMany", "findFirst", "findFirstOrThrow", "updateMany", "deleteMany", "count", "aggregate", "groupBy"]) {
      expect(isGuardedOp(op)).toBe(true);
    }
    for (const op of ["findUnique", "create", "update", "delete", "upsert", "createMany"]) {
      expect(isGuardedOp(op)).toBe(false);
    }
  });
});

describe("isUnscopedTenantQuery", () => {
  it("flags a guarded tenant op with no businessId", () => {
    expect(isUnscopedTenantQuery("Order", "findMany", { where: { status: "PAID" } })).toBe(true);
    expect(isUnscopedTenantQuery("Membership", "findFirst", { where: { userId: "u1" } })).toBe(true);
    expect(isUnscopedTenantQuery("Item", "findMany", {})).toBe(true); // no where at all
  });

  it("passes a guarded tenant op that IS scoped by businessId", () => {
    expect(isUnscopedTenantQuery("Order", "findMany", { where: { businessId: "b1" } })).toBe(false);
    expect(isUnscopedTenantQuery("Payment", "aggregate", { where: { businessId: "b1", method: "CASH" } })).toBe(false);
  });

  it("ignores non-tenant models even without businessId", () => {
    expect(isUnscopedTenantQuery("User", "findMany", { where: { email: "a@b.c" } })).toBe(false);
    expect(isUnscopedTenantQuery("Session", "findFirst", { where: { token: "t" } })).toBe(false);
    expect(isUnscopedTenantQuery("Business", "findMany", {})).toBe(false);
  });

  it("ignores single-row / non-guarded ops even on tenant models", () => {
    expect(isUnscopedTenantQuery("Order", "findUnique", { where: { id: "o1" } })).toBe(false);
    expect(isUnscopedTenantQuery("Order", "update", { where: { id: "o1" }, data: {} })).toBe(false);
    expect(isUnscopedTenantQuery("Order", "create", { data: {} })).toBe(false);
    expect(isUnscopedTenantQuery("Membership", "upsert", { where: { id: "m1" }, create: {}, update: {} })).toBe(false);
  });

  it("stands down inside allowCrossTenant", async () => {
    await allowCrossTenant(async () => {
      expect(isUnscopedTenantQuery("Membership", "findFirst", { where: { userId: "u1" } })).toBe(false);
    });
    // …and re-arms once the reviewed cross-tenant scope exits.
    expect(isUnscopedTenantQuery("Membership", "findFirst", { where: { userId: "u1" } })).toBe(true);
  });
});

describe("enforceTenantScope (test/dev throws)", () => {
  it("throws TenantScopeError on an unscoped tenant query", () => {
    expect(() => enforceTenantScope("Order", "findMany", { where: { status: "PAID" } })).toThrow(TenantScopeError);
  });

  it("does not throw when scoped by businessId", () => {
    expect(() => enforceTenantScope("Order", "findMany", { where: { businessId: "b1" } })).not.toThrow();
  });

  it("does not throw for non-tenant models or single-row ops", () => {
    expect(() => enforceTenantScope("User", "findMany", { where: {} })).not.toThrow();
    expect(() => enforceTenantScope("Order", "findUnique", { where: { id: "o1" } })).not.toThrow();
  });

  it("does not throw inside allowCrossTenant", async () => {
    await allowCrossTenant(async () => {
      expect(() => enforceTenantScope("Membership", "findFirst", { where: { userId: "u1" } })).not.toThrow();
    });
  });
});

describe("enforceTenantScope (production logs and proceeds)", () => {
  it("logs to console.error and does NOT throw in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => enforceTenantScope("Order", "findMany", { where: { status: "PAID" } })).not.toThrow();
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]?.[0]).toContain("Order.findMany");
  });

  it("stays silent in production when the query is properly scoped", () => {
    vi.stubEnv("NODE_ENV", "production");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => enforceTenantScope("Order", "findMany", { where: { businessId: "b1" } })).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("runBackstopOperation (extension interception)", () => {
  it("calls through to the underlying query with the same args when scoped", () => {
    const args = { where: { businessId: "b1" } };
    const query = vi.fn((a: unknown) => ({ ok: a }));
    const result = runBackstopOperation({ model: "Order", operation: "findMany", args }, query);
    expect(query).toHaveBeenCalledWith(args);
    expect(result).toEqual({ ok: args });
  });

  it("throws BEFORE calling the query on an unscoped tenant query (test env)", () => {
    const query = vi.fn();
    expect(() =>
      runBackstopOperation({ model: "Order", operation: "findMany", args: { where: {} } }, query),
    ).toThrow(TenantScopeError);
    expect(query).not.toHaveBeenCalled();
  });

  it("in production, logs then STILL calls the query (never breaks the request)", () => {
    vi.stubEnv("NODE_ENV", "production");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const query = vi.fn((a: unknown) => a);
    const args = { where: {} };
    const result = runBackstopOperation({ model: "Order", operation: "findMany", args }, query);
    expect(spy).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(args);
    expect(result).toBe(args);
  });

  it("passes non-tenant models straight through without inspection", () => {
    const query = vi.fn((a: unknown) => a);
    const args = { where: { email: "a@b.c" } };
    runBackstopOperation({ model: "User", operation: "findMany", args }, query);
    expect(query).toHaveBeenCalledWith(args);
  });
});
