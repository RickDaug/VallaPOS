-- Composite index for the Z-report / CSV-export payment window query
-- (src/features/orders/queries.ts getDailyReport filters WHERE businessId + createdAt range).
-- Mirrors the existing Order @@index([businessId, createdAt]). Additive, non-destructive.
CREATE INDEX "Payment_businessId_createdAt_idx" ON "Payment"("businessId", "createdAt");
