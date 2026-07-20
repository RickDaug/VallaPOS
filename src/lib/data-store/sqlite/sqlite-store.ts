import type {
  SellableEntry,
  SellableModifier,
  SellableModifierGroup,
  ManagedCatalog,
  ManagedCategory,
  ManagedItem,
  ManagedModifierGroup,
  ManagedVariation,
} from "@/features/catalog/queries";
import type { OrderRow, DailyReport, OrderReceipt } from "@/features/orders/queries";
import {
  aggregateItemSales,
  aggregateCashierSales,
  aggregateTenders,
  type ItemSalesReport,
  type CashierSalesRow,
} from "@/features/orders/report-aggregate";
import type { DrawerSessionRow, DrawerDaySummary } from "@/features/cash-drawer/queries";
import {
  checkoutSchema,
  type CheckoutInput,
  type CheckoutResult,
  type Receipt,
  type TenderMethod,
} from "@/features/register/schema";
import {
  openDrawerSchema,
  closeDrawerSchema,
  type OpenDrawerInput,
  type CloseDrawerInput,
} from "@/features/cash-drawer/schema";
import type { OpenDrawerResult, CloseDrawerResult } from "@/features/cash-drawer/actions";
import {
  computePricedOrder,
  validateGroupSelection,
  type PricedLineInput,
  type ResolvedModifier,
} from "@/features/register/pricing";
import { reconcile } from "@/features/cash-drawer/reconcile";
import { hashPinWebcrypto, verifyPinWebcrypto } from "./pin";
import { LOCAL_BUSINESS_ID } from "@/lib/edition";
import type { ItemType, OrderStatus, PaymentMethod } from "@prisma/client";
import type { DataStore } from "../types";
import type { SqlDriver } from "./driver";
import { SCHEMA_SQL } from "./schema";

const UNCATEGORIZED = "Uncategorized";

// The single-tenant business id every local install collapses to lives in the
// pure `edition.ts` module (shared with `tenant.ts`); re-exported here so the
// store's callers keep a single import site.
export { LOCAL_BUSINESS_ID };

/** A local operator (cloud: backed by Membership; local: the `operator` table). */
export interface OperatorRow {
  id: string;
  name: string;
  active: boolean;
}

function labelFor(itemName: string, variationName: string): string {
  return variationName && variationName !== "Default" ? `${itemName} — ${variationName}` : itemName;
}

/** Build a positional-`?` placeholder list of length `n` (e.g. n=3 → "?, ?, ?"). */
function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(", ");
}

/** New random id for a hand-written INSERT (cloud uses Prisma `@default(cuid())`). */
function newId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * SQLite raises this on the `@@unique([businessId, clientUuid])` / `([businessId,
 * number])` constraints. On the idempotent-checkout path we translate the loser of
 * a duplicate `clientUuid` into the already-committed order (mirrors the cloud
 * action's P2002 handling), so a double-submit never surfaces a raw SQL error.
 */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

// Statuses that count as realized revenue for the Z-report sales lines (mirrors
// `REVENUE_STATUSES` in the cloud queries: a VOIDED or fully REFUNDED order is no
// longer a sale; PARTIALLY_REFUNDED stays a reduced sale).
const REVENUE_STATUSES = ["PAID", "PARTIALLY_REFUNDED"] as const;

/**
 * Local (offline edition) implementation of the DataStore seam over hand-written
 * SQL — no Prisma, so the Tauri bundle stays small (docs/EDITIONS.md §3/§5). Talks
 * only to the injected `SqlDriver`, and imports the shared *pure* modules
 * (pricing, reconcile, report aggregation, PIN hashing) so all money/tax/report
 * math is byte-for-byte identical to the cloud path. It pulls in NO `server-only`
 * runtime, so it is safe in the desktop webview.
 *
 * Stages 3a/3b implemented `migrate()` + `getRegisterCatalog` + the order-history
 * reads. Stage 3c completes the store: the managed catalog, the reports, the
 * drawer reads, the atomic `checkout` write (allocate order number + insert
 * Order/OrderLine[]/OrderLineModifier[]/Payment under `BEGIN IMMEDIATE`),
 * `openDrawer`/`closeDrawer`, plus the local operator/PIN reads and a first-run
 * seed. The composition root (`index.ts`) starts returning this store when
 * `isLocal` once the Tauri driver exists (Stage 5) — it can't be constructed
 * before then.
 *
 * SINGLE-TENANT / SINGLE-WRITER simplifications vs. the cloud action, all safe
 * because the offline edition is one business on one machine:
 *  - `checkout` skips the manager-approval gate and the offline price-snapshot
 *    relaxation (there is no offline replay queue — the local DB *is* the source
 *    of truth). It still recomputes every total server-authoritatively.
 *  - operator ATTRIBUTION (`cashierId` / drawer `openedById`) is left null here;
 *    the active-operator context is wired at the local shell boundary (Stage 5),
 *    where auth branches to PIN-only.
 */
export class SqliteDataStore implements DataStore {
  constructor(private readonly sql: SqlDriver) {}

  /** Create the cash-subset tables. Idempotent (`CREATE TABLE IF NOT EXISTS`). */
  async migrate(): Promise<void> {
    for (const stmt of SCHEMA_SQL.split(";").map((s) => s.trim()).filter(Boolean)) {
      await this.sql.execute(stmt);
    }
  }

  // ────────────────────────────── Catalog (read) ──────────────────────────────

  async getRegisterCatalog(businessId: string): Promise<SellableEntry[]> {
    const items = await this.sql.select<{
      id: string;
      name: string;
      type: string;
      categoryName: string | null;
    }>(
      `SELECT i.id, i.name, i.type, c.name AS categoryName
         FROM item i
         LEFT JOIN category c ON c.id = i.categoryId
        WHERE i.businessId = ? AND i.active = 1
        ORDER BY i.name ASC`,
      [businessId],
    );
    if (items.length === 0) return [];

    const itemIds = items.map((i) => i.id);
    const itemPlaceholders = placeholders(itemIds.length);

    const variations = await this.sql.select<{
      id: string;
      itemId: string;
      name: string;
      priceCents: number;
    }>(
      `SELECT id, itemId, name, priceCents FROM variation
        WHERE itemId IN (${itemPlaceholders})
        ORDER BY sortOrder ASC`,
      itemIds,
    );

    const links = await this.sql.select<{
      itemId: string;
      groupId: string;
      groupName: string;
      minSelect: number;
      maxSelect: number;
    }>(
      `SELECT l.itemId, g.id AS groupId, g.name AS groupName, g.minSelect, g.maxSelect
         FROM item_modifier_group l
         JOIN modifier_group g ON g.id = l.groupId
        WHERE l.itemId IN (${itemPlaceholders})`,
      itemIds,
    );

    const groupIds = [...new Set(links.map((l) => l.groupId))];
    const modifiers = groupIds.length
      ? await this.sql.select<{
          id: string;
          groupId: string;
          name: string;
          priceDeltaCents: number;
        }>(
          `SELECT id, groupId, name, priceDeltaCents FROM modifier
            WHERE groupId IN (${placeholders(groupIds.length)})
            ORDER BY sortOrder ASC`,
          groupIds,
        )
      : [];

    const modsByGroup = new Map<string, SellableModifier[]>();
    for (const m of modifiers) {
      const arr = modsByGroup.get(m.groupId) ?? [];
      arr.push({ id: m.id, name: m.name, priceDeltaCents: m.priceDeltaCents });
      modsByGroup.set(m.groupId, arr);
    }

    const groupsByItem = new Map<string, SellableModifierGroup[]>();
    for (const l of links) {
      const arr = groupsByItem.get(l.itemId) ?? [];
      arr.push({
        id: l.groupId,
        name: l.groupName,
        minSelect: l.minSelect,
        maxSelect: l.maxSelect,
        modifiers: modsByGroup.get(l.groupId) ?? [],
      });
      groupsByItem.set(l.itemId, arr);
    }

    const varsByItem = new Map<string, typeof variations>();
    for (const v of variations) {
      const arr = varsByItem.get(v.itemId) ?? [];
      arr.push(v);
      varsByItem.set(v.itemId, arr);
    }

    const entries: SellableEntry[] = [];
    for (const item of items) {
      const modifierGroups = groupsByItem.get(item.id) ?? [];
      for (const v of varsByItem.get(item.id) ?? []) {
        entries.push({
          variationId: v.id,
          itemId: item.id,
          label: labelFor(item.name, v.name),
          category: item.categoryName ?? UNCATEGORIZED,
          type: item.type as ItemType,
          priceCents: v.priceCents,
          modifierGroups,
        });
      }
    }
    return entries;
  }

  /** Full catalog for the Products management screen (active + archived items). */
  async getManagedCatalog(businessId: string): Promise<ManagedCatalog> {
    const categoryRows = await this.sql.select<{ id: string; name: string; sortOrder: number }>(
      `SELECT id, name, sortOrder FROM category
        WHERE businessId = ? ORDER BY sortOrder ASC, name ASC`,
      [businessId],
    );
    const categories: ManagedCategory[] = categoryRows.map((c) => ({
      id: c.id,
      name: c.name,
      sortOrder: c.sortOrder,
    }));

    // Active first, then by name — the live catalog stays at the top, archived
    // items section below (matches the cloud `[{ active: "desc" }, { name: "asc" }]`).
    const itemRows = await this.sql.select<{
      id: string;
      name: string;
      type: string;
      active: number;
      categoryId: string | null;
      categoryName: string | null;
    }>(
      `SELECT i.id, i.name, i.type, i.active, i.categoryId, c.name AS categoryName
         FROM item i
         LEFT JOIN category c ON c.id = i.categoryId
        WHERE i.businessId = ?
        ORDER BY i.active DESC, i.name ASC`,
      [businessId],
    );

    const itemIds = itemRows.map((i) => i.id);
    const variationRows = itemIds.length
      ? await this.sql.select<{
          id: string;
          itemId: string;
          name: string;
          priceCents: number;
          sku: string | null;
          sortOrder: number;
        }>(
          `SELECT id, itemId, name, priceCents, sku, sortOrder FROM variation
            WHERE itemId IN (${placeholders(itemIds.length)})
            ORDER BY sortOrder ASC, name ASC`,
          itemIds,
        )
      : [];
    const varsByItem = new Map<string, ManagedVariation[]>();
    for (const v of variationRows) {
      const arr = varsByItem.get(v.itemId) ?? [];
      arr.push({ id: v.id, name: v.name, priceCents: v.priceCents, sku: v.sku, sortOrder: v.sortOrder });
      varsByItem.set(v.itemId, arr);
    }

    const linkRows = itemIds.length
      ? await this.sql.select<{ itemId: string; groupId: string }>(
          `SELECT itemId, groupId FROM item_modifier_group
            WHERE itemId IN (${placeholders(itemIds.length)})`,
          itemIds,
        )
      : [];
    const groupIdsByItem = new Map<string, string[]>();
    for (const l of linkRows) {
      const arr = groupIdsByItem.get(l.itemId) ?? [];
      arr.push(l.groupId);
      groupIdsByItem.set(l.itemId, arr);
    }

    const items: ManagedItem[] = itemRows.map((i) => ({
      id: i.id,
      name: i.name,
      type: i.type as ItemType,
      active: Boolean(i.active),
      categoryId: i.categoryId,
      categoryName: i.categoryName,
      variations: varsByItem.get(i.id) ?? [],
      modifierGroupIds: groupIdsByItem.get(i.id) ?? [],
    }));

    const groupRows = await this.sql.select<{
      id: string;
      name: string;
      minSelect: number;
      maxSelect: number;
    }>(
      `SELECT id, name, minSelect, maxSelect FROM modifier_group
        WHERE businessId = ? ORDER BY name ASC`,
      [businessId],
    );
    const groupIds = groupRows.map((g) => g.id);
    const modRows = groupIds.length
      ? await this.sql.select<{
          id: string;
          groupId: string;
          name: string;
          priceDeltaCents: number;
        }>(
          `SELECT id, groupId, name, priceDeltaCents FROM modifier
            WHERE groupId IN (${placeholders(groupIds.length)})
            ORDER BY sortOrder ASC`,
          groupIds,
        )
      : [];
    const modsByGroup = new Map<string, { id: string; name: string; priceDeltaCents: number }[]>();
    for (const m of modRows) {
      const arr = modsByGroup.get(m.groupId) ?? [];
      arr.push({ id: m.id, name: m.name, priceDeltaCents: m.priceDeltaCents });
      modsByGroup.set(m.groupId, arr);
    }
    const modifierGroups: ManagedModifierGroup[] = groupRows.map((g) => ({
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      modifiers: modsByGroup.get(g.id) ?? [],
    }));

    return { categories, items, modifierGroups };
  }

  // ─────────────────────────────── Orders (read) ──────────────────────────────

  /** Recent orders (most recent first), with the first payment's method. */
  async listOrders(businessId: string, limit = 100): Promise<OrderRow[]> {
    const rows = await this.sql.select<{
      id: string;
      number: number;
      createdAt: string;
      customerName: string | null;
      status: string;
      totalCents: number;
      method: string | null;
    }>(
      `SELECT o.id, o.number, o.createdAt, o.customerName, o.status, o.totalCents,
              (SELECT p.method FROM payment p WHERE p.orderId = o.id ORDER BY p.rowid LIMIT 1) AS method
         FROM "order" o
        WHERE o.businessId = ?
        ORDER BY o.createdAt DESC
        LIMIT ?`,
      [businessId, limit],
    );
    return rows.map((o) => ({
      id: o.id,
      number: o.number,
      createdAt: o.createdAt,
      customerName: o.customerName,
      status: o.status as OrderStatus,
      totalCents: o.totalCents,
      method: (o.method as PaymentMethod | null) ?? null,
    }));
  }

  /**
   * One order's full receipt (lines + modifiers + payments), STRICTLY scoped to
   * the business — an orderId from another business returns null (never trust the
   * id alone), mirroring the cloud `findFirst({ id, businessId })` guarantee.
   */
  async getOrderReceipt(businessId: string, orderId: string): Promise<OrderReceipt | null> {
    const orders = await this.sql.select<{
      id: string;
      number: number;
      createdAt: string;
      customerName: string | null;
      status: string;
      subtotalCents: number;
      discountCents: number;
      taxCents: number;
      tipCents: number;
      totalCents: number;
      businessName: string;
      currency: string;
      taxRateBps: number;
      taxInclusive: number;
      timezone: string;
    }>(
      `SELECT o.id, o.number, o.createdAt, o.customerName, o.status,
              o.subtotalCents, o.discountCents, o.taxCents, o.tipCents, o.totalCents,
              b.name AS businessName, b.currency, b.taxRateBps, b.taxInclusive, b.timezone
         FROM "order" o
         JOIN business b ON b.id = o.businessId
        WHERE o.id = ? AND o.businessId = ?`,
      [orderId, businessId],
    );
    const order = orders[0];
    if (!order) return null;

    const lines = await this.sql.select<{
      id: string;
      nameSnapshot: string;
      quantity: number;
      unitPriceCents: number;
      discountCents: number;
      taxCents: number;
      totalCents: number;
    }>(
      `SELECT id, nameSnapshot, quantity, unitPriceCents, discountCents, taxCents, totalCents
         FROM order_line WHERE orderId = ? ORDER BY id ASC`,
      [orderId],
    );

    const lineIds = lines.map((l) => l.id);
    const mods = lineIds.length
      ? await this.sql.select<{
          id: string;
          orderLineId: string;
          nameSnapshot: string;
          priceDeltaCents: number;
        }>(
          `SELECT id, orderLineId, nameSnapshot, priceDeltaCents
             FROM order_line_modifier
            WHERE orderLineId IN (${placeholders(lineIds.length)})
            ORDER BY id ASC`,
          lineIds,
        )
      : [];
    const modsByLine = new Map<string, { id: string; name: string; priceDeltaCents: number }[]>();
    for (const m of mods) {
      const arr = modsByLine.get(m.orderLineId) ?? [];
      arr.push({ id: m.id, name: m.nameSnapshot, priceDeltaCents: m.priceDeltaCents });
      modsByLine.set(m.orderLineId, arr);
    }

    const payments = await this.sql.select<{
      method: string;
      amountCents: number;
      tenderedCents: number | null;
      changeCents: number | null;
      processorRef: string | null;
    }>(
      `SELECT method, amountCents, tenderedCents, changeCents, processorRef
         FROM payment WHERE orderId = ? ORDER BY createdAt ASC`,
      [orderId],
    );

    return {
      id: order.id,
      number: order.number,
      createdAt: order.createdAt,
      customerName: order.customerName,
      status: order.status as OrderStatus,
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      taxCents: order.taxCents,
      tipCents: order.tipCents,
      totalCents: order.totalCents,
      businessName: order.businessName,
      currency: order.currency,
      taxRateBps: order.taxRateBps,
      taxInclusive: Boolean(order.taxInclusive),
      timeZone: order.timezone,
      lines: lines.map((l) => ({
        id: l.id,
        name: l.nameSnapshot,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        discountCents: l.discountCents,
        taxCents: l.taxCents,
        totalCents: l.totalCents,
        modifiers: modsByLine.get(l.id) ?? [],
      })),
      payments: payments.map((p) => ({
        method: p.method as PaymentMethod,
        amountCents: p.amountCents,
        tenderedCents: p.tenderedCents,
        changeCents: p.changeCents,
        manualNote: p.processorRef,
      })),
    };
  }

  // ─────────────────────────────── Reports (read) ─────────────────────────────

  /**
   * End-of-day (Z-report) aggregation in [start, end), scoped by businessId.
   * RECONCILIATION SEMANTICS mirror the cloud query exactly: cash/payment figures
   * are counted by ACTUAL payment movements (Σ Payment.amountCents per method,
   * INCLUDING negative refund reversals), keyed on PAYMENT time; the SALES lines
   * exclude VOIDED / fully-REFUNDED orders and back out the refunded fraction of a
   * PARTIALLY_REFUNDED order proportionally.
   */
  async getDailyReport(businessId: string, start: Date, end: Date): Promise<DailyReport> {
    const s = start.toISOString();
    const e = end.toISOString();

    const biz = (
      await this.sql.select<{ taxInclusive: number }>(
        `SELECT taxInclusive FROM business WHERE id = ?`,
        [businessId],
      )
    )[0];
    const taxInclusive = biz ? Boolean(biz.taxInclusive) : false;

    const statusList = placeholders(REVENUE_STATUSES.length);
    const revenueOrders = await this.sql.select<{
      id: string;
      subtotalCents: number;
      discountCents: number;
      taxCents: number;
      tipCents: number;
      totalCents: number;
    }>(
      `SELECT id, subtotalCents, discountCents, taxCents, tipCents, totalCents
         FROM "order"
        WHERE businessId = ? AND status IN (${statusList})
          AND createdAt >= ? AND createdAt < ?`,
      [businessId, ...REVENUE_STATUSES, s, e],
    );

    // Each revenue order's payments, to back out its refunded fraction.
    const orderIds = revenueOrders.map((o) => o.id);
    const orderPayments = orderIds.length
      ? await this.sql.select<{ orderId: string; amountCents: number }>(
          `SELECT orderId, amountCents FROM payment
            WHERE orderId IN (${placeholders(orderIds.length)})`,
          orderIds,
        )
      : [];
    const refundedByOrder = new Map<string, number>();
    for (const p of orderPayments) {
      if (p.amountCents < 0) {
        refundedByOrder.set(p.orderId, (refundedByOrder.get(p.orderId) ?? 0) - p.amountCents);
      }
    }

    // ALL payments whose OWN createdAt falls in the window (status-agnostic), so
    // negative refund reversals net out cash collected. Joined to the order for
    // defense-in-depth tenant scoping (mirrors the cloud `order: { businessId }`).
    const payments = await this.sql.select<{ method: string; amountCents: number }>(
      `SELECT p.method, p.amountCents
         FROM payment p JOIN "order" o ON o.id = p.orderId
        WHERE p.businessId = ? AND o.businessId = ?
          AND p.createdAt >= ? AND p.createdAt < ?`,
      [businessId, businessId, s, e],
    );

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
      tenders: { rows: [], verifiedCollectedCents: 0, unverifiedCollectedCents: 0 },
    };

    // Retained (net-of-refund) sales per order — proportional fraction, integer cents.
    for (const o of revenueOrders) {
      const refundedCents = refundedByOrder.get(o.id) ?? 0;
      const f = o.totalCents > 0 ? Math.min(1, Math.max(0, refundedCents / o.totalCents)) : 0;
      const keep = (v: number) => v - Math.round(f * v);
      report.grossSalesCents += keep(o.subtotalCents);
      report.discountCents += keep(o.discountCents);
      report.taxCents += keep(o.taxCents);
      report.tipCents += keep(o.tipCents);
    }

    const preTaxBaseCents = report.grossSalesCents - report.discountCents;
    report.netSalesCents = taxInclusive ? preTaxBaseCents - report.taxCents : preTaxBaseCents;
    report.totalCollectedCents =
      preTaxBaseCents + (taxInclusive ? 0 : report.taxCents) + report.tipCents;

    const methodTotals = new Map<PaymentMethod, { count: number; amountCents: number }>();
    for (const p of payments) {
      const method = p.method as PaymentMethod;
      const entry = methodTotals.get(method) ?? { count: 0, amountCents: 0 };
      entry.count += 1;
      entry.amountCents += p.amountCents;
      methodTotals.set(method, entry);
      if (method === "CASH") report.cashCollectedCents += p.amountCents;
      if (p.amountCents < 0) report.refundsCents += -p.amountCents;
    }
    report.byMethod = [...methodTotals.entries()].map(([method, v]) => ({ method, ...v }));
    report.tenders = aggregateTenders(payments);
    return report;
  }

  /** Per-item + per-category sales breakdown over PAID orders in [start, end). */
  async getItemSalesReport(businessId: string, start: Date, end: Date): Promise<ItemSalesReport> {
    const lines = await this.sql.select<{
      nameSnapshot: string;
      quantity: number;
      totalCents: number;
      taxCents: number;
      variationId: string | null;
    }>(
      `SELECT ol.nameSnapshot, ol.quantity, ol.totalCents, ol.taxCents, ol.variationId
         FROM order_line ol JOIN "order" o ON o.id = ol.orderId
        WHERE o.businessId = ? AND o.status = 'PAID'
          AND o.createdAt >= ? AND o.createdAt < ?`,
      [businessId, start.toISOString(), end.toISOString()],
    );

    const variationIds = [...new Set(lines.map((l) => l.variationId).filter((v): v is string => !!v))];
    const variations = variationIds.length
      ? await this.sql.select<{ id: string; categoryName: string | null }>(
          `SELECT v.id, c.name AS categoryName
             FROM variation v
             JOIN item i ON i.id = v.itemId
             LEFT JOIN category c ON c.id = i.categoryId
            WHERE v.businessId = ? AND v.id IN (${placeholders(variationIds.length)})`,
          [businessId, ...variationIds],
        )
      : [];
    const categoryByVariation = new Map(variations.map((v) => [v.id, v.categoryName ?? null]));

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

  /** Net sales per cashier (operator) over PAID orders in [start, end). */
  async getCashierSalesReport(businessId: string, start: Date, end: Date): Promise<CashierSalesRow[]> {
    const orders = await this.sql.select<{
      cashierId: string | null;
      subtotalCents: number;
      discountCents: number;
    }>(
      `SELECT cashierId, subtotalCents, discountCents FROM "order"
        WHERE businessId = ? AND status = 'PAID'
          AND createdAt >= ? AND createdAt < ?`,
      [businessId, start.toISOString(), end.toISOString()],
    );

    const cashierIds = [...new Set(orders.map((o) => o.cashierId).filter((v): v is string => !!v))];
    const operators = cashierIds.length
      ? await this.sql.select<{ id: string; name: string }>(
          `SELECT id, name FROM operator
            WHERE businessId = ? AND id IN (${placeholders(cashierIds.length)})`,
          [businessId, ...cashierIds],
        )
      : [];
    const nameById = new Map(operators.map((o) => [o.id, o.name.trim() || "Staff"]));

    return aggregateCashierSales(
      orders.map((o) => ({
        cashier: o.cashierId ? (nameById.get(o.cashierId) ?? "Unknown") : "Unattributed",
        netSalesCents: o.subtotalCents - o.discountCents,
      })),
    );
  }

  // ─────────────────────────────── Drawer (read) ──────────────────────────────

  /** The single open drawer session (closedAt = null), or null. */
  async getOpenSession(businessId: string): Promise<DrawerSessionRow | null> {
    const s = (
      await this.sql.select<DrawerRow>(
        `SELECT * FROM cash_drawer_session
          WHERE businessId = ? AND closedAt IS NULL
          ORDER BY openedAt DESC LIMIT 1`,
        [businessId],
      )
    )[0];
    if (!s) return null;
    const openedByName = await this.resolveOperatorName(businessId, s.openedById);
    return toDrawerRow(s, openedByName);
  }

  /** Recent drawer sessions (most recent first). */
  async listDrawerSessions(businessId: string, limit = 30): Promise<DrawerSessionRow[]> {
    const rows = await this.sql.select<DrawerRow>(
      `SELECT * FROM cash_drawer_session
        WHERE businessId = ? ORDER BY openedAt DESC LIMIT ?`,
      [businessId, limit],
    );
    return rows.map((s) => toDrawerRow(s, null));
  }

  /**
   * NET cash through the drawer in [openedAt, end): Σ CASH Payment.amountCents by
   * PAYMENT time, status-agnostic (negative refund reversals included), so a cash
   * refund reduces expected drawer cash. Matches the Z-report's cash figure.
   */
  async getCashCollectedSince(businessId: string, openedAt: Date, end: Date = new Date()): Promise<number> {
    const r = (
      await this.sql.select<{ total: number }>(
        `SELECT COALESCE(SUM(p.amountCents), 0) AS total
           FROM payment p JOIN "order" o ON o.id = p.orderId
          WHERE p.businessId = ? AND o.businessId = ? AND p.method = 'CASH'
            AND p.createdAt >= ? AND p.createdAt < ?`,
        [businessId, businessId, openedAt.toISOString(), end.toISOString()],
      )
    )[0];
    return r?.total ?? 0;
  }

  /** Drawer variance summary for sessions CLOSED within [start, end). */
  async getDrawerDaySummary(businessId: string, start: Date, end: Date): Promise<DrawerDaySummary> {
    const closed = await this.sql.select<{ varianceCents: number | null }>(
      `SELECT varianceCents FROM cash_drawer_session
        WHERE businessId = ? AND closedAt >= ? AND closedAt < ?`,
      [businessId, start.toISOString(), end.toISOString()],
    );
    const openRow = (
      await this.sql.select<{ n: number }>(
        `SELECT COUNT(*) AS n FROM cash_drawer_session WHERE businessId = ? AND closedAt IS NULL`,
        [businessId],
      )
    )[0];
    const netVarianceCents = closed.reduce((sum, s) => sum + (s.varianceCents ?? 0), 0);
    return { closedCount: closed.length, openCount: openRow?.n ?? 0, netVarianceCents };
  }

  // ─────────────────────────────── Write path ─────────────────────────────────

  /**
   * Complete a cash sale. The server (this store) is the source of truth for
   * money: it re-looks-up real variation prices + the business tax rate from
   * SQLite and recomputes every total via the SHARED pure pricing engine — the
   * client never sets prices. Idempotent on `clientUuid` (a resubmit returns the
   * existing receipt). The allocate-number-and-insert is one atomic unit under
   * `BEGIN IMMEDIATE`; SQLite is single-writer so the order-number race the cloud
   * counter guards against cannot even occur here.
   *
   * Unlike the cloud action this drops the manager-approval gate and the
   * offline-replay price snapshot — the local edition is cash-only, single-tenant,
   * and its DB is the source of truth (no replay queue). See the class doc-comment.
   */
  async checkout(input: CheckoutInput): Promise<CheckoutResult> {
    const data = checkoutSchema.parse(input);
    const { businessId } = data;

    // Idempotency: a resubmit of the same clientUuid returns the existing receipt.
    const existing = await this.receiptByClientUuid(businessId, data.clientUuid);
    if (existing) return existing;

    const biz = (
      await this.sql.select<{ taxRateBps: number; taxInclusive: number }>(
        `SELECT taxRateBps, taxInclusive FROM business WHERE id = ?`,
        [businessId],
      )
    )[0];
    if (!biz) throw new Error("Unknown business.");

    const { moneyLines, lineRecords } = await this.resolveLines(businessId, data.lines);
    const priced = computePricedOrder(moneyLines, {
      taxRateBps: biz.taxRateBps,
      cartDiscountCents: data.cartDiscountCents,
      tipCents: data.tipCents,
      taxInclusive: Boolean(biz.taxInclusive),
    });

    // Tender: CASH must cover the server total and yields change; every non-cash
    // method records the total out-of-band (no tender/change, optional note).
    const isCash = data.method === "CASH";
    if (isCash && data.cashTenderedCents < priced.totalCents) {
      throw new Error("Cash tendered is less than the total.");
    }
    const tenderedCents = isCash ? data.cashTenderedCents : null;
    const changeCents = isCash ? data.cashTenderedCents - priced.totalCents : null;
    const note = isCash ? null : data.manualNote?.trim() || null;

    const createdAt = new Date().toISOString();
    const orderId = newId();
    let number = 0;
    try {
      await this.sql.execute("BEGIN IMMEDIATE");
      // Atomically allocate the next per-business order number (the row is locked
      // for the duration of the transaction). upsert is defensive: a business
      // without a counter row self-heals on its first sale.
      await this.sql.execute(
        `INSERT INTO order_counter (businessId, lastNumber) VALUES (?, 1)
           ON CONFLICT(businessId) DO UPDATE SET lastNumber = lastNumber + 1`,
        [businessId],
      );
      number = (
        await this.sql.select<{ lastNumber: number }>(
          `SELECT lastNumber FROM order_counter WHERE businessId = ?`,
          [businessId],
        )
      )[0]!.lastNumber;

      await this.sql.execute(
        `INSERT INTO "order"
           (id, businessId, clientUuid, number, cashierId, customerName, status,
            subtotalCents, discountCents, taxCents, tipCents, totalCents, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, 'PAID', ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          businessId,
          data.clientUuid,
          number,
          null, // cashierId — operator attribution wired at the local shell (Stage 5)
          data.customerName ?? null,
          priced.subtotalCents,
          priced.discountCents,
          priced.taxCents,
          priced.tipCents,
          priced.totalCents,
          createdAt,
          createdAt,
        ],
      );

      for (let i = 0; i < lineRecords.length; i++) {
        const l = lineRecords[i]!;
        const p = priced.lines[i]!;
        const lineId = newId();
        await this.sql.execute(
          `INSERT INTO order_line
             (id, businessId, orderId, variationId, nameSnapshot, unitPriceCents,
              quantity, discountCents, taxCents, totalCents)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            lineId,
            businessId,
            orderId,
            l.variationId,
            l.nameSnapshot,
            l.unitPriceCents,
            l.quantity,
            p.discountCents,
            p.taxCents,
            p.totalCents,
          ],
        );
        for (const m of l.modifiers) {
          await this.sql.execute(
            `INSERT INTO order_line_modifier (id, orderLineId, nameSnapshot, priceDeltaCents)
             VALUES (?, ?, ?, ?)`,
            [newId(), lineId, m.nameSnapshot, m.priceDeltaCents],
          );
        }
      }

      await this.sql.execute(
        `INSERT INTO payment
           (id, businessId, orderId, method, status, amountCents, tenderedCents, changeCents, processorRef, createdAt)
         VALUES (?, ?, ?, ?, 'CAPTURED', ?, ?, ?, ?, ?)`,
        [newId(), businessId, orderId, data.method, priced.totalCents, tenderedCents, changeCents, note, createdAt],
      );

      await this.sql.execute("COMMIT");
    } catch (err) {
      try {
        await this.sql.execute("ROLLBACK");
      } catch {
        // no active transaction to roll back — ignore
      }
      // A concurrent resubmit won the clientUuid insert race; return its receipt.
      if (isUniqueViolation(err)) {
        const winner = await this.receiptByClientUuid(businessId, data.clientUuid);
        if (winner) return winner;
      }
      throw err;
    }

    return {
      orderId,
      number,
      subtotalCents: priced.subtotalCents,
      discountCents: priced.discountCents,
      taxCents: priced.taxCents,
      tipCents: priced.tipCents,
      totalCents: priced.totalCents,
      method: data.method,
      cashTenderedCents: tenderedCents ?? 0,
      changeCents: changeCents ?? 0,
      manualNote: note,
    };
  }

  /** Open a new drawer session. Rejects if one is already open for the business. */
  async openDrawer(input: OpenDrawerInput): Promise<OpenDrawerResult> {
    const data = openDrawerSchema.parse(input);
    const existing = (
      await this.sql.select<{ id: string }>(
        `SELECT id FROM cash_drawer_session WHERE businessId = ? AND closedAt IS NULL LIMIT 1`,
        [data.businessId],
      )
    )[0];
    if (existing) throw new Error("A drawer session is already open.");

    const id = newId();
    const openedAt = new Date().toISOString();
    await this.sql.execute(
      `INSERT INTO cash_drawer_session (id, businessId, openedById, openingFloatCents, openedAt)
       VALUES (?, ?, ?, ?, ?)`,
      [id, data.businessId, null, data.openingFloatCents, openedAt],
    );
    return { sessionId: id, openingFloatCents: data.openingFloatCents, openedAt };
  }

  /**
   * Close the open drawer session and reconcile. Loads it scoped by businessId +
   * id + closedAt:null, computes expected = float + cash collected in
   * [openedAt, now), variance = counted − expected, and stamps closedAt. The
   * blind count (counted committed before expected is revealed) is enforced by the
   * caller/UI, same as cloud.
   */
  async closeDrawer(input: CloseDrawerInput): Promise<CloseDrawerResult> {
    const data = closeDrawerSchema.parse(input);
    const session = (
      await this.sql.select<{ id: string; openingFloatCents: number; openedAt: string }>(
        `SELECT id, openingFloatCents, openedAt FROM cash_drawer_session
          WHERE id = ? AND businessId = ? AND closedAt IS NULL`,
        [data.sessionId, data.businessId],
      )
    )[0];
    if (!session) throw new Error("No matching open drawer session.");

    const closedAt = new Date();
    const cashCollectedCents = await this.getCashCollectedSince(
      data.businessId,
      new Date(session.openedAt),
      closedAt,
    );
    const { expectedCents, varianceCents } = reconcile(
      session.openingFloatCents,
      cashCollectedCents,
      data.countedCents,
    );

    // Re-scope the update by closedAt:null so a concurrent close can't double-close.
    const result = await this.sql.execute(
      `UPDATE cash_drawer_session
          SET expectedCents = ?, countedCents = ?, varianceCents = ?, closedAt = ?
        WHERE id = ? AND businessId = ? AND closedAt IS NULL`,
      [expectedCents, data.countedCents, varianceCents, closedAt.toISOString(), session.id, data.businessId],
    );
    if (result.rowsAffected === 0) throw new Error("Drawer session was already closed.");

    return {
      sessionId: session.id,
      openingFloatCents: session.openingFloatCents,
      expectedCents,
      countedCents: data.countedCents,
      varianceCents,
      closedAt: closedAt.toISOString(),
    };
  }

  // ─────────────────────── Local operator/PIN + first-run seed ─────────────────
  //
  // Local-edition-only surface (the cloud backs operators with Better Auth +
  // Membership, so these are NOT on the shared `DataStore` interface — keeping the
  // cloud impl and the tenant CI guard untouched). Wired into the PIN-lock at the
  // local shell boundary in Stage 4/5.

  /** Active operators for the local business (for the PIN-lock roster). */
  async listOperators(businessId: string): Promise<OperatorRow[]> {
    const rows = await this.sql.select<{ id: string; name: string; active: number }>(
      `SELECT id, name, active FROM operator
        WHERE businessId = ? AND active = 1 ORDER BY name ASC`,
      [businessId],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, active: Boolean(r.active) }));
  }

  /**
   * Verify an operator's PIN against the stored PBKDF2 hash (Web Crypto —
   * constant-time, never throws). Returns false for an unknown/inactive operator
   * or any malformed input, so a corrupt row simply fails to match. NOTE: the JS
   * gate is UX only in the desktop build; the Rust license gate (Stage 6) is the
   * real trust anchor.
   */
  async verifyOperatorPin(businessId: string, operatorId: string, pin: string): Promise<boolean> {
    const op = (
      await this.sql.select<{ pinHash: string | null }>(
        `SELECT pinHash FROM operator WHERE id = ? AND businessId = ? AND active = 1`,
        [operatorId, businessId],
      )
    )[0];
    if (!op) return false;
    return verifyPinWebcrypto(pin, op.pinHash);
  }

  /**
   * First-run seed: create the single local business + its first operator (and a
   * zeroed order counter) if the store is empty. Idempotent — returns the existing
   * business id when one is already present, so it's safe to call on every boot.
   */
  async seedFirstRun(opts?: {
    businessId?: string;
    businessName?: string;
    operatorName?: string;
    pin?: string;
  }): Promise<{ businessId: string }> {
    const existing = (
      await this.sql.select<{ id: string }>(`SELECT id FROM business LIMIT 1`)
    )[0];
    if (existing) return { businessId: existing.id };

    const businessId = opts?.businessId ?? LOCAL_BUSINESS_ID;
    const now = new Date().toISOString();
    await this.sql.execute(
      `INSERT INTO business (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)`,
      [businessId, opts?.businessName ?? "My Business", now, now],
    );
    await this.sql.execute(
      `INSERT INTO order_counter (businessId, lastNumber) VALUES (?, 0)`,
      [businessId],
    );
    const pinHash = opts?.pin ? await hashPinWebcrypto(opts.pin) : null;
    await this.sql.execute(
      `INSERT INTO operator (id, businessId, name, pinHash, active, createdAt) VALUES (?, ?, ?, ?, 1, ?)`,
      [newId(), businessId, opts?.operatorName ?? "Owner", pinHash, now],
    );
    return { businessId };
  }

  // ───────────────────────────────── internals ────────────────────────────────

  /** Resolve an operator's display name (scoped to the business), or null. */
  private async resolveOperatorName(
    businessId: string,
    operatorId: string | null,
  ): Promise<string | null> {
    if (!operatorId) return null;
    const op = (
      await this.sql.select<{ name: string }>(
        `SELECT name FROM operator WHERE id = ? AND businessId = ?`,
        [operatorId, businessId],
      )
    )[0];
    return op?.name ?? null;
  }

  /**
   * Rebuild a checkout `Receipt` from a committed order + its first payment (the
   * idempotency re-read). Returns null when no order carries this clientUuid.
   */
  private async receiptByClientUuid(businessId: string, clientUuid: string): Promise<Receipt | null> {
    const o = (
      await this.sql.select<{
        id: string;
        number: number;
        subtotalCents: number;
        discountCents: number;
        taxCents: number;
        tipCents: number;
        totalCents: number;
      }>(
        `SELECT id, number, subtotalCents, discountCents, taxCents, tipCents, totalCents
           FROM "order" WHERE businessId = ? AND clientUuid = ?`,
        [businessId, clientUuid],
      )
    )[0];
    if (!o) return null;
    const pay = (
      await this.sql.select<{
        method: string;
        tenderedCents: number | null;
        changeCents: number | null;
        processorRef: string | null;
      }>(
        `SELECT method, tenderedCents, changeCents, processorRef
           FROM payment WHERE orderId = ? ORDER BY createdAt ASC LIMIT 1`,
        [o.id],
      )
    )[0];
    const method: TenderMethod = pay?.method === "MANUAL" || pay?.method === "QR" ? pay.method : "CASH";
    return {
      orderId: o.id,
      number: o.number,
      subtotalCents: o.subtotalCents,
      discountCents: o.discountCents,
      taxCents: o.taxCents,
      tipCents: o.tipCents,
      totalCents: o.totalCents,
      method,
      cashTenderedCents: pay?.tenderedCents ?? 0,
      changeCents: pay?.changeCents ?? 0,
      manualNote: pay?.processorRef ?? null,
    };
  }

  /**
   * Resolve client cart lines to server-authoritative money inputs + persistable
   * records. Re-looks-up prices + linked modifier groups from the local catalog
   * (via `getRegisterCatalog`), validates each group's min/maxSelect, and snapshots
   * the chosen (and ad-hoc) modifiers. Mirrors the cloud `resolveOrderLines` minus
   * the offline price-override path (local has no replay queue).
   */
  private async resolveLines(
    businessId: string,
    lines: CheckoutInput["lines"],
  ): Promise<{ moneyLines: PricedLineInput[]; lineRecords: ResolvedLineRecord[] }> {
    const catalog = await this.getRegisterCatalog(businessId);
    const byVariation = new Map(catalog.map((e) => [e.variationId, e]));

    const moneyLines: PricedLineInput[] = [];
    const lineRecords: ResolvedLineRecord[] = [];
    for (const line of lines) {
      const entry = byVariation.get(line.variationId);
      if (!entry) throw new Error(`Unknown item: ${line.variationId}`);

      const chosenIds = line.modifierIds ?? [];
      const modifierById = new Map<string, ResolvedModifier>();
      for (const g of entry.modifierGroups) {
        for (const m of g.modifiers) {
          modifierById.set(m.id, { id: m.id, nameSnapshot: m.name, priceDeltaCents: m.priceDeltaCents });
        }
      }
      for (const id of chosenIds) {
        if (!modifierById.has(id)) throw new Error(`Unknown modifier for item: ${id}`);
      }
      for (const g of entry.modifierGroups) {
        const groupModifierIds = g.modifiers.map((m) => m.id);
        const chosenInGroup = chosenIds.filter((id) => groupModifierIds.includes(id));
        validateGroupSelection(
          { groupId: g.id, minSelect: g.minSelect, maxSelect: g.maxSelect, modifierIds: groupModifierIds },
          chosenInGroup,
        );
      }

      const chosenModifiers = chosenIds.map((id) => modifierById.get(id)!);
      // Ad-hoc modifiers: trust the cashier-typed name + upcharge (bounded by the
      // checkout schema; the delta only adds). Synthetic ids keep them distinct.
      const customModifiers: ResolvedModifier[] = (line.customModifiers ?? []).map((c, i) => ({
        id: `custom_${i}`,
        nameSnapshot: c.name.trim(),
        priceDeltaCents: c.priceDeltaCents,
      }));
      const allModifiers = [...chosenModifiers, ...customModifiers];
      const lineDiscountCents = line.lineDiscountCents ?? 0;

      moneyLines.push({
        unitPriceCents: entry.priceCents,
        quantity: line.quantity,
        lineDiscountCents,
        modifiers: allModifiers,
      });
      lineRecords.push({
        variationId: entry.variationId,
        unitPriceCents: entry.priceCents,
        quantity: line.quantity,
        nameSnapshot: entry.label,
        modifiers: allModifiers,
      });
    }
    return { moneyLines, lineRecords };
  }
}

/** Persistable order-line record (name/price snapshotted at sale time). */
interface ResolvedLineRecord {
  variationId: string;
  unitPriceCents: number;
  quantity: number;
  nameSnapshot: string;
  modifiers: ResolvedModifier[];
}

/** Raw `cash_drawer_session` row shape (timestamps already ISO-8601 TEXT). */
interface DrawerRow {
  id: string;
  openedById: string | null;
  openingFloatCents: number;
  expectedCents: number | null;
  countedCents: number | null;
  varianceCents: number | null;
  openedAt: string;
  closedAt: string | null;
}

/** Map a raw drawer row to the shared `DrawerSessionRow` projection. */
function toDrawerRow(s: DrawerRow, openedByName: string | null): DrawerSessionRow {
  return {
    id: s.id,
    openedById: s.openedById,
    openedByName,
    openingFloatCents: s.openingFloatCents,
    expectedCents: s.expectedCents,
    countedCents: s.countedCents,
    varianceCents: s.varianceCents,
    openedAt: s.openedAt,
    closedAt: s.closedAt,
  };
}
