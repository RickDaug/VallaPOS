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
        modifierGroups,
      });
    }
  }
  return entries;
}

export interface ManagedCategory {
  id: string;
  name: string;
}

export interface ManagedItem {
  id: string;
  name: string;
  type: ItemType;
  categoryName: string | null;
  variations: { id: string; name: string; priceCents: number }[];
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
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    db.item.findMany({
      where: { businessId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        type: true,
        category: { select: { name: true } },
        variations: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, priceCents: true } },
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
      categoryName: i.category?.name ?? null,
      variations: i.variations,
      modifierGroupIds: i.modifierLinks.map((l) => l.groupId),
    })),
    modifierGroups,
  };
}
