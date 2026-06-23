import { z } from "zod";

/**
 * Zod schemas + shared constants for the restaurant floor plan. Kept in a
 * (non-`server-only`) module so the rules can be unit-tested and the canvas
 * constants can be imported by both the editor and the service view, which
 * share one logical coordinate space.
 */

// Logical canvas size in px. The editor/service view scale this to fit their
// container; positions are stored in this space so a layout looks identical
// everywhere regardless of screen size.
export const FLOOR_WIDTH = 1000;
export const FLOOR_HEIGHT = 700;

export const MIN_TABLE_SIZE = 40;
export const MAX_TABLE_SIZE = 320;
export const MAX_TABLES_PER_BUSINESS = 100; // 0–100 tables, per the product spec
export const MAX_SEATS_PER_TABLE = 40;

const businessIdSchema = z.string().min(1);
const idSchema = z.string().min(1);

export const SHAPES = ["ROUND", "SQUARE", "RECT"] as const;

/** Clamp an integer into [min,max]; used so a stray drag can't push a table off-canvas. */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

export const businessOnlySchema = z.object({ businessId: businessIdSchema });
export const roomIdSchema = z.object({ businessId: businessIdSchema, id: idSchema });

export const createRoomSchema = z.object({
  businessId: businessIdSchema,
  name: z.string().trim().min(1).max(40),
});

export const renameRoomSchema = z.object({
  businessId: businessIdSchema,
  id: idSchema,
  name: z.string().trim().min(1).max(40),
});

export const reorderRoomSchema = z.object({
  businessId: businessIdSchema,
  id: idSchema,
  sortOrder: z.number().int().min(0).max(10_000),
});

export const createTableSchema = z.object({
  businessId: businessIdSchema,
  roomId: idSchema,
  label: z.string().trim().min(1).max(12),
  shape: z.enum(SHAPES).default("SQUARE"),
  seats: z.number().int().min(0).max(MAX_SEATS_PER_TABLE).default(4),
  x: z.number().int().min(0).max(FLOOR_WIDTH).default(40),
  y: z.number().int().min(0).max(FLOOR_HEIGHT).default(40),
  width: z.number().int().min(MIN_TABLE_SIZE).max(MAX_TABLE_SIZE).default(80),
  height: z.number().int().min(MIN_TABLE_SIZE).max(MAX_TABLE_SIZE).default(80),
});

// Partial update — drag sends x/y; the inspector sends label/shape/seats/size.
// Every field optional; the action applies whichever are present.
export const updateTableSchema = z
  .object({
    businessId: businessIdSchema,
    id: idSchema,
    label: z.string().trim().min(1).max(12).optional(),
    shape: z.enum(SHAPES).optional(),
    seats: z.number().int().min(0).max(MAX_SEATS_PER_TABLE).optional(),
    x: z.number().int().min(0).max(FLOOR_WIDTH).optional(),
    y: z.number().int().min(0).max(FLOOR_HEIGHT).optional(),
    width: z.number().int().min(MIN_TABLE_SIZE).max(MAX_TABLE_SIZE).optional(),
    height: z.number().int().min(MIN_TABLE_SIZE).max(MAX_TABLE_SIZE).optional(),
  })
  .refine(
    (d) =>
      d.label !== undefined ||
      d.shape !== undefined ||
      d.seats !== undefined ||
      d.x !== undefined ||
      d.y !== undefined ||
      d.width !== undefined ||
      d.height !== undefined,
    { message: "Nothing to update." },
  );

export const deleteTableSchema = z.object({ businessId: businessIdSchema, id: idSchema });

// "Super easy" setup: drop N evenly-laid-out tables into a room at once.
export const quickAddTablesSchema = z.object({
  businessId: businessIdSchema,
  roomId: idSchema,
  count: z.number().int().min(1).max(MAX_TABLES_PER_BUSINESS),
  seats: z.number().int().min(0).max(MAX_SEATS_PER_TABLE).default(4),
});
