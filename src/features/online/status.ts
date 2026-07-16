/**
 * Pure online-order status machine (no server-only / Prisma) so the transitions
 * are unit-testable and shared between the merchant actions and the UI.
 *
 * Lifecycle (see docs/ONLINE_ORDERING.md):
 *   SUBMITTED ──accept──▶ ACCEPTED ──ready──▶ READY ──complete──▶ COMPLETED
 *        │                   │                  │
 *        └──reject──▶ REJECTED (from any of SUBMITTED/ACCEPTED/READY)
 *   ACCEPTED can also skip straight to COMPLETED (accepted → handed over).
 *
 * Stock is decremented on ACCEPT (not on submit — avoids losing stock to spam /
 * abandoned online orders) and restocked on REJECT only if it had been accepted.
 */

export const ONLINE_ORDER_ACTIONS = ["accept", "ready", "complete", "reject"] as const;
export type OnlineOrderAction = (typeof ONLINE_ORDER_ACTIONS)[number];

export type OnlineStatus = "SUBMITTED" | "ACCEPTED" | "READY" | "COMPLETED" | "REJECTED";

/** The active (still on the merchant board) statuses. */
export const ACTIVE_ONLINE_STATUSES: OnlineStatus[] = ["SUBMITTED", "ACCEPTED", "READY"];

const TRANSITIONS: Record<OnlineStatus, Partial<Record<OnlineOrderAction, OnlineStatus>>> = {
  SUBMITTED: { accept: "ACCEPTED", reject: "REJECTED" },
  ACCEPTED: { ready: "READY", complete: "COMPLETED", reject: "REJECTED" },
  READY: { complete: "COMPLETED", reject: "REJECTED" },
  COMPLETED: {},
  REJECTED: {},
};

/** The target status for an action, or null when the action is invalid from `current`. */
export function nextOnlineStatus(
  current: OnlineStatus,
  action: OnlineOrderAction,
): OnlineStatus | null {
  return TRANSITIONS[current]?.[action] ?? null;
}

/**
 * Whether stock has been COMMITTED (decremented) at a given status. Stock moves on
 * ACCEPT, so it's committed once the order is ACCEPTED or READY. A reject from
 * SUBMITTED (never accepted) must NOT restock; a reject from ACCEPTED/READY must.
 */
export function isStockCommittedAt(status: OnlineStatus): boolean {
  return status === "ACCEPTED" || status === "READY";
}
