import "server-only";
import { db } from "@/lib/db";
import type { ItemType } from "@prisma/client";

export interface SellableEntry {
  variationId: string;
  itemId: string;
  label: string; // "Soda — Large" or just "Classic Burger"
  category: string;
  type: ItemType;
  priceCents: number;
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
    },
  });

  const entries: SellableEntry[] = [];
  for (const item of items) {
    for (const variation of item.variations) {
      entries.push({
        variationId: variation.id,
        itemId: item.id,
        label: labelFor(item.name, variation.name),
        category: item.category?.name ?? UNCATEGORIZED,
        type: item.type,
        priceCents: variation.priceCents,
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
}

export interface ManagedCatalog {
  categories: ManagedCategory[];
  items: ManagedItem[];
}

/** Full catalog for the Products management screen, scoped to the business. */
export async function getManagedCatalog(businessId: string): Promise<ManagedCatalog> {
  const [categories, items] = await Promise.all([
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
    })),
  };
}
