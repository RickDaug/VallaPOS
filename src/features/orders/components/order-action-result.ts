/**
 * Pure mapping from a refund/void server result to a toast spec. Split out of
 * `OrderActions.tsx` so it carries no JSX and is unit-testable (the Vitest config
 * has no React plugin — tests only load plain `.ts`).
 */

import type { RefundVoidResult } from "@/features/orders/actions";

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

export interface ToastSpec {
  title: string;
  description?: string;
  variant: "success" | "error" | "default";
}

/**
 * Describe a refund/void result as a toast. `money` formats integer cents to a
 * display string. Success branches vary the title by the resulting order status.
 */
export function describeRefundVoidResult(
  res: RefundVoidResult,
  money: (cents: number) => string,
): ToastSpec {
  if (!res.ok) {
    return { title: REASON_TEXT[res.reason], variant: "error" };
  }
  if (res.status === "VOIDED") {
    return {
      title: "Order voided",
      description: `${money(res.reversedCents)} reversed.`,
      variant: "success",
    };
  }
  if (res.status === "REFUNDED") {
    return {
      title: "Order refunded",
      description: `${money(res.reversedCents)} refunded.`,
      variant: "success",
    };
  }
  return {
    title: "Partial refund issued",
    description: `${money(res.reversedCents)} refunded.`,
    variant: "success",
  };
}
