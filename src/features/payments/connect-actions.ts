"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireCapability } from "@/lib/operator-guard";
import { requireSession, ForbiddenError } from "@/lib/tenant";
import { isConnectCountry, type ConnectCountry } from "./connect-gateway";
import { createStripeConnectGateway, isPaymentsConfigured } from "./connect-stripe";
import {
  startConnectOnboarding,
  refreshConnectStatus,
  NOT_CONNECTED,
  type ConnectBusinessState,
  type ConnectStatus,
} from "./connect-service";
import { prismaConnectStore } from "./connect-store";
import { connectOnboardingSchema } from "./connect-schema";

/**
 * Server actions for Stripe Connect onboarding (PAYMENTS.md §9, PR-A).
 *
 * Gated by the `manage_settings` capability — only an owner/manager can connect
 * or inspect the business's payment account. Nothing here charges money.
 */

const settingsPath = (businessId: string) => `/${businessId}/settings`;

/** Load the business + assert the current session may manage its settings. */
async function loadManagedBusiness(businessId: string) {
  const ctx = await requireCapability(businessId, "manage_settings");
  const business = await db.business.findUnique({ where: { id: ctx.businessId } });
  if (!business) throw new ForbiddenError("NOT_A_MEMBER");
  return business;
}

function toState(business: {
  id: string;
  name: string;
  country: ConnectCountry;
  stripeAccountId: string | null;
}): ConnectBusinessState {
  return {
    businessId: business.id,
    displayName: business.name,
    country: business.country,
    stripeAccountId: business.stripeAccountId,
  };
}

export type StartOnboardingActionResult =
  | { ok: true; onboardingUrl: string }
  | { ok: false; reason: "payments_not_configured" | "unsupported_country" };

/**
 * Begin (or resume) Stripe onboarding and return a hosted onboarding URL for the
 * client to redirect to. Creates the connected account on first call.
 */
export async function startPaymentsOnboarding(
  input: unknown,
): Promise<StartOnboardingActionResult> {
  const { businessId } = connectOnboardingSchema.parse(input);
  const business = await loadManagedBusiness(businessId);

  if (!isPaymentsConfigured()) return { ok: false, reason: "payments_not_configured" };

  const country = business.country;
  if (!isConnectCountry(country)) return { ok: false, reason: "unsupported_country" };

  const session = await requireSession();
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

  const result = await startConnectOnboarding({
    gateway: createStripeConnectGateway(),
    store: prismaConnectStore(),
    business: toState({ ...business, country }),
    contactEmail: session.user.email,
    returnUrl: `${base}${settingsPath(business.id)}?connect=return`,
    refreshUrl: `${base}${settingsPath(business.id)}?connect=refresh`,
  });

  revalidatePath(settingsPath(business.id));
  return { ok: true, onboardingUrl: result.onboardingUrl };
}

export type RefreshStatusActionResult =
  | { ok: true; status: ConnectStatus }
  | { ok: false; reason: "payments_not_configured" };

/**
 * Force a live re-check of capability status from Stripe and persist it. Useful
 * right after the merchant returns from onboarding, before the webhook lands.
 */
export async function refreshPaymentsOnboarding(
  input: unknown,
): Promise<RefreshStatusActionResult> {
  const { businessId } = connectOnboardingSchema.parse(input);
  const business = await loadManagedBusiness(businessId);

  if (!isPaymentsConfigured()) return { ok: false, reason: "payments_not_configured" };

  const country = business.country;
  if (!isConnectCountry(country)) {
    // No account possible for an unsupported country → simply not connected.
    return { ok: true, status: NOT_CONNECTED };
  }

  const status = await refreshConnectStatus({
    gateway: createStripeConnectGateway(),
    store: prismaConnectStore(),
    business: toState({ ...business, country }),
  });

  revalidatePath(settingsPath(business.id));
  return { ok: true, status };
}
