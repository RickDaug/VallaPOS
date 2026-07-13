import type {
  SellableEntry,
  SellableModifier,
  SellableModifierGroup,
  ManagedCatalog,
} from "@/features/catalog/queries";
import type { OrderRow, DailyReport, OrderReceipt } from "@/features/orders/queries";
import type { ItemSalesReport, CashierSalesRow } from "@/features/orders/report-aggregate";
import type { DrawerSessionRow, DrawerDaySummary } from "@/features/cash-drawer/queries";
import type { CheckoutResult } from "@/features/register/schema";
import type { OpenDrawerResult, CloseDrawerResult } from "@/features/cash-drawer/actions";
import type { ItemType } from "@prisma/client";
import type { DataStore } from "../types";
import type { SqlDriver } from "./driver";
import { SCHEMA_SQL } from "./schema";

const UNCATEGORIZED = "Uncategorized";

function labelFor(itemName: string, variationName: string): string {
  return variationName && variationName !== "Default" ? `${itemName} — ${variationName}` : itemName;
}

/** Methods land incrementally; until then they fail loudly rather than silently. */
function notYet(method: string): never {
  throw new Error(`SqliteDataStore.${method} is implemented in Stage 3b (docs/EDITIONS.md).`);
}

/**
 * Local (offline edition) implementation of the DataStore seam over hand-written
 * SQL — no Prisma, so the Tauri bundle stays small (docs/EDITIONS.md §3/§5). Talks
 * only to the injected `SqlDriver`, and imports the shared projection types as
 * `import type` (erased), so this module pulls in NO `server-only` runtime and is
 * safe in the desktop webview.
 *
 * Stage 3a implements schema migration + `getRegisterCatalog` (the register grid),
 * proving the schema → driver → projection pipeline end-to-end. The remaining
 * methods are Stage 3b.
 */
export class SqliteDataStore implements DataStore {
  constructor(private readonly sql: SqlDriver) {}

  /** Create the cash-subset tables. Idempotent (`CREATE TABLE IF NOT EXISTS`). */
  async migrate(): Promise<void> {
    for (const stmt of SCHEMA_SQL.split(";").map((s) => s.trim()).filter(Boolean)) {
      await this.sql.execute(stmt);
    }
  }

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
    const itemPlaceholders = itemIds.map(() => "?").join(", ");

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
            WHERE groupId IN (${groupIds.map(() => "?").join(", ")})
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

  // ── Stage 3b — reads ──
  async getManagedCatalog(): Promise<ManagedCatalog> {
    return notYet("getManagedCatalog");
  }
  async listOrders(): Promise<OrderRow[]> {
    return notYet("listOrders");
  }
  async getOrderReceipt(): Promise<OrderReceipt | null> {
    return notYet("getOrderReceipt");
  }
  async getDailyReport(): Promise<DailyReport> {
    return notYet("getDailyReport");
  }
  async getItemSalesReport(): Promise<ItemSalesReport> {
    return notYet("getItemSalesReport");
  }
  async getCashierSalesReport(): Promise<CashierSalesRow[]> {
    return notYet("getCashierSalesReport");
  }
  async getOpenSession(): Promise<DrawerSessionRow | null> {
    return notYet("getOpenSession");
  }
  async listDrawerSessions(): Promise<DrawerSessionRow[]> {
    return notYet("listDrawerSessions");
  }
  async getCashCollectedSince(): Promise<number> {
    return notYet("getCashCollectedSince");
  }
  async getDrawerDaySummary(): Promise<DrawerDaySummary> {
    return notYet("getDrawerDaySummary");
  }

  // ── Stage 3b — writes ──
  async checkout(): Promise<CheckoutResult> {
    return notYet("checkout");
  }
  async openDrawer(): Promise<OpenDrawerResult> {
    return notYet("openDrawer");
  }
  async closeDrawer(): Promise<CloseDrawerResult> {
    return notYet("closeDrawer");
  }
}
