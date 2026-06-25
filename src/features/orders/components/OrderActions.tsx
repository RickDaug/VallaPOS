"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2, Ban } from "lucide-react";
import type { OrderStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/money";
import { refundOrder, voidOrder, type RefundVoidResult } from "@/features/orders/actions";
import { describeRefundVoidResult } from "@/features/orders/components/order-action-result";

/**
 * MANAGER-gated refund / void controls for a single order. Hidden entirely for
 * non-managers and for orders already VOIDED/REFUNDED (nothing left to reverse).
 * Confirmation goes through the shared `useConfirm` dialog. Partial refund is a
 * small inline amount field; leaving it blank performs a full refund.
 */
export function OrderActions({
  businessId,
  orderId,
  status,
  totalCents,
  currency,
}: {
  businessId: string;
  orderId: string;
  status: OrderStatus;
  totalCents: number;
  currency: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [pending, setPending] = useState(false);
  const [partialOpen, setPartialOpen] = useState(false);
  const [partialAmount, setPartialAmount] = useState("");

  // Nothing to do on a terminal order. PARTIALLY_REFUNDED can still be refunded
  // further (until the balance is exhausted) but can't be voided.
  const settled = status === "VOIDED" || status === "REFUNDED";
  if (settled) return null;

  const money = (c: number) => formatMoney(c, currency);

  async function run(action: () => Promise<RefundVoidResult>) {
    setPending(true);
    try {
      const res = await action();
      toast(describeRefundVoidResult(res, money));
      if (res.ok) {
        setPartialOpen(false);
        setPartialAmount("");
        router.refresh();
      }
    } catch {
      toast({
        title: "Something went wrong",
        description: "Please try again.",
        variant: "error",
      });
    } finally {
      setPending(false);
    }
  }

  async function onVoid() {
    const ok = await confirm({
      title: "Void this order?",
      description: `This fully reverses the sale of ${money(totalCents)}. Cash reversals reduce the expected drawer total.`,
      confirmLabel: "Void order",
    });
    if (ok) await run(() => voidOrder({ businessId, orderId }));
  }

  async function onFullRefund() {
    const ok = await confirm({
      title: "Refund this order in full?",
      description: `This reverses the full amount collected and marks the order refunded.`,
      confirmLabel: "Refund in full",
    });
    if (ok) await run(() => refundOrder({ businessId, orderId }));
  }

  async function onPartialRefund() {
    const dollars = Number(partialAmount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      toast({
        title: "Enter a refund amount greater than zero.",
        variant: "error",
      });
      return;
    }
    const cents = Math.round(dollars * 100);
    const ok = await confirm({
      title: `Refund ${money(cents)}?`,
      description: "This reverses the entered amount; the order stays partially refunded.",
      confirmLabel: `Refund ${money(cents)}`,
    });
    if (ok) await run(() => refundOrder({ businessId, orderId, amountCents: cents }));
  }

  // Void is only meaningful on a clean PAID order.
  const canVoid = status === "PAID";

  return (
    <div className="print:hidden">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onFullRefund} disabled={pending}>
          <Undo2 size={18} /> Refund
        </Button>
        <Button
          variant="outline"
          onClick={() => setPartialOpen((v) => !v)}
          disabled={pending}
          aria-expanded={partialOpen}
          aria-controls="partial-refund-panel"
        >
          Partial refund
        </Button>
        {canVoid && (
          <Button variant="destructive" onClick={onVoid} disabled={pending}>
            <Ban size={18} /> Void
          </Button>
        )}
      </div>

      {partialOpen && (
        <div
          id="partial-refund-panel"
          className="mt-3 space-y-2 rounded-lg border border-border bg-muted p-3"
        >
          <label htmlFor="refund-amount" className="block text-sm font-medium">
            Refund amount ({currency})
          </label>
          <input
            id="refund-amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={partialAmount}
            onChange={(e) => setPartialAmount(e.target.value)}
            placeholder="0.00"
            autoFocus
            className="numeric h-11 w-full rounded-md border border-input bg-card px-3 text-base transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            onClick={onPartialRefund}
            disabled={pending || partialAmount.trim() === ""}
            className="w-full"
          >
            {pending ? "Refunding…" : "Refund this amount"}
          </Button>
        </div>
      )}

      {confirmEl}
    </div>
  );
}
