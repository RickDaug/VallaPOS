import type { Prisma } from "@prisma/client";

/**
 * Shared STOCK DECREMENT (inventory, #129) — used by BOTH the cash checkout
 * (register/actions.ts) and the webhook-settled QR sale (payments/sale-store.ts)
 * so both paths move stock identically.
 *
 * For each line whose parent item tracks stock, atomically decrement the
 * variation's on-hand count. MUST be called INSIDE the sale's transaction so
 * stock only moves if the order/payment commits. OVERSELL IS ALLOWED — the count
 * may go negative; a POS must never freeze a real transaction over inventory, and
 * a negative reading is an honest "sold more than you had" signal.
 *
 * Ownership must already be established by the caller (variations looked up
 * scoped to `businessId`), so each `variationId` is this tenant's — the update is
 * keyed by the verified id alone.
 */
export interface StockDecrementLine {
  variationId: string;
  quantity: number;
  trackStock: boolean;
}

export async function applyStockDecrements(
  tx: Pick<Prisma.TransactionClient, "variation">,
  lines: StockDecrementLine[],
): Promise<void> {
  for (const l of lines) {
    if (!l.trackStock) continue;
    await tx.variation.update({
      where: { id: l.variationId },
      data: { stock: { decrement: l.quantity } },
    });
  }
}
