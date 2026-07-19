"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock, Phone, Smartphone, User } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/money";
import { settleOnlineOrder, transitionOnlineOrder } from "@/features/online/actions";
import { ONLINE_SETTLE_METHODS, type OnlineSettleMethod } from "@/features/online/schema";
import type { OnlineOrderAction } from "@/features/online/status";
import type { IncomingOnlineOrder } from "@/features/online/queries";

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "New",
  ACCEPTED: "Preparing",
  READY: "Ready",
  COMPLETED: "Completed",
};

const STATUS_STYLE: Record<string, string> = {
  SUBMITTED: "border-primary/40 bg-primary/10 text-primary",
  ACCEPTED: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  READY: "border-success/40 bg-success/10 text-success",
  COMPLETED: "border-border bg-muted text-muted-foreground",
};

/** Tender labels for the "Take payment" picker (values match ONLINE_SETTLE_METHODS). */
const METHOD_LABEL: Record<OnlineSettleMethod, string> = {
  CASH: "Cash",
  QR: "QR",
  MANUAL: "Other",
};

/** The action buttons available at each status (label + action + primary flag). */
function actionsFor(status: string): { label: string; action: OnlineOrderAction; primary?: boolean }[] {
  switch (status) {
    case "SUBMITTED":
      return [
        { label: "Accept", action: "accept", primary: true },
        { label: "Reject", action: "reject" },
      ];
    case "ACCEPTED":
      return [
        { label: "Mark ready", action: "ready", primary: true },
        { label: "Complete", action: "complete" },
        { label: "Reject", action: "reject" },
      ];
    case "READY":
      return [
        { label: "Complete", action: "complete", primary: true },
        { label: "Reject", action: "reject" },
      ];
    default:
      return [];
  }
}

const ACTION_DONE: Record<OnlineOrderAction, string> = {
  accept: "Order accepted",
  ready: "Order marked ready",
  complete: "Order completed",
  reject: "Order rejected",
};

export function OnlineOrdersBoard({
  businessId,
  currency,
  enabled,
  orders,
}: {
  businessId: string;
  currency: string;
  enabled: boolean;
  orders: IncomingOnlineOrder[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Which order (if any) has its "Take payment" tender picker open.
  const [payingId, setPayingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function runAction(orderId: string, action: OnlineOrderAction) {
    if (pendingId) return;
    setPendingId(orderId);
    startTransition(async () => {
      try {
        const result = await transitionOnlineOrder({ businessId, orderId, action });
        toast({
          title: result.status === "already" ? "Order already updated" : ACTION_DONE[action],
          variant: action === "reject" || result.status === "already" ? "default" : "success",
        });
        router.refresh();
      } catch (err) {
        toast({
          title: "Couldn't update the order",
          description: err instanceof Error ? err.message : undefined,
          variant: "error",
        });
      } finally {
        setPendingId(null);
      }
    });
  }

  function takePayment(orderId: string, method: OnlineSettleMethod) {
    if (pendingId) return;
    setPendingId(orderId);
    startTransition(async () => {
      try {
        const result = await settleOnlineOrder({ businessId, orderId, method });
        toast({
          title: result.status === "already_paid" ? "Already paid" : "Payment recorded",
          description:
            result.status === "already_paid"
              ? undefined
              : `${formatMoney(result.totalCents, currency)} · ${METHOD_LABEL[method]}`,
          variant: result.status === "already_paid" ? "default" : "success",
        });
        setPayingId(null);
        router.refresh();
      } catch (err) {
        toast({
          title: "Couldn't take payment",
          description: err instanceof Error ? err.message : undefined,
          variant: "error",
        });
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-black md:text-3xl">Online orders</h1>
        <p className="text-sm text-muted-foreground">
          {enabled
            ? "Accept, prepare, and complete customer self-orders."
            : "Online ordering is turned off. Enable it in Settings → Online ordering."}
        </p>
      </header>

      {orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-10 text-center text-muted-foreground">
          <Smartphone className="mx-auto mb-2 opacity-60" size={28} />
          <p className="font-medium">No incoming orders</p>
          <p className="text-sm">New customer orders will appear here automatically.</p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {orders.map((order) => (
            <li
              key={order.id}
              className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm"
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-black">#{order.number}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock size={12} />
                    {new Date(order.createdAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                      STATUS_STYLE[order.onlineStatus] ?? "border-border"
                    }`}
                  >
                    {STATUS_LABEL[order.onlineStatus] ?? order.onlineStatus}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      order.paid
                        ? "border-success/40 bg-success/10 text-success"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    }`}
                  >
                    {order.paid ? "Paid" : "Unpaid"}
                  </span>
                </div>
              </div>

              {(order.customerName || order.customerPhone) && (
                <div className="mb-3 space-y-0.5 text-sm">
                  {order.customerName && (
                    <p className="flex items-center gap-1.5">
                      <User size={13} className="text-muted-foreground" />
                      {order.customerName}
                    </p>
                  )}
                  {order.customerPhone && (
                    <a
                      href={`tel:${order.customerPhone}`}
                      className="flex items-center gap-1.5 text-primary underline"
                    >
                      <Phone size={13} />
                      {order.customerPhone}
                    </a>
                  )}
                </div>
              )}

              <ul className="mb-3 flex-1 space-y-1.5 text-sm">
                {order.lines.map((line) => (
                  <li key={line.id}>
                    <div className="flex justify-between gap-2">
                      <span>
                        <span className="numeric font-semibold">{line.quantity}×</span>{" "}
                        {line.nameSnapshot}
                      </span>
                      <span className="numeric text-muted-foreground">
                        {formatMoney(line.totalCents, currency)}
                      </span>
                    </div>
                    {line.modifiers.length > 0 && (
                      <p className="pl-5 text-xs text-muted-foreground">
                        {line.modifiers.map((m) => m.nameSnapshot).join(", ")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>

              <div className="mb-3 flex items-center justify-between border-t border-border pt-2 text-sm">
                <span className="font-medium">Total</span>
                <span className="numeric font-black">
                  {formatMoney(order.totalCents, currency)}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {actionsFor(order.onlineStatus).map((a) => (
                  <button
                    key={a.action}
                    type="button"
                    disabled={pendingId === order.id}
                    onClick={() => runAction(order.id, a.action)}
                    className={`inline-flex h-10 items-center rounded-lg px-4 text-sm font-semibold transition-colors active:scale-[0.98] disabled:opacity-60 ${
                      a.primary
                        ? "bg-primary text-primary-foreground"
                        : a.action === "reject"
                          ? "border border-destructive/40 text-destructive hover:bg-destructive/10"
                          : "border border-border hover:bg-muted"
                    }`}
                  >
                    {a.label}
                  </button>
                ))}

                {/* A1: take payment — records a Payment + flips the order to PAID so
                    it becomes revenue/tax. Hidden once paid. */}
                {!order.paid &&
                  (payingId === order.id ? (
                    <div
                      role="group"
                      aria-label={`Take payment for order ${order.number}`}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <span className="text-sm font-medium text-muted-foreground">Tender:</span>
                      {ONLINE_SETTLE_METHODS.map((m) => (
                        <button
                          key={m}
                          type="button"
                          disabled={pendingId === order.id}
                          onClick={() => takePayment(order.id, m)}
                          className="inline-flex h-10 items-center rounded-lg border border-border px-3 text-sm font-semibold transition-colors hover:bg-muted active:scale-[0.98] disabled:opacity-60"
                        >
                          {METHOD_LABEL[m]}
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={pendingId === order.id}
                        onClick={() => setPayingId(null)}
                        className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={pendingId === order.id}
                      onClick={() => setPayingId(order.id)}
                      className="inline-flex h-10 items-center rounded-lg border border-success/50 bg-success/10 px-4 text-sm font-semibold text-success transition-colors hover:bg-success/20 active:scale-[0.98] disabled:opacity-60"
                    >
                      Take payment
                    </button>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
