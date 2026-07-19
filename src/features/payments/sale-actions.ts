"use server";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireCapability } from "@/lib/operator-guard";
import { computePricedOrder } from "@/features/register/pricing";
import { resolveOrderLines } from "@/features/register/resolve-lines";
import { isConnectCountry } from "./connect-gateway";
import { isPaymentsConfigured } from "./connect-stripe";
import { isPaymentsV2Enabled } from "./flags";
import { createStripeCheckoutGateway } from "./checkout-stripe";
import { openCheckoutSession } from "./checkout-service";
import { createOrReuseCheckoutSession } from "./sale-store";
import { getSalePaymentState, type SalePaymentState } from "./sale-queries";
import { qrSaleSchema, qrSaleStateSchema } from "./sale-schema";

/**
 * QR sale rail (PAYMENTS.md §9, PR-C). Opens a hosted Stripe Checkout Session on
 * the merchant's CONNECTED account for an OPEN order; the customer scans the
 * returned QR and pays; the webhook settles it. Dormant behind every gate.
 *
 * SERVER-AUTHORITATIVE: the total is recomputed from the catalog exactly like the
 * cash checkout — the client sends only cart lines, never a price (invariant #3;
 * this rail is online-only and rejects any offline price snapshot by construction,
 * the schema has no such field). Idempotent on `clientUuid`: a re-tapped "Pay"
 * reuses the same OPEN order + the same Stripe session (idempotency key), so it
 * can never open a duplicate or double-charge.
 */

export type CreateQrSaleResult =
  | { ok: true; qrUrl: string; stripeSessionId: string; expiresAt: number | null }
  | { ok: false; reason: "qr_unavailable" };

export async function createStripeQrSale(input: unknown): Promise<CreateQrSaleResult> {
  const data = qrSaleSchema.parse(input);
  // The active operator (PIN-identified) must be allowed to take orders; the OPEN
  // order is attributed to them.
  const operator = await requireCapability(data.businessId, "take_orders");
  const { businessId } = operator;

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: {
      country: true,
      currency: true,
      taxRateBps: true,
      taxInclusive: true,
      stripeAccountId: true,
      stripeChargesEnabled: true,
    },
  });
  if (!business) return { ok: false, reason: "qr_unavailable" };

  // GATE: every condition must hold or the rail is invisible/unavailable.
  if (
    !isPaymentsV2Enabled() ||
    !isPaymentsConfigured() ||
    !business.stripeChargesEnabled ||
    !business.stripeAccountId ||
    !isConnectCountry(business.country)
  ) {
    return { ok: false, reason: "qr_unavailable" };
  }
  const stripeAccountId = business.stripeAccountId;

  // Reuse an existing OPEN/settled order for this clientUuid (idempotent re-tap);
  // otherwise recompute the total server-side and create the OPEN order.
  const existing = await db.order.findUnique({
    where: { businessId_clientUuid: { businessId, clientUuid: data.clientUuid } },
    select: { id: true, number: true, totalCents: true },
  });

  let orderId: string;
  let orderNumber: number;
  let amountCents: number;

  if (existing) {
    orderId = existing.id;
    orderNumber = existing.number;
    amountCents = existing.totalCents;
  } else {
    // Resolve REAL prices + modifiers from the DB (businessId-scoped) — client
    // prices are never trusted. No priceOverride: the QR rail is online-only.
    const { moneyLines, lineRecords } = await resolveOrderLines(businessId, data.lines);
    const priced = computePricedOrder(moneyLines, {
      taxRateBps: business.taxRateBps,
      cartDiscountCents: data.cartDiscountCents,
      tipCents: data.tipCents,
      taxInclusive: business.taxInclusive,
    });

    const created = await db.$transaction(async (tx) => {
      // Atomically allocate the next per-business order number (row-locked).
      const counter = await tx.orderCounter.upsert({
        where: { businessId },
        create: { businessId, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
        select: { lastNumber: true },
      });
      const number = counter.lastNumber;

      return tx.order.create({
        data: {
          businessId,
          clientUuid: data.clientUuid,
          number,
          // OPEN — the money ledger (Payment) is written ONLY on webhook capture;
          // the order is marked PAID by the webhook, never by the client.
          status: "OPEN",
          cashierId: operator.membershipId,
          customerName: data.customerName,
          subtotalCents: priced.subtotalCents,
          discountCents: priced.discountCents,
          taxCents: priced.taxCents,
          tipCents: priced.tipCents,
          totalCents: priced.totalCents,
          lines: {
            create: lineRecords.map((l, i) => {
              const p = priced.lines[i]!;
              return {
                businessId,
                variationId: l.variationId,
                nameSnapshot: l.nameSnapshot,
                unitPriceCents: l.unitPriceCents,
                quantity: l.quantity,
                discountCents: p.discountCents,
                taxCents: p.taxCents,
                totalCents: p.totalCents,
                modifiers: {
                  create: l.modifiers.map((m) => ({
                    nameSnapshot: m.nameSnapshot,
                    priceDeltaCents: m.priceDeltaCents,
                  })),
                },
              };
            }),
          },
        },
        select: { id: true, number: true, totalCents: true },
      });
    });
    orderId = created.id;
    orderNumber = created.number;
    amountCents = created.totalCents;
  }

  // Open (or reuse, via the Stripe idempotency key) the hosted Checkout Session
  // on the connected account, then persist/refresh the CheckoutSession row.
  const session = await openCheckoutSession({
    gateway: createStripeCheckoutGateway(),
    businessId,
    stripeAccountId,
    orderId,
    orderNumber,
    clientUuid: data.clientUuid,
    amountCents,
    currency: business.currency,
    appBaseUrl: env.NEXT_PUBLIC_APP_URL,
  });

  await createOrReuseCheckoutSession({
    businessId,
    orderId,
    clientUuid: data.clientUuid,
    stripeSessionId: session.stripeSessionId,
    stripeAccountId,
    amountCents,
    currency: business.currency,
    expiresAt: session.expiresAt ? new Date(session.expiresAt * 1000) : null,
  });

  return { ok: true, qrUrl: session.url, stripeSessionId: session.stripeSessionId, expiresAt: session.expiresAt };
}

/**
 * Register poll for a QR sale's settlement state. Thin `"use server"` wrapper over
 * the server-only query so the client component can call it; gated by
 * `take_orders` and tenant-scoped by businessId.
 */
export async function getStripeQrSaleState(input: unknown): Promise<SalePaymentState | null> {
  const data = qrSaleStateSchema.parse(input);
  await requireCapability(data.businessId, "take_orders");
  return getSalePaymentState({ businessId: data.businessId, stripeSessionId: data.stripeSessionId });
}
