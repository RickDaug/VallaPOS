-- Payroll-tax provider scaffold (embedded payroll — Check) — docs/PAYROLL_TAX.md.
-- Additive + nullable/defaulted only, so existing businesses/payslips are
-- untouched and the integration stays DORMANT until CHECK_* keys are set AND a
-- merchant onboards. NO PII columns (SSN/EIN/bank) are added — that data lives
-- only in the provider, tokenized; we mirror opaque provider ids + cent figures.
--
-- ⚠ NOT YET APPLIED TO NEON. Apply with `prisma migrate deploy` from this branch
-- BEFORE merging, or authed requests will 500 on the missing columns.

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "checkCompanyId" TEXT,
ADD COLUMN     "payrollTaxEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payrollTaxOnboardingStatus" TEXT;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "checkEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "PayPeriod" ADD COLUMN     "checkPayrollId" TEXT,
ADD COLUMN     "checkPayrollStatus" TEXT;

-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN     "employeeTaxCents" INTEGER,
ADD COLUMN     "employerTaxCents" INTEGER,
ADD COLUMN     "netPayCents" INTEGER,
ADD COLUMN     "providerPayslipId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Business_checkCompanyId_key" ON "Business"("checkCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_checkEmployeeId_key" ON "Membership"("checkEmployeeId");
