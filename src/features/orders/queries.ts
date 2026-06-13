import "server-only";
import { db } from "@/lib/db";
import type { OrderStatus, PaymentMethod } from "@prisma/client";

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
  orderCount: number;
  grossSalesCents: number; // sum of subtotals
  discountCents: number;
  netSalesCents: number; // gross - discounts (pre-tax)
  taxCents: number;
  tipCents: number;
  totalCollectedCents: number; // sum of order totals
  byMethod: { method: PaymentMethod; count: number; amountCents: number }[];
  cashCollectedCents: number;
}

/**
 * End-of-day (Z-report) aggregation over PAID orders in [start, end), scoped by
 * businessId. Aggregated in JS — fine for single-location daily volumes.
 */
export async function getDailyReport(
  businessId: string,
  start: Date,
  end: Date,
): Promise<DailyReport> {
  const orders = await db.order.findMany({
    where: { businessId, status: "PAID", createdAt: { gte: start, lt: end } },
    select: {
      subtotalCents: true,
      discountCents: true,
      taxCents: true,
      tipCents: true,
      totalCents: true,
      payments: { select: { method: true, amountCents: true } },
    },
  });

  const report: DailyReport = {
    orderCount: orders.length,
    grossSalesCents: 0,
    discountCents: 0,
    netSalesCents: 0,
    taxCents: 0,
    tipCents: 0,
    totalCollectedCents: 0,
    byMethod: [],
    cashCollectedCents: 0,
  };

  const methodTotals = new Map<PaymentMethod, { count: number; amountCents: number }>();

  for (const o of orders) {
    report.grossSalesCents += o.subtotalCents;
    report.discountCents += o.discountCents;
    report.taxCents += o.taxCents;
    report.tipCents += o.tipCents;
    report.totalCollectedCents += o.totalCents;
    for (const p of o.payments) {
      const entry = methodTotals.get(p.method) ?? { count: 0, amountCents: 0 };
      entry.count += 1;
      entry.amountCents += p.amountCents;
      methodTotals.set(p.method, entry);
      if (p.method === "CASH") report.cashCollectedCents += p.amountCents;
    }
  }

  report.netSalesCents = report.grossSalesCents - report.discountCents;
  report.byMethod = [...methodTotals.entries()].map(([method, v]) => ({ method, ...v }));
  return report;
}
