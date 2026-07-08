-- Integrated payments (Stripe Connect) — PAYMENTS.md §9, PR-A.
-- Additive + nullable/defaulted, so existing businesses are untouched.

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'US',
ADD COLUMN     "stripeAccountId" TEXT,
ADD COLUMN     "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Business_stripeAccountId_key" ON "Business"("stripeAccountId");
