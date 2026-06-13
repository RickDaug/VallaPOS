import "server-only";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@prisma/client";
import { roleAtLeast } from "@/lib/roles";

/**
 * The multi-tenancy choke point.
 *
 * EVERY tenant-owned server action and query MUST start here and then ALWAYS
 * include `where: { businessId }`. A single missing filter is a cross-business
 * data leak. This is the load-bearing invariant of the whole app.
 */

export class AuthError extends Error {}
export class ForbiddenError extends Error {}

export interface TenantContext {
  userId: string;
  businessId: string;
  membershipId: string;
  role: Role;
}

/** Resolve the current session or throw. */
export async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new AuthError("UNAUTHENTICATED");
  return session;
}

/** Confirm the current user is a member of `businessId`; return the scoped context. */
export async function requireMembership(businessId: string): Promise<TenantContext> {
  const session = await requireSession();
  const membership = await db.membership.findUnique({
    where: { userId_businessId: { userId: session.user.id, businessId } },
  });
  if (!membership) throw new ForbiddenError("NOT_A_MEMBER");
  return {
    userId: session.user.id,
    businessId,
    membershipId: membership.id,
    role: membership.role,
  };
}

/** Gate an action by minimum role (e.g. refunds require MANAGER). */
export function assertRole(ctx: TenantContext, min: Role): void {
  if (!roleAtLeast(ctx.role, min)) {
    throw new ForbiddenError(`REQUIRES_${min}`);
  }
}
