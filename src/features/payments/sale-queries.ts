import "server-only";

import { db } from "@/lib/db";
import type { CheckoutSessionStatus } from "@prisma/client";

/**
 * Read side for the register to POLL a QR sale's settlement (PAYMENTS.md §9,
 * PR-C). Tenant-scoped by `businessId` (the caller — a `take_orders` action —
 * already proved membership), and additionally matched on the session id so a
 * register only ever reads its own tenant's session.
 */
export interface SalePaymentState {
  /** The lifecycle status the webhook has (or hasn't) advanced the session to. */
  status: CheckoutSessionStatus;
  /** The OPEN/PAID order this session collects. */
  orderId: string;
  /** The settling Payment id once CAPTURED (null while OPEN/FAILED/EXPIRED). */
  paymentId: string | null;
}

export async function getSalePaymentState(input: {
  businessId: string;
  stripeSessionId: string;
}): Promise<SalePaymentState | null> {
  const row = await db.checkoutSession.findFirst({
    where: { businessId: input.businessId, stripeSessionId: input.stripeSessionId },
    select: { status: true, orderId: true, paymentId: true },
  });
  return row ?? null;
}
