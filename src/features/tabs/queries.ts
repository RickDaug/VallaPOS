import "server-only";

import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";

export interface FloorServiceTable {
  id: string;
  label: string;
  shape: "ROUND" | "SQUARE" | "RECT";
  x: number;
  y: number;
  width: number;
  height: number;
  seats: number;
  // Open-tab summary (null = available).
  tab: {
    orderId: string;
    number: number;
    openedAt: string; // ISO
    totalCents: number;
    guests: number; // distinct seats used (0 if none assigned yet)
    merged: boolean; // seated across more than one table
  } | null;
}

export interface FloorServiceRoom {
  id: string;
  name: string;
  sortOrder: number;
  tables: FloorServiceTable[];
}

/**
 * The floor as the service view sees it: rooms + tables, each annotated with its
 * open tab (if any). A table is occupied iff an OPEN order is seated at it.
 * Tenant-scoped via requireMembership + explicit businessId filters.
 */
export async function getFloorService(businessId: string): Promise<FloorServiceRoom[]> {
  const ctx = await requireMembership(businessId);

  const [rooms, openOrders] = await Promise.all([
    db.floorRoom.findMany({
      where: { businessId: ctx.businessId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        sortOrder: true,
        tables: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { id: true, label: true, shape: true, x: true, y: true, width: true, height: true, seats: true },
        },
      },
    }),
    db.order.findMany({
      where: { businessId: ctx.businessId, status: "OPEN" },
      select: {
        id: true,
        number: true,
        createdAt: true,
        totalCents: true,
        tables: { select: { tableId: true } },
        lines: { select: { seat: true } },
      },
    }),
  ]);

  // Map tableId -> its open tab summary. A merged order annotates every table.
  const tabByTable = new Map<string, FloorServiceTable["tab"]>();
  for (const o of openOrders) {
    const guests = new Set(o.lines.map((l) => l.seat).filter((s): s is number => s !== null)).size;
    const merged = o.tables.length > 1;
    const summary = {
      orderId: o.id,
      number: o.number,
      openedAt: o.createdAt.toISOString(),
      totalCents: o.totalCents,
      guests,
      merged,
    };
    for (const t of o.tables) tabByTable.set(t.tableId, summary);
  }

  return rooms.map((room) => ({
    ...room,
    tables: room.tables.map((t) => ({ ...t, tab: tabByTable.get(t.id) ?? null })),
  }));
}

export interface TabModifierView {
  nameSnapshot: string;
  priceDeltaCents: number;
}
export interface TabLineView {
  id: string;
  seat: number | null;
  variationId: string | null;
  nameSnapshot: string;
  unitPriceCents: number;
  quantity: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  settledByPaymentId: string | null;
  modifiers: TabModifierView[];
}
export interface TabView {
  orderId: string;
  number: number;
  openedAt: string;
  taxInclusive: boolean;
  tableLabels: string[];
  lines: TabLineView[];
}

/**
 * Full open tab for the table-detail UI. Strictly tenant-scoped (findFirst on
 * id + businessId). Returns null if the order isn't this business's, isn't open,
 * or doesn't exist (the caller handles notFound).
 */
export async function getTab(businessId: string, orderId: string): Promise<TabView | null> {
  const ctx = await requireMembership(businessId);

  const order = await db.order.findFirst({
    where: { id: orderId, businessId: ctx.businessId, status: "OPEN" },
    select: {
      id: true,
      number: true,
      createdAt: true,
      business: { select: { taxInclusive: true } },
      tables: { select: { table: { select: { label: true } } } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          seat: true,
          variationId: true,
          nameSnapshot: true,
          unitPriceCents: true,
          quantity: true,
          discountCents: true,
          taxCents: true,
          totalCents: true,
          settledByPaymentId: true,
          modifiers: { select: { nameSnapshot: true, priceDeltaCents: true } },
        },
      },
    },
  });
  if (!order) return null;

  return {
    orderId: order.id,
    number: order.number,
    openedAt: order.createdAt.toISOString(),
    taxInclusive: order.business.taxInclusive,
    tableLabels: order.tables.map((t) => t.table.label),
    lines: order.lines,
  };
}
