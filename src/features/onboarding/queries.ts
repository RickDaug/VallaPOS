import "server-only";
import { db } from "@/lib/db";
import type { FirstRunState } from "./first-run";

/**
 * The demo product seeded into every new business (see SAMPLE_ITEM_NAME in
 * src/features/auth/actions.ts). It exists only so the register isn't empty on
 * day one — tapping/keeping it must NOT count as the merchant having built a real
 * catalog, or the "Add your first item" step would self-complete from the seed
 * (audit R4 #2). Excluded from the activation item count below. Keep this literal
 * in sync with auth/actions.ts (that "use server" file can't export the constant,
 * and it isn't in this file's ownership to edit).
 */
const SAMPLE_ITEM_NAME = "Sample item (tap to sell — delete anytime)";

/**
 * Derive the merchant's first-run activation state from data (no schema flag).
 * All three reads are scoped by businessId (tenant-isolation invariant).
 *
 *  - hasItems  — any REAL catalog item exists (the seeded sample doesn't count).
 *  - hasSale   — any order has reached a completed status (paid, or paid then
 *                refunded). OPEN tabs and VOIDED orders don't count as a sale.
 *  - taxConfigured — a non-zero tax rate is set.
 */
export async function getFirstRunState(businessId: string): Promise<FirstRunState> {
  const [realItemCount, saleCount, business] = await Promise.all([
    // Exclude the seeded demo product so a real, merchant-added item is what
    // completes the "Add your first item" step (tenant-scoped by businessId).
    db.item.count({ where: { businessId, name: { not: SAMPLE_ITEM_NAME } } }),
    db.order.count({
      where: { businessId, status: { in: ["PAID", "REFUNDED", "PARTIALLY_REFUNDED"] } },
    }),
    db.business.findUnique({ where: { id: businessId }, select: { taxRateBps: true } }),
  ]);

  return {
    hasItems: realItemCount > 0,
    hasSale: saleCount > 0,
    taxConfigured: (business?.taxRateBps ?? 0) > 0,
  };
}
