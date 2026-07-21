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

/**
 * True if a caller with `callerRole` may grant/assign `targetRole` to a member.
 * A caller can never grant a role above their own rank — so a MANAGER can grant
 * CASHIER/MANAGER but NOT OWNER; only an OWNER can grant OWNER. This blocks a
 * MANAGER→OWNER privilege escalation via the member-management actions.
 */
export function canGrantRole(callerRole: Role, targetRole: Role): boolean {
  return ROLE_RANK[targetRole] <= ROLE_RANK[callerRole];
}
