import { z } from "zod";

export const emailReceiptSchema = z.object({
  businessId: z.string().min(1),
  orderId: z.string().min(1),
  // Customer email to send the receipt to.
  email: z.string().trim().email(),
});

export type EmailReceiptInput = z.infer<typeof emailReceiptSchema>;

// A sane upper bound (10,000,000 cents = $100k) guards against fat-fingered
// refund amounts while staying well above any realistic single-order figure.
const MAX_CENTS = 10_000_000;

/** Void or full refund of an order. IDs are cuids, so we only require non-empty. */
export const voidOrderSchema = z.object({
  businessId: z.string().min(1),
  orderId: z.string().min(1),
  // Idempotency key for this void request. The client sends one per user action
  // and reuses it on retry, so a double-tap / re-send is applied at most once.
  clientUuid: z.string().uuid().optional(),
});
export type VoidOrderInput = z.infer<typeof voidOrderSchema>;

/**
 * Refund an order. Omit `amountCents` (or pass null) for a FULL refund; pass a
 * positive amount for a PARTIAL refund. The action re-derives net-collected from
 * the DB and rejects an amount that exceeds it — the bound here is only a sanity
 * cap, never the authority on how much can be refunded.
 */
export const refundOrderSchema = z.object({
  businessId: z.string().min(1),
  orderId: z.string().min(1),
  amountCents: z.number().int().positive().max(MAX_CENTS).nullish(),
  // Idempotency key for this refund request (see voidOrderSchema). Reused across
  // a retry so a double-tapped or re-sent refund is applied at most once.
  clientUuid: z.string().uuid().optional(),
});
export type RefundOrderInput = z.infer<typeof refundOrderSchema>;
