"use server";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireCapability } from "@/lib/operator-guard";
import { requireSession, ForbiddenError } from "@/lib/tenant";
import { createStripeBillingGateway } from "./billing-stripe";
import { openSubscriptionCheckout, openBillingPortalSession } from "./billing-service";
import { isBillingConfigured } from "./subscription-access";
import { subscriptionActionSchema } from "./billing-schema";

/**
 * Server actions for the flat SaaS subscription (PAYMENTS.md §9, PR-D) — OUR
 * platform billing, separate from the Connect sale rail.
 *
 * OWNER-ONLY: a subscription is an owner/billing responsibility, so both actions
 * require an active OWNER operator (a manager with `manage_settings` is NOT
 * enough). Every action gates on `isBillingConfigured()` and returns a typed
 * result — `{ ok:false, reason:"billing_unavailable" }` when unconfigured — so
 * the client can never trigger a dead Stripe call.
 */

/** Establish an active OWNER operator or throw (locked → OperatorLockedError,
 *  non-owner → ForbiddenError). Owners implicitly hold every capability. */
async function requireBillingOwner(businessId: string) {
  const operator = await requireCapability(businessId, "manage_settings");
  if (operator.role !== "OWNER") {
    throw new ForbiddenError("REQUIRES_OWNER");
  }
  return operator;
}

export type StartSubscriptionCheckoutResult =
  | { ok: true; url: string }
  | { ok: false; reason: "billing_unavailable" };

/**
 * Begin (or resume) the platform subscription Checkout and return a hosted URL
 * for the client to redirect the OWNER to. Reuses the business's existing platform
 * Customer id so a re-subscribe never spawns a duplicate customer.
 */
export async function startSubscriptionCheckout(
  input: unknown,
): Promise<StartSubscriptionCheckoutResult> {
  const { businessId } = subscriptionActionSchema.parse(input);
  await requireBillingOwner(businessId);

  if (!isBillingConfigured()) return { ok: false, reason: "billing_unavailable" };
  const priceId = env.STRIPE_SUBSCRIPTION_PRICE_ID;
  if (!priceId) return { ok: false, reason: "billing_unavailable" };

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, stripeCustomerId: true },
  });
  if (!business) return { ok: false, reason: "billing_unavailable" };

  const session = await requireSession();

  const result = await openSubscriptionCheckout({
    gateway: createStripeBillingGateway(),
    businessId,
    businessName: business.name,
    ownerEmail: session.user.email,
    priceId,
    existingCustomerId: business.stripeCustomerId,
    appBaseUrl: env.NEXT_PUBLIC_APP_URL,
  });

  return { ok: true, url: result.url };
}

export type OpenBillingPortalResult =
  | { ok: true; url: string }
  | { ok: false; reason: "billing_unavailable" | "no_customer" };

/**
 * Open the Stripe Customer Portal for self-service management (update card,
 * cancel, view invoices). Requires an existing platform Customer.
 */
export async function openBillingPortal(input: unknown): Promise<OpenBillingPortalResult> {
  const { businessId } = subscriptionActionSchema.parse(input);
  await requireBillingOwner(businessId);

  if (!isBillingConfigured()) return { ok: false, reason: "billing_unavailable" };

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { stripeCustomerId: true },
  });
  if (!business?.stripeCustomerId) return { ok: false, reason: "no_customer" };

  const result = await openBillingPortalSession({
    gateway: createStripeBillingGateway(),
    businessId,
    customerId: business.stripeCustomerId,
    appBaseUrl: env.NEXT_PUBLIC_APP_URL,
  });

  return { ok: true, url: result.url };
}
