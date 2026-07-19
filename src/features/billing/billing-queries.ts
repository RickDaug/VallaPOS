import "server-only";

import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";

/**
 * Read-side view for the Settings → Subscription card (PAYMENTS.md §9, PR-D).
 * Membership-gated + tenant-scoped; uses the cached subscription columns (kept
 * fresh by the platform webhook) so a page render never blocks on a Stripe
 * round-trip. Actions (subscribe/manage) are OWNER-only and enforced separately.
 */
export interface SubscriptionStateView {
  /** Stripe's raw status string, or null when never subscribed. */
  status: string | null;
  /** When the current period ends (renews/lapses), or null. */
  currentPeriodEnd: Date | null;
  /** True once a platform Customer exists (⇒ the Manage-billing portal is usable). */
  hasCustomer: boolean;
}

export async function getSubscriptionState(businessId: string): Promise<SubscriptionStateView> {
  await requireMembership(businessId);
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: {
      subscriptionStatus: true,
      subscriptionCurrentPeriodEnd: true,
      stripeCustomerId: true,
    },
  });
  return {
    status: business?.subscriptionStatus ?? null,
    currentPeriodEnd: business?.subscriptionCurrentPeriodEnd ?? null,
    hasCustomer: Boolean(business?.stripeCustomerId),
  };
}
