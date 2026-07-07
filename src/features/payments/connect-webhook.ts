/**
 * PURE extraction of connected-account capability state from a Stripe webhook
 * event object. Kept separate from the route handler (which does signature
 * verification + DB writes) so the shape-parsing — the fiddly part — is unit
 * tested without a server, an SDK, or a signed payload.
 *
 * The account-capability signal can arrive in more than one shape depending on
 * the event/API surface, so we read defensively and default to "not enabled":
 *   - v1-style `account.updated`: `{ id, charges_enabled, details_submitted,
 *     capabilities: { card_payments: "active" } }`
 *   - Accounts v2: `{ id, configuration: { merchant: { capabilities: {
 *     card_payments: { status: "active" } } } } }`
 *
 * `chargesEnabled` is treated as the AND of "the account can charge" — we only
 * flip a business to charge-ready when the card_payments capability is active
 * (v2 status) or the account reports charges_enabled (v1). Anything unrecognized
 * → null (the route no-ops), never a false positive.
 */

export interface AccountCapabilityUpdate {
  accountId: string;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
}

/** Event types we act on. Others are acknowledged (200) and ignored. */
export const HANDLED_ACCOUNT_EVENT_TYPES: readonly string[] = [
  "account.updated",
  "v2.core.account.updated",
  "v2.core.account[configuration.merchant].capability_status_updated",
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** Read `card_payments` capability status across the v1 and v2 shapes. */
function cardPaymentsActive(obj: Record<string, unknown>): boolean {
  // v1: capabilities.card_payments === "active"
  const caps = asRecord(obj.capabilities);
  if (caps && caps.card_payments === "active") return true;

  // v2: configuration.merchant.capabilities.card_payments.status === "active"
  const merchant = asRecord(asRecord(obj.configuration)?.merchant);
  const v2Card = asRecord(asRecord(merchant?.capabilities)?.card_payments);
  if (v2Card && v2Card.status === "active") return true;

  return false;
}

/**
 * Pull the account id + capability state out of an event object, or null when
 * the event isn't an account-capability signal we understand. `eventType` gates
 * the parse so a same-shaped object on an unrelated event can't trip it.
 */
export function extractAccountCapability(
  eventType: string,
  eventObject: unknown,
): AccountCapabilityUpdate | null {
  if (!HANDLED_ACCOUNT_EVENT_TYPES.includes(eventType)) return null;

  const obj = asRecord(eventObject);
  if (!obj) return null;

  const accountId = typeof obj.id === "string" ? obj.id : null;
  if (!accountId || !accountId.startsWith("acct_")) return null;

  const chargesEnabled = obj.charges_enabled === true || cardPaymentsActive(obj);
  const detailsSubmitted = obj.details_submitted === true || chargesEnabled;

  return { accountId, chargesEnabled, detailsSubmitted };
}
