import "server-only";
import { headers } from "next/headers";
import { auth, type Session } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@prisma/client";
import { roleAtLeast } from "@/lib/roles";
import { authMode, LOCAL_BUSINESS_ID, LOCAL_USER_ID } from "@/lib/edition";

/**
 * The multi-tenancy choke point.
 *
 * EVERY tenant-owned server action and query MUST start here and then ALWAYS
 * include `where: { businessId }`. A single missing filter is a cross-business
 * data leak. This is the load-bearing invariant of the whole app.
 *
 * EDITION BRANCH (docs/EDITIONS.md §4): the LOCAL (offline desktop) edition has no
 * Better Auth and no multi-tenant DB — it's a single-operator install. When
 * `authMode === "pin-only"` these resolve to a FIXED local context WITHOUT calling
 * `auth`/`db`, so the shared cash-path code runs unchanged while the in-app PIN
 * lock (src/lib/operator.ts / Stage 5) is the real gate. The cloud path (the
 * default) is byte-for-byte unchanged. (Tree-shaking `auth`/`db` out of the local
 * BUILD is a Stage 5 bundling concern; here they simply aren't CALLED when local.)
 */

export class AuthError extends Error {}
export class ForbiddenError extends Error {}

export interface TenantContext {
  userId: string;
  businessId: string;
  membershipId: string;
  role: Role;
}

// The single fixed operator on a local install: full-access OWNER, single tenant.
const LOCAL_CONTEXT: TenantContext = {
  userId: LOCAL_USER_ID,
  businessId: LOCAL_BUSINESS_ID,
  membershipId: LOCAL_USER_ID,
  role: "OWNER",
};

/** Resolve the current session or throw. */
export async function requireSession() {
  // LOCAL: return a minimal fixed session (only `user.id` is read by shared code);
  // the cloud-only auth/payments flows that call this are compiled off in local.
  if (authMode === "pin-only") {
    return { user: { id: LOCAL_USER_ID } } as unknown as Session;
  }
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new AuthError("UNAUTHENTICATED");
  return session;
}

/** Confirm the current user is a member of `businessId`; return the scoped context. */
export async function requireMembership(businessId: string): Promise<TenantContext> {
  // LOCAL: single-operator install — no membership lookup; return the fixed
  // context scoped to the caller's businessId (always LOCAL_BUSINESS_ID in local).
  if (authMode === "pin-only") {
    return { ...LOCAL_CONTEXT, businessId };
  }
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
