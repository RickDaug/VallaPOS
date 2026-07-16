/**
 * Pure stock/inventory helpers. Deliberately NO `server-only` so the register,
 * the Products screen, and unit tests can all share the exact same low/out-of-
 * stock definitions (single source of truth for the thresholds).
 *
 * Stock is a whole-unit integer count on a Variation. `null`/`undefined` means
 * the parent item does NOT track stock (`Item.trackStock === false`), so there
 * is no meaningful quantity — those are reported as "untracked" and never draw a
 * low/out badge.
 */

/** At or below this on-hand count (but above zero) an item reads as "low stock". */
export const LOW_STOCK_THRESHOLD = 5;

/** The four states a variation's stock can be in for display/decisioning. */
export type StockStatus = "ok" | "low" | "out" | "untracked";

/** True only when stock is tracked (a number) and depleted (<= 0). */
export function isOutOfStock(stock: number | null | undefined): boolean {
  return typeof stock === "number" && stock <= 0;
}

/** True only when stock is tracked and in the (0, LOW_STOCK_THRESHOLD] band. */
export function isLowStock(stock: number | null | undefined): boolean {
  return typeof stock === "number" && stock > 0 && stock <= LOW_STOCK_THRESHOLD;
}

/**
 * Classify a variation's on-hand count:
 *  - "untracked" — not tracking (null/undefined)
 *  - "out"       — tracking and <= 0
 *  - "low"       — tracking and in (0, LOW_STOCK_THRESHOLD]
 *  - "ok"        — tracking and above the threshold
 */
export function stockStatus(stock: number | null | undefined): StockStatus {
  if (typeof stock !== "number") return "untracked";
  if (stock <= 0) return "out";
  if (stock <= LOW_STOCK_THRESHOLD) return "low";
  return "ok";
}
