/**
 * PURE extraction of a sale SETTLEMENT signal from a Stripe Checkout webhook
 * event. Kept separate from the route handler (signature verification + DB
 * writes) so the fiddly shape-parsing is unit-tested without a server, an SDK, or
 * a signed payload — mirroring `connect-webhook.ts`.
 *
 * Mapping (docs/PAYMENTS.md §9):
 *   - `checkout.session.completed` — capture ONLY when `payment_status === "paid"`
 *     (a synchronous card pays immediately; an async method completes "unpaid"
 *     and settles later via async_payment_succeeded).
 *   - `checkout.session.async_payment_succeeded` — capture.
 *   - `checkout.session.async_payment_failed`     — fail.
 *   - `checkout.session.expired`                  — expire.
 *   - anything else                               — null (route no-ops).
 *
 * No side effects. Reads defensively; a missing session id → null (never a
 * false-positive settlement).
 */

/** What the settled/failed/expired session tells us — all we act on. */
export interface SaleSettlement {
  /** How to transition the CheckoutSession. */
  kind: "capture" | "fail" | "expire";
  /** Stripe Checkout Session id (`cs_…`) — the tenant resolves from THIS. */
  stripeSessionId: string;
  /** Stripe's `amount_total` (integer cents) — re-verified vs the stored amount. */
  amountTotal: number | null;
  /** Stripe currency (lowercase, e.g. "usd") — re-verified vs the stored currency. */
  currency: string | null;
  /** The settling PaymentIntent id (`pi_…`) — becomes the Payment.processorRef. */
  paymentIntentId: string | null;
  /** Non-sensitive card metadata if the event carried it (usually absent). */
  cardBrand?: string | null;
  cardLast4?: string | null;
}

const CAPTURE_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** Pull a string id from either a bare id or an expanded `{ id }` object. */
function idOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  const rec = asRecord(value);
  return rec && typeof rec.id === "string" ? rec.id : null;
}

/** Best-effort card brand/last4 if the session object happens to carry them. */
function cardDetailsOf(obj: Record<string, unknown>): { cardBrand: string | null; cardLast4: string | null } {
  const pi = asRecord(obj.payment_intent);
  const charge = asRecord(pi?.latest_charge);
  const details = asRecord(asRecord(charge?.payment_method_details)?.card);
  const brand = details && typeof details.brand === "string" ? details.brand : null;
  const last4 = details && typeof details.last4 === "string" ? details.last4 : null;
  return { cardBrand: brand, cardLast4: last4 };
}

export function extractSaleSettlement(event: {
  type: string;
  object: unknown;
}): SaleSettlement | null {
  const type = event.type;
  const isCapture = CAPTURE_TYPES.has(type);
  const isFail = type === "checkout.session.async_payment_failed";
  const isExpire = type === "checkout.session.expired";
  if (!isCapture && !isFail && !isExpire) return null;

  const obj = asRecord(event.object);
  if (!obj) return null;

  const stripeSessionId = typeof obj.id === "string" ? obj.id : null;
  if (!stripeSessionId || !stripeSessionId.startsWith("cs_")) return null;

  // `completed` only settles when actually paid; an async method completes
  // "unpaid" and its later async_payment_succeeded does the capture.
  if (type === "checkout.session.completed" && obj.payment_status !== "paid") {
    return null;
  }

  const kind: SaleSettlement["kind"] = isCapture ? "capture" : isFail ? "fail" : "expire";
  const { cardBrand, cardLast4 } = cardDetailsOf(obj);

  return {
    kind,
    stripeSessionId,
    amountTotal: typeof obj.amount_total === "number" ? obj.amount_total : null,
    currency: typeof obj.currency === "string" ? obj.currency : null,
    paymentIntentId: idOf(obj.payment_intent),
    cardBrand,
    cardLast4,
  };
}
