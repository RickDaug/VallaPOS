import { z } from "zod";

/**
 * Zod schemas for restaurant open-tab writes. Non-`server-only` so the rules are
 * unit-testable. Money is never accepted from the client except the cash tendered
 * at settle (the server recomputes the amount due).
 */

const businessIdSchema = z.string().min(1);
const idSchema = z.string().min(1);

// Upper bound on a single cashier-typed upcharge (cents). Mirrors the register's
// MAX_SNAPSHOT_PRICE_CENTS — generous for real add-ons while keeping a forged
// value bounded. The delta only ADDS (min 0), so it can never underpay.
const MAX_CUSTOM_MODIFIER_CENTS = 100_000_000;

// A line to add to a tab — same shape as the register line, minus price.
const tabLineInputSchema = z.object({
  variationId: idSchema,
  quantity: z.number().int().positive().max(999),
  modifierIds: z.array(idSchema).max(50).optional(),
  // AD-HOC modifiers the cashier typed at the order screen (e.g. "No onion",
  // "Extra cheese"). Unlike `modifierIds`, these have no catalog row, so the
  // name + upcharge ARE cashier-provided — like a manual line addition. Bounded:
  // the upcharge only ever ADDS (min 0), so it can't be used to underpay, and
  // it's capped. Persisted as a name/price snapshot on the order line. Mirrors
  // the register's checkout schema exactly (features/register/schema.ts).
  customModifiers: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        priceDeltaCents: z.number().int().min(0).max(MAX_CUSTOM_MODIFIER_CENTS),
      }),
    )
    .max(20)
    .optional(),
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
