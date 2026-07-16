import "server-only";
import { db } from "@/lib/db";
import type { ItemType } from "@prisma/client";

export interface SellableModifier {
  id: string;
  name: string;
  priceDeltaCents: number;
}

export interface SellableModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: SellableModifier[];
}

export interface SellableEntry {
  variationId: string;
  itemId: string;
  label: string; // "Soda — Large" or just "Classic Burger"
  category: string;
  type: ItemType;
  priceCents: number;
  // Inventory. `trackStock` is the parent item's flag; `stock` is this
  // variation's on-hand count (null when not tracking). OPTIONAL so the offline
  // SqliteDataStore (which doesn't surface stock yet) still satisfies the type —
  // consumers treat an absent value as "untracked". See stock.ts.
  trackStock?: boolean;
  stock?: number | null;
  // Modifier groups linked to the parent item (shared across its variations).
  modifierGroups: SellableModifierGroup[];
}

const UNCATEGORIZED = "Uncategorized";

function labelFor(itemName: string, variationName: string): string {
  return variationName && variationName !== "Default" ? `${itemName} — ${variationName}` : itemName;
}

/**
 * Flat list of sellable variations for the register grid, scoped to the
 * business. Queries items directly (not via categories) so uncategorized items
 * still appear. One card per variation.
 */
export async function getRegisterCatalog(businessId: string): Promise<SellableEntry[]> {
  const items = await db.item.findMany({
    where: { businessId, active: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      type: true,
      trackStock: true,
      category: { select: { name: true } },
      variations: { orderBy: { sortOrder: "asc" } },
      modifierLinks: {
        select: {
          group: {
            select: {
              id: true,
              name: true,
              minSelect: true,
              maxSelect: true,
              modifiers: {
                orderBy: { sortOrder: "asc" },
                select: { id: true, name: true, priceDeltaCents: true },
              },
            },
          },
        },
      },
    },
  });

  const entries: SellableEntry[] = [];
  for (const item of items) {
    const modifierGroups: SellableModifierGroup[] = item.modifierLinks.map((link) => ({
      id: link.group.id,
      name: link.group.name,
      minSelect: link.group.minSelect,
      maxSelect: link.group.maxSelect,
      modifiers: link.group.modifiers,
    }));
    for (const variation of item.variations) {
      entries.push({
        variationId: variation.id,
        itemId: item.id,
        label: labelFor(item.name, variation.name),
        category: item.category?.name ?? UNCATEGORIZED,
        type: item.type,
        priceCents: variation.priceCents,
        trackStock: item.trackStock,
        stock: variation.stock,
        modifierGroups,
      });
    }
  }
  return entries;
}

export interface ManagedCategory {
  id: string;
  name: string;
  sortOrder: number;
}

export interface ManagedVariation {
  id: string;
  name: string;
  priceCents: number;
  sku: string | null;
  sortOrder: number;
  // On-hand count (null when the item isn't tracking stock). OPTIONAL so the
  // offline SqliteDataStore still satisfies the type. See stock.ts.
  stock?: number | null;
}

export interface ManagedItem {
  id: string;
  name: string;
  type: ItemType;
  active: boolean;
  categoryId: string | null;
  categoryName: string | null;
  // Whether this item tracks per-variation stock. OPTIONAL for the same reason.
  trackStock?: boolean;
  variations: ManagedVariation[];
  // Ids of the modifier groups linked to this item.
  modifierGroupIds: string[];
}

export interface ManagedModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: { id: string; name: string; priceDeltaCents: number }[];
}

export interface ManagedCatalog {
  categories: ManagedCategory[];
  items: ManagedItem[];
  modifierGroups: ManagedModifierGroup[];
}

/** Full catalog for the Products management screen, scoped to the business. */
export async function getManagedCatalog(businessId: string): Promise<ManagedCatalog> {
  const [categories, items, modifierGroups] = await Promise.all([
    db.category.findMany({
      where: { businessId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, sortOrder: true },
    }),
    // All items (active + archived); the UI filters/sections archived ones.
    // Active first, then by name, so the live catalog stays at the top.
    db.item.findMany({
      where: { businessId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        type: true,
        active: true,
        trackStock: true,
        categoryId: true,
        category: { select: { name: true } },
        variations: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: { id: true, name: true, priceCents: true, sku: true, sortOrder: true, stock: true },
        },
        modifierLinks: { select: { groupId: true } },
      },
    }),
    db.modifierGroup.findMany({
      where: { businessId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        minSelect: true,
        maxSelect: true,
        modifiers: {
          orderBy: { sortOrder: "asc" },
          select: { id: true, name: true, priceDeltaCents: true },
        },
      },
    }),
  ]);

  return {
    categories,
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      type: i.type,
      active: i.active,
      categoryId: i.categoryId,
      categoryName: i.category?.name ?? null,
      trackStock: i.trackStock,
      variations: i.variations,
      modifierGroupIds: i.modifierLinks.map((l) => l.groupId),
    })),
    modifierGroups,
  };
}
