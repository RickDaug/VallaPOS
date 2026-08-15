import { z } from "zod";

/**
 * Zod schemas for payroll-tax writes. Non-`server-only` so the rules are
 * unit-testable and importable by client components. Everything else (company
 * legal name, worker identity, gross figures) is resolved server-side from the
 * business + payslips, never trusted from the client — the client sends only ids.
 */

const businessIdSchema = z.string().min(1);
const idSchema = z.string().min(1);

/** Start/refresh company onboarding — just the tenant id. */
export const onboardingSchema = z.object({
  businessId: businessIdSchema,
});
export type OnboardingInput = z.infer<typeof onboardingSchema>;

/** Sync one worker (Membership) to the provider. */
export const syncWorkerSchema = z.object({
  businessId: businessIdSchema,
  membershipId: idSchema,
});
export type SyncWorkerInput = z.infer<typeof syncWorkerSchema>;

/** Run a tax preview for a pay period (writes provider figures onto payslips). */
export const previewRunSchema = z.object({
  businessId: businessIdSchema,
  payPeriodId: idSchema,
});
export type PreviewRunInput = z.infer<typeof previewRunSchema>;

/** Approve a previously-previewed provider run for a pay period. */
export const approveRunSchema = z.object({
  businessId: businessIdSchema,
  payPeriodId: idSchema,
});
export type ApproveRunInput = z.infer<typeof approveRunSchema>;
