import "server-only";

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { applyStockDecrements, type StockDecrementLine } from "@/features/register/stock-decrement";
import type { SaleSettlement } from "./sale-webhook";

/**
 * Prisma-backed persistence for the QR sale rail (PAYMENTS.md §9, PR-C).
 *
 * The money-critical settlement logic lives here (well-tested) rather than in the
 * webhook route, which stays thin. The load-bearing guarantees:
 *
 *  1. TENANT FROM THE SIGNED EVENT ONLY — the CheckoutSession is resolved by the
 *     globally-unique `stripeSessionId`, then `businessId` comes off THAT row.
 *     `stripeAccountId` on the row is asserted `=== eventAccount` before any write.
 *  2. DOUBLE-CAPTURE IMPOSSIBLE — a compare-and-set `updateMany(status: OPEN →
 *     CAPTURED)` is the flip; if it affects 0 rows the sale already settled and we
 *     no-op. `CheckoutSession.paymentId @unique` is the DB hard stop behind it.
 *  3. AMOUNT TAMPER-PROOF — before marking the order PAID we re-verify Stripe's
 *     `amount_total` + currency against the stored `amountCents`/`currency`; a
 *     mismatch marks the session FAILED and alarms, never PAID.
 *
 * `CheckoutSession`/`Business` writes are keyed by the row's own id + businessId,
 * so they are outside the tenant-isolation guard's model list intentionally (the
 * tenant is proven from the signed session id, not a request session).
 */

/** Discriminated outcome so the route can log precisely and always 200. */
export type SettleOutcome =
  | { outcome: "captured"; paymentId: string; orderId: string; businessId: string }
  | { outcome: "failed" }
  | { outcome: "expired" }
  | { outcome: "already_settled" }
  | { outcome: "unknown_session" }
  | { outcome: "account_mismatch" }
  | { outcome: "amount_mismatch" };

/** Currencies match case-insensitively (Stripe returns lowercase; we store upper). */
function currencyMatches(a: string | null, b: string): boolean {
  return typeof a === "string" && a.toUpperCase() === b.toUpperCase();
}

interface SessionRow {
  id: string;
  businessId: string;
  orderId: string;
  stripeAccountId: string;
  amountCents: number;
  currency: string;
  status: string;
}

/** Resolve the session row from the signed session id (single-row, unique key). */
async function findSessionRow(stripeSessionId: string): Promise<SessionRow | null> {
  return db.checkoutSession.findUnique({
    where: { stripeSessionId },
    select: {
      id: true,
      businessId: true,
      orderId: true,
      stripeAccountId: true,
      amountCents: true,
      currency: true,
      status: true,
    },
  });
}

/**
 * Idempotent create/reuse of the CheckoutSession row for an OPEN order. Keyed by
 * `@@unique([businessId, clientUuid])` so a re-tapped "Pay" reuses the same row
 * (the Stripe idempotency key already returns the same session, so we never
 * overwrite the stored ids). Single-row upsert carrying businessId in the
 * compound key — safe by the tenant convention.
 */
export async function createOrReuseCheckoutSession(input: {
  businessId: string;
  orderId: string;
  clientUuid: string;
  stripeSessionId: string;
  stripeAccountId: string;
  amountCents: number;
  currency: string;
  expiresAt: Date | null;
}): Promise<{ id: string; stripeSessionId: string; status: string }> {
  const row = await db.checkoutSession.upsert({
    where: {
      businessId_clientUuid: { businessId: input.businessId, clientUuid: input.clientUuid },
    },
    create: {
      businessId: input.businessId,
      orderId: input.orderId,
      clientUuid: input.clientUuid,
      stripeSessionId: input.stripeSessionId,
      stripeAccountId: input.stripeAccountId,
      amountCents: input.amountCents,
      currency: input.currency,
      expiresAt: input.expiresAt,
    },
    // Reuse: the Stripe idempotency key guarantees the same session, so never
    // rewrite the stored ids/amount for an existing OPEN attempt.
    update: {},
    select: { id: true, stripeSessionId: true, status: true },
  });
  return row;
}

/** Read the stock-decrement lines for an order (persisted lines + trackStock). */
async function orderStockLines(
  tx: Prisma.TransactionClient,
  businessId: string,
  orderId: string,
): Promise<StockDecrementLine[]> {
  const lines = await tx.orderLine.findMany({
    where: { businessId, orderId },
    select: { variationId: true, quantity: true },
  });
  const ids = lines.map((l) => l.variationId).filter((v): v is string => Boolean(v));
  if (ids.length === 0) return [];
  const variations = await tx.variation.findMany({
    where: { businessId, id: { in: ids } },
    select: { id: true, item: { select: { trackStock: true } } },
  });
  const trackById = new Map(variations.map((v) => [v.id, Boolean(v.item.trackStock)]));
  const out: StockDecrementLine[] = [];
  for (const l of lines) {
    if (!l.variationId) continue;
    out.push({
      variationId: l.variationId,
      quantity: l.quantity,
      trackStock: trackById.get(l.variationId) ?? false,
    });
  }
  return out;
}

/**
 * Capture a settled QR sale. Resolves the row from the signed session id, asserts
 * the connected account, re-verifies the amount + currency, then in ONE
 * transaction compare-and-sets OPEN → CAPTURED, writes the CAPTURED Payment
 * (method QR, processorRef = PI id), links it to the session (`paymentId` is the
 * unique double-capture guard), marks the Order PAID, and decrements stock exactly
 * like the cash checkout (shared `applyStockDecrements`).
 */
export async function captureQrSale(input: {
  settlement: SaleSettlement;
  eventAccount: string | null;
}): Promise<SettleOutcome> {
  const { settlement, eventAccount } = input;
  const row = await findSessionRow(settlement.stripeSessionId);
  if (!row) return { outcome: "unknown_session" };
  // INVARIANT #1: the connected account on the SIGNED event must match the row.
  if (!eventAccount || row.stripeAccountId !== eventAccount) {
    return { outcome: "account_mismatch" };
  }
  // INVARIANT #3: re-verify the amount + currency before PAID. A mismatch is a
  // tamper/misconfig alarm — mark FAILED (if still OPEN), never settle.
  if (settlement.amountTotal !== row.amountCents || !currencyMatches(settlement.currency, row.currency)) {
    await db.checkoutSession.updateMany({
      where: { id: row.id, businessId: row.businessId, status: "OPEN" },
      data: { status: "FAILED" },
    });
    return { outcome: "amount_mismatch" };
  }

  return db.$transaction(async (tx) => {
    // INVARIANT #2: compare-and-set OPEN → CAPTURED. 0 rows ⇒ already settled
    // (a replayed webhook, or completed + async_payment_succeeded both firing).
    const flip = await tx.checkoutSession.updateMany({
      where: { id: row.id, businessId: row.businessId, status: "OPEN" },
      data: { status: "CAPTURED" },
    });
    if (flip.count === 0) return { outcome: "already_settled" } as SettleOutcome;

    const payment = await tx.payment.create({
      data: {
        businessId: row.businessId,
        orderId: row.orderId,
        method: "QR",
        status: "CAPTURED",
        amountCents: row.amountCents, // the stored, server-recomputed total
        processorRef: settlement.paymentIntentId,
        cardBrand: settlement.cardBrand ?? null,
        cardLast4: settlement.cardLast4 ?? null,
      },
      select: { id: true },
    });

    // Link the Payment to the session; `paymentId @unique` is the hard DB guard
    // against a second capture ever attaching a second payment.
    await tx.checkoutSession.update({
      where: { id: row.id },
      data: { paymentId: payment.id },
    });

    await tx.order.update({ where: { id: row.orderId }, data: { status: "PAID" } });

    await applyStockDecrements(tx, await orderStockLines(tx, row.businessId, row.orderId));

    return {
      outcome: "captured",
      paymentId: payment.id,
      orderId: row.orderId,
      businessId: row.businessId,
    } as SettleOutcome;
  });
}

/** Compare-and-set OPEN → FAILED for an async-payment failure (asserts account). */
export async function failQrSale(input: {
  settlement: SaleSettlement;
  eventAccount: string | null;
}): Promise<SettleOutcome> {
  return transitionOpen(input, "FAILED", "failed");
}

/** Compare-and-set OPEN → EXPIRED for an expired/cancelled session (asserts account). */
export async function expireQrSale(input: {
  settlement: SaleSettlement;
  eventAccount: string | null;
}): Promise<SettleOutcome> {
  return transitionOpen(input, "EXPIRED", "expired");
}

async function transitionOpen(
  input: { settlement: SaleSettlement; eventAccount: string | null },
  toStatus: "FAILED" | "EXPIRED",
  ok: "failed" | "expired",
): Promise<SettleOutcome> {
  const row = await findSessionRow(input.settlement.stripeSessionId);
  if (!row) return { outcome: "unknown_session" };
  if (!input.eventAccount || row.stripeAccountId !== input.eventAccount) {
    return { outcome: "account_mismatch" };
  }
  // Only flip while OPEN — never override an already-CAPTURED sale (a late
  // `expired` after a successful async capture must not un-settle it).
  const flip = await db.checkoutSession.updateMany({
    where: { id: row.id, businessId: row.businessId, status: "OPEN" },
    data: { status: toStatus },
  });
  if (flip.count === 0) return { outcome: "already_settled" };
  return { outcome: ok };
}
