import { describe, it, expect, beforeEach, vi } from "vitest";

// getPublicMenu gates the whole public surface: it must return null (→ the page
// 404s) when the business is missing OR online ordering is disabled, and only
// otherwise return the menu. We stub the DB + the shared catalog query.

const businessFindUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { business: { findUnique: (...a: unknown[]) => businessFindUnique(...a) } },
}));

const getRegisterCatalog = vi.fn();
vi.mock("@/features/catalog/queries", () => ({
  getRegisterCatalog: (...a: unknown[]) => getRegisterCatalog(...a),
}));

import { getPublicMenu } from "./queries";

const BUSINESS_ID = "biz_1";

function business(over: Record<string, unknown> = {}) {
  return {
    name: "Taco Truck",
    currency: "USD",
    taxRateBps: 825,
    taxInclusive: false,
    onlineOrderingEnabled: true,
    onlineOrderInstructions: "Pick up at the window.",
    qrPayEnabled: true,
    qrPayLabel: "PIX",
    qrPayValue: "pix-key-123",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getRegisterCatalog.mockResolvedValue([]);
});

describe("getPublicMenu — gating", () => {
  it("returns null when the business does not exist", async () => {
    businessFindUnique.mockResolvedValue(null);
    expect(await getPublicMenu(BUSINESS_ID)).toBeNull();
    // Never even loads the catalog for a non-existent/disabled business.
    expect(getRegisterCatalog).not.toHaveBeenCalled();
  });

  it("returns null when online ordering is disabled", async () => {
    businessFindUnique.mockResolvedValue(business({ onlineOrderingEnabled: false }));
    expect(await getPublicMenu(BUSINESS_ID)).toBeNull();
    expect(getRegisterCatalog).not.toHaveBeenCalled();
  });

  it("returns the menu when enabled, with qrPay + instructions", async () => {
    businessFindUnique.mockResolvedValue(business());
    getRegisterCatalog.mockResolvedValue([{ variationId: "v1" }]);
    const menu = await getPublicMenu(BUSINESS_ID);
    expect(menu).not.toBeNull();
    expect(menu!.name).toBe("Taco Truck");
    expect(menu!.instructions).toBe("Pick up at the window.");
    expect(menu!.qrPay).toEqual({ label: "PIX", value: "pix-key-123" });
    expect(menu!.entries).toHaveLength(1);
    expect(getRegisterCatalog).toHaveBeenCalledWith(BUSINESS_ID);
  });

  it("omits qrPay when qrPayEnabled is false or has no value", async () => {
    businessFindUnique.mockResolvedValue(business({ qrPayEnabled: false }));
    const menu = await getPublicMenu(BUSINESS_ID);
    expect(menu!.qrPay).toBeNull();
  });
});
