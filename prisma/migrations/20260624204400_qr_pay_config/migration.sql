-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "qrPayEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "qrPayLabel" TEXT,
ADD COLUMN     "qrPayValue" TEXT;
