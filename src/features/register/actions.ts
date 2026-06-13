"use server";

import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { computeTotals, type CartLineInput } from "@/lib/money";
import { checkoutSchema, type CheckoutInput } from "./schema";

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
  const { businessId } = await requireMembership(data.businessId);

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

  // Resolve REAL prices from the DB, scoped to this business.
  const variations = await db.variation.findMany({
    where: { businessId, id: { in: data.lines.map((l) => l.variationId) } },
    include: { item: { select: { name: true } } },
  });
  const byId = new Map(variations.map((v) => [v.id, v]));

  const moneyLines: CartLineInput[] = [];
  const lineRecords = data.lines.map((line) => {
    const variation = byId.get(line.variationId);
    if (!variation) throw new Error(`Unknown item: ${line.variationId}`);
    const unitPriceCents = variation.priceCents; // modifiers added in a later phase
    moneyLines.push({
      unitPriceCents,
      quantity: line.quantity,
      lineDiscountCents: line.lineDiscountCents ?? 0,
    });
    const gross = unitPriceCents * line.quantity;
    const lineDiscount = Math.min(line.lineDiscountCents ?? 0, gross);
    return {
      variation,
      unitPriceCents,
      quantity: line.quantity,
      discountCents: lineDiscount,
      nameSnapshot:
        variation.name && variation.name !== "Default"
          ? `${variation.item.name} — ${variation.name}`
          : variation.item.name,
      lineTotalCents: gross - lineDiscount,
    };
  });

  const totals = computeTotals(moneyLines, {
    taxRateBps: business.taxRateBps,
    cartDiscountCents: data.cartDiscountCents,
    tipCents: data.tipCents,
    taxInclusive: business.taxInclusive,
  });

  if (data.cashTenderedCents < totals.totalCents) {
    throw new Error("Cash tendered is less than the total.");
  }
  const changeCents = data.cashTenderedCents - totals.totalCents;

  const order = await db.$transaction(async (tx) => {
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
        customerName: data.customerName,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        taxCents: totals.taxCents,
        tipCents: totals.tipCents,
        totalCents: totals.totalCents,
        lines: {
          create: lineRecords.map((l) => ({
            businessId,
            variationId: l.variation.id,
            nameSnapshot: l.nameSnapshot,
            unitPriceCents: l.unitPriceCents,
            quantity: l.quantity,
            discountCents: l.discountCents,
            taxCents: 0, // per-line tax detail captured in a later phase
            totalCents: l.lineTotalCents,
          })),
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
