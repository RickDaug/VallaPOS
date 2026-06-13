import { z } from "zod";

/**
 * Cash-drawer input validation. Money is integer cents and never negative.
 * IDs are cuids (Prisma `@default(cuid())`) — we validate they're non-empty
 * strings rather than uuids, since the models use cuid. The businessId is the
 * same cuid the rest of the app passes around.
 *
 * A sane upper bound (10,000,000 cents = $100k) guards against fat-fingered
 * counts/floats while staying well above any realistic single-drawer figure.
 */
const MAX_CENTS = 10_000_000;

const centsField = z.number().int().min(0).max(MAX_CENTS);

export const openDrawerSchema = z.object({
  businessId: z.string().min(1),
  openingFloatCents: centsField,
});
export type OpenDrawerInput = z.infer<typeof openDrawerSchema>;

export const closeDrawerSchema = z.object({
  businessId: z.string().min(1),
  sessionId: z.string().min(1),
  countedCents: centsField,
});
export type CloseDrawerInput = z.infer<typeof closeDrawerSchema>;
