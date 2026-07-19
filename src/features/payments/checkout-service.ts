/**
 * Hosted-Checkout sale ORCHESTRATION (PAYMENTS.md §9, PR-C) — pure, side-effect-
 * free except through the injected `CheckoutGateway`. No DB, no SDK, no
 * `server-only` import, so `checkout-service.test.ts` drives it with the
 * `FakeCheckoutGateway`.
 *
 * It builds the success/cancel URLs from the app origin, assembles the
 * reconciliation metadata, and calls the gateway. The AMOUNT is passed in already
 * recomputed server-side (the action does that) — nothing here trusts a client
 * total. The tenant is NEVER resolved from the metadata built here; the webhook
 * resolves it from the returned `stripeSessionId` → CheckoutSession row.
 */

import type { CheckoutGateway, CheckoutSessionResult } from "./checkout-gateway";

/** The order/business fields the orchestration reads (all server-authoritative). */
export interface OpenCheckoutSessionInput {
  gateway: CheckoutGateway;
  businessId: string;
  /** The connected account the session is created on (`acct_…`). */
  stripeAccountId: string;
  /** The OPEN order being collected. */
  orderId: string;
  /** Human-friendly order number (for the Stripe product label + metadata). */
  orderNumber: number;
  /** Register idempotency key (reused across a "Pay" re-tap). */
  clientUuid: string;
  /** Server-recomputed total, integer cents. */
  amountCents: number;
  /** ISO-4217 currency (e.g. "USD"). */
  currency: string;
  /** `env.NEXT_PUBLIC_APP_URL` — the hosted origin Stripe redirects back to. */
  appBaseUrl: string;
}

export interface OpenCheckoutSessionResult extends CheckoutSessionResult {
  /** Echoed back so the caller persists exactly what the session was opened for. */
  amountCents: number;
  currency: string;
}

/** Customer-facing "payment received" landing (public route — no auth). */
export function saleSuccessUrl(appBaseUrl: string): string {
  const base = appBaseUrl.replace(/\/$/, "");
  // Stripe substitutes {CHECKOUT_SESSION_ID} into the final redirect.
  return `${base}/pay/success?session_id={CHECKOUT_SESSION_ID}`;
}

/** Where a cancelled/abandoned session sends the customer back. */
export function saleCancelUrl(appBaseUrl: string, businessId: string): string {
  const base = appBaseUrl.replace(/\/$/, "");
  return `${base}/${businessId}/register?checkout=cancel`;
}

/**
 * Open a hosted Checkout Session for an OPEN order on the merchant's connected
 * account. Pure orchestration: build URLs + metadata, call the gateway, return
 * the session identifiers for the store to persist.
 */
export async function openCheckoutSession(
  input: OpenCheckoutSessionInput,
): Promise<OpenCheckoutSessionResult> {
  const metadata: Record<string, string> = {
    businessId: input.businessId,
    orderId: input.orderId,
    clientUuid: input.clientUuid,
    orderNumber: String(input.orderNumber),
  };

  const result = await input.gateway.createCheckoutSession({
    businessId: input.businessId,
    orderId: input.orderId,
    clientUuid: input.clientUuid,
    stripeAccountId: input.stripeAccountId,
    amountCents: input.amountCents,
    currency: input.currency,
    successUrl: saleSuccessUrl(input.appBaseUrl),
    cancelUrl: saleCancelUrl(input.appBaseUrl, input.businessId),
    metadata,
  });

  return { ...result, amountCents: input.amountCents, currency: input.currency };
}
