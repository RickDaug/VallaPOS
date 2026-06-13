import "server-only";
import { db } from "@/lib/db";

export interface SellableEntry {
  variationId: string;
  itemId: string;
  label: string; // "Soda — Large" or just "Classic Burger"
  category: string;
  type: "PRODUCT" | "SERVICE";
  priceCents: number;
}

/**
 * Flat list of sellable variations for the register grid, scoped to the
 * business. One card per variation; the item name is combined with the
 * variation name unless the variation is the default "Default".
 */
export async function getRegisterCatalog(businessId: string): Promise<SellableEntry[]> {
  const categories = await db.category.findMany({
    where: { businessId },
    orderBy: { sortOrder: "asc" },
    select: {
      name: true,
      items: {
        where: { active: true },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          type: true,
          variations: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });

  const entries: SellableEntry[] = [];
  for (const category of categories) {
    for (const item of category.items) {
      for (const variation of item.variations) {
        const label =
          variation.name && variation.name !== "Default"
            ? `${item.name} — ${variation.name}`
            : item.name;
        entries.push({
          variationId: variation.id,
          itemId: item.id,
          label,
          category: category.name,
          type: item.type,
          priceCents: variation.priceCents,
        });
      }
    }
  }
  return entries;
}
