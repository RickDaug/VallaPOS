import { z } from "zod";

/**
 * Zod schemas for catalog writes. Kept in their own (non-`server-only`) module
 * so the validation rules can be unit tested without importing the server
 * action file. The actions in `actions.ts` import and `.parse()` these.
 */

const businessIdSchema = z.string().min(1);

export const createCategorySchema = z.object({
  businessId: businessIdSchema,
  name: z.string().trim().min(1).max(60),
});

export const createItemSchema = z.object({
  businessId: businessIdSchema,
  name: z.string().trim().min(1).max(80),
  type: z.enum(["PRODUCT", "SERVICE"]),
  categoryId: z.string().min(1).nullable().optional(),
  priceCents: z.number().int().min(0).max(10_000_000),
});

export const idSchema = z.object({
  businessId: businessIdSchema,
  id: z.string().min(1),
});

// Edit an existing item: name, type, category, and the Default variation's price.
export const updateItemSchema = z.object({
  businessId: businessIdSchema,
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  type: z.enum(["PRODUCT", "SERVICE"]),
  categoryId: z.string().min(1).nullable().optional(),
  priceCents: z.number().int().min(0).max(10_000_000),
});

// Archive / unarchive an item via the existing Item.active flag.
export const setItemActiveSchema = z.object({
  businessId: businessIdSchema,
  id: z.string().min(1),
  active: z.boolean(),
});

// SKU is optional; empty/whitespace becomes null (the column is nullable and
// uniquely constrained per business, so we never store an empty string).
const skuSchema = z
  .string()
  .trim()
  .max(60)
  .nullable()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

export const createVariationSchema = z.object({
  businessId: businessIdSchema,
  itemId: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  priceCents: z.number().int().min(0).max(10_000_000),
  sku: skuSchema,
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});

export const updateVariationSchema = z.object({
  businessId: businessIdSchema,
  id: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  priceCents: z.number().int().min(0).max(10_000_000),
  sku: skuSchema,
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});

// Reorder a category (numeric sortOrder; lower sorts first).
export const updateCategorySortOrderSchema = z.object({
  businessId: businessIdSchema,
  id: z.string().min(1),
  sortOrder: z.number().int().min(0).max(100_000),
});

export const createModifierGroupSchema = z
  .object({
    businessId: businessIdSchema,
    name: z.string().trim().min(1).max(60),
    minSelect: z.number().int().min(0).max(99),
    maxSelect: z.number().int().min(1).max(99),
  })
  .refine((d) => d.maxSelect >= d.minSelect, {
    message: "maxSelect must be >= minSelect.",
    path: ["maxSelect"],
  });

export const createModifierSchema = z.object({
  businessId: businessIdSchema,
  groupId: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  priceDeltaCents: z.number().int().min(0).max(10_000_000),
});

export const linkSchema = z.object({
  businessId: businessIdSchema,
  itemId: z.string().min(1),
  groupId: z.string().min(1),
});
