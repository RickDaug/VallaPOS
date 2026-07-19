import { z } from "zod";

/**
 * Zod schema for the subscription actions (PAYMENTS.md §9, PR-D). Just the tenant
 * id — everything else (owner email, price id, redirect URLs, existing customer)
 * is resolved server-side from the business + session, never trusted from the
 * client. Mirrors `connectOnboardingSchema`.
 */
export const subscriptionActionSchema = z.object({
  businessId: z.string().min(1),
});

export type SubscriptionActionInput = z.infer<typeof subscriptionActionSchema>;
