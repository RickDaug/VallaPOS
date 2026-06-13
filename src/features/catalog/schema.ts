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
