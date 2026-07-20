import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createDesktopCheckout } from "@/features/desktop-license/checkout-service";
import {
  createStripeDesktopCheckoutGateway,
  isDesktopLicenseConfigured,
} from "@/features/desktop-license/checkout-stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The "$99 Buy" entry point (linked from the marketing pricing card). Creates a
 * one-time desktop-license Checkout Session and redirects the buyer to Stripe.
 *
 * When the feature is dormant (no `STRIPE_SECRET_KEY`) or the create fails, it
 * falls back to the pricing section — the button's historical no-op, so nothing
 * ever appears broken.
 */
export async function GET(): Promise<Response> {
  const pricing = new URL("/#pricing", env.NEXT_PUBLIC_APP_URL);
  if (!isDesktopLicenseConfigured()) return NextResponse.redirect(pricing, 303);
  try {
    const { url } = await createDesktopCheckout(
      createStripeDesktopCheckoutGateway(),
      env.NEXT_PUBLIC_APP_URL,
    );
    return NextResponse.redirect(url, 303);
  } catch (err) {
    console.error("Desktop-license checkout failed to start:", err);
    return NextResponse.redirect(pricing, 303);
  }
}
