-- CreateTable
CREATE TABLE "OrderCounter" (
    "businessId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderCounter_pkey" PRIMARY KEY ("businessId")
);

-- AddForeignKey
ALTER TABLE "OrderCounter" ADD CONSTRAINT "OrderCounter_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: give every existing business a counter seeded to its current highest
-- order number, so the next sale continues the sequence instead of colliding at 1.
INSERT INTO "OrderCounter" ("businessId", "lastNumber")
SELECT b."id", COALESCE(MAX(o."number"), 0)
FROM "Business" b
LEFT JOIN "Order" o ON o."businessId" = b."id"
GROUP BY b."id";
