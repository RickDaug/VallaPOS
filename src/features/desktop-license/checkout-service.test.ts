import { describe, expect, it } from "vitest";
import { FakeDesktopCheckoutGateway } from "./checkout-gateway";
import { SESSION_ID_TEMPLATE, createDesktopCheckout } from "./checkout-service";

describe("createDesktopCheckout", () => {
  it("builds success/cancel URLs from the app base and returns the gateway URL", async () => {
    const gateway = new FakeDesktopCheckoutGateway();
    const res = await createDesktopCheckout(gateway, "https://vallapos.com");

    expect(gateway.lastInput).toEqual({
      successUrl: `https://vallapos.com/desktop/license?session_id=${SESSION_ID_TEMPLATE}`,
      cancelUrl: "https://vallapos.com/#pricing",
    });
    expect(res.url).toContain("checkout.stripe.test");
  });

  it("normalizes a trailing slash on the app base", async () => {
    const gateway = new FakeDesktopCheckoutGateway();
    await createDesktopCheckout(gateway, "https://vallapos.com/");
    expect(gateway.lastInput?.successUrl.startsWith("https://vallapos.com/desktop/license")).toBe(true);
    expect(gateway.lastInput?.cancelUrl).toBe("https://vallapos.com/#pricing");
  });
});
