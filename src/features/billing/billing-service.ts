/**
 * Flat SaaS subscription ORCHESTRATION (PAYMENTS.md §9, PR-D) — pure, side-effect-
 * free except through the injected `BillingGateway`. No DB, no SDK, no
 * `server-only` import, so `billing-service.test.ts` drives it with the
 * `FakeBillingGateway`.
 *
 * It builds the success/cancel/return URLs from the app origin and calls the
 * gateway. Nothing here reads env or resolves the tenant — the action supplies the
 * business/owner/customer facts.
 */

import type {
  BillingGateway,
  BillingPortalResult,
  SubscriptionCheckoutResult,
} from "./billing-gateway";

function base(appBaseUrl: string): string {
  return appBaseUrl.replace(/\/$/, "");
}

/** Owner lands back on Settings with a success marker after subscribing. */
export function subscriptionSuccessUrl(appBaseUrl: string, businessId: string): string {
  return `${base(appBaseUrl)}/${businessId}/settings?billing=success`;
}

/** Where a cancelled/abandoned subscription Checkout returns the owner. */
export function subscriptionCancelUrl(appBaseUrl: string, businessId: string): string {
  return `${base(appBaseUrl)}/${businessId}/settings?billing=cancel`;
}

/** Where the Customer Portal returns the owner when they're done. */
export function billingPortalReturnUrl(appBaseUrl: string, businessId: string): string {
  return `${base(appBaseUrl)}/${businessId}/settings?billing=portal`;
}

export interface OpenSubscriptionCheckoutInput {
  gateway: BillingGateway;
  businessId: string;
  businessName: string;
  ownerEmail: string;
  priceId: string;
  /** Existing platform Customer id, if any (reused so we don't duplicate). */
  existingCustomerId?: string | null;
  /** `env.NEXT_PUBLIC_APP_URL` — the hosted origin Stripe redirects back to. */
  appBaseUrl: string;
}

/** Open a subscription Checkout Session on the PLATFORM account for this business. */
export async function openSubscriptionCheckout(
  input: OpenSubscriptionCheckoutInput,
): Promise<SubscriptionCheckoutResult> {
  return input.gateway.createSubscriptionCheckout({
    businessId: input.businessId,
    businessName: input.businessName,
    ownerEmail: input.ownerEmail,
    priceId: input.priceId,
    existingCustomerId: input.existingCustomerId ?? null,
    successUrl: subscriptionSuccessUrl(input.appBaseUrl, input.businessId),
    cancelUrl: subscriptionCancelUrl(input.appBaseUrl, input.businessId),
  });
}

export interface OpenBillingPortalInput {
  gateway: BillingGateway;
  businessId: string;
  customerId: string;
  appBaseUrl: string;
}

/** Open a Customer Portal session for the business's platform Customer. */
export async function openBillingPortalSession(
  input: OpenBillingPortalInput,
): Promise<BillingPortalResult> {
  return input.gateway.createBillingPortalSession({
    customerId: input.customerId,
    returnUrl: billingPortalReturnUrl(input.appBaseUrl, input.businessId),
  });
}
