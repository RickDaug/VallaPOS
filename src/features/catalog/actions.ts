"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireMembership, assertRole } from "@/lib/tenant";
import {
  createCategorySchema,
  createItemSchema,
  idSchema,
  createModifierGroupSchema,
  createModifierSchema,
  linkSchema,
} from "./schema";

function revalidateCatalog(businessId: string) {
  revalidatePath(`/${businessId}/products`);
  revalidatePath(`/${businessId}/register`);
}

export async function createCategory(input: z.infer<typeof createCategorySchema>) {
  const data = createCategorySchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

  await db.category.create({ data: { businessId: ctx.businessId, name: data.name } });
  revalidateCatalog(ctx.businessId);
}

export async function deleteCategory(input: z.infer<typeof idSchema>) {
  const data = idSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

  // Scope the delete by businessId so one tenant can't delete another's row.
  await db.category.deleteMany({ where: { id: data.id, businessId: ctx.businessId } });
  revalidateCatalog(ctx.businessId);
}

export async function createItem(input: z.infer<typeof createItemSchema>) {
  const data = createItemSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

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
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

  await db.item.deleteMany({ where: { id: data.id, businessId: ctx.businessId } });
  revalidateCatalog(ctx.businessId);
}

// ── Modifiers ────────────────────────────────────────────────────────────────

export async function createModifierGroup(input: z.infer<typeof createModifierGroupSchema>) {
  const data = createModifierGroupSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

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
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

  // Scope by businessId; cascades remove modifiers + item links.
  await db.modifierGroup.deleteMany({ where: { id: data.id, businessId: ctx.businessId } });
  revalidateCatalog(ctx.businessId);
}

export async function createModifier(input: z.infer<typeof createModifierSchema>) {
  const data = createModifierSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

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
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

  await db.modifier.deleteMany({ where: { id: data.id, businessId: ctx.businessId } });
  revalidateCatalog(ctx.businessId);
}

export async function linkModifierGroup(input: z.infer<typeof linkSchema>) {
  const data = linkSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

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

export async function unlinkModifierGroup(input: z.infer<typeof linkSchema>) {
  const data = linkSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

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
