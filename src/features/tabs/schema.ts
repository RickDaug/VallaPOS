import { z } from "zod";

/**
 * Zod schemas for restaurant open-tab writes. Non-`server-only` so the rules are
 * unit-testable. Money is never accepted from the client except the cash tendered
 * at settle (the server recomputes the amount due).
 */

const businessIdSchema = z.string().min(1);
const idSchema = z.string().min(1);

// A line to add to a tab — same shape as the register line, minus price.
const tabLineInputSchema = z.object({
  variationId: idSchema,
  quantity: z.number().int().positive().max(999),
  modifierIds: z.array(idSchema).max(50).optional(),
});

// seat: a non-negative integer, or null for the shared/unassigned group.
const seatSchema = z.number().int().min(0).max(999).nullable();

export const openTabSchema = z.object({
  businessId: businessIdSchema,
  tableId: idSchema,
});

export const addTabLinesSchema = z.object({
  businessId: businessIdSchema,
  orderId: idSchema,
  seat: seatSchema.default(null),
  lines: z.array(tabLineInputSchema).min(1).max(100),
});

export const setTabLineQtySchema = z.object({
  businessId: businessIdSchema,
  orderId: idSchema,
  lineId: idSchema,
  quantity: z.number().int().positive().max(999),
});

export const tabLineRefSchema = z.object({
  businessId: businessIdSchema,
  orderId: idSchema,
  lineId: idSchema,
});

export const assignLineSeatSchema = z.object({
  businessId: businessIdSchema,
  orderId: idSchema,
  lineId: idSchema,
  seat: seatSchema,
});

export const mergeTablesSchema = z.object({
  businessId: businessIdSchema,
  orderId: idSchema,
  tableId: idSchema,
});

export const transferTabSchema = z.object({
  businessId: businessIdSchema,
  orderId: idSchema,
  fromTableId: idSchema,
  toTableId: idSchema,
});

export const settleTabSchema = z.object({
  businessId: businessIdSchema,
  orderId: idSchema,
  // Omit (or null) to settle the WHOLE remaining tab; otherwise the seats to
  // settle (use null in the array for the shared group).
  seats: z.array(seatSchema).min(1).nullable().optional(),
  tipCents: z.number().int().min(0).max(10_000_000).default(0),
  cashTenderedCents: z.number().int().min(0).max(10_000_000),
});

export type TabLineInput = z.infer<typeof tabLineInputSchema>;
