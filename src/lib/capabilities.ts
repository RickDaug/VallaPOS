import type { Role } from "@prisma/client";

/**
 * Granular per-member capabilities. Each key gates a surface that is otherwise
 * role-gated. Stored on `Membership.permissions` (string[]). OWNER is implicitly
 * all-access (so the "≥1 owner" guards can't be defeated by clearing perms);
 * for non-owners a capability is granted iff it's listed in their permissions.
 *
 * Pure module (no server-only/Prisma runtime) so it's unit-testable and usable
 * on the client for showing/hiding controls. The SERVER still enforces via
 * requireCapability — the client list is for UX only.
 */

export const CAPABILITIES = [
  "take_orders",
  "refund_void",
  "manage_products",
  "view_reports",
  "cash_drawer",
  "manage_team",
  "manage_settings",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  take_orders: "Take orders",
  refund_void: "Refunds & voids",
  manage_products: "Manage products & floor",
  view_reports: "View reports",
  cash_drawer: "Cash drawer",
  manage_team: "Manage team",
  manage_settings: "Business settings",
};

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/** Keep only valid capability keys (deduped) — used when accepting client input. */
export function sanitizeCapabilities(values: string[]): Capability[] {
  return [...new Set(values.filter(isCapability))];
}

/**
 * Default capability grants seeded on member creation (and backfilled in the
 * pin_staff_permissions migration). OWNER is omitted — it's all-access in code.
 * MANAGER gets everything; CASHIER mirrors today's looser gates.
 */
export const ROLE_DEFAULT_CAPABILITIES: Record<Role, Capability[]> = {
  OWNER: [...CAPABILITIES],
  MANAGER: [...CAPABILITIES],
  CASHIER: ["take_orders", "cash_drawer", "view_reports"],
};

export function defaultCapabilitiesFor(role: Role): Capability[] {
  return [...ROLE_DEFAULT_CAPABILITIES[role]];
}

/**
 * The authorization check. OWNER always passes; otherwise the capability must be
 * in the member's granted permissions.
 */
export function can(role: Role, permissions: string[], cap: Capability): boolean {
  return role === "OWNER" || permissions.includes(cap);
}
