import "server-only";
import { db } from "@/lib/db";
import type { FirstRunState } from "./first-run";

/**
 * Derive the merchant's first-run activation state from data (no schema flag).
 * All three reads are scoped by businessId (tenant-isolation invariant).
 *
 *  - hasItems  — any catalog item exists.
 *  - hasSale   — any order has reached a completed status (paid, or paid then
 *                refunded). OPEN tabs and VOIDED orders don't count as a sale.
 *  - taxConfigured — a non-zero tax rate is set.
 */
export async function getFirstRunState(businessId: string): Promise<FirstRunState> {
  const [itemCount, saleCount, business] = await Promise.all([
    db.item.count({ where: { businessId } }),
    db.order.count({
      where: { businessId, status: { in: ["PAID", "REFUNDED", "PARTIALLY_REFUNDED"] } },
    }),
    db.business.findUnique({ where: { id: businessId }, select: { taxRateBps: true } }),
  ]);

  return {
    hasItems: itemCount > 0,
    hasSale: saleCount > 0,
    taxConfigured: (business?.taxRateBps ?? 0) > 0,
  };
}
