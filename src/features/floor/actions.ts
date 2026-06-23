"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireMembership, assertRole } from "@/lib/tenant";
import {
  createRoomSchema,
  renameRoomSchema,
  reorderRoomSchema,
  roomIdSchema,
  createTableSchema,
  updateTableSchema,
  deleteTableSchema,
  quickAddTablesSchema,
  clamp,
  FLOOR_WIDTH,
  FLOOR_HEIGHT,
  MAX_TABLE_SIZE,
  MIN_TABLE_SIZE,
  MAX_TABLES_PER_BUSINESS,
} from "./schema";

const PRISMA_UNIQUE_VIOLATION = "P2002";
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === PRISMA_UNIQUE_VIOLATION
  );
}

function revalidateFloor(businessId: string) {
  revalidatePath(`/${businessId}/settings`);
  revalidatePath(`/${businessId}/floor`);
}

// Defense in depth: confirm a room belongs to this business before touching it.
async function assertRoomOwned(roomId: string, businessId: string) {
  const room = await db.floorRoom.findFirst({
    where: { id: roomId, businessId },
    select: { id: true },
  });
  if (!room) throw new Error("Room not found.");
}

async function assertUnderTableCap(businessId: string, adding: number) {
  const current = await db.floorTable.count({ where: { businessId } });
  if (current + adding > MAX_TABLES_PER_BUSINESS) {
    throw new Error(
      `Table limit reached — a business can have up to ${MAX_TABLES_PER_BUSINESS} tables (you have ${current}).`,
    );
  }
}

// ── Rooms ────────────────────────────────────────────────────────────────────

export async function createRoom(input: z.infer<typeof createRoomSchema>) {
  const data = createRoomSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

  // New rooms sort after existing ones.
  const count = await db.floorRoom.count({ where: { businessId: ctx.businessId } });
  try {
    const room = await db.floorRoom.create({
      data: { businessId: ctx.businessId, name: data.name, sortOrder: count },
      select: { id: true },
    });
    revalidateFloor(ctx.businessId);
    return room.id;
  } catch (err) {
    if (isUniqueViolation(err)) throw new Error("A room with that name already exists.");
    throw err;
  }
}

export async function renameRoom(input: z.infer<typeof renameRoomSchema>) {
  const data = renameRoomSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

  try {
    // Scoped by businessId so a tenant can't rename another's room.
    await db.floorRoom.updateMany({
      where: { id: data.id, businessId: ctx.businessId },
      data: { name: data.name },
    });
    revalidateFloor(ctx.businessId);
  } catch (err) {
    if (isUniqueViolation(err)) throw new Error("A room with that name already exists.");
    throw err;
  }
}

export async function reorderRoom(input: z.infer<typeof reorderRoomSchema>) {
  const data = reorderRoomSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

  await db.floorRoom.updateMany({
    where: { id: data.id, businessId: ctx.businessId },
    data: { sortOrder: data.sortOrder },
  });
  revalidateFloor(ctx.businessId);
}

export async function deleteRoom(input: z.infer<typeof roomIdSchema>) {
  const data = roomIdSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

  // Cascade drops the room's tables (FloorTable.roomId onDelete: Cascade).
  await db.floorRoom.deleteMany({ where: { id: data.id, businessId: ctx.businessId } });
  revalidateFloor(ctx.businessId);
}

// ── Tables ───────────────────────────────────────────────────────────────────

export async function createTable(input: z.infer<typeof createTableSchema>) {
  const data = createTableSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");
  await assertRoomOwned(data.roomId, ctx.businessId);
  await assertUnderTableCap(ctx.businessId, 1);

  const sortOrder = await db.floorTable.count({ where: { businessId: ctx.businessId, roomId: data.roomId } });
  const table = await db.floorTable.create({
    data: {
      businessId: ctx.businessId,
      roomId: data.roomId,
      label: data.label,
      shape: data.shape,
      seats: data.seats,
      x: clamp(data.x, 0, FLOOR_WIDTH),
      y: clamp(data.y, 0, FLOOR_HEIGHT),
      width: clamp(data.width, MIN_TABLE_SIZE, MAX_TABLE_SIZE),
      height: clamp(data.height, MIN_TABLE_SIZE, MAX_TABLE_SIZE),
      sortOrder,
    },
    select: { id: true },
  });
  revalidateFloor(ctx.businessId);
  return table.id;
}

export async function updateTable(input: z.infer<typeof updateTableSchema>) {
  const data = updateTableSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

  // Only the provided fields are written; coords/sizes are re-clamped server-side.
  const patch: Record<string, unknown> = {};
  if (data.label !== undefined) patch.label = data.label;
  if (data.shape !== undefined) patch.shape = data.shape;
  if (data.seats !== undefined) patch.seats = data.seats;
  if (data.x !== undefined) patch.x = clamp(data.x, 0, FLOOR_WIDTH);
  if (data.y !== undefined) patch.y = clamp(data.y, 0, FLOOR_HEIGHT);
  if (data.width !== undefined) patch.width = clamp(data.width, MIN_TABLE_SIZE, MAX_TABLE_SIZE);
  if (data.height !== undefined) patch.height = clamp(data.height, MIN_TABLE_SIZE, MAX_TABLE_SIZE);

  await db.floorTable.updateMany({
    where: { id: data.id, businessId: ctx.businessId },
    data: patch,
  });
  revalidateFloor(ctx.businessId);
}

export async function deleteTable(input: z.infer<typeof deleteTableSchema>) {
  const data = deleteTableSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

  await db.floorTable.deleteMany({ where: { id: data.id, businessId: ctx.businessId } });
  revalidateFloor(ctx.businessId);
}

export async function quickAddTables(input: z.infer<typeof quickAddTablesSchema>) {
  const data = quickAddTablesSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");
  await assertRoomOwned(data.roomId, ctx.businessId);
  await assertUnderTableCap(ctx.businessId, data.count);

  // Globally-distinct labels: continue numbering from the current table count.
  const existing = await db.floorTable.count({ where: { businessId: ctx.businessId } });
  const startInRoom = await db.floorTable.count({
    where: { businessId: ctx.businessId, roomId: data.roomId },
  });

  // Tidy grid within the canvas.
  const size = 80;
  const gap = 28;
  const stride = size + gap;
  const cols = Math.max(1, Math.floor((FLOOR_WIDTH - gap) / stride));

  const rows = Array.from({ length: data.count }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      businessId: ctx.businessId,
      roomId: data.roomId,
      label: `T${existing + i + 1}`,
      shape: "SQUARE" as const,
      seats: data.seats,
      x: clamp(gap + col * stride, 0, FLOOR_WIDTH),
      y: clamp(gap + row * stride, 0, FLOOR_HEIGHT),
      width: size,
      height: size,
      sortOrder: startInRoom + i,
    };
  });

  // createManyAndReturn (Postgres) so the editor can render the new tables
  // without a refetch.
  const created = await db.floorTable.createManyAndReturn({
    data: rows,
    select: { id: true, label: true, shape: true, x: true, y: true, width: true, height: true, seats: true },
  });
  revalidateFloor(ctx.businessId);
  return created;
}
