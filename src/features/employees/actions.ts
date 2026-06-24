"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireMembership, assertRole } from "@/lib/tenant";
import { assertNotLocked, recordFailure, recordSuccess } from "@/lib/pin-throttle";
import { defaultCapabilitiesFor, sanitizeCapabilities } from "@/lib/capabilities";
import { setActiveOperator, clearActiveOperator } from "@/lib/operator";
import { hashPin, verifyPin } from "./pin";
import {
  addMemberSchema,
  addStaffMemberSchema,
  updateMemberNameSchema,
  setPermissionsSchema,
  changeRoleSchema,
  setPinSchema,
  clearPinSchema,
  setActiveSchema,
  verifyPinSchema,
  businessScopeSchema,
  clockSchema,
  type AddMemberInput,
  type AddStaffMemberInput,
  type UpdateMemberNameInput,
  type SetPermissionsInput,
  type ChangeRoleInput,
  type SetPinInput,
  type ClearPinInput,
  type SetActiveInput,
  type VerifyPinInput,
  type BusinessScopeInput,
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
    data: {
      userId: user.id,
      businessId: ctx.businessId,
      role: data.role,
      permissions: defaultCapabilitiesFor(data.role),
    },
    select: { id: true },
  });
  revalidateEmployees(ctx.businessId);
  return { membershipId: membership.id };
}

/**
 * Add a PIN-only staff member with NO login account — the common case for hourly
 * workers who just use the till. Creates a Membership with `userId: null`, a
 * display name, a hashed PIN, and role-default capabilities. MANAGER+.
 */
export async function addStaffMember(input: AddStaffMemberInput): Promise<{ membershipId: string }> {
  const data = addStaffMemberSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

  const membership = await db.membership.create({
    data: {
      userId: null,
      name: data.name,
      businessId: ctx.businessId,
      role: data.role,
      permissions: defaultCapabilitiesFor(data.role),
      pinHash: hashPin(data.pin),
    },
    select: { id: true },
  });
  revalidateEmployees(ctx.businessId);
  return { membershipId: membership.id };
}

/** Rename a member (display name). MANAGER+, tenant-scoped. */
export async function updateMemberName(input: UpdateMemberNameInput): Promise<void> {
  const data = updateMemberNameSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "MANAGER");

  await db.membership.updateMany({
    where: { id: data.membershipId, businessId: ctx.businessId },
    data: { name: data.name },
  });
  revalidateEmployees(ctx.businessId);
}

/**
 * Set a member's granular capability grants. OWNER-only (so a manager can't
 * escalate their own/others' access). Unknown keys are dropped. An OWNER target's
 * grants are cosmetic (OWNER is all-access in code) but stored for consistency.
 */
export async function setMemberPermissions(input: SetPermissionsInput): Promise<void> {
  const data = setPermissionsSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  assertRole(ctx, "OWNER");

  const target = await db.membership.findFirst({
    where: { id: data.membershipId, businessId: ctx.businessId },
    select: { id: true },
  });
  if (!target) throw new Error("Member not found.");

  await db.membership.updateMany({
    where: { id: target.id, businessId: ctx.businessId },
    data: { permissions: sanitizeCapabilities(data.permissions) },
  });
  revalidateEmployees(ctx.businessId);
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
 *
 * This action sits OUTSIDE Better Auth's rate limiter, so it's throttled here
 * per (businessId, membershipId): too many consecutive failed guesses lock the
 * target for a cool-down. A locked target returns the same `{ valid: false }` as
 * a wrong PIN so a brute-forcer can't tell lockout from a miss.
 */
export async function verifyMemberPin(input: VerifyPinInput): Promise<{ valid: boolean }> {
  const data = verifyPinSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  // Any member may verify a PIN (it's the gate for switching the active cashier).
  assertRole(ctx, "CASHIER");

  try {
    await assertNotLocked(ctx.businessId, data.membershipId);
  } catch {
    return { valid: false };
  }

  const target = await db.membership.findFirst({
    where: { id: data.membershipId, businessId: ctx.businessId, active: true },
    select: { pinHash: true },
  });
  if (!target) return { valid: false };

  const valid = verifyPin(data.pin, target.pinHash);
  if (valid) await recordSuccess(ctx.businessId, data.membershipId);
  else await recordFailure(ctx.businessId, data.membershipId);
  return { valid };
}

/**
 * Become the active operator on this device by entering a member's PIN. Same
 * throttled, constant-time verification as verifyMemberPin; on success it sets
 * the signed operator cookie (src/lib/operator.ts). Returns only a boolean — a
 * wrong PIN, a locked target, and an inactive/unknown member all look identical.
 */
export async function enterOperatorPin(input: VerifyPinInput): Promise<{ ok: boolean }> {
  const data = verifyPinSchema.parse(input);
  const ctx = await requireMembership(data.businessId); // device must belong to the business

  try {
    await assertNotLocked(ctx.businessId, data.membershipId);
  } catch {
    return { ok: false };
  }

  const target = await db.membership.findFirst({
    where: { id: data.membershipId, businessId: ctx.businessId, active: true },
    select: { pinHash: true },
  });
  if (!target) return { ok: false };

  const valid = verifyPin(data.pin, target.pinHash);
  if (!valid) {
    await recordFailure(ctx.businessId, data.membershipId);
    return { ok: false };
  }
  await recordSuccess(ctx.businessId, data.membershipId);
  await setActiveOperator(ctx.businessId, data.membershipId);
  return { ok: true };
}

/**
 * Bootstrap path: the signed-in device user becomes the active operator WITHOUT
 * a PIN — allowed ONLY when their own membership has no PIN set (e.g. a fresh
 * owner). Once they set a PIN they must enter it like everyone else (closing the
 * "anyone at the device acts as the owner" hole on a shared terminal).
 */
export async function becomeSelfOperator(input: BusinessScopeInput): Promise<{ ok: boolean; needsPin?: boolean }> {
  const data = businessScopeSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  const me = await db.membership.findFirst({
    where: { id: ctx.membershipId, businessId: ctx.businessId, active: true },
    select: { pinHash: true },
  });
  if (!me) return { ok: false };
  if (me.pinHash) return { ok: false, needsPin: true };
  await setActiveOperator(ctx.businessId, ctx.membershipId);
  return { ok: true };
}

/** Lock the device (clear the active operator). */
export async function lockOperator(input: BusinessScopeInput): Promise<void> {
  const data = businessScopeSchema.parse(input);
  const ctx = await requireMembership(data.businessId);
  await clearActiveOperator(ctx.businessId);
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
