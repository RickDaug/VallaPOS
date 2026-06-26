import { z } from "zod";

/** Tender methods the register can record at checkout. CASH settles with cash +
 *  change; QR shows the merchant's configured payment QR (confirm-based, no PSP)
 *  and MANUAL ("Other") records any other payment taken outside the app — both
 *  capture the server total with no card data and no change. (CARD is reserved
 *  for the later processor-backed integrated-payments work.) */
export const TENDER_METHODS = ["CASH", "QR", "MANUAL"] as const;
export type TenderMethod = (typeof TENDER_METHODS)[number];

// Upper bound on any single snapshot price (cents). Generous enough for real
// merchandise ($1M) while keeping a forged offline snapshot bounded — the
// relaxation below only trusts these UNIT prices, never an arbitrary total.
const MAX_SNAPSHOT_PRICE_CENTS = 100_000_000;

const snapshotPrice = z.number().int().min(0).max(MAX_SNAPSHOT_PRICE_CENTS);

/**
 * OFFLINE PRICE SNAPSHOT (deliberate, bounded trust relaxation — see actions.ts).
 *
 * Captured at sale time on the device when a sale is rung up OFFLINE. The cash
 * was already collected at the price the customer was QUOTED on screen; if the
 * catalog price changes before the queued sale replays, the recorded total must
 * still match what was paid — NOT the current DB price. So a replayed offline
 * sale carries this snapshot and the server trusts the snapshot UNIT prices
 * (and only those) instead of re-reading the catalog.
 *
 * `quoted: true` is the explicit origin marker. Per line (index-aligned with
 * `lines`): the quoted base `unitPriceCents` (EXCLUDING modifiers) plus the
 * quoted per-modifier deltas keyed by modifier id. All non-negative + bounded.
 * Tax is still recomputed from these prices server-side, and modifiers are still
 * re-validated against the catalog — only the unit/delta amounts are trusted.
 */
export const priceSnapshotSchema = z.object({
  // Explicit origin marker — must be literally true for the relaxation to apply.
  quoted: z.literal(true),
  // One entry per cart line, in the SAME order as `lines`.
  lines: z
    .array(
      z.object({
        // Quoted base unit price (modifiers excluded), captured at sale time.
        unitPriceCents: snapshotPrice,
        // Quoted modifier deltas, keyed by modifier id. The server still verifies
        // each id is real + linked; the snapshot only overrides the delta amount.
        modifierDeltas: z.record(z.string().min(1), snapshotPrice).optional(),
      }),
    )
    .min(1),
});

export type PriceSnapshot = z.infer<typeof priceSnapshotSchema>;

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
  // Manager-approval override for an UNVERIFIED tender (QR / MANUAL). When the
  // active operator lacks `approve_unverified_tender` (a cashier), a manager
  // enters their PIN to authorize the unverified tender. Verified SERVER-SIDE
  // against a capability-holding member of THIS business — the client value is
  // never trusted. Ignored for CASH and when the operator already holds the
  // capability. Digits-only, same 4–8 length as a member PIN.
  managerPin: z
    .string()
    .regex(/^\d+$/, "PIN must be digits only.")
    .min(4)
    .max(8)
    .optional(),
  customerName: z.string().trim().max(80).optional(),
  // Present ONLY on a replayed OFFLINE sale (cash already collected at the quoted
  // price). When present + valid, the server trusts these snapshot unit prices
  // instead of the current catalog. Absent on every ONLINE checkout, which stays
  // fully server-authoritative. See priceSnapshotSchema + actions.ts.
  priceSnapshot: priceSnapshotSchema.optional(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

/**
 * The receipt returned by a completed checkout. Lives here (not in the
 * `"use server"` actions file) so it — and the result-union helpers below — can
 * be imported by client components and other non-server modules. A `"use server"`
 * file may only export async functions, so the type-guard can't live there.
 */
export interface Receipt {
  orderId: string;
  number: number;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  // How it was paid. For MANUAL ("Other") there is no cash/change — both are 0.
  method: TenderMethod;
  cashTenderedCents: number;
  changeCents: number;
  // Optional reference captured for a MANUAL tender (else null).
  manualNote: string | null;
}

/**
 * A checkout that could not complete because an UNVERIFIED tender (QR/MANUAL) was
 * rung by an operator who lacks `approve_unverified_tender` and the manager-PIN
 * override was missing or wrong. No order/payment is written. The UI prompts for
 * (or re-prompts for) a manager PIN.
 *  - manager_approval_required: no PIN supplied — show the prompt.
 *  - invalid_manager_pin: a PIN was supplied but didn't match a capability-holder
 *    (or that holder is locked out / none is configured) — show "try again".
 */
export interface CheckoutRejection {
  error: "manager_approval_required" | "invalid_manager_pin";
}

export type CheckoutResult = Receipt | CheckoutRejection;

/** Narrow a checkout result: true when the sale completed (a Receipt). */
export function isReceipt(result: CheckoutResult): result is Receipt {
  return !("error" in result);
}
