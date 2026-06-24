import "server-only";
import { db } from "@/lib/db";
import type { OrderStatus, PaymentMethod } from "@prisma/client";
import {
  aggregateItemSales,
  aggregateCashierSales,
  type ItemSalesReport,
  type CashierSalesRow,
} from "@/features/orders/report-aggregate";

export interface OrderRow {
  id: string;
  number: number;
  createdAt: string; // ISO
  customerName: string | null;
  status: OrderStatus;
  totalCents: number;
  method: PaymentMethod | null;
}

/** Recent orders for the business (most recent first), scoped by businessId. */
export async function listOrders(businessId: string, limit = 100): Promise<OrderRow[]> {
  const orders = await db.order.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      number: true,
      createdAt: true,
      customerName: true,
      status: true,
      totalCents: true,
      payments: { select: { method: true }, take: 1 },
    },
  });
  return orders.map((o) => ({
    id: o.id,
    number: o.number,
    createdAt: o.createdAt.toISOString(),
    customerName: o.customerName,
    status: o.status,
    totalCents: o.totalCents,
    method: o.payments[0]?.method ?? null,
  }));
}

export interface DailyReport {
  orderCount: number; // sales that count as revenue (excludes VOIDED/REFUNDED)
  grossSalesCents: number; // sum of subtotals (revenue orders)
  discountCents: number;
  netSalesCents: number; // gross - discounts (pre-tax)
  taxCents: number;
  tipCents: number;
  totalCollectedCents: number; // sum of order totals (revenue orders)
  refundsCents: number; // total refunded/voided money in the window, shown POSITIVE
  byMethod: { method: PaymentMethod; count: number; amountCents: number }[];
  cashCollectedCents: number; // NET cash movement: Σ CASH Payment.amountCents (refunds reduce it)
}

// Statuses that count as realized revenue for the sales lines of the Z-report.
// A VOIDED or fully REFUNDED order is no longer a sale; PARTIALLY_REFUNDED still
// represents a (reduced) sale, so its order header stays in net sales while the
// refunded money is reflected through the payment movements below.
const REVENUE_STATUSES: OrderStatus[] = ["PAID", "PARTIALLY_REFUNDED"];

/**
 * End-of-day (Z-report) aggregation in [start, end), scoped by businessId.
 *
 * RECONCILIATION SEMANTICS (approved): cash/payment figures are counted by
 * ACTUAL payment movements — Σ Payment.amountCents per method, INCLUDING the
 * negative reversing payments written by refunds/voids — NOT by Order.status.
 * So a cash refund reduces `cashCollectedCents` (and the CASH byMethod line) and
 * thus the expected drawer cash, keeping the till reconcilable. The SALES lines
 * (orders/gross/net/tax/tips/total) still exclude VOIDED and fully-REFUNDED
 * orders, since those are no longer sales. `refundsCents` surfaces the day's
 * total reversed money (shown positive). Aggregated in JS — fine for
 * single-location daily volumes.
 */
export async function getDailyReport(
  businessId: string,
  start: Date,
  end: Date,
): Promise<DailyReport> {
  // Revenue orders (the sales lines) — exclude VOIDED / fully REFUNDED.
  const revenueOrders = await db.order.findMany({
    where: { businessId, status: { in: REVENUE_STATUSES }, createdAt: { gte: start, lt: end } },
    select: {
      subtotalCents: true,
      discountCents: true,
      taxCents: true,
      tipCents: true,
      totalCents: true,
    },
  });

  // Payment movements (the money lines) — ALL payments on orders created in the
  // window, status-agnostic, so negative refund reversals are included and a
  // cash refund nets out of cash collected.
  const payments = await db.payment.findMany({
    where: { businessId, order: { businessId, createdAt: { gte: start, lt: end } } },
    select: { method: true, amountCents: true },
  });

  const report: DailyReport = {
    orderCount: revenueOrders.length,
    grossSalesCents: 0,
    discountCents: 0,
    netSalesCents: 0,
    taxCents: 0,
    tipCents: 0,
    totalCollectedCents: 0,
    refundsCents: 0,
    byMethod: [],
    cashCollectedCents: 0,
  };

  for (const o of revenueOrders) {
    report.grossSalesCents += o.subtotalCents;
    report.discountCents += o.discountCents;
    report.taxCents += o.taxCents;
    report.tipCents += o.tipCents;
    report.totalCollectedCents += o.totalCents;
  }
  report.netSalesCents = report.grossSalesCents - report.discountCents;

  const methodTotals = new Map<PaymentMethod, { count: number; amountCents: number }>();
  for (const p of payments) {
    const entry = methodTotals.get(p.method) ?? { count: 0, amountCents: 0 };
    entry.count += 1;
    entry.amountCents += p.amountCents;
    methodTotals.set(p.method, entry);
    if (p.method === "CASH") report.cashCollectedCents += p.amountCents;
    // Refund reversals are the negative payments; surface their magnitude.
    if (p.amountCents < 0) report.refundsCents += -p.amountCents;
  }

  report.byMethod = [...methodTotals.entries()].map(([method, v]) => ({ method, ...v }));
  return report;
}

/**
 * Per-item and per-category sales breakdown over PAID orders in [start, end),
 * scoped by businessId. Category is resolved best-effort from the line's
 * `variationId` (which can be null, or point at a since-deleted variation) via a
 * single batched lookup — the durable `nameSnapshot` is always the item key.
 */
export async function getItemSalesReport(
  businessId: string,
  start: Date,
  end: Date,
): Promise<ItemSalesReport> {
  const orders = await db.order.findMany({
    where: { businessId, status: "PAID", createdAt: { gte: start, lt: end } },
    select: {
      lines: {
        select: {
          nameSnapshot: true,
          quantity: true,
          totalCents: true,
          taxCents: true,
          variationId: true,
        },
      },
    },
  });
  const lines = orders.flatMap((o) => o.lines);

  // Batch-resolve category names for the variations still in the catalog.
  const variationIds = [...new Set(lines.map((l) => l.variationId).filter((v): v is string => !!v))];
  const variations = variationIds.length
    ? await db.variation.findMany({
        where: { id: { in: variationIds }, businessId },
        select: { id: true, item: { select: { category: { select: { name: true } } } } },
      })
    : [];
  const categoryByVariation = new Map(variations.map((v) => [v.id, v.item.category?.name ?? null]));

  return aggregateItemSales(
    lines.map((l) => ({
      nameSnapshot: l.nameSnapshot,
      quantity: l.quantity,
      totalCents: l.totalCents,
      taxCents: l.taxCents,
      categoryName: l.variationId ? (categoryByVariation.get(l.variationId) ?? null) : null,
    })),
  );
}

/**
 * Net sales per cashier over PAID orders in [start, end), scoped by businessId.
 * The cashier name is resolved from the membership's user (name, else email);
 * orders with no cashier are grouped under "Unattributed".
 */
export async function getCashierSalesReport(
  businessId: string,
  start: Date,
  end: Date,
): Promise<CashierSalesRow[]> {
  const orders = await db.order.findMany({
    where: { businessId, status: "PAID", createdAt: { gte: start, lt: end } },
    select: { cashierId: true, subtotalCents: true, discountCents: true },
  });

  const cashierIds = [...new Set(orders.map((o) => o.cashierId).filter((v): v is string => !!v))];
  const members = cashierIds.length
    ? await db.membership.findMany({
        where: { id: { in: cashierIds }, businessId },
        select: { id: true, user: { select: { name: true, email: true } } },
      })
    : [];
  const nameById = new Map(members.map((m) => [m.id, m.user.name?.trim() || m.user.email]));

  return aggregateCashierSales(
    orders.map((o) => ({
      cashier: o.cashierId ? (nameById.get(o.cashierId) ?? "Unknown") : "Unattributed",
      netSalesCents: o.subtotalCents - o.discountCents,
    })),
  );
}

export interface ReceiptLine {
  id: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  modifiers: { id: string; name: string; priceDeltaCents: number }[];
}

export interface ReceiptPayment {
  method: PaymentMethod;
  amountCents: number;
  tenderedCents: number | null;
  changeCents: number | null;
}

export interface OrderReceipt {
  id: string;
  number: number;
  createdAt: string; // ISO
  customerName: string | null;
  status: OrderStatus;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  // Business snapshot for rendering the header + money formatting.
  businessName: string;
  currency: string;
  taxRateBps: number;
  taxInclusive: boolean;
  lines: ReceiptLine[];
  payments: ReceiptPayment[];
}

/**
 * Load one order's full receipt — lines + payments — STRICTLY scoped to the
 * business. The `where: { id, businessId }` (with `businessId` indexed on Order)
 * is the tenant-isolation guarantee: an orderId from another business simply
 * returns null. Returns null when not found rather than throwing, so callers
 * can `notFound()`.
 */
export async function getOrderReceipt(
  businessId: string,
  orderId: string,
): Promise<OrderReceipt | null> {
  const order = await db.order.findFirst({
    // findFirst (not findUnique) so we can require BOTH id AND businessId —
    // never trust the orderId alone to scope a tenant read.
    where: { id: orderId, businessId },
    select: {
      id: true,
      number: true,
      createdAt: true,
      customerName: true,
      status: true,
      subtotalCents: true,
      discountCents: true,
      taxCents: true,
      tipCents: true,
      totalCents: true,
      business: {
        select: { name: true, currency: true, taxRateBps: true, taxInclusive: true },
      },
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          nameSnapshot: true,
          quantity: true,
          unitPriceCents: true,
          discountCents: true,
          taxCents: true,
          totalCents: true,
          modifiers: {
            orderBy: { id: "asc" },
            select: { id: true, nameSnapshot: true, priceDeltaCents: true },
          },
        },
      },
      payments: {
        orderBy: { createdAt: "asc" },
        select: { method: true, amountCents: true, tenderedCents: true, changeCents: true },
      },
    },
  });

  if (!order) return null;

  return {
    id: order.id,
    number: order.number,
    createdAt: order.createdAt.toISOString(),
    customerName: order.customerName,
    status: order.status,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    taxCents: order.taxCents,
    tipCents: order.tipCents,
    totalCents: order.totalCents,
    businessName: order.business.name,
    currency: order.business.currency,
    taxRateBps: order.business.taxRateBps,
    taxInclusive: order.business.taxInclusive,
    lines: order.lines.map((l) => ({
      id: l.id,
      name: l.nameSnapshot,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      discountCents: l.discountCents,
      taxCents: l.taxCents,
      totalCents: l.totalCents,
      modifiers: l.modifiers.map((m) => ({
        id: m.id,
        name: m.nameSnapshot,
        priceDeltaCents: m.priceDeltaCents,
      })),
    })),
    payments: order.payments.map((p) => ({
      method: p.method,
      amountCents: p.amountCents,
      tenderedCents: p.tenderedCents,
      changeCents: p.changeCents,
    })),
  };
}
