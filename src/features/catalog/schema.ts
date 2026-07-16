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

// ── Stock / inventory ─────────────────────────────────────────────────────────

// Toggle Item.trackStock. Enabling initializes each of the item's null-stock
// variations to 0 (see setItemStockTracking).
export const setItemStockTrackingSchema = z.object({
  businessId: businessIdSchema,
  itemId: z.string().min(1),
  trackStock: z.boolean(),
});

// Absolute set of a variation's on-hand count (manual entry / stock-take).
// Non-negative; the action also clamps defensively.
export const setVariationStockSchema = z.object({
  businessId: businessIdSchema,
  variationId: z.string().min(1),
  stock: z.number().int().min(0).max(1_000_000),
});

// Relative +/- correction (restock / shrinkage). Non-zero; the action clamps the
// RESULT to >= 0 so a manual over-decrement can't drive the count negative.
export const adjustVariationStockSchema = z.object({
  businessId: businessIdSchema,
  variationId: z.string().min(1),
  delta: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((v) => v !== 0, { message: "delta must be non-zero." }),
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

// ── Bulk entry (paste-or-type grid) ──────────────────────────────────────────

// A raw grid row — all cells optional strings; the server re-parses/validates
// them with the pure `bulk-parse` module (never trusts the client).
const bulkRowSchema = z.object({
  name: z.string().optional(),
  price: z.string().optional(),
  category: z.string().optional(),
  sku: z.string().optional(),
  type: z.string().optional(),
});

export const bulkCreateItemsSchema = z.object({
  businessId: businessIdSchema,
  preset: z.enum(["menu", "retail", "service"]),
  // Cap the batch so a runaway paste can't create an unbounded transaction.
  rows: z.array(bulkRowSchema).max(1000),
});

// One modifier group + all its options created in a single call (kills the
// one-at-a-time / blank-row entry). Options are pre-parsed by the client and
// re-validated here.
export const createModifierGroupWithModifiersSchema = z
  .object({
    businessId: businessIdSchema,
    name: z.string().trim().min(1).max(60),
    minSelect: z.number().int().min(0).max(99),
    maxSelect: z.number().int().min(1).max(99),
    options: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(60),
          priceDeltaCents: z.number().int().min(0).max(10_000_000),
        }),
      )
      .max(200),
  })
  .refine((d) => d.maxSelect >= d.minSelect, {
    message: "maxSelect must be >= minSelect.",
    path: ["maxSelect"],
  });

// Attach a "No ___ / Extra ___" ingredient options group to ONE specific item.
// The client expands ingredients into options (via buildIngredientOptions); this
// creates the group + links it to the item in one call.
export const addItemIngredientOptionsSchema = z.object({
  businessId: businessIdSchema,
  itemId: z.string().min(1),
  groupName: z.string().trim().min(1).max(60),
  options: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        priceDeltaCents: z.number().int().min(0).max(10_000_000),
      }),
    )
    .min(1)
    .max(120), // up to ~60 ingredients (No + Extra each)
});
