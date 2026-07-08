import "server-only";

import { db } from "@/lib/db";
import type { ConnectStore } from "./connect-service";

/**
 * Prisma-backed `ConnectStore`. `business` is the tenant ROOT (not a tenant-owned
 * model), so these writes are keyed by the business id / unique account id and are
 * intentionally outside the tenant-isolation guard's model list.
 */
export function prismaConnectStore(): ConnectStore {
  return {
    async saveAccountId(businessId, accountId) {
      await db.business.update({
        where: { id: businessId },
        data: { stripeAccountId: accountId },
      });
    },
    async saveChargesEnabled(businessId, accountId, chargesEnabled) {
      // Match BOTH ids so a stale status for a since-replaced account can't flip
      // the current one.
      await db.business.updateMany({
        where: { id: businessId, stripeAccountId: accountId },
        data: { stripeChargesEnabled: chargesEnabled },
      });
    },
  };
}

/**
 * Webhook path: flip capability status keyed by the connected-account id alone
 * (the webhook has no session/business context). Returns the number of rows
 * updated — 0 means we don't recognize the account (safe no-op). `stripeAccountId`
 * is unique, so this affects at most one business.
 */
export async function applyChargesByAccountId(
  accountId: string,
  chargesEnabled: boolean,
): Promise<number> {
  const res = await db.business.updateMany({
    where: { stripeAccountId: accountId },
    data: { stripeChargesEnabled: chargesEnabled },
  });
  return res.count;
}
