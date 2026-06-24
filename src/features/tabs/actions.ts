"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { computePricedOrder, priceLine } from "@/features/register/pricing";
import { resolveOrderLines } from "@/features/register/resolve-lines";
import { planSettlement, type TabLine } from "./tab-math";
import {
  openTabSchema,
  addTabLinesSchema,
  setTabLineQtySchema,
  tabLineRefSchema,
  assignLineSeatSchema,
  mergeTablesSchema,
  transferTabSchema,
  settleTabSchema,
} from "./schema";

function revalidateFloor(businessId: string) {
  revalidatePath(`/${businessId}/floor`);
}

/** Confirm an order is this business's AND still open (single source of the guard). */
async function loadOpenOrder(orderId: string, businessId: string) {
  const order = await db.order.findFirst({
    where: { id: orderId, businessId, status: "OPEN" },
    select: { id: true },
  });
  if (!order) throw new Error("Open tab not found.");
}

/**
 * Recompute and persist an order's aggregate totals from its persisted lines.
 * Mirrors computePricedOrder: subtotal = Σ gross, discount = Σ line discount,
 * tax = Σ line tax, total = Σ taxable-base + (exclusive ? tax : 0) + tip. Reading
 * the totals straight off the stored line fields keeps Order.taxCents == Σ line tax.
 */
async function recomputeOrderTotals(
  tx: Prisma.TransactionClient,
  orderId: string,
  businessId: string,
  taxInclusive: boolean,
) {
  const lines = await tx.orderLine.findMany({
    where: { orderId, businessId },
    select: { totalCents: true, discountCents: true, taxCents: true },
  });
  let base = 0;
  let discount = 0;
  let tax = 0;
  for (const l of lines) {
    base += l.totalCents; // taxable base, after line discount
    discount += l.discountCents;
    tax += l.taxCents;
  }
  const order = await tx.order.findFirstOrThrow({
    where: { id: orderId, businessId },
    select: { tipCents: true },
  });
  await tx.order.update({
    where: { id: orderId },
    data: {
      subtotalCents: base + discount, // gross before line discounts
      discountCents: discount,
      taxCents: tax,
      totalCents: base + (taxInclusive ? 0 : tax) + order.tipCents,
    },
  });
}

// ── Open / merge / transfer ────────────────────────────────────────────────────

export async function openTab(input: z.infer<typeof openTabSchema>): Promise<string> {
  const data = openTabSchema.parse(input);
  const ctx = await requireMembership(data.businessId);

  const table = await db.floorTable.findFirst({
    where: { id: data.tableId, businessId: ctx.businessId },
    select: { id: true },
  });
  if (!table) throw new Error("Table not found.");

  const occupied = await db.order.findFirst({
    where: { businessId: ctx.businessId, status: "OPEN", tables: { some: { tableId: data.tableId } } },
    select: { id: true },
  });
  if (occupied) throw new Error("That table already has an open tab.");

  const clientUuid = randomUUID();
  const order = await db.$transaction(async (tx) => {
    // Allocate the next per-business number (row-locked counter), same as checkout.
    const counter = await tx.orderCounter.upsert({
      where: { businessId: ctx.businessId },
      create: { businessId: ctx.businessId, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
      select: { lastNumber: true },
    });
    return tx.order.create({
      data: {
        businessId: ctx.businessId,
        clientUuid,
        number: counter.lastNumber,
        status: "OPEN",
        cashierId: ctx.membershipId,
        tables: { create: { tableId: data.tableId } },
      },
      select: { id: true },
    });
  });

  revalidateFloor(ctx.businessId);
  return order.id;
}

export async function mergeTables(input: z.infer<typeof mergeTablesSchema>) {
  const data = mergeTablesSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  await loadOpenOrder(data.orderId, ctx.businessId);

  const table = await db.floorTable.findFirst({
    where: { id: data.tableId, businessId: ctx.businessId },
    select: { id: true },
  });
  if (!table) throw new Error("Table not found.");

  // The target table must not be held by a DIFFERENT open tab.
  const otherTab = await db.order.findFirst({
    where: {
      businessId: ctx.businessId,
      status: "OPEN",
      id: { not: data.orderId },
      tables: { some: { tableId: data.tableId } },
    },
    select: { id: true },
  });
  if (otherTab) throw new Error("That table already has its own open tab.");

  // skipDuplicates: merging a table already on this tab is a no-op.
  await db.orderTable.createMany({
    data: [{ orderId: data.orderId, tableId: data.tableId }],
    skipDuplicates: true,
  });
  revalidateFloor(ctx.businessId);
}

export async function transferTab(input: z.infer<typeof transferTabSchema>) {
  const data = transferTabSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  await loadOpenOrder(data.orderId, ctx.businessId);

  const toTable = await db.floorTable.findFirst({
    where: { id: data.toTableId, businessId: ctx.businessId },
    select: { id: true },
  });
  if (!toTable) throw new Error("Destination table not found.");

  const otherTab = await db.order.findFirst({
    where: {
      businessId: ctx.businessId,
      status: "OPEN",
      id: { not: data.orderId },
      tables: { some: { tableId: data.toTableId } },
    },
    select: { id: true },
  });
  if (otherTab) throw new Error("The destination table already has an open tab.");

  await db.$transaction(async (tx) => {
    await tx.orderTable.deleteMany({ where: { orderId: data.orderId, tableId: data.fromTableId } });
    await tx.orderTable.createMany({
      data: [{ orderId: data.orderId, tableId: data.toTableId }],
      skipDuplicates: true,
    });
  });
  revalidateFloor(ctx.businessId);
}

// ── Line edits ───────────────────────────────────────────────────────────────

export async function addTabLines(input: z.infer<typeof addTabLinesSchema>) {
  const data = addTabLinesSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  await loadOpenOrder(data.orderId, ctx.businessId);

  const business = await db.business.findUniqueOrThrow({
    where: { id: ctx.businessId },
    select: { taxRateBps: true, taxInclusive: true },
  });

  const { moneyLines, lineRecords } = await resolveOrderLines(ctx.businessId, data.lines);
  const priced = computePricedOrder(moneyLines, {
    taxRateBps: business.taxRateBps,
    taxInclusive: business.taxInclusive,
  });

  await db.$transaction(async (tx) => {
    for (let i = 0; i < lineRecords.length; i++) {
      const l = lineRecords[i]!;
      const p = priced.lines[i]!;
      await tx.orderLine.create({
        data: {
          businessId: ctx.businessId,
          orderId: data.orderId,
          variationId: l.variationId,
          nameSnapshot: l.nameSnapshot,
          unitPriceCents: l.unitPriceCents,
          quantity: l.quantity,
          discountCents: p.discountCents,
          taxCents: p.taxCents,
          totalCents: p.totalCents,
          seat: data.seat,
          modifiers: {
            create: l.modifiers.map((m) => ({ nameSnapshot: m.nameSnapshot, priceDeltaCents: m.priceDeltaCents })),
          },
        },
      });
    }
    await recomputeOrderTotals(tx, data.orderId, ctx.businessId, business.taxInclusive);
  });
  revalidateFloor(ctx.businessId);
}

export async function setTabLineQty(input: z.infer<typeof setTabLineQtySchema>) {
  const data = setTabLineQtySchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  await loadOpenOrder(data.orderId, ctx.businessId);

  const line = await db.orderLine.findFirst({
    where: { id: data.lineId, orderId: data.orderId, businessId: ctx.businessId },
    select: {
      unitPriceCents: true,
      discountCents: true,
      settledByPaymentId: true,
      modifiers: { select: { priceDeltaCents: true } },
    },
  });
  if (!line) throw new Error("Item not found on this tab.");
  if (line.settledByPaymentId) throw new Error("That item has already been paid.");

  const business = await db.business.findUniqueOrThrow({
    where: { id: ctx.businessId },
    select: { taxRateBps: true, taxInclusive: true },
  });

  const p = priceLine(
    {
      unitPriceCents: line.unitPriceCents,
      quantity: data.quantity,
      lineDiscountCents: line.discountCents,
      modifiers: line.modifiers.map((m, i) => ({
        id: String(i),
        nameSnapshot: "",
        priceDeltaCents: m.priceDeltaCents,
      })),
    },
    business.taxRateBps,
    business.taxInclusive,
  );

  await db.$transaction(async (tx) => {
    await tx.orderLine.updateMany({
      where: { id: data.lineId, businessId: ctx.businessId },
      data: { quantity: data.quantity, discountCents: p.discountCents, taxCents: p.taxCents, totalCents: p.totalCents },
    });
    await recomputeOrderTotals(tx, data.orderId, ctx.businessId, business.taxInclusive);
  });
  revalidateFloor(ctx.businessId);
}

export async function removeTabLine(input: z.infer<typeof tabLineRefSchema>) {
  const data = tabLineRefSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  await loadOpenOrder(data.orderId, ctx.businessId);

  const line = await db.orderLine.findFirst({
    where: { id: data.lineId, orderId: data.orderId, businessId: ctx.businessId },
    select: { settledByPaymentId: true },
  });
  if (!line) throw new Error("Item not found on this tab.");
  if (line.settledByPaymentId) throw new Error("That item has already been paid.");

  const business = await db.business.findUniqueOrThrow({
    where: { id: ctx.businessId },
    select: { taxInclusive: true },
  });

  await db.$transaction(async (tx) => {
    await tx.orderLine.deleteMany({ where: { id: data.lineId, businessId: ctx.businessId } });
    await recomputeOrderTotals(tx, data.orderId, ctx.businessId, business.taxInclusive);
  });
  revalidateFloor(ctx.businessId);
}

export async function assignLineSeat(input: z.infer<typeof assignLineSeatSchema>) {
  const data = assignLineSeatSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  await loadOpenOrder(data.orderId, ctx.businessId);

  const line = await db.orderLine.findFirst({
    where: { id: data.lineId, orderId: data.orderId, businessId: ctx.businessId },
    select: { settledByPaymentId: true },
  });
  if (!line) throw new Error("Item not found on this tab.");
  if (line.settledByPaymentId) throw new Error("That item has already been paid.");

  await db.orderLine.updateMany({
    where: { id: data.lineId, businessId: ctx.businessId },
    data: { seat: data.seat },
  });
  revalidateFloor(ctx.businessId);
}

// ── Settle (whole tab or by seat) ──────────────────────────────────────────────

export interface SettleResult {
  amountCents: number;
  tipCents: number;
  changeCents: number;
  closed: boolean;
}

export async function settleTab(input: z.infer<typeof settleTabSchema>): Promise<SettleResult> {
  const data = settleTabSchema.parse(input);
  const ctx = await requireMembership(data.businessId);

  const order = await db.order.findFirst({
    where: { id: data.orderId, businessId: ctx.businessId, status: "OPEN" },
    select: {
      id: true,
      business: { select: { taxInclusive: true } },
      lines: { select: { id: true, seat: true, totalCents: true, taxCents: true, settledByPaymentId: true } },
    },
  });
  if (!order) throw new Error("Open tab not found.");

  const taxInclusive = order.business.taxInclusive;
  const plan = planSettlement(order.lines as TabLine[], {
    seats: data.seats && data.seats.length > 0 ? data.seats : "all",
    taxInclusive,
  });

  const amountWithTip = plan.amountCents + data.tipCents;
  if (data.cashTenderedCents < amountWithTip) {
    throw new Error("Cash tendered is less than the amount due.");
  }
  const changeCents = data.cashTenderedCents - amountWithTip;

  const closed = await db.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        businessId: ctx.businessId,
        orderId: data.orderId,
        method: "CASH",
        status: "CAPTURED",
        amountCents: amountWithTip, // goods for these seats + tip = cash collected
        tenderedCents: data.cashTenderedCents,
        changeCents,
      },
      select: { id: true },
    });

    // Mark exactly the planned lines settled. The settledByPaymentId: null guard
    // means a line a concurrent settle already paid won't be touched here.
    const result = await tx.orderLine.updateMany({
      where: { id: { in: plan.lineIds }, businessId: ctx.businessId, settledByPaymentId: null },
      data: { settledByPaymentId: payment.id },
    });
    // Lost-race guard: if any planned line was already settled by a concurrent
    // settle, the cash we just computed no longer matches what we actually
    // settled — abort the whole transaction (payment included) so the till can't
    // over-collect. The caller reloads the tab and retries on fresh data.
    if (result.count !== plan.lineIds.length) {
      throw new Error("This tab changed while you were settling — reload and try again.");
    }

    // Decide closure from authoritative in-transaction state, not the (possibly
    // stale) plan: the tab closes only when no unsettled line remains.
    const remaining = await tx.orderLine.count({
      where: { orderId: data.orderId, businessId: ctx.businessId, settledByPaymentId: null },
    });
    const isClosed = remaining === 0;

    await tx.order.update({
      where: { id: data.orderId },
      data: { tipCents: { increment: data.tipCents }, ...(isClosed ? { status: "PAID" as const } : {}) },
    });

    await recomputeOrderTotals(tx, data.orderId, ctx.businessId, taxInclusive);
    return isClosed;
  });

  revalidateFloor(ctx.businessId);
  return { amountCents: plan.amountCents, tipCents: data.tipCents, changeCents, closed };
}
