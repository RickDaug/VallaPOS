import "server-only";

import { env } from "@/lib/env";
import { StripeGatewayError } from "../payments/connect-stripe";
import type {
  BillingGateway,
  BillingPortalResult,
  CreateBillingPortalInput,
  CreateSubscriptionCheckoutInput,
  SubscriptionCheckoutResult,
} from "./billing-gateway";

/**
 * REAL platform Billing gateway (PAYMENTS.md §9, PR-D) — the only module that
 * talks to Stripe for the flat SaaS subscription. Implements `BillingGateway` via
 * the Stripe SDK loaded with a dynamic `import` (pinned 22.3.0) so it never rides
 * a client bundle — mirroring `checkout-stripe.ts` / `constructStripeEvent`.
 *
 * PLATFORM ACCOUNT ONLY. There is NO `stripeAccount` param on any call here — the
 * Business is a Customer of VallaPOS's own Stripe account (our revenue), entirely
 * decoupled from the merchant's Connect account (their sales). It uses the PLATFORM
 * secret (`STRIPE_SECRET_KEY`), a PLATFORM Price id, and a SEPARATE platform
 * webhook secret (`STRIPE_SUBSCRIPTION_WEBHOOK_SECRET`).
 *
 * Dormant when STRIPE_SECRET_KEY is unset — callers gate on `isBillingConfigured()`
 * first (the actions do). Constructing a session without a key throws.
 *
 * ⚠ LIVE-VERIFY the exact subscription-Checkout + Portal shape against a claimed
 * sandbox with `scripts/stripe-billing-smoke.mjs` before shipping; the port
 * isolates any fix here.
 */

function requireSecret(): string {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new StripeGatewayError("STRIPE_SECRET_KEY is not configured", 500);
  }
  return key;
}

/** Read a Customer id from the `session.customer` union (string | object | null). */
function customerIdOf(customer: unknown): string | null {
  if (typeof customer === "string") return customer;
  if (customer && typeof customer === "object" && "id" in customer) {
    const id = (customer as { id: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

export function createStripeBillingGateway(): BillingGateway {
  return {
    async createSubscriptionCheckout(
      input: CreateSubscriptionCheckoutInput,
    ): Promise<SubscriptionCheckoutResult> {
      const secret = requireSecret();
      const { default: Stripe } = await import("stripe");
      // apiVersion omitted (the installed SDK pins it) — same convention as the
      // connect/checkout gateways.
      const stripe = new Stripe(secret);

      const existingCustomerId = input.existingCustomerId ?? undefined;
      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          line_items: [{ price: input.priceId, quantity: 1 }],
          // Reuse the existing Customer; only pass customer_email when there is
          // none (Stripe rejects both together and would otherwise duplicate).
          customer: existingCustomerId,
          customer_email: existingCustomerId ? undefined : input.ownerEmail,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          // Tenant reconciliation — the webhook resolves the business from these.
          client_reference_id: input.businessId,
          subscription_data: { metadata: { businessId: input.businessId } },
          metadata: { businessId: input.businessId },
        },
        {
          // Re-clicking "Subscribe" for the same business returns the SAME session
          // instead of opening a duplicate.
          idempotencyKey: `sub-checkout-${input.businessId}`,
        },
      );

      if (!session.url) {
        throw new StripeGatewayError("Stripe subscription Checkout Session has no URL", 502);
      }
      return { url: session.url, customerId: customerIdOf(session.customer) };
    },

    async createBillingPortalSession(
      input: CreateBillingPortalInput,
    ): Promise<BillingPortalResult> {
      const secret = requireSecret();
      const { default: Stripe } = await import("stripe");
      const stripe = new Stripe(secret);

      const portal = await stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
      });
      if (!portal.url) {
        throw new StripeGatewayError("Stripe billing portal session has no URL", 502);
      }
      return { url: portal.url };
    },
  };
}

/** A verified PLATFORM Stripe event, narrowed to what the billing handler reads. */
export interface VerifiedPlatformEvent {
  id: string;
  type: string;
  object: unknown;
}

/**
 * Verify + parse a PLATFORM (subscription) webhook using the SDK, against the
 * SEPARATE `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` — NOT the Connect webhook secret.
 * These are two distinct Stripe webhook endpoints with distinct signing secrets.
 * Throws on a bad signature or a missing secret so the route returns 400 and
 * Stripe retries. Mirrors `constructStripeEvent` (Connect).
 */
export async function constructPlatformEvent(
  rawBody: string,
  signature: string,
): Promise<VerifiedPlatformEvent> {
  const secret = requireSecret();
  const webhookSecret = env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new StripeGatewayError("STRIPE_SUBSCRIPTION_WEBHOOK_SECRET is not configured", 500);
  }
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(secret);
  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  return {
    id: event.id,
    type: event.type,
    object: event.data.object as unknown,
  };
}
