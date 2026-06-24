-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "name" TEXT,
ADD COLUMN     "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "userId" DROP NOT NULL;

-- Backfill capability grants from each existing member's role so the (later)
-- switch to capability-based enforcement does not lock anyone out. OWNER is
-- intentionally left empty — it is treated as all-access in code. Mirrors the
-- role-default presets in src/lib/capabilities.ts.
UPDATE "Membership"
SET "permissions" = ARRAY['take_orders','refund_void','manage_products','view_reports','cash_drawer','manage_team','manage_settings']
WHERE "role" = 'MANAGER';

UPDATE "Membership"
SET "permissions" = ARRAY['take_orders','cash_drawer','view_reports']
WHERE "role" = 'CASHIER';
