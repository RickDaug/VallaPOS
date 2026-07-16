/**
 * PURE mapping helpers between our payslips and the provider's payroll payload
 * (no `server-only`/Prisma), so the fiddly translation is unit-tested in isolation
 * — mirrors how connect-webhook.ts isolates its shape parsing.
 *
 * One direction: payslip → provider payroll LINE (skip workers not synced to the
 * provider). The other: provider preview RESULT → payslip mirror figures, matched
 * by the provider employee id.
 */

import type { PayrollLineInput, PayrollPreview } from "./gateway";

/** The minimal payslip view the tax pipeline needs. */
export interface PayslipTaxSource {
  payslipId: string;
  /** Provider employee id (Membership.checkEmployeeId); null = not synced. */
  checkEmployeeId: string | null;
  /** Pre-tax gross the provider withholds against (integer cents). */
  grossCents: number;
}

/** The provider-sourced mirror figures to persist onto ONE payslip. */
export interface PayslipTaxFigures {
  payslipId: string;
  providerPayslipId: string | null;
  employeeTaxCents: number;
  employerTaxCents: number;
  netPayCents: number;
}

/**
 * Build the provider payroll lines from payslips. Workers WITHOUT a synced
 * provider employee id are skipped (they can't be withheld for until synced) —
 * the caller can surface how many were skipped.
 */
export function toPayrollLines(payslips: PayslipTaxSource[]): PayrollLineInput[] {
  const lines: PayrollLineInput[] = [];
  for (const s of payslips) {
    if (!s.checkEmployeeId) continue;
    lines.push({ employeeId: s.checkEmployeeId, grossCents: s.grossCents });
  }
  return lines;
}

/** Count of payslips that couldn't be sent because the worker isn't synced yet. */
export function unsyncedCount(payslips: PayslipTaxSource[]): number {
  return payslips.filter((s) => !s.checkEmployeeId).length;
}

/**
 * Match a provider preview back onto payslips by provider employee id, yielding
 * the mirror figures to persist. A payslip whose employee isn't in the preview is
 * omitted (nothing to write). `providerPayslipId` uses the preview's own per-line
 * id when present, else the run id, so the mirror is always traceable.
 */
export function applyPreviewToPayslips(
  payslips: PayslipTaxSource[],
  preview: PayrollPreview,
): PayslipTaxFigures[] {
  const byEmployee = new Map(preview.lines.map((l) => [l.employeeId, l]));
  const out: PayslipTaxFigures[] = [];
  for (const s of payslips) {
    if (!s.checkEmployeeId) continue;
    const line = byEmployee.get(s.checkEmployeeId);
    if (!line) continue;
    out.push({
      payslipId: s.payslipId,
      providerPayslipId: preview.payrollId,
      employeeTaxCents: line.employeeTaxCents,
      employerTaxCents: line.employerTaxCents,
      netPayCents: line.netPayCents,
    });
  }
  return out;
}
