/**
 * PURE extraction of a subscription-state signal from a PLATFORM Stripe webhook
 * event. Kept separate from the route handler (signature verification + DB
 * writes) so the fiddly shape-parsing is unit-tested without a server, an SDK, or
 * a signed payload — mirroring `sale-webhook.ts` / `connect-webhook.ts`.
 *
 * Handled events (docs/PAYMENTS.md §9, PR-D):
 *   - `checkout.session.completed` (mode === "subscription") — records the
 *     customer↔subscription↔business mapping and grants access (status "active").
 *   - `customer.subscription.created|updated|deleted` — the AUTHORITATIVE status
 *     (active/trialing/past_due/canceled/…), price, and period end.
 *   - `invoice.payment_failed` — a recurring charge failed → treat as past_due
 *     (grace) even if the corresponding subscription.updated is delayed.
 *   - anything else → null (route no-ops, 200).
 *
 * No side effects. Reads defensively; an object with no resolvable customer /
 * subscription / business id → null (never a false-positive state write).
 */

/** The state signal a handled event carries. Any of the three ids may be null;
 *  the store resolves the business by subscription id → customer id → businessId. */
export interface SubscriptionEvent {
  /** Our tenant id if the event carried it (`client_reference_id` / metadata). */
  businessId: string | null;
  /** Platform Customer id (`cus_…`). */
  stripeCustomerId: string | null;
  /** Platform Subscription id (`sub_…`). */
  stripeSubscriptionId: string | null;
  /** Stripe's RAW status string (stored verbatim; mapped in subscription-access). */
  status: string | null;
  /** The subscribed Price id (`price_…`) when the event carries it. */
  priceId: string | null;
  /** Current period end (renews/lapses at) when the event carries it. */
  currentPeriodEnd: Date | null;
}

const SUBSCRIPTION_EVENT_TYPES = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
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

/** businessId from `client_reference_id` (Checkout) or `metadata.businessId`. */
function businessIdOf(obj: Record<string, unknown>): string | null {
  if (typeof obj.client_reference_id === "string") return obj.client_reference_id;
  const meta = asRecord(obj.metadata);
  return meta && typeof meta.businessId === "string" ? meta.businessId : null;
}

/** First subscription-item price id (`items.data[0].price.id`, or legacy `plan.id`). */
function firstPriceId(obj: Record<string, unknown>): string | null {
  const items = asRecord(obj.items);
  const data = items?.data;
  const first = Array.isArray(data) ? asRecord(data[0]) : null;
  if (!first) return null;
  const price = idOf(first.price);
  if (price) return price;
  return idOf(first.plan);
}

/** Convert a unix-seconds timestamp to a Date, defensively. */
function unixToDate(value: unknown): Date | null {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000) : null;
}

/** current_period_end at the subscription level, or on its first item (newer API). */
function periodEndOf(obj: Record<string, unknown>): Date | null {
  const top = unixToDate(obj.current_period_end);
  if (top) return top;
  const items = asRecord(obj.items);
  const data = items?.data;
  const first = Array.isArray(data) ? asRecord(data[0]) : null;
  return first ? unixToDate(first.current_period_end) : null;
}

export function extractSubscriptionEvent(event: {
  type: string;
  object: unknown;
}): SubscriptionEvent | null {
  const obj = asRecord(event.object);
  if (!obj) return null;
  const type = event.type;

  // 1) Checkout completed — establishes the mapping and grants access. Only for
  // subscription-mode sessions (a one-time payment session is not ours here).
  if (type === "checkout.session.completed") {
    if (obj.mode !== "subscription") return null;
    const stripeCustomerId = idOf(obj.customer);
    const stripeSubscriptionId = idOf(obj.subscription);
    const businessId = businessIdOf(obj);
    if (!stripeCustomerId && !stripeSubscriptionId && !businessId) return null;
    return {
      businessId,
      stripeCustomerId,
      stripeSubscriptionId,
      // Checkout succeeded → the subscription is live; the authoritative
      // trialing/past_due nuance arrives via customer.subscription.updated.
      status: "active",
      priceId: null,
      currentPeriodEnd: null,
    };
  }

  // 2) Subscription lifecycle — the authoritative status/price/period end.
  if (SUBSCRIPTION_EVENT_TYPES.has(type)) {
    const stripeSubscriptionId = typeof obj.id === "string" ? obj.id : null;
    const stripeCustomerId = idOf(obj.customer);
    const businessId = businessIdOf(obj);
    if (!stripeSubscriptionId && !stripeCustomerId) return null;
    return {
      businessId,
      stripeCustomerId,
      stripeSubscriptionId,
      status: typeof obj.status === "string" ? obj.status : null,
      priceId: firstPriceId(obj),
      currentPeriodEnd: periodEndOf(obj),
    };
  }

  // 3) Invoice payment failed — force past_due (grace) promptly.
  if (type === "invoice.payment_failed") {
    const stripeCustomerId = idOf(obj.customer);
    const stripeSubscriptionId = idOf(obj.subscription);
    const businessId = businessIdOf(obj);
    if (!stripeCustomerId && !stripeSubscriptionId) return null;
    return {
      businessId,
      stripeCustomerId,
      stripeSubscriptionId,
      status: "past_due",
      priceId: null,
      currentPeriodEnd: null,
    };
  }

  return null;
}
