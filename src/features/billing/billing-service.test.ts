import { describe, it, expect } from "vitest";
import { FakeBillingGateway } from "./billing-gateway";
import {
  openSubscriptionCheckout,
  openBillingPortalSession,
  subscriptionSuccessUrl,
  subscriptionCancelUrl,
  billingPortalReturnUrl,
} from "./billing-service";

describe("openSubscriptionCheckout", () => {
  it("passes the price/business/owner + success/cancel URLs to the gateway (new customer)", async () => {
    const gateway = new FakeBillingGateway();
    const result = await openSubscriptionCheckout({
      gateway,
      businessId: "biz_1",
      businessName: "Taquería Valla",
      ownerEmail: "owner@valla.test",
      priceId: "price_flat",
      existingCustomerId: null,
      appBaseUrl: "https://app.test/", // trailing slash normalized
    });

    expect(result.url).toContain("checkout");

    const call = gateway.checkoutCalls[0]!;
    expect(call.businessId).toBe("biz_1");
    expect(call.businessName).toBe("Taquería Valla");
    expect(call.ownerEmail).toBe("owner@valla.test");
    expect(call.priceId).toBe("price_flat");
    expect(call.existingCustomerId).toBeNull();
    expect(call.successUrl).toBe("https://app.test/biz_1/settings?billing=success");
    expect(call.cancelUrl).toBe("https://app.test/biz_1/settings?billing=cancel");
  });

  it("reuses an existing platform customer id when present", async () => {
    const gateway = new FakeBillingGateway();
    const result = await openSubscriptionCheckout({
      gateway,
      businessId: "biz_2",
      businessName: "Biz Two",
      ownerEmail: "two@valla.test",
      priceId: "price_flat",
      existingCustomerId: "cus_existing",
      appBaseUrl: "https://app.test",
    });

    expect(gateway.checkoutCalls[0]!.existingCustomerId).toBe("cus_existing");
    // The fake echoes the reused customer back.
    expect(result.customerId).toBe("cus_existing");
  });
});

describe("openBillingPortalSession", () => {
  it("passes the customer id + return URL to the gateway", async () => {
    const gateway = new FakeBillingGateway();
    const result = await openBillingPortalSession({
      gateway,
      businessId: "biz_1",
      customerId: "cus_1",
      appBaseUrl: "https://app.test",
    });

    expect(result.url).toContain("portal");
    const call = gateway.portalCalls[0]!;
    expect(call.customerId).toBe("cus_1");
    expect(call.returnUrl).toBe("https://app.test/biz_1/settings?billing=portal");
  });
});

describe("URL builders (stable / idempotent)", () => {
  it("build the settings-anchored URLs", () => {
    expect(subscriptionSuccessUrl("https://app.test", "b")).toBe(
      "https://app.test/b/settings?billing=success",
    );
    expect(subscriptionCancelUrl("https://app.test/", "b")).toBe(
      "https://app.test/b/settings?billing=cancel",
    );
    expect(billingPortalReturnUrl("https://app.test", "b")).toBe(
      "https://app.test/b/settings?billing=portal",
    );
  });
});
