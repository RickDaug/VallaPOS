-- Single-operator ("stay unlocked") mode — audit remediation #5.
-- Additive + defaulted, so existing businesses are untouched (default OFF).

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "singleOperatorMode" BOOLEAN NOT NULL DEFAULT false;
