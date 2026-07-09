import { describe, it, expect, beforeEach, vi } from "vitest";

// createBusiness exercised with REAL zod, DB + session choke point stubbed.
// We assert the Round-3 create-time data defaults: a brand-new business is
// single-operator ("stays unlocked"), carries the chosen mode, and is seeded
// with exactly one clearly-labeled sample item so the register isn't empty.
const requireSession = vi.fn();
const businessCreate = vi.fn();
const itemCreate = vi.fn();

vi.mock("@/lib/tenant", () => ({
  requireSession: (...a: unknown[]) => requireSession(...a),
}));
vi.mock("@/lib/tenant-backstop", () => ({
  allowCrossTenant: (fn: () => unknown) => fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    business: { create: (...a: unknown[]) => businessCreate(...a) },
    item: { create: (...a: unknown[]) => itemCreate(...a) },
  },
}));

import { createBusiness } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ user: { id: "u1" } });
  businessCreate.mockResolvedValue({ id: "biz_1" });
  itemCreate.mockResolvedValue({ id: "item_1" });
});

describe("createBusiness", () => {
  it("defaults a new business to single-operator (stays unlocked)", async () => {
    await createBusiness({ name: "Taco Stand" });
    const data = businessCreate.mock.calls[0]![0].data;
    expect(data.singleOperatorMode).toBe(true);
    expect(data.memberships.create.role).toBe("OWNER");
  });

  it("stores the chosen business mode", async () => {
    await createBusiness({ name: "Taqueria", mode: "RESTAURANT" });
    expect(businessCreate.mock.calls[0]![0].data.mode).toBe("RESTAURANT");
  });

  it("defaults mode to STORE when omitted", async () => {
    await createBusiness({ name: "Corner Shop" });
    expect(businessCreate.mock.calls[0]![0].data.mode).toBe("STORE");
  });

  it("seeds exactly one sample item scoped to the new business", async () => {
    const { businessId } = await createBusiness({ name: "Corner Shop" });
    expect(businessId).toBe("biz_1");
    expect(itemCreate).toHaveBeenCalledTimes(1);
    const data = itemCreate.mock.calls[0]![0].data;
    expect(data.businessId).toBe("biz_1");
    expect(data.name.toLowerCase()).toContain("sample");
    expect(data.variations.create.priceCents).toBeGreaterThan(0);
    expect(data.variations.create.businessId).toBe("biz_1");
  });

  it("rejects an invalid mode", async () => {
    await expect(createBusiness({ name: "X", mode: "CAFE" })).rejects.toThrow();
    expect(businessCreate).not.toHaveBeenCalled();
  });
});
