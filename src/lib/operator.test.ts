import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory cookie jar + stubbed env/db so we can round-trip the signed operator
// cookie and prove tampering / DB re-validation reject it.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => {
      if (value === "") jar.delete(name);
      else jar.set(name, value);
    },
  }),
}));
vi.mock("@/lib/env", () => ({ env: { BETTER_AUTH_SECRET: "test-secret-0123456789abcdef" } }));
const membershipFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { membership: { findFirst: (...a: unknown[]) => membershipFindFirst(...a) } },
}));

import { setActiveOperator, getActiveOperator, clearActiveOperator } from "./operator";

const BIZ = "biz_1";
const NAME = "vp_op_biz_1";

beforeEach(() => {
  jar.clear();
  vi.clearAllMocks();
});

describe("active operator cookie", () => {
  it("round-trips: a signed cookie resolves to the re-loaded membership", async () => {
    membershipFindFirst.mockResolvedValue({
      id: "m1",
      role: "CASHIER",
      permissions: ["take_orders"],
      name: null,
      user: { name: "Sam" },
    });
    await setActiveOperator(BIZ, "m1");
    const op = await getActiveOperator(BIZ);
    expect(op).toEqual({ membershipId: "m1", role: "CASHIER", permissions: ["take_orders"], name: "Sam" });
    // The DB lookup is scoped to active members of this business.
    expect(membershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "m1", businessId: BIZ, active: true }) }),
    );
  });

  it("rejects a tampered cookie (signature mismatch) without hitting the DB", async () => {
    await setActiveOperator(BIZ, "m1");
    jar.set(NAME, jar.get(NAME)! + "x"); // corrupt the signature
    const op = await getActiveOperator(BIZ);
    expect(op).toBeNull();
    expect(membershipFindFirst).not.toHaveBeenCalled();
  });

  it("rejects a forged value with no signature", async () => {
    jar.set(NAME, "not-a-real-token");
    expect(await getActiveOperator(BIZ)).toBeNull();
    expect(membershipFindFirst).not.toHaveBeenCalled();
  });

  it("returns null when the membership is gone/deactivated (DB re-validation)", async () => {
    membershipFindFirst.mockResolvedValue(null);
    await setActiveOperator(BIZ, "m1");
    expect(await getActiveOperator(BIZ)).toBeNull();
  });

  it("clears the operator", async () => {
    membershipFindFirst.mockResolvedValue({ id: "m1", role: "OWNER", permissions: [], name: "O", user: null });
    await setActiveOperator(BIZ, "m1");
    await clearActiveOperator(BIZ);
    expect(await getActiveOperator(BIZ)).toBeNull();
  });

  it("returns null when no cookie is set (locked)", async () => {
    expect(await getActiveOperator(BIZ)).toBeNull();
  });
});
