"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireMembership, assertRole } from "@/lib/tenant";

const businessIdSchema = z.string().min(1);

const createCategorySchema = z.object({
  businessId: businessIdSchema,
  name: z.string().trim().min(1).max(60),
});

const createItemSchema = z.object({
  businessId: businessIdSchema,
  name: z.string().trim().min(1).max(80),
  type: z.enum(["PRODUCT", "SERVICE"]),
  categoryId: z.string().min(1).nullable().optional(),
  priceCents: z.number().int().min(0).max(10_000_000),
});

const idSchema = z.object({
  businessId: businessIdSchema,
  id: z.string().min(1),
});

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
