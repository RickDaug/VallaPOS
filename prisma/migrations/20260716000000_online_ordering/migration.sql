-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('IN_PERSON', 'ONLINE');

-- CreateEnum
CREATE TYPE "OnlineOrderStatus" AS ENUM ('SUBMITTED', 'ACCEPTED', 'READY', 'COMPLETED', 'REJECTED');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "onlineOrderInstructions" TEXT,
ADD COLUMN     "onlineOrderingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "channel" "OrderChannel" NOT NULL DEFAULT 'IN_PERSON',
ADD COLUMN     "customerPhone" TEXT,
ADD COLUMN     "onlineStatus" "OnlineOrderStatus";

-- CreateIndex
CREATE INDEX "Order_businessId_channel_onlineStatus_idx" ON "Order"("businessId", "channel", "onlineStatus");

