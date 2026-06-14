import "server-only";
import { db } from "@/lib/db";
import { expectedCash } from "./reconcile";

export interface DrawerSessionRow {
  id: string;
  openedById: string | null;
  openedByName: string | null;
  openingFloatCents: number;
  expectedCents: number | null;
  countedCents: number | null;
  varianceCents: number | null;
  openedAt: string; // ISO
  closedAt: string | null; // ISO
}

function toRow(s: {
  id: string;
  openedById: string | null;
  openingFloatCents: number;
  expectedCents: number | null;
  countedCents: number | null;
  varianceCents: number | null;
  openedAt: Date;
  closedAt: Date | null;
  openedByName?: string | null;
}): DrawerSessionRow {
  return {
    id: s.id,
    openedById: s.openedById,
    openedByName: s.openedByName ?? null,
    openingFloatCents: s.openingFloatCents,
    expectedCents: s.expectedCents,
    countedCents: s.countedCents,
    varianceCents: s.varianceCents,
    openedAt: s.openedAt.toISOString(),
    closedAt: s.closedAt ? s.closedAt.toISOString() : null,
  };
}

/**
 * The single open drawer session for the business (closedAt = null), or null.
 * There is at most one by construction (openDrawer rejects a second open).
 */
export async function getOpenSession(businessId: string): Promise<DrawerSessionRow | null> {
  const session = await db.cashDrawerSession.findFirst({
    where: { businessId, closedAt: null },
    orderBy: { openedAt: "desc" },
  });
  if (!session) return null;
  const openedByName = await resolveOpenerName(businessId, session.openedById);
  return toRow({ ...session, openedByName });
}

/** Recent drawer sessions for the business (most recent first), scoped by businessId. */
export async function listDrawerSessions(
  businessId: string,
  limit = 30,
): Promise<DrawerSessionRow[]> {
  const sessions = await db.cashDrawerSession.findMany({
    where: { businessId },
    orderBy: { openedAt: "desc" },
    take: limit,
  });
  return sessions.map((s) => toRow(s));
}

/**
 * NET cash that moved through the drawer since it opened: the sum of CASH
 * `Payment.amountCents` on this business's orders created in [openedAt, end),
 * counted by ACTUAL payment movements (status-agnostic) so the negative
 * reversing payments written by a cash refund/void are INCLUDED — a cash refund
 * therefore reduces expected drawer cash. This matches the Z-report's
 * `cashCollectedCents` (CASH payment movements, refunds included) exactly, so
 * the drawer and the report never disagree. Scoped tightly by businessId.
 */
export async function getCashCollectedSince(
  businessId: string,
  openedAt: Date,
  end: Date = new Date(),
): Promise<number> {
  const agg = await db.payment.aggregate({
    _sum: { amountCents: true },
    where: {
      businessId,
      method: "CASH",
      // No status filter: a refund's negative CASH payment must net out the
      // drawer. Scope by the ORDER's creation window (same window the Z-report
      // uses), tenant-scoped on both the payment and the order.
      order: { businessId, createdAt: { gte: openedAt, lt: end } },
    },
  });
  return agg._sum.amountCents ?? 0;
}

/**
 * Running expected cash for the OPEN session = opening float + cash collected
 * since it opened. Returns null when there is no open session.
 */
export async function getRunningExpected(businessId: string): Promise<{
  session: DrawerSessionRow;
  cashCollectedCents: number;
  expectedCents: number;
} | null> {
  const session = await getOpenSession(businessId);
  if (!session) return null;
  const cashCollectedCents = await getCashCollectedSince(businessId, new Date(session.openedAt));
  const expectedCents = expectedCash(session.openingFloatCents, cashCollectedCents);
  return { session, cashCollectedCents, expectedCents };
}

export interface DrawerDaySummary {
  closedCount: number;
  openCount: number;
  netVarianceCents: number; // sum of variance across sessions CLOSED in the window
}

/**
 * Drawer variance summary for sessions CLOSED within [start, end), scoped by
 * businessId. Used to surface the day's drawer over/short on the Z-report.
 */
export async function getDrawerDaySummary(
  businessId: string,
  start: Date,
  end: Date,
): Promise<DrawerDaySummary> {
  const [closed, openCount] = await Promise.all([
    db.cashDrawerSession.findMany({
      where: { businessId, closedAt: { gte: start, lt: end } },
      select: { varianceCents: true },
    }),
    db.cashDrawerSession.count({ where: { businessId, closedAt: null } }),
  ]);
  const netVarianceCents = closed.reduce((sum, s) => sum + (s.varianceCents ?? 0), 0);
  return { closedCount: closed.length, openCount, netVarianceCents };
}

/** Resolve the opener's display name (user.name/email) for a Membership id, scoped to the business. */
async function resolveOpenerName(
  businessId: string,
  membershipId: string | null,
): Promise<string | null> {
  if (!membershipId) return null;
  const membership = await db.membership.findFirst({
    where: { id: membershipId, businessId },
    select: { user: { select: { name: true, email: true } } },
  });
  return membership?.user.name ?? membership?.user.email ?? null;
}
