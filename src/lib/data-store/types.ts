/**
 * The DATA-STORE SEAM (docs/EDITIONS.md §2).
 *
 * One port that the cash-path features call instead of reaching for Prisma/`db`
 * directly. Two implementations select by edition:
 *   - cloud → `PrismaDataStore` (Neon), in `./prisma-store.ts`
 *   - local → `SqliteDataStore` (Tauri SQLite), added in Stage 3
 *
 * All types below are the SAME projection interfaces the current `queries.ts`
 * files already return — imported as `import type` (fully erased, so this file
 * pulls in no `server-only` runtime code and stays importable anywhere).
 *
 * `businessId` stays in every signature — in the local edition it collapses to a
 * fixed single-tenant constant, which keeps the cloud impl and the tenant CI
 * guard unchanged.
 *
 * SCOPE: reads + the write path (`checkout` and drawer open/close). The local
 * operator/PIN methods arrive with the local edition (Stage 3). Note that callers
 * still import the query fns / server actions directly today — routing them
 * through `getDataStore()` is an edition-build concern (Stage 5), because the
 * write boundary is a server action invoked from the client, not a plain call.
 */
import type { SellableEntry, ManagedCatalog } from "@/features/catalog/queries";
import type { OrderRow, DailyReport, OrderReceipt } from "@/features/orders/queries";
import type { ItemSalesReport, CashierSalesRow } from "@/features/orders/report-aggregate";
import type { DrawerSessionRow, DrawerDaySummary } from "@/features/cash-drawer/queries";
import type { CheckoutInput, CheckoutResult } from "@/features/register/schema";
import type { OpenDrawerInput, CloseDrawerInput } from "@/features/cash-drawer/schema";
import type { OpenDrawerResult, CloseDrawerResult } from "@/features/cash-drawer/actions";

export interface DataStore {
  // ── Catalog (read) — src/features/catalog/queries.ts ──
  getRegisterCatalog(businessId: string): Promise<SellableEntry[]>;
  getManagedCatalog(businessId: string): Promise<ManagedCatalog>;

  // ── Orders (read) — src/features/orders/queries.ts ──
  listOrders(businessId: string, limit?: number): Promise<OrderRow[]>;
  getOrderReceipt(businessId: string, orderId: string): Promise<OrderReceipt | null>;

  // ── Reports (read) — src/features/orders/queries.ts ──
  getDailyReport(businessId: string, start: Date, end: Date): Promise<DailyReport>;
  getItemSalesReport(businessId: string, start: Date, end: Date): Promise<ItemSalesReport>;
  getCashierSalesReport(businessId: string, start: Date, end: Date): Promise<CashierSalesRow[]>;

  // ── Cash drawer (read) — src/features/cash-drawer/queries.ts ──
  getOpenSession(businessId: string): Promise<DrawerSessionRow | null>;
  listDrawerSessions(businessId: string, limit?: number): Promise<DrawerSessionRow[]>;
  getCashCollectedSince(businessId: string, openedAt: Date, end?: Date): Promise<number>;
  getDrawerDaySummary(businessId: string, start: Date, end: Date): Promise<DrawerDaySummary>;

  // ── Write path (server-authoritative) ──
  // `checkout` is the atomic allocate-order-number-and-insert commit — the
  // OrderCounter upsert lives inside its `$transaction` (the order-number-race
  // fix depends on it). Cloud: the existing server action. Local (Stage 3): a
  // local fn doing the same under SQLite `BEGIN IMMEDIATE`.
  checkout(input: CheckoutInput): Promise<CheckoutResult>;
  openDrawer(input: OpenDrawerInput): Promise<OpenDrawerResult>;
  closeDrawer(input: CloseDrawerInput): Promise<CloseDrawerResult>;

  // Local operator/PIN reads (cloud: Membership; local: Operator table) arrive
  // with the local edition in Stage 3.
}
