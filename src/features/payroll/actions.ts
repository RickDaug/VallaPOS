"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/operator-guard";
import { zonedDayStartUtc, addDaysToDateStr } from "@/features/orders/report-aggregate";
import {
  computePayslip,
  overtimeRuleFrom,
  sumAdjustments,
  type AdjustmentLine,
  type TimeInterval,
} from "./calc";
import {
  setPayRateSchema,
  createPayPeriodSchema,
  payPeriodScopeSchema,
  addAdjustmentSchema,
  removeAdjustmentSchema,
  type SetPayRateInput,
  type CreatePayPeriodInput,
  type PayPeriodScopeInput,
  type AddAdjustmentInput,
  type RemoveAdjustmentInput,
} from "./schema";

/**
 * Payroll writes. Every action is gated by the `manage_payroll` capability (OWNER
 * + MANAGER by default) and tenant-scoped by businessId. Money is integer cents.
 *
 * HARD BOUNDARY: these actions RECORD gross / adjustments / net. They do NOT
 * compute statutory tax withholding, FICA, or filings (see docs/PAYROLL.md).
 */

function revalidatePayroll(businessId: string, payPeriodId?: string) {
  revalidatePath(`/${businessId}/payroll`);
  if (payPeriodId) revalidatePath(`/${businessId}/payroll/${payPeriodId}`);
}

/** Resolve a member's display name (account name → membership name → email → "Staff"). */
function resolveName(m: {
  name: string | null;
  user: { name: string | null; email: string } | null;
}): string {
  return m.user?.name ?? m.name ?? m.user?.email ?? "Staff";
}

// ─────────────────────────────────────────────────────────────────────────────
// Pay rates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set (create or update) a worker's pay rate. One rate per membership. Verifies
 * the membership belongs to this business, then upserts. HOURLY zeroes annual and
 * vice-versa so a switched pay type can't leave stale numbers behind.
 */
export async function setPayRate(input: SetPayRateInput): Promise<{ ok: true }> {
  const data = setPayRateSchema.parse(input);
  await requireCapability(data.businessId, "manage_payroll");

  const member = await db.membership.findFirst({
    where: { id: data.membershipId, businessId: data.businessId },
    select: { id: true },
  });
  if (!member) throw new Error("Member not found.");

  const hourlyCents = data.payType === "HOURLY" ? data.hourlyCents : 0;
  const annualCents = data.payType === "SALARY" ? data.annualCents : 0;

  await db.payRate.upsert({
    where: { membershipId: data.membershipId },
    create: {
      businessId: data.businessId,
      membershipId: data.membershipId,
      payType: data.payType,
      hourlyCents,
      annualCents,
      otEnabled: data.otEnabled,
      otThresholdMinutes: data.otThresholdMinutes,
      otMultiplierBps: data.otMultiplierBps,
    },
    update: {
      payType: data.payType,
      hourlyCents,
      annualCents,
      otEnabled: data.otEnabled,
      otThresholdMinutes: data.otThresholdMinutes,
      otMultiplierBps: data.otMultiplierBps,
    },
  });

  revalidatePayroll(data.businessId);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pay periods
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a DRAFT pay period. The YYYY-MM-DD start/end days are interpreted in the
 * BUSINESS timezone and stored as UTC instants: startDate = local midnight of the
 * start day; endDate = local midnight of the day AFTER the end day (so the window
 * [startDate, endDate) is inclusive of the whole end day) — the same day-window
 * convention the Z-report uses.
 */
export async function createPayPeriod(
  input: CreatePayPeriodInput,
): Promise<{ payPeriodId: string }> {
  const data = createPayPeriodSchema.parse(input);
  await requireCapability(data.businessId, "manage_payroll");

  const business = await db.business.findUnique({
    where: { id: data.businessId },
    select: { timezone: true },
  });
  if (!business) throw new Error("Business not found.");

  const start = zonedDayStartUtc(data.startDate, business.timezone);
  const end = zonedDayStartUtc(addDaysToDateStr(data.endDate, 1), business.timezone);

  const period = await db.payPeriod.create({
    data: {
      businessId: data.businessId,
      label: data.label,
      startDate: start,
      endDate: end,
      notes: data.notes,
      status: "DRAFT",
    },
    select: { id: true },
  });

  revalidatePayroll(data.businessId);
  return { payPeriodId: period.id };
}

/**
 * Compute (or recompute) the payslips of a DRAFT period from TimeEntry.
 *
 * For each ACTIVE member with a pay rate, it pulls their shifts overlapping the
 * window, splits regular/overtime hours (weekly rule), computes gross, and
 * upserts a payslip. Existing MANUAL ADJUSTMENT lines are PRESERVED across a
 * recompute (only hours/gross are recalculated; net re-sums the kept
 * adjustments). Members with no pay rate are skipped (nothing to pay). Only
 * allowed while DRAFT — finalize to lock.
 */
export async function computePayPeriod(
  input: PayPeriodScopeInput,
): Promise<{ payslipCount: number }> {
  const data = payPeriodScopeSchema.parse(input);
  await requireCapability(data.businessId, "manage_payroll");

  const period = await db.payPeriod.findFirst({
    where: { id: data.payPeriodId, businessId: data.businessId },
    select: { id: true, startDate: true, endDate: true, status: true },
  });
  if (!period) throw new Error("Pay period not found.");
  if (period.status !== "DRAFT") {
    throw new Error("Only a draft pay period can be computed. Reopen it first.");
  }

  const window = { start: period.startDate, end: period.endDate };
  const asOf = new Date();

  // Active members with a pay rate — the workers this run pays.
  const rates = await db.payRate.findMany({
    where: { businessId: data.businessId, membership: { active: true } },
    select: {
      membershipId: true,
      payType: true,
      hourlyCents: true,
      annualCents: true,
      otEnabled: true,
      otThresholdMinutes: true,
      otMultiplierBps: true,
      membership: { select: { name: true, user: { select: { name: true, email: true } } } },
    },
  });

  // All shifts overlapping the window, grouped by member (one query, grouped in JS).
  const entries = await db.timeEntry.findMany({
    where: {
      businessId: data.businessId,
      clockInAt: { lt: window.end },
      OR: [{ clockOutAt: null }, { clockOutAt: { gte: window.start } }],
    },
    select: { membershipId: true, clockInAt: true, clockOutAt: true },
  });
  const byMember = new Map<string, TimeInterval[]>();
  for (const e of entries) {
    const list = byMember.get(e.membershipId) ?? [];
    list.push({ clockInAt: e.clockInAt, clockOutAt: e.clockOutAt });
    byMember.set(e.membershipId, list);
  }

  // Preserve manual adjustments across recompute: map membershipId → its lines.
  const existing = await db.payslip.findMany({
    where: { businessId: data.businessId, payPeriodId: period.id },
    select: {
      membershipId: true,
      adjustments: { select: { kind: true, amountCents: true } },
    },
  });
  const keptAdjustments = new Map<string, AdjustmentLine[]>();
  for (const slip of existing) {
    keptAdjustments.set(
      slip.membershipId,
      slip.adjustments.map((a) => ({ kind: a.kind, amountCents: a.amountCents })),
    );
  }

  await db.$transaction(async (tx) => {
    for (const rate of rates) {
      const adjustments = keptAdjustments.get(rate.membershipId) ?? [];
      const comp = computePayslip({
        payType: rate.payType,
        entries: byMember.get(rate.membershipId) ?? [],
        window,
        hourlyCents: rate.hourlyCents,
        annualCents: rate.annualCents,
        overtime: overtimeRuleFrom(rate),
        adjustments,
        asOf,
      });
      const nameSnapshot = resolveName(rate.membership);

      const slipData = {
        nameSnapshot,
        payType: comp.payType,
        regularMinutes: comp.regularMinutes,
        overtimeMinutes: comp.overtimeMinutes,
        openShiftCount: comp.openShiftCount,
        hourlyCents: comp.hourlyCents,
        annualCents: comp.annualCents,
        otMultiplierBps: comp.otMultiplierBps,
        regularPayCents: comp.regularPayCents,
        overtimePayCents: comp.overtimePayCents,
        grossCents: comp.grossCents,
        additionsCents: comp.additionsCents,
        deductionsCents: comp.deductionsCents,
        netCents: comp.netCents,
      };

      await tx.payslip.upsert({
        where: {
          payPeriodId_membershipId: {
            payPeriodId: period.id,
            membershipId: rate.membershipId,
          },
        },
        create: {
          businessId: data.businessId,
          payPeriodId: period.id,
          membershipId: rate.membershipId,
          ...slipData,
        },
        update: slipData,
      });
    }
  });

  revalidatePayroll(data.businessId, period.id);
  return { payslipCount: rates.length };
}

/** Re-sum a payslip's stored adjustments into additions/deductions/net (net = gross + add − ded). */
async function recomputeSlipNet(
  tx: Prisma.TransactionClient,
  businessId: string,
  payslipId: string,
): Promise<void> {
  const slip = await tx.payslip.findFirst({
    where: { id: payslipId, businessId },
    select: {
      grossCents: true,
      adjustments: { select: { kind: true, amountCents: true } },
    },
  });
  if (!slip) return;
  const { additionsCents, deductionsCents } = sumAdjustments(
    slip.adjustments.map((a) => ({ kind: a.kind, amountCents: a.amountCents })),
  );
  await tx.payslip.updateMany({
    where: { id: payslipId, businessId },
    data: {
      additionsCents,
      deductionsCents,
      netCents: slip.grossCents + additionsCents - deductionsCents,
    },
  });
}

/**
 * Finalize a DRAFT pay period → FINALIZED (locks it for review/export). Requires
 * at least one payslip so an empty run can't be finalized by accident.
 */
export async function finalizePayPeriod(input: PayPeriodScopeInput): Promise<{ ok: true }> {
  const data = payPeriodScopeSchema.parse(input);
  await requireCapability(data.businessId, "manage_payroll");

  const period = await db.payPeriod.findFirst({
    where: { id: data.payPeriodId, businessId: data.businessId },
    select: { id: true, status: true, _count: { select: { payslips: true } } },
  });
  if (!period) throw new Error("Pay period not found.");
  if (period.status !== "DRAFT") throw new Error("Only a draft period can be finalized.");
  if (period._count.payslips === 0) throw new Error("Compute payslips before finalizing.");

  await db.payPeriod.updateMany({
    where: { id: period.id, businessId: data.businessId, status: "DRAFT" },
    data: { status: "FINALIZED", finalizedAt: new Date() },
  });

  revalidatePayroll(data.businessId, period.id);
  return { ok: true };
}

/** Reopen a FINALIZED period back to DRAFT so hours/adjustments can be changed. */
export async function reopenPayPeriod(input: PayPeriodScopeInput): Promise<{ ok: true }> {
  const data = payPeriodScopeSchema.parse(input);
  await requireCapability(data.businessId, "manage_payroll");

  const period = await db.payPeriod.findFirst({
    where: { id: data.payPeriodId, businessId: data.businessId },
    select: { id: true, status: true },
  });
  if (!period) throw new Error("Pay period not found.");
  if (period.status !== "FINALIZED") throw new Error("Only a finalized period can be reopened.");

  await db.payPeriod.updateMany({
    where: { id: period.id, businessId: data.businessId, status: "FINALIZED" },
    data: { status: "DRAFT", finalizedAt: null },
  });

  revalidatePayroll(data.businessId, period.id);
  return { ok: true };
}

/** Mark a FINALIZED period as PAID (records paidAt). Terminal state. */
export async function markPayPeriodPaid(input: PayPeriodScopeInput): Promise<{ ok: true }> {
  const data = payPeriodScopeSchema.parse(input);
  await requireCapability(data.businessId, "manage_payroll");

  const period = await db.payPeriod.findFirst({
    where: { id: data.payPeriodId, businessId: data.businessId },
    select: { id: true, status: true },
  });
  if (!period) throw new Error("Pay period not found.");
  if (period.status !== "FINALIZED") {
    throw new Error("Finalize the period before marking it paid.");
  }

  await db.payPeriod.updateMany({
    where: { id: period.id, businessId: data.businessId, status: "FINALIZED" },
    data: { status: "PAID", paidAt: new Date() },
  });

  revalidatePayroll(data.businessId, period.id);
  return { ok: true };
}

/** Delete a DRAFT pay period (cascades its payslips + adjustments). DRAFT only. */
export async function deletePayPeriod(input: PayPeriodScopeInput): Promise<{ ok: true }> {
  const data = payPeriodScopeSchema.parse(input);
  await requireCapability(data.businessId, "manage_payroll");

  const period = await db.payPeriod.findFirst({
    where: { id: data.payPeriodId, businessId: data.businessId },
    select: { id: true, status: true },
  });
  if (!period) throw new Error("Pay period not found.");
  if (period.status !== "DRAFT") throw new Error("Only a draft period can be deleted.");

  await db.payPeriod.deleteMany({ where: { id: period.id, businessId: data.businessId } });

  revalidatePayroll(data.businessId);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Adjustments
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add a manual adjustment line (bonus/reimbursement = ADDITION; advance/deduction
 * = DEDUCTION) to a payslip, then re-sum the payslip's net. Only while the parent
 * period is DRAFT (a finalized run is locked).
 */
export async function addAdjustment(input: AddAdjustmentInput): Promise<{ adjustmentId: string }> {
  const data = addAdjustmentSchema.parse(input);
  await requireCapability(data.businessId, "manage_payroll");

  const slip = await db.payslip.findFirst({
    where: { id: data.payslipId, businessId: data.businessId },
    select: { id: true, payPeriodId: true, payPeriod: { select: { status: true } } },
  });
  if (!slip) throw new Error("Payslip not found.");
  if (slip.payPeriod.status !== "DRAFT") {
    throw new Error("Reopen the pay period to edit adjustments.");
  }

  const adjustmentId = await db.$transaction(async (tx) => {
    const created = await tx.payslipAdjustment.create({
      data: {
        businessId: data.businessId,
        payslipId: slip.id,
        kind: data.kind,
        label: data.label,
        amountCents: data.amountCents,
      },
      select: { id: true },
    });
    await recomputeSlipNet(tx, data.businessId, slip.id);
    return created.id;
  });

  revalidatePayroll(data.businessId, slip.payPeriodId);
  return { adjustmentId };
}

/** Remove a manual adjustment line, then re-sum net. Only while the period is DRAFT. */
export async function removeAdjustment(input: RemoveAdjustmentInput): Promise<{ ok: true }> {
  const data = removeAdjustmentSchema.parse(input);
  await requireCapability(data.businessId, "manage_payroll");

  const adjustment = await db.payslipAdjustment.findFirst({
    where: { id: data.adjustmentId, businessId: data.businessId },
    select: {
      id: true,
      payslipId: true,
      payslip: { select: { payPeriodId: true, payPeriod: { select: { status: true } } } },
    },
  });
  if (!adjustment) throw new Error("Adjustment not found.");
  if (adjustment.payslip.payPeriod.status !== "DRAFT") {
    throw new Error("Reopen the pay period to edit adjustments.");
  }

  await db.$transaction(async (tx) => {
    await tx.payslipAdjustment.deleteMany({
      where: { id: adjustment.id, businessId: data.businessId },
    });
    await recomputeSlipNet(tx, data.businessId, adjustment.payslipId);
  });

  revalidatePayroll(data.businessId, adjustment.payslip.payPeriodId);
  return { ok: true };
}
