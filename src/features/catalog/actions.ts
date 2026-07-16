"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/operator-guard";
import {
  createCategorySchema,
  createItemSchema,
  idSchema,
  updateItemSchema,
  setItemActiveSchema,
  createVariationSchema,
  updateVariationSchema,
  updateCategorySortOrderSchema,
  createModifierGroupSchema,
  createModifierSchema,
  linkSchema,
  bulkCreateItemsSchema,
  createModifierGroupWithModifiersSchema,
  addItemIngredientOptionsSchema,
  setItemStockTrackingSchema,
  setVariationStockSchema,
  adjustVariationStockSchema,
} from "./schema";
import { getPreset, isBlankRow, validateRow, type ParsedRow } from "./bulk-parse";

// Prisma's unique-constraint code, raised when a per-business SKU collides on
// @@unique([businessId, sku]). We translate it into a friendly message.
const PRISMA_UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === PRISMA_UNIQUE_VIOLATION
  );
}

function revalidateCatalog(businessId: string) {
  revalidatePath(`/${businessId}/products`);
  revalidatePath(`/${businessId}/register`);
}

export async function createCategory(input: z.infer<typeof createCategorySchema>) {
  const data = createCategorySchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");

  await db.category.create({ data: { businessId: ctx.businessId, name: data.name } });
  revalidateCatalog(ctx.businessId);
}

export async function deleteCategory(input: z.infer<typeof idSchema>) {
  const data = idSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");

  // Scope the delete by businessId so one tenant can't delete another's row.
  await db.category.deleteMany({ where: { id: data.id, businessId: ctx.businessId } });
  revalidateCatalog(ctx.businessId);
}

export async function createItem(input: z.infer<typeof createItemSchema>) {
  const data = createItemSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");

  // Validate the category belongs to this business (defense in depth).
  if (data.categoryId) {
    const category = await db.category.findFirst({
      where: { id: data.categoryId, businessId: ctx.businessId },
      select: { id: true },
    });
    if (!category) throw new Error("Category not found.");
  }

  await db.item.create({
    data: {
      businessId: ctx.businessId,
      name: data.name,
      type: data.type,
      categoryId: data.categoryId ?? null,
      trackStock: false,
      variations: {
        create: { businessId: ctx.businessId, name: "Default", priceCents: data.priceCents },
      },
    },
  });
  revalidateCatalog(ctx.businessId);
}

export async function deleteItem(input: z.infer<typeof idSchema>) {
  const data = idSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");

  await db.item.deleteMany({ where: { id: data.id, businessId: ctx.businessId } });
  revalidateCatalog(ctx.businessId);
}

/**
 * Edit an existing item's name/type/category and the price of its "Default"
 * variation. Items created via `createItem` always have a Default variation, so
 * editing the price here keeps the simple single-price flow working; richer
 * multi-size pricing is managed via the variation actions below.
 */
export async function updateItem(input: z.infer<typeof updateItemSchema>) {
  const data = updateItemSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");

  // The item must belong to this business.
  const item = await db.item.findFirst({
    where: { id: data.id, businessId: ctx.businessId },
    select: { id: true },
  });
  if (!item) throw new Error("Item not found.");

  // Validate the category belongs to this business (defense in depth).
  if (data.categoryId) {
    const category = await db.category.findFirst({
      where: { id: data.categoryId, businessId: ctx.businessId },
      select: { id: true },
    });
    if (!category) throw new Error("Category not found.");
  }

  // Find the Default variation (or the lowest-sorted one if a legacy item has
  // no "Default") to carry the single-price edit.
  const priceVariation = await db.variation.findFirst({
    where: { itemId: item.id, businessId: ctx.businessId },
    orderBy: [{ name: "asc" }, { sortOrder: "asc" }],
    select: { id: true },
  });

  await db.$transaction(async (tx) => {
    await tx.item.update({
      where: { id: item.id },
      data: {
        name: data.name,
        type: data.type,
        categoryId: data.categoryId ?? null,
      },
    });
    if (priceVariation) {
      await tx.variation.update({
        where: { id: priceVariation.id },
        data: { priceCents: data.priceCents },
      });
    }
  });
  revalidateCatalog(ctx.businessId);
}

/** Archive (active=false) or unarchive an item. Archived items leave the register. */
export async function setItemActive(input: z.infer<typeof setItemActiveSchema>) {
  const data = setItemActiveSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");

  // updateMany scopes by businessId so a forged id can't toggle another tenant's item.
  await db.item.updateMany({
    where: { id: data.id, businessId: ctx.businessId },
    data: { active: data.active },
  });
  revalidateCatalog(ctx.businessId);
}

// ── Variations (sizes) ─────────────────────────────────────────────────────────

export async function createVariation(input: z.infer<typeof createVariationSchema>) {
  const data = createVariationSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");

  // The parent item must belong to this business (defense in depth).
  const item = await db.item.findFirst({
    where: { id: data.itemId, businessId: ctx.businessId },
    select: { id: true },
  });
  if (!item) throw new Error("Item not found.");

  try {
    await db.variation.create({
      data: {
        businessId: ctx.businessId,
        itemId: item.id,
        name: data.name,
        priceCents: data.priceCents,
        sku: data.sku,
        sortOrder: data.sortOrder ?? 0,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new Error("That SKU is already in use.");
    throw err;
  }
  revalidateCatalog(ctx.businessId);
}

export async function updateVariation(input: z.infer<typeof updateVariationSchema>) {
  const data = updateVariationSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");

  // The variation must belong to this business.
  const variation = await db.variation.findFirst({
    where: { id: data.id, businessId: ctx.businessId },
    select: { id: true },
  });
  if (!variation) throw new Error("Variation not found.");

  try {
    await db.variation.update({
      where: { id: variation.id },
      data: {
        name: data.name,
        priceCents: data.priceCents,
        sku: data.sku,
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new Error("That SKU is already in use.");
    throw err;
  }
  revalidateCatalog(ctx.businessId);
}

export async function deleteVariation(input: z.infer<typeof idSchema>) {
  const data = idSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");

  // The variation must belong to this business; resolve its item to count siblings.
  const variation = await db.variation.findFirst({
    where: { id: data.id, businessId: ctx.businessId },
    select: { id: true, itemId: true },
  });
  if (!variation) throw new Error("Variation not found.");

  // Guard: an item must keep at least one variation (price lives on the variation).
  const count = await db.variation.count({
    where: { itemId: variation.itemId, businessId: ctx.businessId },
  });
  if (count <= 1) throw new Error("An item must keep at least one variation.");

  await db.variation.deleteMany({ where: { id: variation.id, businessId: ctx.businessId } });
  revalidateCatalog(ctx.businessId);
}

// ── Stock / inventory ─────────────────────────────────────────────────────────

/**
 * Turn stock tracking on/off for one item. When ENABLING, every variation of the
 * item that currently has `stock = null` (never tracked) is initialized to 0, so
 * the count starts from a known baseline the operator can then set/adjust.
 * Disabling leaves the stored numbers in place (harmless; reads ignore them when
 * `trackStock` is false) — re-enabling doesn't wipe a prior count.
 */
export async function setItemStockTracking(
  input: z.infer<typeof setItemStockTrackingSchema>,
) {
  const data = setItemStockTrackingSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");

  // The item must belong to this business (defense in depth).
  const item = await db.item.findFirst({
    where: { id: data.itemId, businessId: ctx.businessId },
    select: { id: true },
  });
  if (!item) throw new Error("Item not found.");

  await db.$transaction(async (tx) => {
    await tx.item.update({ where: { id: item.id }, data: { trackStock: data.trackStock } });
    if (data.trackStock) {
      // Seed a 0 baseline only where nothing was ever tracked; leave existing
      // counts untouched. Scoped by businessId (tenant-safe bulk update).
      await tx.variation.updateMany({
        where: { itemId: item.id, businessId: ctx.businessId, stock: null },
        data: { stock: 0 },
      });
    }
  });
  revalidateCatalog(ctx.businessId);
}

/** Absolute set of a variation's on-hand count (manual entry / stock-take). */
export async function setVariationStock(input: z.infer<typeof setVariationStockSchema>) {
  const data = setVariationStockSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");

  // The variation must belong to this business.
  const variation = await db.variation.findFirst({
    where: { id: data.variationId, businessId: ctx.businessId },
    select: { id: true },
  });
  if (!variation) throw new Error("Variation not found.");

  // Clamp >= 0 for a manual set (the schema already floors at 0; belt-and-braces).
  const stock = Math.max(0, data.stock);
  await db.variation.updateMany({
    where: { id: variation.id, businessId: ctx.businessId },
    data: { stock },
  });
  revalidateCatalog(ctx.businessId);
}

/**
 * Relative +/- correction to a variation's count (restock, shrinkage, fix). The
 * RESULT is clamped to >= 0 so an over-decrement by hand can't drive it negative
 * (only an oversell at checkout is allowed to go negative — that's an honest
 * signal there; a manual correction should never manufacture negative stock).
 */
export async function adjustVariationStock(
  input: z.infer<typeof adjustVariationStockSchema>,
) {
  const data = adjustVariationStockSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");

  // The variation must belong to this business; read the current count to apply
  // the delta with a >= 0 floor.
  const variation = await db.variation.findFirst({
    where: { id: data.variationId, businessId: ctx.businessId },
    select: { id: true, stock: true },
  });
  if (!variation) throw new Error("Variation not found.");

  const next = Math.max(0, (variation.stock ?? 0) + data.delta);
  await db.variation.updateMany({
    where: { id: variation.id, businessId: ctx.businessId },
    data: { stock: next },
  });
  revalidateCatalog(ctx.businessId);
}

// ── Reorder ─────────────────────────────────────────────────────────────────

export async function updateCategorySortOrder(
  input: z.infer<typeof updateCategorySortOrderSchema>,
) {
  const data = updateCategorySortOrderSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");

  await db.category.updateMany({
    where: { id: data.id, businessId: ctx.businessId },
    data: { sortOrder: data.sortOrder },
  });
  revalidateCatalog(ctx.businessId);
}

// ── Modifiers ────────────────────────────────────────────────────────────────

export async function createModifierGroup(input: z.infer<typeof createModifierGroupSchema>) {
  const data = createModifierGroupSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");

  await db.modifierGroup.create({
    data: {
      businessId: ctx.businessId,
      name: data.name,
      minSelect: data.minSelect,
      maxSelect: data.maxSelect,
    },
  });
  revalidateCatalog(ctx.businessId);
}

export async function deleteModifierGroup(input: z.infer<typeof idSchema>) {
  const data = idSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");

  // Scope by businessId; cascades remove modifiers + item links.
  await db.modifierGroup.deleteMany({ where: { id: data.id, businessId: ctx.businessId } });
  revalidateCatalog(ctx.businessId);
}

export async function createModifier(input: z.infer<typeof createModifierSchema>) {
  const data = createModifierSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");

  // The group must belong to this business (defense in depth against a forged id).
  const group = await db.modifierGroup.findFirst({
    where: { id: data.groupId, businessId: ctx.businessId },
    select: { id: true },
  });
  if (!group) throw new Error("Modifier group not found.");

  await db.modifier.create({
    data: {
      businessId: ctx.businessId,
      groupId: group.id,
      name: data.name,
      priceDeltaCents: data.priceDeltaCents,
    },
  });
  revalidateCatalog(ctx.businessId);
}

export async function deleteModifier(input: z.infer<typeof idSchema>) {
  const data = idSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");

  await db.modifier.deleteMany({ where: { id: data.id, businessId: ctx.businessId } });
  revalidateCatalog(ctx.businessId);
}

export async function linkModifierGroup(input: z.infer<typeof linkSchema>) {
  const data = linkSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");

  // Both the item and the group must belong to this business before we link them.
  const [item, group] = await Promise.all([
    db.item.findFirst({ where: { id: data.itemId, businessId: ctx.businessId }, select: { id: true } }),
    db.modifierGroup.findFirst({
      where: { id: data.groupId, businessId: ctx.businessId },
      select: { id: true },
    }),
  ]);
  if (!item || !group) throw new Error("Item or modifier group not found.");

  // Idempotent: re-linking an existing pair is a no-op (composite PK).
  await db.itemModifierGroup.upsert({
    where: { itemId_groupId: { itemId: item.id, groupId: group.id } },
    create: { itemId: item.id, groupId: group.id },
    update: {},
  });
  revalidateCatalog(ctx.businessId);
}

// ── Bulk entry (paste-or-type grid) ──────────────────────────────────────────

export interface BulkCreateItemsResult {
  created: number;
  categoriesCreated: string[];
  /** Rows we couldn't create, with a reason — surfaced so nothing drops silently. */
  skipped: { row: number; name: string; reason: string }[];
}

/**
 * Create many items (each with one or more variations) in a single transaction.
 * Categories typed in the grid are auto-created (case-insensitive match to avoid
 * "Drinks" vs "drinks" duplicates). Rows are re-validated server-side with the
 * pure `bulk-parse` module; invalid rows and SKU conflicts are SKIPPED and
 * reported, not silently dropped, so the operator can fix and re-save them.
 */
export async function bulkCreateItems(
  input: z.infer<typeof bulkCreateItemsSchema>,
): Promise<BulkCreateItemsResult> {
  const data = bulkCreateItemsSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");
  const preset = getPreset(data.preset);

  // 1. Validate every non-blank row.
  const skipped: BulkCreateItemsResult["skipped"] = [];
  let valid: { row: number; parsed: ParsedRow }[] = [];
  data.rows.forEach((raw, i) => {
    if (isBlankRow(raw)) return;
    const res = validateRow(raw, preset);
    const label = (raw.name ?? "").trim() || `row ${i + 1}`;
    if (res.ok) valid.push({ row: i + 1, parsed: res.row });
    else skipped.push({ row: i + 1, name: label, reason: res.error });
  });

  // 2. Resolve SKU conflicts (retail): dedupe within the batch + against the DB.
  const skus = valid.map((v) => v.parsed.sku).filter((s): s is string => Boolean(s));
  if (skus.length > 0) {
    const existing = await db.variation.findMany({
      where: { businessId: ctx.businessId, sku: { in: skus } },
      select: { sku: true },
    });
    const taken = new Set(existing.map((e) => e.sku));
    const batchSeen = new Set<string>();
    valid = valid.filter((v) => {
      const sku = v.parsed.sku;
      if (!sku) return true;
      if (taken.has(sku)) {
        skipped.push({ row: v.row, name: v.parsed.name, reason: `SKU "${sku}" already exists` });
        return false;
      }
      if (batchSeen.has(sku)) {
        skipped.push({ row: v.row, name: v.parsed.name, reason: `Duplicate SKU "${sku}" in this batch` });
        return false;
      }
      batchSeen.add(sku);
      return true;
    });
  }

  if (valid.length === 0) {
    return { created: 0, categoriesCreated: [], skipped };
  }

  // 3. Resolve categories (case-insensitive) — reuse existing, create missing.
  const existingCats = await db.category.findMany({
    where: { businessId: ctx.businessId },
    select: { id: true, name: true },
  });
  const catByLower = new Map(existingCats.map((c) => [c.name.toLowerCase(), c.id]));
  const neededNames = new Map<string, string>(); // lower -> original casing (first seen)
  for (const v of valid) {
    const name = v.parsed.categoryName;
    if (name && !catByLower.has(name.toLowerCase()) && !neededNames.has(name.toLowerCase())) {
      neededNames.set(name.toLowerCase(), name);
    }
  }

  const categoriesCreated: string[] = [];
  await db.$transaction(
    async (tx) => {
      // Create any missing categories first, filling the id map.
      for (const [lower, original] of neededNames) {
        const created = await tx.category.create({
          data: { businessId: ctx.businessId, name: original },
        });
        catByLower.set(lower, created.id);
        categoriesCreated.push(original);
      }
      // Then create each item with its variations.
      for (const v of valid) {
        const categoryId = v.parsed.categoryName
          ? (catByLower.get(v.parsed.categoryName.toLowerCase()) ?? null)
          : null;
        await tx.item.create({
          data: {
            businessId: ctx.businessId,
            name: v.parsed.name,
            type: v.parsed.type,
            categoryId,
            trackStock: false,
            variations: {
              create: v.parsed.variations.map((vr, idx) => ({
                businessId: ctx.businessId,
                name: vr.name,
                priceCents: vr.priceCents,
                sortOrder: idx,
                // The item-level SKU rides the first (Default) variation only.
                sku: idx === 0 ? v.parsed.sku : null,
              })),
            },
          },
        });
      }
    },
    // Generous timeout: a large paste is a one-off admin action, not a hot path.
    { timeout: 60_000, maxWait: 20_000 },
  );

  revalidateCatalog(ctx.businessId);
  return { created: valid.length, categoriesCreated, skipped };
}

/**
 * Attach a "No ___ / Extra ___" ingredient options group to ONE specific item.
 * Creates the group (minSelect 0, each option independently tappable) with all
 * options and links it to the item — in one transaction. This is the discoverable,
 * per-item path so an operator never has to build a group then hunt for the link.
 */
export async function addItemIngredientOptions(
  input: z.infer<typeof addItemIngredientOptionsSchema>,
) {
  const data = addItemIngredientOptionsSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");

  // The item must belong to this business (defense in depth).
  const item = await db.item.findFirst({
    where: { id: data.itemId, businessId: ctx.businessId },
    select: { id: true },
  });
  if (!item) throw new Error("Item not found.");

  // Each option is independently selectable (no onion AND extra cheese AND …),
  // so the cap is the option count (bounded by the schema, and ≤ the 99 limit).
  const maxSelect = Math.min(data.options.length, 99);

  await db.$transaction(async (tx) => {
    const group = await tx.modifierGroup.create({
      data: {
        businessId: ctx.businessId,
        name: data.groupName,
        minSelect: 0,
        maxSelect,
        modifiers: {
          create: data.options.map((o, i) => ({
            businessId: ctx.businessId,
            name: o.name,
            priceDeltaCents: o.priceDeltaCents,
            sortOrder: i,
          })),
        },
      },
    });
    await tx.itemModifierGroup.create({ data: { itemId: item.id, groupId: group.id } });
  });

  revalidateCatalog(ctx.businessId);
}

/** Create a modifier group and ALL its options in one call (no blank-row entry). */
export async function createModifierGroupWithModifiers(
  input: z.infer<typeof createModifierGroupWithModifiersSchema>,
) {
  const data = createModifierGroupWithModifiersSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");

  await db.modifierGroup.create({
    data: {
      businessId: ctx.businessId,
      name: data.name,
      minSelect: data.minSelect,
      maxSelect: data.maxSelect,
      modifiers: {
        create: data.options.map((o, i) => ({
          businessId: ctx.businessId,
          name: o.name,
          priceDeltaCents: o.priceDeltaCents,
          sortOrder: i,
        })),
      },
    },
  });
  revalidateCatalog(ctx.businessId);
}

export async function unlinkModifierGroup(input: z.infer<typeof linkSchema>) {
  const data = linkSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_products");

  // Scope the unlink to rows whose item belongs to this business (the link row
  // itself carries no businessId, so we guard via the item).
  const item = await db.item.findFirst({
    where: { id: data.itemId, businessId: ctx.businessId },
    select: { id: true },
  });
  if (!item) throw new Error("Item not found.");

  await db.itemModifierGroup.deleteMany({ where: { itemId: item.id, groupId: data.groupId } });
  revalidateCatalog(ctx.businessId);
}
