import "server-only";

import { db } from "@/lib/db";
import type { PayrollTaxStore } from "./service";
import type { PayslipTaxFigures } from "./mapping";

/**
 * Prisma-backed `PayrollTaxStore`. `Business` is the tenant ROOT (keyed by its own
 * id / unique provider ids), so — like connect-store.ts — those writes are
 * intentionally outside the tenant-isolation guard's model list. Tenant-owned
 * writes (Membership / PayPeriod / Payslip) are scoped by `businessId` here too.
 *
 * NO PII is written — only opaque provider ids + integer-cent mirror figures.
 */
export function prismaPayrollTaxStore(): PayrollTaxStore {
  return {
    async saveCompany(businessId, companyId, status) {
      await db.business.update({
        where: { id: businessId },
        data: { checkCompanyId: companyId, payrollTaxOnboardingStatus: status },
      });
    },

    async saveOnboardingStatus(businessId, companyId, status) {
      // Match BOTH ids so a stale status for a since-replaced company can't win.
      await db.business.updateMany({
        where: { id: businessId, checkCompanyId: companyId },
        data: { payrollTaxOnboardingStatus: status },
      });
    },

    async saveEmployeeId(businessId, membershipId, employeeId) {
      await db.membership.updateMany({
        where: { id: membershipId, businessId },
        data: { checkEmployeeId: employeeId },
      });
    },

    async savePayrollRun(businessId, payPeriodId, payrollId, status) {
      await db.payPeriod.updateMany({
        where: { id: payPeriodId, businessId },
        data: { checkPayrollId: payrollId, checkPayrollStatus: status },
      });
    },

    async savePayslipFigures(businessId, figures: PayslipTaxFigures[]) {
      // Bulk mirror write; each row scoped by businessId + its own id. Runs in one
      // transaction so a partial provider preview never half-populates a run.
      await db.$transaction(
        figures.map((f) =>
          db.payslip.updateMany({
            where: { id: f.payslipId, businessId },
            data: {
              providerPayslipId: f.providerPayslipId,
              employeeTaxCents: f.employeeTaxCents,
              employerTaxCents: f.employerTaxCents,
              netPayCents: f.netPayCents,
            },
          }),
        ),
      );
    },
  };
}

/**
 * Webhook path: reconcile onboarding status keyed by the provider COMPANY id alone
 * (the webhook has no session/business context). Returns rows updated — 0 means we
 * don't recognize the company (safe no-op). `checkCompanyId` is unique, so this
 * affects at most one business.
 */
export async function applyOnboardingStatusByCompanyId(
  companyId: string,
  status: string,
): Promise<number> {
  const res = await db.business.updateMany({
    where: { checkCompanyId: companyId },
    data: { payrollTaxOnboardingStatus: status },
  });
  return res.count;
}

/**
 * Webhook path: reconcile a payroll-run status keyed by the provider PAYROLL id.
 * Returns rows updated (0 = unknown run, safe no-op).
 */
export async function applyPayrollStatusByPayrollId(
  payrollId: string,
  status: string,
): Promise<number> {
  // tenant-ok: webhook has no business context; keyed by the provider run id.
  const res = await db.payPeriod.updateMany({
    where: { checkPayrollId: payrollId },
    data: { checkPayrollStatus: status },
  });
  return res.count;
}
