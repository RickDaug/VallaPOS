"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { requireCapability } from "@/lib/operator-guard";
import { getOrderReceipt } from "./queries";
import { renderReceiptEmail, validateRecipientEmail } from "./receipt-email";
import { isEmailConfigured, sendReceiptEmail } from "./email";
import {
  emailReceiptSchema,
  refundOrderSchema,
  voidOrderSchema,
  type EmailReceiptInput,
  type RefundOrderInput,
  type VoidOrderInput,
} from "./schema";
import {
  planFullReversal,
  planPartialRefund,
  netCollectedTotal,
  type PaymentMovement,
  type ReversingPayment,
} from "./refund";
import type { OrderStatus, PaymentMethod } from "@prisma/client";

export type EmailReceiptResult =
  | { ok: true }
  | {
      ok: false;
      reason: "email_not_configured" | "order_not_found" | "invalid_email" | "send_failed";
    };

/**
 * Email a receipt to a customer via Resend.
 *
 * Order of operations (all enforced regardless of whether email is configured):
 *  1. zod-validate the input (businessId / orderId / email shape).
 *  2. `requireMembership` — tenant isolation: only a member of this business may
 *     email its receipts.
 *  3. Business-scoped read — an orderId from another tenant returns null.
 *  4. Validate the recipient address (pure zod) → `invalid_email` on failure.
 *  5. Render text/HTML, then send via Resend.
 *
 * Graceful degrade: when RESEND_API_KEY is unset the action returns
 * `email_not_configured` and never attempts a send — the app and build work
 * unchanged. Provider failures map to `send_failed` (never throw to the client).
 */
export async function emailReceipt(input: EmailReceiptInput): Promise<EmailReceiptResult> {
  const data = emailReceiptSchema.parse(input);

  // Tenant isolation: only a member of this business may email its receipts.
  await requireMembership(data.businessId);

  // Business-scoped read — an orderId from another tenant returns null.
  const receipt = await getOrderReceipt(data.businessId, data.orderId);
  if (!receipt) return { ok: false, reason: "order_not_found" };

  // Re-validate the recipient with the pure helper (defense in depth beyond the
  // schema; also normalizes/trims). Do this BEFORE checking configuration so a
  // bad address is reported even when the provider is unset.
  const to = validateRecipientEmail(data.email);
  if (!to) return { ok: false, reason: "invalid_email" };

  // No provider configured → no-op. Do NOT pretend the email was sent.
  if (!isEmailConfigured()) {
    return { ok: false, reason: "email_not_configured" };
  }

  const rendered = renderReceiptEmail(receipt);
  const sent = await sendReceiptEmail(to, rendered);
  if (!sent.ok) return { ok: false, reason: sent.reason };
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Refunds & voids (MANAGER+).
//
// Both write REVERSING (negative-amount) Payment rows inside a $transaction and
// mark the original captures REFUNDED. The drawer/Z-report count cash by actual
// payment movements (Σ CASH amountCents, negatives included), so a cash refund
// correctly reduces expected drawer cash and Z-report cash — see queries.ts.
// ─────────────────────────────────────────────────────────────────────────────

export type RefundVoidResult =
  | {
      ok: true;
      status: OrderStatus;
      reversedCents: number;
      // Cash physically returned from the till (drawer-reconciled). Always set by
      // refundOrder/voidOrder; optional only so existing result literals (e.g. in
      // unit tests / callers that don't inspect it) stay assignable.
      cashRefundedCents?: number;
      // QR/MANUAL portion: a negative Payment is RECORDED to reverse the sale in
      // the books, but there is no PSP to move money, so the operator must settle
      // it by hand. Surfaced (not silently implied as settled) so the UI can say
      // "manual refund required".
      manualRefundCents?: number;
      manualRefundRequired?: boolean;
    }
  | {
      ok: false;
      reason:
        | "order_not_found"
        | "not_paid" // void requires a PAID order
        | "already_settled" // already VOIDED/REFUNDED — nothing to reverse
        | "nothing_collected" // no positive net payments to reverse
        | "amount_not_positive"
        | "exceeds_net_collected";
    };

/**
 * Split reversal magnitudes into the cash that leaves the till vs the QR/MANUAL
 * portion that has no PSP and therefore needs a MANUAL refund by the operator.
 */
function classifyRefund(reversals: ReversingPayment[]): {
  cashRefundedCents: number;
  manualRefundCents: number;
  manualRefundRequired: boolean;
} {
  let cashRefundedCents = 0;
  let manualRefundCents = 0;
  for (const r of reversals) {
    const magnitude = -r.amountCents; // reversals are negative
    if (r.method === "CASH") cashRefundedCents += magnitude;
    else manualRefundCents += magnitude;
  }
  return { cashRefundedCents, manualRefundCents, manualRefundRequired: manualRefundCents > 0 };
}

/** Statuses that are already terminal for refund/void purposes. */
const SETTLED: ReadonlySet<OrderStatus> = new Set<OrderStatus>(["VOIDED", "REFUNDED"]);

/**
 * VOID an order — a full reversal of a mistaken sale. Only a PAID order may be
 * voided. Sets status = VOIDED and writes one negative Payment per method equal
 * to the net collected on that method (method matching the original, status
 * REFUNDED), and flips the original captures to REFUNDED — all in one
 * transaction. MANAGER+ only; strictly businessId-scoped.
 */
export async function voidOrder(input: VoidOrderInput): Promise<RefundVoidResult> {
  const data = voidOrderSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "refund_void");

  return db.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: data.orderId, businessId: ctx.businessId },
      select: { id: true, status: true, payments: { select: { id: true, method: true, amountCents: true } } },
    });
    if (!order) return { ok: false, reason: "order_not_found" };
    if (SETTLED.has(order.status)) return { ok: false, reason: "already_settled" };
    if (order.status !== "PAID") return { ok: false, reason: "not_paid" };

    const movements: PaymentMovement[] = order.payments.map((p) => ({
      method: p.method,
      amountCents: p.amountCents,
    }));
    const reversals = planFullReversal(movements);
    const reversedCents = -reversals.reduce((s, r) => s + r.amountCents, 0);

    // A cash reversal takes money out of the till, so it must land in an OPEN
    // drawer session (throws when none is open — see assertOpenDrawerForCash).
    await assertOpenDrawerForCash(tx, ctx.businessId, reversals);
    await applyReversal(tx, ctx.businessId, order.id, order.payments, reversals, "VOIDED");

    revalidatePaths(ctx.businessId, order.id);
    return { ok: true, status: "VOIDED", reversedCents, ...classifyRefund(reversals) };
  });
}

/**
 * REFUND an order. Omit `amountCents` for a FULL refund (status → REFUNDED,
 * reversing the entire net-collected amount); pass a positive amount for a
 * PARTIAL refund (status → PARTIALLY_REFUNDED, reversing exactly that amount).
 *
 * Guards: rejects an already VOIDED/REFUNDED order, rejects refunding more than
 * the net-collected (accounting for any prior partial refunds), rejects a
 * non-positive amount. MANAGER+ only; strictly businessId-scoped. A partial
 * refund leaves the order PARTIALLY_REFUNDED and refundable again until exhausted.
 */
export async function refundOrder(input: RefundOrderInput): Promise<RefundVoidResult> {
  const data = refundOrderSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "refund_void");

  return db.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: data.orderId, businessId: ctx.businessId },
      select: { id: true, status: true, payments: { select: { id: true, method: true, amountCents: true } } },
    });
    if (!order) return { ok: false, reason: "order_not_found" };
    // A fully REFUNDED or VOIDED order has nothing left to give back.
    if (SETTLED.has(order.status)) return { ok: false, reason: "already_settled" };

    const movements: PaymentMovement[] = order.payments.map((p) => ({
      method: p.method,
      amountCents: p.amountCents,
    }));

    const isPartial = data.amountCents != null;
    if (!isPartial) {
      // FULL refund: reverse the entire remaining net-collected.
      const reversals = planFullReversal(movements);
      if (reversals.length === 0) return { ok: false, reason: "nothing_collected" };
      const reversedCents = -reversals.reduce((s, r) => s + r.amountCents, 0);
      await assertOpenDrawerForCash(tx, ctx.businessId, reversals);
      await applyReversal(tx, ctx.businessId, order.id, order.payments, reversals, "REFUNDED");
      revalidatePaths(ctx.businessId, order.id);
      return { ok: true, status: "REFUNDED", reversedCents, ...classifyRefund(reversals) };
    }

    // PARTIAL refund: reverse exactly `amountCents`, validated against net-collected.
    const plan = planPartialRefund(movements, data.amountCents!);
    if (!plan.ok) {
      if (plan.error === "amount_not_positive") return { ok: false, reason: "amount_not_positive" };
      if (plan.error === "no_collected_payments") return { ok: false, reason: "nothing_collected" };
      return { ok: false, reason: "exceeds_net_collected" };
    }

    const reversedCents = -plan.reversals.reduce((s, r) => s + r.amountCents, 0);
    // If this partial refund drains the remaining balance, it's really a full
    // refund — mark REFUNDED (and flip captures) rather than PARTIALLY_REFUNDED.
    const remainingAfter = netCollectedTotal(movements) - reversedCents;
    const nextStatus: OrderStatus = remainingAfter <= 0 ? "REFUNDED" : "PARTIALLY_REFUNDED";

    await assertOpenDrawerForCash(tx, ctx.businessId, plan.reversals);
    await applyReversal(
      tx,
      ctx.businessId,
      order.id,
      // Only flip ORIGINAL captures to REFUNDED on a full settle; a partial
      // refund leaves the captures CAPTURED so further partials remain valid.
      nextStatus === "REFUNDED" ? order.payments : [],
      plan.reversals,
      nextStatus,
    );
    revalidatePaths(ctx.businessId, order.id);
    return { ok: true, status: nextStatus, reversedCents, ...classifyRefund(plan.reversals) };
  });
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/**
 * A cash refund/void physically removes money from the till. The drawer and
 * Z-report now key cash by PAYMENT time, so a cash reversal recorded while NO
 * drawer is open would never be reconciled against any session. Guard it: when
 * any reversal is CASH, require an open drawer session for the business (scoped
 * by businessId) and THROW (like the capability guard) when there is none, so
 * the whole transaction rolls back and nothing is written.
 */
async function assertOpenDrawerForCash(
  tx: Tx,
  businessId: string,
  reversals: ReversingPayment[],
): Promise<void> {
  const hasCash = reversals.some((r) => r.method === "CASH" && r.amountCents < 0);
  if (!hasCash) return;
  const open = await tx.cashDrawerSession.findFirst({
    where: { businessId, closedAt: null },
    select: { id: true },
  });
  if (!open) throw new Error("NO_OPEN_DRAWER_FOR_CASH_REFUND");
}

/**
 * Write the reversing negative Payment rows, optionally mark the original
 * captures REFUNDED, and set the order status — all on the given transaction.
 * Reversing payments are tenant-scoped (businessId) exactly like the originals.
 */
async function applyReversal(
  tx: Tx,
  businessId: string,
  orderId: string,
  capturesToRefund: { id: string }[],
  reversals: { method: string; amountCents: number }[],
  status: OrderStatus,
): Promise<void> {
  if (reversals.length > 0) {
    await tx.payment.createMany({
      data: reversals.map((r) => ({
        businessId,
        orderId,
        // `r.method` originated from a real Payment.method (PaymentMethod enum)
        // loaded from the DB, so this cast is sound — the refund module keeps
        // methods as plain strings to stay Prisma-free.
        method: r.method as PaymentMethod,
        status: "REFUNDED" as const,
        amountCents: r.amountCents, // negative
      })),
    });
  }
  if (capturesToRefund.length > 0) {
    await tx.payment.updateMany({
      where: { businessId, orderId, id: { in: capturesToRefund.map((p) => p.id) }, status: "CAPTURED" },
      data: { status: "REFUNDED" },
    });
  }
  await tx.order.update({ where: { id: orderId }, data: { status } });
}

function revalidatePaths(businessId: string, orderId: string): void {
  revalidatePath(`/${businessId}/orders`);
  revalidatePath(`/${businessId}/orders/${orderId}/receipt`);
  revalidatePath(`/${businessId}/reports`);
  revalidatePath(`/${businessId}/drawer`);
}
