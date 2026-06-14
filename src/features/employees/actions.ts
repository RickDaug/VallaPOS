"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireMembership, assertRole } from "@/lib/tenant";
import { hashPin, verifyPin } from "./pin";
import {
  addMemberSchema,
  changeRoleSchema,
  setPinSchema,
  clearPinSchema,
  setActiveSchema,
  verifyPinSchema,
  clockSchema,
  type AddMemberInput,
  type ChangeRoleInput,
  type SetPinInput,
  type ClearPinInput,
  type SetActiveInput,
  type VerifyPinInput,
  type ClockInput,
} from "./schema";

/**
 * Employee management + PIN + clock-in/out writes.
 *
 * Role gating:
 *  - Manage members (add / change role / set-reset PIN / deactivate): MANAGER+.
 *    These are administrative controls, not cashier self-service.
 *  - Verify a PIN / clock in / clock out: any active member (CASHIER+). These are
 *    shift operations every employee performs, but always for THEIR OWN
 *    membership (the action derives the membership from the caller, never trusts
 *    a client-sent id for self-targeting actions).
 *
 * SECURITY: a plaintext PIN is only ever passed to `hashPin`/`verifyPin`. It is
 * never logged, never returned, and never persisted — only the salted `pinHash`.
 */

function revalidateEmployees(businessId: string) {
  revalidatePath(`/${businessId}/employees`);
}

/**
 * Add an EXISTING user (by email) to this business as a member. We do NOT create
 * brand-new auth users here — that requires a password and goes through Better
 * Auth sign-up. If the email has no user account, the action reports it so the
 * UI can tell the manager the person must sign up first. Idempotent-ish: a
 * duplicate membership is rejected by the (userId, businessId) unique key.
 */
export async function addMember(
  input: AddMemberInput,
): Promise<{ membershipId: string } | { error: "no_such_user" | "already_member" }> {
  const data = addMemberSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

  const user = await db.user.findUnique({ where: { email: data.email }, select: { id: true } });
  if (!user) return { error: "no_such_user" };

  const existing = await db.membership.findUnique({
    where: { userId_businessId: { userId: user.id, businessId: ctx.businessId } },
    select: { id: true },
  });
  if (existing) return { error: "already_member" };

  const membership = await db.membership.create({
    data: { userId: user.id, businessId: ctx.businessId, role: data.role },
    select: { id: true },
  });
  revalidateEmployees(ctx.businessId);
  return { membershipId: membership.id };
}

/**
 * Change a member's role. Scoped by businessId. Guards against the last OWNER
 * being demoted (a business must always have at least one owner) so an admin
 * can't accidentally lock everyone out of owner-only controls.
 */
export async function changeMemberRole(input: ChangeRoleInput): Promise<void> {
  const data = changeRoleSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

  const target = await db.membership.findFirst({
    where: { id: data.membershipId, businessId: ctx.businessId },
    select: { id: true, role: true },
  });
  if (!target) throw new Error("Member not found.");

  if (target.role === "OWNER" && data.role !== "OWNER") {
    const owners = await db.membership.count({
      where: { businessId: ctx.businessId, role: "OWNER" },
    });
    if (owners <= 1) throw new Error("A business must have at least one owner.");
  }

  await db.membership.updateMany({
    where: { id: target.id, businessId: ctx.businessId },
    data: { role: data.role },
  });
  revalidateEmployees(ctx.businessId);
}

/** Set or reset a member's PIN. Stores only the salted hash; never the PIN. */
export async function setMemberPin(input: SetPinInput): Promise<void> {
  const data = setPinSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

  const target = await db.membership.findFirst({
    where: { id: data.membershipId, businessId: ctx.businessId },
    select: { id: true },
  });
  if (!target) throw new Error("Member not found.");

  const pinHash = hashPin(data.pin);
  await db.membership.updateMany({
    where: { id: target.id, businessId: ctx.businessId },
    data: { pinHash },
  });
  revalidateEmployees(ctx.businessId);
}

/** Clear a member's PIN (they can no longer unlock on a shared device). */
export async function clearMemberPin(input: ClearPinInput): Promise<void> {
  const data = clearPinSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

  await db.membership.updateMany({
    where: { id: data.membershipId, businessId: ctx.businessId },
    data: { pinHash: null },
  });
  revalidateEmployees(ctx.businessId);
}

/**
 * Activate / deactivate a member. A deactivated member keeps their history (and
 * time entries) but is flagged inactive. Guards against deactivating the last
 * active OWNER. The membership row itself is never deleted here.
 */
export async function setMemberActive(input: SetActiveInput): Promise<void> {
  const data = setActiveSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

  const target = await db.membership.findFirst({
    where: { id: data.membershipId, businessId: ctx.businessId },
    select: { id: true, role: true, active: true },
  });
  if (!target) throw new Error("Member not found.");

  if (!data.active && target.role === "OWNER" && target.active) {
    const activeOwners = await db.membership.count({
      where: { businessId: ctx.businessId, role: "OWNER", active: true },
    });
    if (activeOwners <= 1) throw new Error("A business must have at least one active owner.");
  }

  await db.membership.updateMany({
    where: { id: target.id, businessId: ctx.businessId },
    data: { active: data.active },
  });
  revalidateEmployees(ctx.businessId);
}

/**
 * Verify a PIN for a membership (for a future cashier-switch / clock flow).
 * Returns only a boolean — never the hash, never which step failed in a way that
 * leaks the stored value. Scoped by businessId; an inactive member fails.
 */
export async function verifyMemberPin(input: VerifyPinInput): Promise<{ valid: boolean }> {
  const data = verifyPinSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  // Any member may verify a PIN (it's the gate for switching the active cashier).
  assertRole(ctx, "CASHIER");

  const target = await db.membership.findFirst({
    where: { id: data.membershipId, businessId: ctx.businessId, active: true },
    select: { pinHash: true },
  });
  if (!target) return { valid: false };
  return { valid: verifyPin(data.pin, target.pinHash) };
}

/**
 * Clock IN: open a TimeEntry for the CALLER's own membership. Rejects if an open
 * entry already exists (one active shift at a time). businessId-scoped.
 */
export async function clockIn(input: ClockInput): Promise<{ entryId: string }> {
  const data = clockSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "CASHIER");

  // Self-service: a member clocks IN their own membership. We trust the
  // membership from the tenant context, not a client-sent id.
  const membershipId = ctx.membershipId;

  const open = await db.timeEntry.findFirst({
    where: { businessId: ctx.businessId, membershipId, clockOutAt: null },
    select: { id: true },
  });
  if (open) throw new Error("You are already clocked in.");

  const entry = await db.timeEntry.create({
    data: { businessId: ctx.businessId, membershipId },
    select: { id: true },
  });
  revalidatePath(`/${ctx.businessId}/employees`);
  return { entryId: entry.id };
}

/**
 * Clock OUT: close the caller's open TimeEntry. The updateMany is scoped by
 * businessId + membershipId + clockOutAt:null so a concurrent clock-out can't
 * double-close (the loser updates 0 rows).
 */
export async function clockOut(input: ClockInput): Promise<{ closed: boolean }> {
  const data = clockSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "CASHIER");

  const membershipId = ctx.membershipId;
  const result = await db.timeEntry.updateMany({
    where: { businessId: ctx.businessId, membershipId, clockOutAt: null },
    data: { clockOutAt: new Date() },
  });
  if (result.count === 0) throw new Error("You are not clocked in.");

  revalidatePath(`/${ctx.businessId}/employees`);
  return { closed: true };
}
