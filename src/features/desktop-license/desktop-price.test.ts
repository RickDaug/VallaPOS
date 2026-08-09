import { describe, expect, it } from "vitest";

import { DESKTOP_PRICE_CENTS, desktopLineItem } from "./desktop-price";

/**
 * The desktop edition is a catalog product ("VallaPOS Desktop", $99 one-time)
 * alongside the monthly subscription. Inline price_data would mint a NEW ad-hoc
 * Stripe Product per sale, so the Price id must win whenever it is configured.
 */
describe("desktopLineItem", () => {
  it("references the catalog Price when DESKTOP_PRICE_ID is set", () => {
    const item = desktopLineItem("price_1U1ew4AOkezTuccQOSJQUMIb");
    expect(item).toEqual({ quantity: 1, price: "price_1U1ew4AOkezTuccQOSJQUMIb" });
    // No inline pricing — otherwise Stripe creates a throwaway Product per sale.
    expect(item).not.toHaveProperty("price_data");
  });

  it("falls back to the inline $99 price when the id is unset", () => {
    const item = desktopLineItem(undefined);
    expect(item).not.toHaveProperty("price");
    expect(item).toMatchObject({
      quantity: 1,
      price_data: { currency: "usd", unit_amount: DESKTOP_PRICE_CENTS },
    });
  });

  it("treats an empty id as unset rather than sending an empty price", () => {
    // An env var present-but-blank must not produce `price: ""` (a 400 from Stripe).
    expect(desktopLineItem("")).not.toHaveProperty("price");
  });

  it("keeps the fallback price at $99", () => {
    expect(DESKTOP_PRICE_CENTS).toBe(9900);
  });
});
