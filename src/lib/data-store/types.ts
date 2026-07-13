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
 * SCOPE: this is the READ seam (Stage 2a). The write path — `checkout` (the
 * atomic commit), `openDrawer`/`closeDrawer`, and the local operator/PIN methods
 * — extends this interface in the next slice (Stage 2b), so the shape here is
 * intentionally partial.
 */
import type { SellableEntry, ManagedCatalog } from "@/features/catalog/queries";
import type { OrderRow, DailyReport, OrderReceipt } from "@/features/orders/queries";
import type { ItemSalesReport, CashierSalesRow } from "@/features/orders/report-aggregate";
import type { DrawerSessionRow, DrawerDaySummary } from "@/features/cash-drawer/queries";

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

  // ── Write path (checkout/commit, drawer open/close) + local operator PIN ──
  //    lands in Stage 2b; see docs/EDITIONS.md §2.
}
