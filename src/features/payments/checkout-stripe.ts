import "server-only";

import { env } from "@/lib/env";
import { StripeGatewayError } from "./connect-stripe";
import type {
  CheckoutGateway,
  CheckoutSessionResult,
  CreateCheckoutSessionInput,
} from "./checkout-gateway";

/**
 * REAL hosted-Checkout gateway (PAYMENTS.md §9, PR-C) — the only module that
 * opens a Stripe Checkout Session over the network. Implements the
 * `CheckoutGateway` port via the Stripe SDK, loaded with a dynamic `import`
 * (pinned 22.3.0) so it never rides a client bundle — mirroring
 * `constructStripeEvent` in `connect-stripe.ts`.
 *
 * The session is created ON the merchant's CONNECTED account (`stripeAccount`),
 * a DIRECT charge — the connected account is merchant of record and the platform
 * takes no application fee. `payment_method_types` is deliberately OMITTED so
 * Stripe serves the connected account's eligible dynamic payment methods
 * (country-agnostic across US/MX/BR). The `idempotencyKey` makes a re-tapped
 * "Pay" return the SAME session instead of opening a duplicate.
 *
 * Dormant when STRIPE_SECRET_KEY is unset — callers gate on `isPaymentsConfigured()`
 * first (the action does). Constructing a session without a key throws.
 *
 * ⚠ LIVE-VERIFY the exact Checkout shape against a claimed sandbox with
 * `scripts/stripe-qr-smoke.mjs` before shipping; the port isolates any fix here.
 */

function requireSecret(): string {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new StripeGatewayError("STRIPE_SECRET_KEY is not configured", 500);
  }
  return key;
}

export function createStripeCheckoutGateway(): CheckoutGateway {
  return {
    async createCheckoutSession(
      input: CreateCheckoutSessionInput,
    ): Promise<CheckoutSessionResult> {
      const secret = requireSecret();
      const { default: Stripe } = await import("stripe");
      // apiVersion is omitted (the installed SDK pins it); this avoids depending
      // on the SDK's LatestApiVersion literal type — same call convention as the
      // connect webhook verifier.
      const stripe = new Stripe(secret);

      // The product name is the merchant-facing order label; the number rides in
      // metadata (never trusted for tenant resolution — see the port doc).
      const orderNumber = input.metadata.orderNumber;
      const productName = orderNumber ? `Order #${orderNumber}` : "Order";

      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: input.currency.toLowerCase(),
                product_data: { name: productName },
                unit_amount: input.amountCents,
              },
              quantity: 1,
            },
          ],
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          metadata: input.metadata,
          // Mirror metadata onto the PaymentIntent so a settled charge is
          // reconcilable from the Stripe dashboard too.
          payment_intent_data: { metadata: input.metadata },
          // payment_method_types OMITTED → dynamic payment methods (country-agnostic).
        },
        {
          stripeAccount: input.stripeAccountId,
          // Re-tapping "Pay" for the same cart returns the SAME session.
          idempotencyKey: `qr-sale-${input.businessId}-${input.clientUuid}`,
        },
      );

      if (!session.url) {
        throw new StripeGatewayError("Stripe Checkout Session has no URL", 502);
      }
      return {
        stripeSessionId: session.id,
        url: session.url,
        expiresAt: typeof session.expires_at === "number" ? session.expires_at : null,
      };
    },
  };
}
