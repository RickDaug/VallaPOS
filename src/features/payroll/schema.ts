import { z } from "zod";

/**
 * Zod schemas for payroll writes. Kept in a non-`server-only` module so the
 * validation rules are unit-testable and importable by client components for
 * input bounds, without pulling the server action file into the browser bundle.
 *
 * Money is INTEGER CENTS (non-negative). The overtime multiplier is basis points
 * (15000 = 1.5×). IDs are cuids — validated as non-empty strings.
 */

const businessIdSchema = z.string().min(1);
const idSchema = z.string().min(1);

// Non-negative integer cents. Capped generously to catch obvious fat-finger
// errors (e.g. missing decimal) without constraining real values.
const centsSchema = z.number().int().min(0).max(1_000_000_000);

// A basis-point multiplier ≥ 1.0× (10000) and ≤ 5.0× (50000). OT never pays LESS
// than base; a >5× multiplier is almost certainly a mistake.
const multiplierBpsSchema = z.number().int().min(10_000).max(50_000);

// Weekly OT threshold in minutes: 0 (all hours OT) up to 168h (a full week).
const thresholdMinutesSchema = z.number().int().min(0).max(7 * 24 * 60);

/** YYYY-MM-DD calendar date. */
const dateStrSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");

export const payTypeSchema = z.enum(["HOURLY", "SALARY"]);
export const adjustmentKindSchema = z.enum(["ADDITION", "DEDUCTION"]);

/** Set (create/update) a worker's pay rate. Hourly uses hourlyCents; salary uses annualCents. */
export const setPayRateSchema = z
  .object({
    businessId: businessIdSchema,
    membershipId: idSchema,
    payType: payTypeSchema,
    hourlyCents: centsSchema.default(0),
    annualCents: centsSchema.default(0),
    otEnabled: z.boolean().default(true),
    otThresholdMinutes: thresholdMinutesSchema.nullable().default(null),
    otMultiplierBps: multiplierBpsSchema.nullable().default(null),
  })
  .refine((v) => (v.payType === "HOURLY" ? v.hourlyCents > 0 : true), {
    message: "Enter an hourly rate greater than 0.",
    path: ["hourlyCents"],
  })
  .refine((v) => (v.payType === "SALARY" ? v.annualCents > 0 : true), {
    message: "Enter an annual salary greater than 0.",
    path: ["annualCents"],
  });
export type SetPayRateInput = z.infer<typeof setPayRateSchema>;

/** Create a pay period over [startDate, endDate] (inclusive days). */
export const createPayPeriodSchema = z
  .object({
    businessId: businessIdSchema,
    label: z.string().trim().max(80).optional(),
    startDate: dateStrSchema,
    endDate: dateStrSchema,
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "End date must be on or after the start date.",
    path: ["endDate"],
  });
export type CreatePayPeriodInput = z.infer<typeof createPayPeriodSchema>;

/** A period-scoped action with no other input (compute, finalize, reopen, mark-paid, delete). */
export const payPeriodScopeSchema = z.object({
  businessId: businessIdSchema,
  payPeriodId: idSchema,
});
export type PayPeriodScopeInput = z.infer<typeof payPeriodScopeSchema>;

/** Add a manual adjustment line to a payslip. amountCents is positive; kind sets the sign. */
export const addAdjustmentSchema = z.object({
  businessId: businessIdSchema,
  payslipId: idSchema,
  kind: adjustmentKindSchema,
  label: z.string().trim().min(1, "Enter a label.").max(80),
  amountCents: centsSchema.refine((c) => c > 0, "Enter an amount greater than 0."),
});
export type AddAdjustmentInput = z.infer<typeof addAdjustmentSchema>;

/** Remove a manual adjustment line. */
export const removeAdjustmentSchema = z.object({
  businessId: businessIdSchema,
  adjustmentId: idSchema,
});
export type RemoveAdjustmentInput = z.infer<typeof removeAdjustmentSchema>;
