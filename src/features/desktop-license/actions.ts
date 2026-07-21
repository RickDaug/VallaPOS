"use server";

import { env } from "@/lib/env";
import { createDesktopCheckout } from "./checkout-service";
import { createStripeDesktopCheckoutGateway, isDesktopLicenseConfigured } from "./checkout-stripe";

export type StartDesktopCheckoutResult = { url: string } | { error: "unavailable" };

/**
 * Start a $99 one-time desktop-license Checkout. Gated on `isDesktopLicenseConfigured()`
 * — when Stripe isn't configured (or the create fails) it returns `unavailable`
 * and the caller degrades (the marketing button falls back to its no-op). Returns
 * the Stripe-hosted URL to redirect the buyer to.
 */
export async function startDesktopCheckout(): Promise<StartDesktopCheckoutResult> {
  if (!isDesktopLicenseConfigured()) return { error: "unavailable" };
  try {
    return await createDesktopCheckout(
      createStripeDesktopCheckoutGateway(),
      env.NEXT_PUBLIC_APP_URL,
    );
  } catch (err) {
    console.error("startDesktopCheckout failed:", err);
    return { error: "unavailable" };
  }
}
