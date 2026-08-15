-- CreateEnum
CREATE TYPE "PayType" AS ENUM ('HOURLY', 'SALARY');

-- CreateEnum
CREATE TYPE "PayPeriodStatus" AS ENUM ('DRAFT', 'FINALIZED', 'PAID');

-- CreateEnum
CREATE TYPE "AdjustmentKind" AS ENUM ('ADDITION', 'DEDUCTION');

-- CreateTable
CREATE TABLE "PayRate" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "payType" "PayType" NOT NULL DEFAULT 'HOURLY',
    "hourlyCents" INTEGER NOT NULL DEFAULT 0,
    "annualCents" INTEGER NOT NULL DEFAULT 0,
    "otEnabled" BOOLEAN NOT NULL DEFAULT true,
    "otThresholdMinutes" INTEGER,
    "otMultiplierBps" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayPeriod" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "label" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "PayPeriodStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "payPeriodId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "payType" "PayType" NOT NULL DEFAULT 'HOURLY',
    "regularMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "openShiftCount" INTEGER NOT NULL DEFAULT 0,
    "hourlyCents" INTEGER NOT NULL DEFAULT 0,
    "annualCents" INTEGER NOT NULL DEFAULT 0,
    "otMultiplierBps" INTEGER NOT NULL DEFAULT 15000,
    "regularPayCents" INTEGER NOT NULL DEFAULT 0,
    "overtimePayCents" INTEGER NOT NULL DEFAULT 0,
    "grossCents" INTEGER NOT NULL DEFAULT 0,
    "additionsCents" INTEGER NOT NULL DEFAULT 0,
    "deductionsCents" INTEGER NOT NULL DEFAULT 0,
    "netCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayslipAdjustment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "payslipId" TEXT NOT NULL,
    "kind" "AdjustmentKind" NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayslipAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayRate_membershipId_key" ON "PayRate"("membershipId");

-- CreateIndex
CREATE INDEX "PayRate_businessId_idx" ON "PayRate"("businessId");

-- CreateIndex
CREATE INDEX "PayPeriod_businessId_idx" ON "PayPeriod"("businessId");

-- CreateIndex
CREATE INDEX "PayPeriod_businessId_startDate_idx" ON "PayPeriod"("businessId", "startDate");

-- CreateIndex
CREATE INDEX "Payslip_businessId_idx" ON "Payslip"("businessId");

-- CreateIndex
CREATE INDEX "Payslip_payPeriodId_idx" ON "Payslip"("payPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_payPeriodId_membershipId_key" ON "Payslip"("payPeriodId", "membershipId");

-- CreateIndex
CREATE INDEX "PayslipAdjustment_businessId_idx" ON "PayslipAdjustment"("businessId");

-- CreateIndex
CREATE INDEX "PayslipAdjustment_payslipId_idx" ON "PayslipAdjustment"("payslipId");

-- AddForeignKey
ALTER TABLE "PayRate" ADD CONSTRAINT "PayRate_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRate" ADD CONSTRAINT "PayRate_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayPeriod" ADD CONSTRAINT "PayPeriod_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipAdjustment" ADD CONSTRAINT "PayslipAdjustment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipAdjustment" ADD CONSTRAINT "PayslipAdjustment_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

