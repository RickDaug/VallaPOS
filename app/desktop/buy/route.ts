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
 * When the feature is dormant (no usable `STRIPE_SECRET_KEY`) or the create
 * fails, we send the buyer to `/desktop/unavailable`, which TELLS them so and
 * offers a way through. It used to bounce back to `/#pricing` on the theory that
 * nothing should "appear broken" — but a Buy button that silently returns you to
 * the page you were on reads as an abandoned product, and it hid a real
 * production outage (a malformed key dropped by env.ts) behind a no-op.
 */
export async function GET(request: Request): Promise<Response> {
  // Resolve the fallback against the INCOMING request, not NEXT_PUBLIC_APP_URL.
  // That env var is a single fixed origin, so a preview deployment would bounce
  // the visitor onto production mid-purchase — verified doing exactly that. The
  // Stripe return URLs below deliberately stay on the configured origin (they
  // come back from an external redirect, so they can't be request-relative).
  const unavailable = new URL("/desktop/unavailable", new URL(request.url).origin);
  if (!isDesktopLicenseConfigured()) {
    console.error(
      "Desktop-license checkout is unconfigured (no valid STRIPE_SECRET_KEY) — " +
        "the $99 Buy button cannot sell. Serving /desktop/unavailable.",
    );
    return NextResponse.redirect(unavailable, 303);
  }
  try {
    const { url } = await createDesktopCheckout(
      createStripeDesktopCheckoutGateway(),
      env.NEXT_PUBLIC_APP_URL,
    );
    return NextResponse.redirect(url, 303);
  } catch (err) {
    console.error("Desktop-license checkout failed to start:", err);
    return NextResponse.redirect(unavailable, 303);
  }
}
