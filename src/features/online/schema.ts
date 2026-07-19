import { z } from "zod";
import { ONLINE_ORDER_ACTIONS } from "./status";

/**
 * Tenders a merchant can record when settling an online order. Mirrors the
 * register's non-card tenders (`TENDER_METHODS`) and the `PaymentMethod` enum:
 * CASH (in hand), QR (the merchant's confirm-based pay handle), or MANUAL/"Other".
 * CARD is reserved for the later PSP-backed path (docs/PAYMENTS.md).
 */
export const ONLINE_SETTLE_METHODS = ["CASH", "QR", "MANUAL"] as const;
export type OnlineSettleMethod = (typeof ONLINE_SETTLE_METHODS)[number];

/**
 * Input schemas for QR self-ordering (docs/ONLINE_ORDERING.md).
 *
 * The public submit is UNAUTHENTICATED, so every bound here is a security control:
 * hard caps on line count / quantity / string lengths keep a malicious payload
 * from ballooning DB work, and the server RE-LOOKS-UP every price from the catalog
 * (see resolveOrderLines) — the customer never sends money amounts. Unlike the
 * register's checkout schema there is deliberately NO client price, NO price
 * snapshot, NO ad-hoc/custom modifier, and NO discount: an anonymous customer may
 * only pick catalog items + linked modifiers and (optionally) add a tip.
 */

// Upper bound on a tip (cents). SECURITY (#13): this is CLIENT-AUTHORITATIVE money
// added on top of the server-recomputed subtotal — the one amount the customer can
// influence — so it is capped HARD at a small fixed ceiling ($1,000). The public
// self-order UI sends 0; a direct caller can still add a tip, but never an absurd
// one. (The old $1M ceiling let a raw call bolt a seven-figure "tip" onto any cart.)
const MAX_TIP_CENTS = 100_000;

// A public order can't realistically carry hundreds of distinct lines; the caps
// bound the per-request DB work (each line triggers modifier validation + a
// nested write) on an endpoint anyone can hit.
const MAX_LINES = 100;
const MAX_QTY = 99;
const MAX_MODIFIERS_PER_LINE = 30;

export const submitOnlineOrderSchema = z.object({
  businessId: z.string().min(1),
  // Client-generated UUID — idempotency key so a double-tap / flaky reconnect
  // never places two orders.
  clientUuid: z.string().uuid(),
  lines: z
    .array(
      z.object({
        variationId: z.string().min(1),
        quantity: z.number().int().positive().max(MAX_QTY),
        // Chosen modifier ids. The server RE-LOOKS-UP each id (businessId-scoped)
        // and validates min/maxSelect — client names/prices are never trusted.
        modifierIds: z.array(z.string().min(1)).max(MAX_MODIFIERS_PER_LINE).optional(),
      }),
    )
    .min(1, "Your cart is empty")
    .max(MAX_LINES, "Too many items"),
  customerName: z.string().trim().max(80).optional(),
  // Free-text phone (kept as a string — international formats vary). Bounded only.
  customerPhone: z.string().trim().max(40).optional(),
  tipCents: z.number().int().min(0).max(MAX_TIP_CENTS).default(0),
});

export type SubmitOnlineOrderInput = z.infer<typeof submitOnlineOrderSchema>;

/** A merchant-side status transition on one online order (accept/ready/complete/reject). */
export const onlineOrderActionSchema = z.object({
  businessId: z.string().min(1),
  orderId: z.string().min(1),
  action: z.enum(ONLINE_ORDER_ACTIONS),
});

export type OnlineOrderActionInput = z.infer<typeof onlineOrderActionSchema>;

/**
 * Merchant SETTLEMENT of one online order (records a Payment + flips it to PAID so
 * it becomes realized revenue/tax). `take_orders`-gated, tenant-scoped. `tipCents`
 * is an OPTIONAL staff-entered tip added on top of the order's server-stored total;
 * it reuses the same hard cap as the public tip (never an absurd amount).
 */
export const settleOnlineOrderSchema = z.object({
  businessId: z.string().min(1),
  orderId: z.string().min(1),
  method: z.enum(ONLINE_SETTLE_METHODS).default("CASH"),
  tipCents: z.number().int().min(0).max(MAX_TIP_CENTS).default(0),
});

// z.input (not z.infer/output): `method` and `tipCents` have defaults, so a caller
// may omit them (the board sends only businessId/orderId/method; tests omit tip).
export type SettleOnlineOrderInput = z.input<typeof settleOnlineOrderSchema>;

/** Result of settling an online order (idempotent: re-settling is a no-op). */
export interface SettleOnlineOrderResult {
  /** "paid" = we recorded the payment now; "already_paid" = it was settled already. */
  status: "paid" | "already_paid";
  /** The order's total after any staff tip (what was captured / already captured). */
  totalCents: number;
}

/** Settings update: enable/disable online ordering + pickup instructions. */
export const updateOnlineOrderingSchema = z.object({
  businessId: z.string().min(1),
  onlineOrderingEnabled: z.boolean(),
  onlineOrderInstructions: z
    .string()
    .trim()
    .max(500)
    .transform((s) => s || null)
    .nullish(),
});

export type UpdateOnlineOrderingInput = z.infer<typeof updateOnlineOrderingSchema>;

// ── Public submit result (non-sensitive confirmation, no cross-customer data) ──

export interface OnlineOrderConfirmation {
  orderId: string;
  /** Human-friendly per-business order number the customer quotes at pickup. */
  number: number;
  totalCents: number;
}

export interface OnlineSubmitRejection {
  /**
   *  - unavailable: the business doesn't exist or online ordering is off.
   *  - rate_limited: too many submissions from this IP — try again shortly.
   *  - invalid: the cart referenced an unknown/foreign item or modifier, or a
   *    required modifier group was left unsatisfied.
   */
  error: "unavailable" | "rate_limited" | "invalid";
}

export type SubmitOnlineOrderResult = OnlineOrderConfirmation | OnlineSubmitRejection;

/** Narrow a submit result: true when the order was placed (a confirmation). */
export function isOnlineConfirmation(
  result: SubmitOnlineOrderResult,
): result is OnlineOrderConfirmation {
  return !("error" in result);
}
