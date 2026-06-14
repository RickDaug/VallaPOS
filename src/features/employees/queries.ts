import "server-only";
import { db } from "@/lib/db";
import type { Role } from "@prisma/client";
import { entryDurationSeconds, totalDurationSeconds, type TimeInterval } from "./duration";

/**
 * Employee + time-tracking reads. EVERY query is scoped by businessId (the
 * tenant-isolation invariant). PIN hashes are NEVER selected or returned — only
 * a `hasPin` boolean derived from `pinHash != null`.
 */

export interface MemberRow {
  membershipId: string;
  userId: string;
  name: string | null;
  email: string;
  role: Role;
  active: boolean;
  hasPin: boolean;
  createdAt: string; // ISO
  clockedIn: boolean; // has an open TimeEntry right now
}

/** All members of the business (most senior role first, then newest), scoped by businessId. */
export async function listMembers(businessId: string): Promise<MemberRow[]> {
  const memberships = await db.membership.findMany({
    where: { businessId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      role: true,
      active: true,
      pinHash: true, // used ONLY to derive hasPin; never returned
      createdAt: true,
      user: { select: { name: true, email: true } },
      timeEntries: {
        where: { clockOutAt: null },
        select: { id: true },
        take: 1,
      },
    },
  });

  return memberships.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    active: m.active,
    hasPin: m.pinHash != null,
    createdAt: m.createdAt.toISOString(),
    clockedIn: m.timeEntries.length > 0,
  }));
}

export interface TimeEntryRow {
  id: string;
  membershipId: string;
  memberName: string | null;
  memberEmail: string;
  clockInAt: string; // ISO
  clockOutAt: string | null; // ISO
  durationSeconds: number; // open entries measured to `asOf`
  open: boolean;
}

export interface TimesheetSummary {
  entries: TimeEntryRow[];
  totalDurationSeconds: number;
  asOf: string; // ISO — the moment open entries were measured against
}

/**
 * Time entries that overlap [start, end) for the business (most recent first),
 * scoped by businessId. An entry "overlaps" if it clocked in before `end` and
 * either is still open or clocked out at/after `start`. Durations for open
 * entries are computed to `asOf` (default now) by the pure duration module.
 */
export async function getTimesheet(
  businessId: string,
  start: Date,
  end: Date,
  asOf: Date = new Date(),
): Promise<TimesheetSummary> {
  const entries = await db.timeEntry.findMany({
    where: {
      businessId,
      clockInAt: { lt: end },
      OR: [{ clockOutAt: null }, { clockOutAt: { gte: start } }],
    },
    orderBy: { clockInAt: "desc" },
    select: {
      id: true,
      membershipId: true,
      clockInAt: true,
      clockOutAt: true,
      membership: { select: { user: { select: { name: true, email: true } } } },
    },
  });

  const intervals: TimeInterval[] = entries.map((e) => ({
    clockInAt: e.clockInAt,
    clockOutAt: e.clockOutAt,
  }));

  const rows: TimeEntryRow[] = entries.map((e) => ({
    id: e.id,
    membershipId: e.membershipId,
    memberName: e.membership.user.name,
    memberEmail: e.membership.user.email,
    clockInAt: e.clockInAt.toISOString(),
    clockOutAt: e.clockOutAt ? e.clockOutAt.toISOString() : null,
    durationSeconds: entryDurationSeconds({ clockInAt: e.clockInAt, clockOutAt: e.clockOutAt }, asOf),
    open: e.clockOutAt === null,
  }));

  return {
    entries: rows,
    totalDurationSeconds: totalDurationSeconds(intervals, asOf),
    asOf: asOf.toISOString(),
  };
}

/** Today's timesheet (local-server day boundaries) for the business. */
export async function getTodayTimesheet(businessId: string): Promise<TimesheetSummary> {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return getTimesheet(businessId, start, end, now);
}

/** The current member's own open time entry, if any (for the clock widget). */
export async function getOpenEntryFor(
  businessId: string,
  membershipId: string,
): Promise<{ id: string; clockInAt: string } | null> {
  const entry = await db.timeEntry.findFirst({
    where: { businessId, membershipId, clockOutAt: null },
    orderBy: { clockInAt: "desc" },
    select: { id: true, clockInAt: true },
  });
  return entry ? { id: entry.id, clockInAt: entry.clockInAt.toISOString() } : null;
}
