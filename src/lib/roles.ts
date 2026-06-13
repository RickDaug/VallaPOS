import type { Role } from "@prisma/client";

/**
 * Pure role-hierarchy logic. Kept free of server-only imports so it can be unit
 * tested and reused on both sides of the wire if needed.
 */
export const ROLE_RANK: Record<Role, number> = {
  CASHIER: 0,
  MANAGER: 1,
  OWNER: 2,
};

/** True if `role` meets or exceeds the `min` required role. */
export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
