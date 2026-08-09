import "server-only";

import { env } from "@/lib/env";
import { DESKTOP_SKU } from "./issue-service";
import type {
  CreateDesktopCheckoutInput,
  DesktopCheckoutGateway,
  DesktopCheckoutSession,
} from "./checkout-gateway";

// Pricing lives in the env-free desktop-price.ts so it stays unit-testable;
// re-exported here to keep the existing import path working.
import { desktopLineItem } from "./desktop-price";
export { DESKTOP_PRICE_CENTS, desktopLineItem } from "./desktop-price";

/**
 * True when the desktop-license checkout can run — i.e. the PLATFORM Stripe key
 * is set. Dormant otherwise: the action returns `unavailable` and the marketing
 * "$99 Buy" button falls back to its no-op (the current behavior). Mirrors
 * `isBillingConfigured()`.
 */
export function isDesktopLicenseConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

class DesktopCheckoutError extends Error {}

/**
 * Real Stripe gateway: a ONE-TIME (`mode:"payment"`) $99 Checkout Session using the
 * catalog Price when DESKTOP_PRICE_ID is set, else an inline price (so the feature
 * still runs with only STRIPE_SECRET_KEY). Stripe collects the buyer email at
 * checkout; the webhook (next slice) reads `customer_details.email` to deliver the
 * license. `metadata.sku` tags the sale as the desktop edition. Uses the same
 * dynamic `import("stripe")` convention as the billing/connect gateways.
 */
export function createStripeDesktopCheckoutGateway(): DesktopCheckoutGateway {
  return {
    async createCheckoutSession(
      input: CreateDesktopCheckoutInput,
    ): Promise<DesktopCheckoutSession> {
      const secret = env.STRIPE_SECRET_KEY;
      if (!secret) throw new DesktopCheckoutError("STRIPE_SECRET_KEY is not configured");

      const { default: Stripe } = await import("stripe");
      const stripe = new Stripe(secret);

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [desktopLineItem(env.DESKTOP_PRICE_ID)],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        metadata: { sku: DESKTOP_SKU },
        payment_intent_data: { metadata: { sku: DESKTOP_SKU } },
      });

      if (!session.url) throw new DesktopCheckoutError("Stripe Checkout Session has no URL");
      return { url: session.url };
    },
  };
}

/** True when the webhook can verify events: the platform key + its OWN signing secret. */
export function isDesktopWebhookConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.DESKTOP_LICENSE_WEBHOOK_SECRET);
}

/** Where the signed installer downloads from (a GitHub Release); falls back to the releases page. */
export function desktopDownloadUrl(): string {
  return env.DESKTOP_DOWNLOAD_URL ?? "https://github.com/RickDaug/VallaPOS/releases";
}

/**
 * Verify a desktop-license webhook over the RAW body via the Stripe SDK, against
 * the DISTINCT `DESKTOP_LICENSE_WEBHOOK_SECRET` (never the Connect/subscription
 * secrets). Throws on a bad signature / missing config so the route rejects.
 */
export async function constructDesktopEvent(rawBody: string, signature: string) {
  const secret = env.STRIPE_SECRET_KEY;
  const whsec = env.DESKTOP_LICENSE_WEBHOOK_SECRET;
  if (!secret || !whsec) throw new DesktopCheckoutError("Desktop-license webhook is not configured");
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(secret);
  return stripe.webhooks.constructEventAsync(rawBody, signature, whsec);
}
