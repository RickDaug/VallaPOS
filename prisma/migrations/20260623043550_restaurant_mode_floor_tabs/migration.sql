-- CreateEnum
CREATE TYPE "BusinessMode" AS ENUM ('STORE', 'RESTAURANT');

-- CreateEnum
CREATE TYPE "TableShape" AS ENUM ('ROUND', 'SQUARE', 'RECT');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "mode" "BusinessMode" NOT NULL DEFAULT 'STORE';

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "seat" INTEGER,
ADD COLUMN     "settledByPaymentId" TEXT;

-- CreateTable
CREATE TABLE "FloorRoom" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FloorRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorTable" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "shape" "TableShape" NOT NULL DEFAULT 'SQUARE',
    "x" INTEGER NOT NULL DEFAULT 0,
    "y" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL DEFAULT 80,
    "height" INTEGER NOT NULL DEFAULT 80,
    "seats" INTEGER NOT NULL DEFAULT 4,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FloorTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTable" (
    "orderId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,

    CONSTRAINT "OrderTable_pkey" PRIMARY KEY ("orderId","tableId")
);

-- CreateIndex
CREATE INDEX "FloorRoom_businessId_idx" ON "FloorRoom"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "FloorRoom_businessId_name_key" ON "FloorRoom"("businessId", "name");

-- CreateIndex
CREATE INDEX "FloorTable_businessId_idx" ON "FloorTable"("businessId");

-- CreateIndex
CREATE INDEX "FloorTable_roomId_idx" ON "FloorTable"("roomId");

-- CreateIndex
CREATE INDEX "OrderTable_tableId_idx" ON "OrderTable"("tableId");

-- CreateIndex
CREATE INDEX "OrderLine_settledByPaymentId_idx" ON "OrderLine"("settledByPaymentId");

-- AddForeignKey
ALTER TABLE "FloorRoom" ADD CONSTRAINT "FloorRoom_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorTable" ADD CONSTRAINT "FloorTable_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorTable" ADD CONSTRAINT "FloorTable_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "FloorRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTable" ADD CONSTRAINT "OrderTable_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTable" ADD CONSTRAINT "OrderTable_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "FloorTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_settledByPaymentId_fkey" FOREIGN KEY ("settledByPaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
