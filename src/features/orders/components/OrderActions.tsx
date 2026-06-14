"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2, Ban } from "lucide-react";
import type { OrderStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatMoney } from "@/lib/money";
import { refundOrder, voidOrder, type RefundVoidResult } from "@/features/orders/actions";

// Narrow the failure branch's `reason` union so the lookup table is exhaustive.
type FailReason = Extract<RefundVoidResult, { ok: false }>["reason"];

const REASON_TEXT: Record<FailReason, string> = {
  order_not_found: "Order not found.",
  not_paid: "Only a paid order can be voided.",
  already_settled: "This order is already refunded or voided.",
  nothing_collected: "There is nothing left to refund on this order.",
  amount_not_positive: "Enter a refund amount greater than zero.",
  exceeds_net_collected: "Refund exceeds the amount collected on this order.",
};

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
  const [confirm, confirmEl] = useConfirm();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [partialOpen, setPartialOpen] = useState(false);
  const [partialAmount, setPartialAmount] = useState("");

  // Nothing to do on a terminal order. PARTIALLY_REFUNDED can still be refunded
  // further (until the balance is exhausted) but can't be voided.
  const settled = status === "VOIDED" || status === "REFUNDED";
  if (settled) return null;

  const money = (c: number) => formatMoney(c, currency);

  async function run(action: () => Promise<RefundVoidResult>) {
    setPending(true);
    setNotice(null);
    try {
      const res = await action();
      if (res.ok) {
        setNotice(
          res.status === "VOIDED"
            ? `Voided — ${money(res.reversedCents)} reversed.`
            : res.status === "REFUNDED"
              ? `Refunded ${money(res.reversedCents)}.`
              : `Partially refunded ${money(res.reversedCents)}.`,
        );
        setPartialOpen(false);
        setPartialAmount("");
        router.refresh();
      } else {
        setNotice(REASON_TEXT[res.reason]);
      }
    } catch {
      setNotice("Something went wrong. Please try again.");
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
      setNotice("Enter a refund amount greater than zero.");
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
        <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted p-3">
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
            className="numeric h-11 w-full rounded-md border border-input bg-card px-3 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

      {notice && (
        <p className="mt-2 text-sm text-muted-foreground" role="status" aria-live="polite">
          {notice}
        </p>
      )}

      {confirmEl}
    </div>
  );
}
