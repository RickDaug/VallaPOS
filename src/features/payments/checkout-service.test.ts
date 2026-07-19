import { describe, it, expect } from "vitest";
import { FakeCheckoutGateway } from "./checkout-gateway";
import { openCheckoutSession, saleSuccessUrl, saleCancelUrl } from "./checkout-service";

describe("openCheckoutSession", () => {
  it("passes the server amount/currency + reconciliation metadata + URLs to the gateway", async () => {
    const gateway = new FakeCheckoutGateway();
    const result = await openCheckoutSession({
      gateway,
      businessId: "biz_1",
      stripeAccountId: "acct_1",
      orderId: "ord_1",
      orderNumber: 42,
      clientUuid: "uuid-1",
      amountCents: 1599,
      currency: "USD",
      appBaseUrl: "https://app.test/", // trailing slash normalized
    });

    expect(result.stripeSessionId).toBe("cs_fake_1");
    expect(result.url).toContain("cs_fake_1");
    // Echoed back so the caller persists exactly what the session was opened for.
    expect(result.amountCents).toBe(1599);
    expect(result.currency).toBe("USD");

    const call = gateway.calls[0]!;
    expect(call.amountCents).toBe(1599);
    expect(call.currency).toBe("USD");
    expect(call.stripeAccountId).toBe("acct_1");
    // Metadata is for RECONCILIATION only — the webhook never resolves the tenant
    // from it (it uses the returned session id → CheckoutSession row).
    expect(call.metadata).toEqual({
      businessId: "biz_1",
      orderId: "ord_1",
      clientUuid: "uuid-1",
      orderNumber: "42",
    });
    // businessId + clientUuid drive the real gateway's idempotency key
    // (`qr-sale-${businessId}-${clientUuid}`), so a re-tap returns the same session.
    expect(call.businessId).toBe("biz_1");
    expect(call.clientUuid).toBe("uuid-1");
    expect(call.successUrl).toBe("https://app.test/pay/success?session_id={CHECKOUT_SESSION_ID}");
    expect(call.cancelUrl).toBe("https://app.test/biz_1/register?checkout=cancel");
  });

  it("builds stable success/cancel URLs (idempotent across re-taps)", () => {
    expect(saleSuccessUrl("https://app.test")).toBe(
      "https://app.test/pay/success?session_id={CHECKOUT_SESSION_ID}",
    );
    expect(saleCancelUrl("https://app.test", "biz_9")).toBe(
      "https://app.test/biz_9/register?checkout=cancel",
    );
  });
});
