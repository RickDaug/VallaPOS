import { z } from "zod";

/**
 * Zod schemas for the QR sale rail action (PAYMENTS.md §9, PR-C). Mirrors the
 * register `checkoutSchema` line shape, but INTENTIONALLY omits `priceSnapshot`,
 * `method`, cash/manual fields, and the offline attribution fields: the QR rail
 * is ONLINE-ONLY and fully server-authoritative — there is no offline
 * price-quote relaxation on this path (invariant #3). The total is recomputed
 * server-side from the catalog; nothing the client sends about price is trusted.
 */

const MAX_AMOUNT_CENTS = 100_000_000;

export const qrSaleSchema = z.object({
  businessId: z.string().min(1),
  // Client-generated UUID — idempotency key. Reused across a "Pay" re-tap so it
  // maps to the SAME order + Stripe session (never a duplicate charge).
  clientUuid: z.string().uuid(),
  lines: z
    .array(
      z.object({
        variationId: z.string().min(1),
        quantity: z.number().int().positive().max(999),
        // Chosen catalog modifier ids — the server RE-LOOKS-UP each (businessId-
        // scoped) and never trusts a client-sent price.
        modifierIds: z.array(z.string().min(1)).max(50).optional(),
        // Ad-hoc cashier-typed modifiers (name + upcharge, upcharge only adds).
        customModifiers: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(80),
              priceDeltaCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS),
            }),
          )
          .max(20)
          .optional(),
      }),
    )
    .min(1, "Cart is empty")
    .max(300, "Too many lines"),
  tipCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS).default(0),
  cartDiscountCents: z.number().int().min(0).default(0),
  customerName: z.string().trim().max(80).optional(),
});

export type QrSaleInput = z.infer<typeof qrSaleSchema>;

/** Register poll for the settlement state of an opened QR sale. */
export const qrSaleStateSchema = z.object({
  businessId: z.string().min(1),
  stripeSessionId: z.string().min(1),
});

export type QrSaleStateInput = z.infer<typeof qrSaleStateSchema>;
