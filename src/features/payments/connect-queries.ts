import "server-only";

import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { isPaymentsConfigured } from "./connect-stripe";

/**
 * Read-side view for the Settings → Payments screen. Uses the CACHED
 * `stripeChargesEnabled` (kept fresh by the webhook + the refresh action) so a
 * page render never blocks on a Stripe round-trip. Membership-gated; the caller
 * page additionally gates display by the `manage_settings` capability.
 */
export interface PaymentsConnectView {
  /** Platform has Stripe keys configured (feature available at all). */
  configured: boolean;
  /** This business has started onboarding (has a connected account). */
  connected: boolean;
  /** Capability active — the business could take card payments (once the rail ships). */
  chargesEnabled: boolean;
  country: string;
}

export async function getPaymentsConnectStatus(
  businessId: string,
): Promise<PaymentsConnectView> {
  await requireMembership(businessId);
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { country: true, stripeAccountId: true, stripeChargesEnabled: true },
  });
  return {
    configured: isPaymentsConfigured(),
    connected: Boolean(business?.stripeAccountId),
    chargesEnabled: Boolean(business?.stripeChargesEnabled),
    country: business?.country ?? "US",
  };
}
