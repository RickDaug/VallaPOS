import "server-only";
import { db } from "@/lib/db";
import type { PayType, PayPeriodStatus, AdjustmentKind } from "@prisma/client";

/**
 * Payroll reads. EVERY query is scoped by businessId (the tenant-isolation
 * invariant). Money stays integer cents; nothing here computes tax withholding.
 */

export interface PayRateRow {
  membershipId: string;
  name: string;
  role: string;
  active: boolean;
  hasRate: boolean;
  payType: PayType;
  hourlyCents: number;
  annualCents: number;
  otEnabled: boolean;
  otThresholdMinutes: number | null;
  otMultiplierBps: number | null;
}

/**
 * Every member of the business joined with their pay rate (defaulted when unset)
 * — the roster for the pay-rate editing panel. Tenant-scoped by businessId.
 */
export async function listPayRates(businessId: string): Promise<PayRateRow[]> {
  const members = await db.membership.findMany({
    where: { businessId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      role: true,
      active: true,
      user: { select: { name: true, email: true } },
      payRate: {
        select: {
          payType: true,
          hourlyCents: true,
          annualCents: true,
          otEnabled: true,
          otThresholdMinutes: true,
          otMultiplierBps: true,
        },
      },
    },
  });

  return members.map((m) => ({
    membershipId: m.id,
    name: m.user?.name ?? m.name ?? m.user?.email ?? "Staff",
    role: m.role,
    active: m.active,
    hasRate: m.payRate != null,
    payType: m.payRate?.payType ?? "HOURLY",
    hourlyCents: m.payRate?.hourlyCents ?? 0,
    annualCents: m.payRate?.annualCents ?? 0,
    otEnabled: m.payRate?.otEnabled ?? true,
    otThresholdMinutes: m.payRate?.otThresholdMinutes ?? null,
    otMultiplierBps: m.payRate?.otMultiplierBps ?? null,
  }));
}

export interface PayPeriodRow {
  id: string;
  label: string | null;
  startDate: string; // ISO
  endDate: string; // ISO (exclusive window end)
  status: PayPeriodStatus;
  payslipCount: number;
  grossCents: number;
  netCents: number;
  createdAt: string;
}

/** All pay periods for the business (newest first), with payslip roll-ups. */
export async function listPayPeriods(businessId: string): Promise<PayPeriodRow[]> {
  const periods = await db.payPeriod.findMany({
    where: { businessId },
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      label: true,
      startDate: true,
      endDate: true,
      status: true,
      createdAt: true,
      payslips: { select: { grossCents: true, netCents: true } },
    },
  });

  return periods.map((p) => ({
    id: p.id,
    label: p.label,
    startDate: p.startDate.toISOString(),
    endDate: p.endDate.toISOString(),
    status: p.status,
    payslipCount: p.payslips.length,
    grossCents: p.payslips.reduce((s, x) => s + x.grossCents, 0),
    netCents: p.payslips.reduce((s, x) => s + x.netCents, 0),
    createdAt: p.createdAt.toISOString(),
  }));
}

export interface AdjustmentRow {
  id: string;
  kind: AdjustmentKind;
  label: string;
  amountCents: number;
}

export interface PayslipRow {
  id: string;
  membershipId: string;
  nameSnapshot: string;
  payType: PayType;
  regularMinutes: number;
  overtimeMinutes: number;
  openShiftCount: number;
  hourlyCents: number;
  annualCents: number;
  otMultiplierBps: number;
  regularPayCents: number;
  overtimePayCents: number;
  grossCents: number;
  additionsCents: number;
  deductionsCents: number;
  netCents: number;
  // Payroll-tax provider mirror (docs/PAYROLL_TAX.md). Null unless a provider tax
  // preview has run; the v1 fields above are unaffected. Only shown when the
  // provider withholding path is active for the business.
  providerPayslipId: string | null;
  employeeTaxCents: number | null;
  employerTaxCents: number | null;
  netPayCents: number | null;
  adjustments: AdjustmentRow[];
}

export interface PayPeriodDetail {
  id: string;
  label: string | null;
  startDate: string; // ISO
  endDate: string; // ISO (exclusive)
  status: PayPeriodStatus;
  notes: string | null;
  finalizedAt: string | null;
  paidAt: string | null;
  /** Payroll-tax provider run status mirror (null unless a preview/approve ran). */
  checkPayrollStatus: string | null;
  payslips: PayslipRow[];
  totals: {
    grossCents: number;
    additionsCents: number;
    deductionsCents: number;
    netCents: number;
    /** Provider mirror totals — null when no payslip has provider figures. */
    employeeTaxCents: number | null;
    employerTaxCents: number | null;
    netPayCents: number | null;
  };
}

/** A single pay period with its payslips + adjustment lines. Tenant-scoped. */
export async function getPayPeriodDetail(
  businessId: string,
  payPeriodId: string,
): Promise<PayPeriodDetail | null> {
  const period = await db.payPeriod.findFirst({
    where: { id: payPeriodId, businessId },
    select: {
      id: true,
      label: true,
      startDate: true,
      endDate: true,
      status: true,
      notes: true,
      finalizedAt: true,
      paidAt: true,
      checkPayrollStatus: true,
      payslips: {
        orderBy: { nameSnapshot: "asc" },
        select: {
          id: true,
          membershipId: true,
          nameSnapshot: true,
          payType: true,
          regularMinutes: true,
          overtimeMinutes: true,
          openShiftCount: true,
          hourlyCents: true,
          annualCents: true,
          otMultiplierBps: true,
          regularPayCents: true,
          overtimePayCents: true,
          grossCents: true,
          additionsCents: true,
          deductionsCents: true,
          netCents: true,
          providerPayslipId: true,
          employeeTaxCents: true,
          employerTaxCents: true,
          netPayCents: true,
          adjustments: {
            orderBy: { createdAt: "asc" },
            select: { id: true, kind: true, label: true, amountCents: true },
          },
        },
      },
    },
  });
  if (!period) return null;

  const payslips: PayslipRow[] = period.payslips.map((s) => ({
    id: s.id,
    membershipId: s.membershipId,
    nameSnapshot: s.nameSnapshot,
    payType: s.payType,
    regularMinutes: s.regularMinutes,
    overtimeMinutes: s.overtimeMinutes,
    openShiftCount: s.openShiftCount,
    hourlyCents: s.hourlyCents,
    annualCents: s.annualCents,
    otMultiplierBps: s.otMultiplierBps,
    regularPayCents: s.regularPayCents,
    overtimePayCents: s.overtimePayCents,
    grossCents: s.grossCents,
    additionsCents: s.additionsCents,
    deductionsCents: s.deductionsCents,
    netCents: s.netCents,
    providerPayslipId: s.providerPayslipId,
    employeeTaxCents: s.employeeTaxCents,
    employerTaxCents: s.employerTaxCents,
    netPayCents: s.netPayCents,
    adjustments: s.adjustments,
  }));

  // Provider mirror totals stay null until at least one payslip carries figures,
  // so the v1 display is untouched when the provider path is off.
  const anyProvider = payslips.some((s) => s.netPayCents != null);
  const totals = payslips.reduce(
    (acc, s) => ({
      grossCents: acc.grossCents + s.grossCents,
      additionsCents: acc.additionsCents + s.additionsCents,
      deductionsCents: acc.deductionsCents + s.deductionsCents,
      netCents: acc.netCents + s.netCents,
      employeeTaxCents: anyProvider ? (acc.employeeTaxCents ?? 0) + (s.employeeTaxCents ?? 0) : null,
      employerTaxCents: anyProvider ? (acc.employerTaxCents ?? 0) + (s.employerTaxCents ?? 0) : null,
      netPayCents: anyProvider ? (acc.netPayCents ?? 0) + (s.netPayCents ?? 0) : null,
    }),
    {
      grossCents: 0,
      additionsCents: 0,
      deductionsCents: 0,
      netCents: 0,
      employeeTaxCents: 0 as number | null,
      employerTaxCents: 0 as number | null,
      netPayCents: 0 as number | null,
    },
  );

  return {
    id: period.id,
    label: period.label,
    startDate: period.startDate.toISOString(),
    endDate: period.endDate.toISOString(),
    status: period.status,
    notes: period.notes,
    finalizedAt: period.finalizedAt ? period.finalizedAt.toISOString() : null,
    paidAt: period.paidAt ? period.paidAt.toISOString() : null,
    checkPayrollStatus: period.checkPayrollStatus,
    payslips,
    totals,
  };
}
