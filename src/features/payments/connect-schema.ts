import { z } from "zod";

/** Input for the Connect onboarding actions — just the tenant id; everything
 * else (country, email, redirect URLs) is resolved server-side from the business
 * + session, never trusted from the client. */
export const connectOnboardingSchema = z.object({
  businessId: z.string().min(1),
});

export type ConnectOnboardingInput = z.infer<typeof connectOnboardingSchema>;
