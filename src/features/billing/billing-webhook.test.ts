import { describe, it, expect } from "vitest";
import { extractSubscriptionEvent } from "./billing-webhook";

describe("extractSubscriptionEvent", () => {
  it("checkout.session.completed (subscription mode) → maps ids + businessId, grants active", () => {
    const out = extractSubscriptionEvent({
      type: "checkout.session.completed",
      object: {
        mode: "subscription",
        customer: "cus_1",
        subscription: "sub_1",
        client_reference_id: "biz_1",
        metadata: { businessId: "biz_ignored_when_ref_present" },
      },
    });
    expect(out).toEqual({
      businessId: "biz_1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      status: "active",
      priceId: null,
      currentPeriodEnd: null,
    });
  });

  it("checkout.session.completed falls back to metadata.businessId + expanded objects", () => {
    const out = extractSubscriptionEvent({
      type: "checkout.session.completed",
      object: {
        mode: "subscription",
        customer: { id: "cus_2" },
        subscription: { id: "sub_2" },
        metadata: { businessId: "biz_2" },
      },
    });
    expect(out).toMatchObject({
      businessId: "biz_2",
      stripeCustomerId: "cus_2",
      stripeSubscriptionId: "sub_2",
      status: "active",
    });
  });

  it("ignores a non-subscription checkout session", () => {
    expect(
      extractSubscriptionEvent({
        type: "checkout.session.completed",
        object: { mode: "payment", customer: "cus_x", subscription: null },
      }),
    ).toBeNull();
  });

  it("customer.subscription.updated → authoritative status + price + period end", () => {
    const periodEnd = 1_800_000_000;
    const out = extractSubscriptionEvent({
      type: "customer.subscription.updated",
      object: {
        id: "sub_1",
        customer: "cus_1",
        status: "trialing",
        current_period_end: periodEnd,
        metadata: { businessId: "biz_1" },
        items: { data: [{ price: { id: "price_flat" } }] },
      },
    });
    expect(out).toEqual({
      businessId: "biz_1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      status: "trialing",
      priceId: "price_flat",
      currentPeriodEnd: new Date(periodEnd * 1000),
    });
  });

  it("customer.subscription.deleted → canceled status (→ blocked)", () => {
    const out = extractSubscriptionEvent({
      type: "customer.subscription.deleted",
      object: { id: "sub_1", customer: "cus_1", status: "canceled" },
    });
    expect(out).toMatchObject({ stripeSubscriptionId: "sub_1", status: "canceled" });
  });

  it("reads current_period_end off the first item when absent at the top level", () => {
    const periodEnd = 1_700_000_000;
    const out = extractSubscriptionEvent({
      type: "customer.subscription.created",
      object: {
        id: "sub_9",
        customer: "cus_9",
        status: "active",
        items: { data: [{ current_period_end: periodEnd, plan: { id: "price_flat" } }] },
      },
    });
    expect(out?.currentPeriodEnd).toEqual(new Date(periodEnd * 1000));
    // legacy plan.id is used when price.id is absent
    expect(out?.priceId).toBe("price_flat");
  });

  it("invoice.payment_failed → past_due (grace) with the ids it carries", () => {
    const out = extractSubscriptionEvent({
      type: "invoice.payment_failed",
      object: { customer: "cus_1", subscription: "sub_1" },
    });
    expect(out).toEqual({
      businessId: null,
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      status: "past_due",
      priceId: null,
      currentPeriodEnd: null,
    });
  });

  it("returns null for unhandled events and garbage objects", () => {
    expect(
      extractSubscriptionEvent({ type: "payment_intent.succeeded", object: { id: "pi_1" } }),
    ).toBeNull();
    expect(extractSubscriptionEvent({ type: "customer.subscription.updated", object: null })).toBeNull();
    expect(extractSubscriptionEvent({ type: "customer.subscription.updated", object: "nope" })).toBeNull();
    // A subscription event with no resolvable id at all → null (never a false write).
    expect(
      extractSubscriptionEvent({ type: "customer.subscription.updated", object: { status: "active" } }),
    ).toBeNull();
    // A checkout session with no ids/business at all → null.
    expect(
      extractSubscriptionEvent({ type: "checkout.session.completed", object: { mode: "subscription" } }),
    ).toBeNull();
  });
});
