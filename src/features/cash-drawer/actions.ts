"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireMembership, assertRole } from "@/lib/tenant";
import { getCashCollectedSince } from "./queries";
import { reconcile } from "./reconcile";
import {
  openDrawerSchema,
  closeDrawerSchema,
  type OpenDrawerInput,
  type CloseDrawerInput,
} from "./schema";

/**
 * Role gating:
 *  - OPEN a drawer: any member (CASHIER+). A cashier starting a shift needs to
 *    set the opening float without a manager present.
 *  - CLOSE / reconcile: MANAGER+. Counting down the till and accepting a
 *    variance (over/short) is a manager responsibility — it's the control point
 *    that detects loss, so it shouldn't be self-service for the cashier.
 */

export interface OpenDrawerResult {
  sessionId: string;
  openingFloatCents: number;
  openedAt: string;
}

export interface CloseDrawerResult {
  sessionId: string;
  openingFloatCents: number;
  expectedCents: number;
  countedCents: number;
  varianceCents: number;
  closedAt: string;
}

/** Open a new drawer session. Rejects if one is already open for the business. */
export async function openDrawer(input: OpenDrawerInput): Promise<OpenDrawerResult> {
  const data = openDrawerSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "CASHIER"); // any member may open a drawer

  const existing = await db.cashDrawerSession.findFirst({
    where: { businessId: ctx.businessId, closedAt: null },
    select: { id: true },
  });
  if (existing) throw new Error("A drawer session is already open.");

  const session = await db.cashDrawerSession.create({
    data: {
      businessId: ctx.businessId,
      openedById: ctx.membershipId,
      openingFloatCents: data.openingFloatCents,
    },
    select: { id: true, openingFloatCents: true, openedAt: true },
  });

  revalidatePath(`/${ctx.businessId}/drawer`);
  return {
    sessionId: session.id,
    openingFloatCents: session.openingFloatCents,
    openedAt: session.openedAt.toISOString(),
  };
}

/**
 * Close the open drawer session and reconcile. Loads the session scoped by
 * businessId + id + closedAt:null (a closed or foreign session won't load),
 * computes expected = opening float + cash collected in [openedAt, now),
 * variance = counted − expected, and stamps closedAt.
 *
 * Blind count: the cashier/manager enters `countedCents` BEFORE seeing the
 * expected figure; the server computes expected/variance and returns them only
 * after the count is committed, so the count can't be anchored to the expected.
 */
export async function closeDrawer(input: CloseDrawerInput): Promise<CloseDrawerResult> {
  const data = closeDrawerSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER"); // reconciling a drawer is a manager control point

  const session = await db.cashDrawerSession.findFirst({
    where: { id: data.sessionId, businessId: ctx.businessId, closedAt: null },
    select: { id: true, openingFloatCents: true, openedAt: true },
  });
  if (!session) throw new Error("No matching open drawer session.");

  const closedAt = new Date();
  const cashCollectedCents = await getCashCollectedSince(
    ctx.businessId,
    session.openedAt,
    closedAt,
  );
  const { expectedCents, varianceCents } = reconcile(
    session.openingFloatCents,
    cashCollectedCents,
    data.countedCents,
  );

  // Re-scope the update by businessId + closedAt:null so a concurrent close
  // can't double-close (updateMany returns 0 rows on the loser).
  const result = await db.cashDrawerSession.updateMany({
    where: { id: session.id, businessId: ctx.businessId, closedAt: null },
    data: {
      expectedCents,
      countedCents: data.countedCents,
      varianceCents,
      closedAt,
    },
  });
  if (result.count === 0) throw new Error("Drawer session was already closed.");

  revalidatePath(`/${ctx.businessId}/drawer`);
  revalidatePath(`/${ctx.businessId}/reports`);
  return {
    sessionId: session.id,
    openingFloatCents: session.openingFloatCents,
    expectedCents,
    countedCents: data.countedCents,
    varianceCents,
    closedAt: closedAt.toISOString(),
  };
}
