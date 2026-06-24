"use server";

import { db } from "@/lib/db";
import { requireCapability } from "@/lib/operator-guard";
import { computePricedOrder } from "./pricing";
import { resolveOrderLines } from "./resolve-lines";
import { checkoutSchema, type CheckoutInput } from "./schema";

// Prisma's unique-constraint code, raised here when two concurrent requests with
// the same clientUuid race past the pre-check and both try to insert on
// @@unique([businessId, clientUuid]). We translate the loser into the existing
// order so checkout stays idempotent (mirrors catalog's isUniqueViolation).
const PRISMA_UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === PRISMA_UNIQUE_VIOLATION
  );
}

export interface Receipt {
  orderId: string;
  number: number;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  cashTenderedCents: number;
  changeCents: number;
}

/**
 * Complete a cash sale. The server is the source of truth for money: it looks
 * up real variation prices and the business tax rate and recomputes every total
 * — client-sent amounts are never trusted. Idempotent on clientUuid so an
 * offline double-send (or a flaky reconnect) never creates a duplicate sale.
 */
export async function checkout(input: CheckoutInput): Promise<Receipt> {
  const data = checkoutSchema.parse(input);
  // The active operator (PIN-identified) must be allowed to take orders; the sale
  // is attributed to them.
  const { businessId, membershipId } = await requireCapability(data.businessId, "take_orders");

  // Idempotency: if this clientUuid already produced an order, return it.
  const existing = await db.order.findUnique({
    where: { businessId_clientUuid: { businessId, clientUuid: data.clientUuid } },
    include: { payments: true },
  });
  if (existing) {
    const payment = existing.payments[0];
    return toReceipt(existing, payment?.tenderedCents ?? 0, payment?.changeCents ?? 0);
  }

  const business = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { taxRateBps: true, taxInclusive: true },
  });

  // Resolve REAL prices + modifiers from the DB, scoped to this business (shared
  // with the restaurant tab flow) — client-sent names/prices are never trusted.
  const { moneyLines, lineRecords } = await resolveOrderLines(businessId, data.lines);

  // Per-line tax is computed once; the order tax is the SUM of line taxes, so
  // Order.taxCents == Σ OrderLine.taxCents by construction (no second compute).
  const priced = computePricedOrder(moneyLines, {
    taxRateBps: business.taxRateBps,
    cartDiscountCents: data.cartDiscountCents,
    tipCents: data.tipCents,
    taxInclusive: business.taxInclusive,
  });
  const totals = priced;

  if (data.cashTenderedCents < totals.totalCents) {
    throw new Error("Cash tendered is less than the total.");
  }
  const changeCents = data.cashTenderedCents - totals.totalCents;

  let order;
  try {
    order = await db.$transaction(async (tx) => {
      // Atomically allocate the next per-business order number. The increment
      // takes a row lock on this business's counter, so two concurrent cashiers
      // are serialized and can never collide on @@unique([businessId, number]).
      // upsert is defensive: a business without a counter row (e.g. created before
      // this table existed) self-heals on its first sale.
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
          status: "PAID",
          cashierId: membershipId, // who rang the sale (matches the tab flow)
          customerName: data.customerName,
          subtotalCents: totals.subtotalCents,
          discountCents: totals.discountCents,
          taxCents: totals.taxCents,
          tipCents: totals.tipCents,
          totalCents: totals.totalCents,
          lines: {
            // lineRecords and priced.lines are index-aligned (same source order).
            create: lineRecords.map((l, i) => {
              const p = priced.lines[i]!;
              return {
                businessId,
                variationId: l.variationId,
                nameSnapshot: l.nameSnapshot,
                unitPriceCents: l.unitPriceCents,
                quantity: l.quantity,
                discountCents: p.discountCents,
                taxCents: p.taxCents, // per-line tax; Σ == Order.taxCents
                totalCents: p.totalCents,
                modifiers: {
                  // Snapshot each chosen modifier so catalog edits never rewrite
                  // sold history (mirrors OrderLine.nameSnapshot/unitPriceCents).
                  create: l.modifiers.map((m) => ({
                    nameSnapshot: m.nameSnapshot,
                    priceDeltaCents: m.priceDeltaCents,
                  })),
                },
              };
            }),
          },
          payments: {
            create: {
              businessId,
              method: "CASH",
              status: "CAPTURED",
              amountCents: totals.totalCents,
              tenderedCents: data.cashTenderedCents,
              changeCents,
            },
          },
        },
      });
    });
  } catch (e) {
    // Concurrency: another request with the same clientUuid won the insert race
    // after we passed the fast-path pre-check. The DB unique constraint blocks
    // the double-insert; re-read the winner and return its receipt so checkout
    // stays idempotent instead of surfacing an unhandled P2002.
    if (isUniqueViolation(e)) {
      const winner = await db.order.findUnique({
        where: { businessId_clientUuid: { businessId, clientUuid: data.clientUuid } },
        include: { payments: true },
      });
      if (winner) {
        const payment = winner.payments[0];
        return toReceipt(winner, payment?.tenderedCents ?? 0, payment?.changeCents ?? 0);
      }
    }
    throw e;
  }

  return toReceipt(order, data.cashTenderedCents, changeCents);
}

function toReceipt(
  order: {
    id: string;
    number: number;
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    tipCents: number;
    totalCents: number;
  },
  cashTenderedCents: number,
  changeCents: number,
): Receipt {
  return {
    orderId: order.id,
    number: order.number,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    taxCents: order.taxCents,
    tipCents: order.tipCents,
    totalCents: order.totalCents,
    cashTenderedCents,
    changeCents,
  };
}
