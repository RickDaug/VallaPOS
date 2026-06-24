import { z } from "zod";

/** Tender methods the register can record at checkout. CASH settles with cash +
 *  change; QR shows the merchant's configured payment QR (confirm-based, no PSP)
 *  and MANUAL ("Other") records any other payment taken outside the app — both
 *  capture the server total with no card data and no change. (CARD is reserved
 *  for the later processor-backed integrated-payments work.) */
export const TENDER_METHODS = ["CASH", "QR", "MANUAL"] as const;
export type TenderMethod = (typeof TENDER_METHODS)[number];

export const checkoutSchema = z.object({
  businessId: z.string().min(1),
  // Client-generated UUID — idempotency key for offline-safe checkout.
  clientUuid: z.string().uuid(),
  lines: z
    .array(
      z.object({
        variationId: z.string().min(1),
        quantity: z.number().int().positive().max(999),
        lineDiscountCents: z.number().int().min(0).optional(),
        // Chosen modifier ids for this line. The server RE-LOOKS-UP each id
        // (businessId-scoped) and never trusts client-sent names/prices.
        modifierIds: z.array(z.string().min(1)).max(50).optional(),
      }),
    )
    .min(1, "Cart is empty"),
  tipCents: z.number().int().min(0).default(0),
  cartDiscountCents: z.number().int().min(0).default(0),
  // How the sale was tendered. Defaults to CASH so existing/offline payloads
  // (queued before this field existed) replay unchanged.
  method: z.enum(TENDER_METHODS).default("CASH"),
  // Cash given by the customer. Required-in-spirit for CASH (the action rejects
  // a tender below the server total); irrelevant for MANUAL, hence defaulted.
  cashTenderedCents: z.number().int().min(0).default(0),
  // Optional free-text reference for a MANUAL tender (e.g. "Check #1234",
  // "Zelle", "external card"). Ignored for CASH.
  manualNote: z.string().trim().max(120).optional(),
  customerName: z.string().trim().max(80).optional(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
