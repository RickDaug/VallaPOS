import "server-only";

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SubscriptionEvent } from "./billing-webhook";

/**
 * Prisma-backed persistence for the flat SaaS subscription (PAYMENTS.md §9, PR-D).
 *
 * `Business` is the tenant ROOT, and these writes are keyed by the globally-unique
 * Stripe ids (`stripeSubscriptionId` / `stripeCustomerId`) or the business id, so
 * they are intentionally OUTSIDE the tenant-isolation guard's model list — the
 * webhook has no request session; the tenant is proven from the signed event.
 *
 * Idempotent under Stripe's aggressive webhook replay: every apply is a
 * last-write-wins `updateMany`. Resolution order (most→least specific):
 *   1. `stripeSubscriptionId` (unique) — set once the subscription exists
 *   2. `stripeCustomerId`     (unique) — set from the first checkout/subscription event
 *   3. `businessId`           (id)     — the bootstrap path (metadata / client_reference_id)
 * An event that matches none (`count === 0`) is an unknown subscription — the
 * caller logs and 200s; we NEVER throw.
 */

export type SubscriptionResolvedBy = "subscriptionId" | "customerId" | "businessId" | "none";

export interface ApplySubscriptionResult {
  /** Rows updated. 0 ⇒ we don't recognize this subscription (safe no-op). */
  matched: number;
  /** Which key resolved the business (for logging). */
  by: SubscriptionResolvedBy;
}

/**
 * Build the update payload. Only fields the event actually carries are written,
 * so a sparse event (e.g. invoice.payment_failed, which only knows the ids +
 * past_due) never nulls out a previously-stored price/period end. `status` is
 * always written when present (last-write-wins is the intended semantics).
 */
function buildData(update: SubscriptionEvent): Prisma.BusinessUpdateManyMutationInput {
  const data: Prisma.BusinessUpdateManyMutationInput = {};
  if (update.status !== null) data.subscriptionStatus = update.status;
  if (update.stripeCustomerId !== null) data.stripeCustomerId = update.stripeCustomerId;
  if (update.stripeSubscriptionId !== null) data.stripeSubscriptionId = update.stripeSubscriptionId;
  if (update.priceId !== null) data.subscriptionPriceId = update.priceId;
  if (update.currentPeriodEnd !== null) data.subscriptionCurrentPeriodEnd = update.currentPeriodEnd;
  return data;
}

export async function applySubscriptionState(
  update: SubscriptionEvent,
): Promise<ApplySubscriptionResult> {
  const data = buildData(update);

  if (update.stripeSubscriptionId) {
    const res = await db.business.updateMany({
      where: { stripeSubscriptionId: update.stripeSubscriptionId },
      data,
    });
    if (res.count > 0) return { matched: res.count, by: "subscriptionId" };
  }

  if (update.stripeCustomerId) {
    const res = await db.business.updateMany({
      where: { stripeCustomerId: update.stripeCustomerId },
      data,
    });
    if (res.count > 0) return { matched: res.count, by: "customerId" };
  }

  if (update.businessId) {
    const res = await db.business.updateMany({
      where: { id: update.businessId },
      data,
    });
    if (res.count > 0) return { matched: res.count, by: "businessId" };
  }

  return { matched: 0, by: "none" };
}
