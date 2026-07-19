import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Prisma mock -----------------------------------------------------------
// applySubscriptionState resolves the business by the unique stripeSubscriptionId,
// then stripeCustomerId, then the businessId, via updateMany. The mock resolves a
// count based on which known key the `where` carries, so we can assert both the
// resolution ORDER and the unknown → count 0 no-op.
const businessUpdateMany = vi.fn();

vi.mock("@/lib/db", () => ({
  db: { business: { updateMany: (...a: unknown[]) => businessUpdateMany(...a) } },
}));

import { applySubscriptionState } from "./billing-store";
import type { SubscriptionEvent } from "./billing-webhook";

function event(overrides: Partial<SubscriptionEvent> = {}): SubscriptionEvent {
  return {
    businessId: "biz_known",
    stripeCustomerId: "cus_known",
    stripeSubscriptionId: "sub_known",
    status: "active",
    priceId: "price_flat",
    currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // A row exists for each KNOWN key; anything else affects 0 rows.
  businessUpdateMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    if (where.stripeSubscriptionId === "sub_known") return { count: 1 };
    if (where.stripeCustomerId === "cus_known") return { count: 1 };
    if (where.id === "biz_known") return { count: 1 };
    return { count: 0 };
  });
});

describe("applySubscriptionState", () => {
  it("resolves by the unique stripeSubscriptionId first and persists the full state", async () => {
    const res = await applySubscriptionState(event());
    expect(res).toEqual({ matched: 1, by: "subscriptionId" });
    // First (and only) attempt is keyed on the subscription id.
    expect(businessUpdateMany).toHaveBeenCalledTimes(1);
    expect(businessUpdateMany).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: "sub_known" },
      data: {
        subscriptionStatus: "active",
        stripeCustomerId: "cus_known",
        stripeSubscriptionId: "sub_known",
        subscriptionPriceId: "price_flat",
        subscriptionCurrentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
      },
    });
  });

  it("falls back to the customer id when the subscription id doesn't match", async () => {
    const res = await applySubscriptionState(event({ stripeSubscriptionId: "sub_unknown" }));
    expect(res).toEqual({ matched: 1, by: "customerId" });
    expect(businessUpdateMany).toHaveBeenCalledTimes(2);
    expect(businessUpdateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { stripeCustomerId: "cus_known" } }),
    );
  });

  it("falls back to the businessId (bootstrap) when neither Stripe id matches", async () => {
    const res = await applySubscriptionState(
      event({ stripeSubscriptionId: "sub_unknown", stripeCustomerId: "cus_unknown" }),
    );
    expect(res).toEqual({ matched: 1, by: "businessId" });
    expect(businessUpdateMany).toHaveBeenCalledTimes(3);
    expect(businessUpdateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: "biz_known" } }),
    );
  });

  it("returns count 0 (never throws) for an unknown subscription", async () => {
    const res = await applySubscriptionState(
      event({
        stripeSubscriptionId: "sub_unknown",
        stripeCustomerId: "cus_unknown",
        businessId: "biz_unknown",
      }),
    );
    expect(res).toEqual({ matched: 0, by: "none" });
  });

  it("only writes the fields the event carries (sparse invoice.payment_failed)", async () => {
    // A past_due signal that only knows the ids + status must NOT null out price/period.
    await applySubscriptionState({
      businessId: null,
      stripeCustomerId: "cus_known",
      stripeSubscriptionId: "sub_known",
      status: "past_due",
      priceId: null,
      currentPeriodEnd: null,
    });
    expect(businessUpdateMany).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: "sub_known" },
      data: {
        subscriptionStatus: "past_due",
        stripeCustomerId: "cus_known",
        stripeSubscriptionId: "sub_known",
      },
    });
  });
});
