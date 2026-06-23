import "server-only";

import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";

export interface FloorTableLayout {
  id: string;
  label: string;
  shape: "ROUND" | "SQUARE" | "RECT";
  x: number;
  y: number;
  width: number;
  height: number;
  seats: number;
}

export interface FloorRoomLayout {
  id: string;
  name: string;
  sortOrder: number;
  tables: FloorTableLayout[];
}

/**
 * The full floor layout (rooms + their tables) for the editor. Tenant-scoped via
 * requireMembership + an explicit businessId filter. Rooms sort by sortOrder then
 * creation; tables by sortOrder then creation.
 */
export async function getFloorLayout(businessId: string): Promise<FloorRoomLayout[]> {
  const ctx = await requireMembership(businessId);

  const rooms = await db.floorRoom.findMany({
    where: { businessId: ctx.businessId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      sortOrder: true,
      tables: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          label: true,
          shape: true,
          x: true,
          y: true,
          width: true,
          height: true,
          seats: true,
        },
      },
    },
  });

  return rooms;
}

/** Count of tables for a business — used to enforce the 0–100 cap on the server. */
export async function countTables(businessId: string): Promise<number> {
  return db.floorTable.count({ where: { businessId } });
}
