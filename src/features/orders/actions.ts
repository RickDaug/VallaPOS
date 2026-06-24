"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { requireCapability } from "@/lib/operator-guard";
import { getOrderReceipt } from "./queries";
import { renderReceiptEmail } from "./receipt-email";
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
} from "./refund";
import type { OrderStatus, PaymentMethod } from "@prisma/client";

export type EmailReceiptResult =
  | { ok: true }
  | { ok: false; reason: "email_not_configured" | "order_not_found" };

/**
 * Email a receipt to a customer.
 *
 * This is a SAFE scaffold: it validates input, gates on membership (tenant
 * isolation), loads the order strictly scoped to the business, and renders the
 * receipt to both plain text and HTML — but it does NOT bundle an email SDK or
 * ship any credentials. If no email provider is configured (no RESEND_API_KEY),
 * it returns `{ ok: false, reason: "email_not_configured" }` so the UI can show
 * a clear "coming soon" affordance instead of a broken button.
 *
 * TODO(email-provider): wire a provider here. Suggested: Resend.
 *   1. `npm install resend@<pinned-exact-version>` and commit the lockfile.
 *   2. Add `RESEND_API_KEY` (+ optional `RECEIPT_FROM_EMAIL`) to `src/lib/env.ts`
 *      as OPTIONAL vars and document them in `.env.example` (already done).
 *   3. Replace the `email_not_configured` short-circuit below with:
 *        const { Resend } = await import("resend");
 *        const resend = new Resend(process.env.RESEND_API_KEY);
 *        await resend.emails.send({
 *          from: process.env.RECEIPT_FROM_EMAIL ?? "receipts@yourdomain",
 *          to: data.email, subject, text, html,
 *        });
 *   Keep the membership gate + business-scoped load exactly as-is.
 */
export async function emailReceipt(input: EmailReceiptInput): Promise<EmailReceiptResult> {
  const data = emailReceiptSchema.parse(input);

  // Tenant isolation: only a member of this business may email its receipts.
  await requireMembership(data.businessId);

  // Business-scoped read — an orderId from another tenant returns null.
  const receipt = await getOrderReceipt(data.businessId, data.orderId);
  if (!receipt) return { ok: false, reason: "order_not_found" };

  // Render now so a future provider wiring is a one-liner (and so this code is
  // exercised/tested even while sending is disabled).
  const { subject, text, html } = renderReceiptEmail(receipt);
  void subject;
  void text;
  void html;

  // No provider configured → no-op. Do NOT pretend the email was sent.
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, reason: "email_not_configured" };
  }

  // Unreachable until a provider is wired above (see TODO). Returning the
  // not-configured result keeps the type honest without shipping a fake send.
  return { ok: false, reason: "email_not_configured" };
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
  | { ok: true; status: OrderStatus; reversedCents: number }
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

    await applyReversal(tx, ctx.businessId, order.id, order.payments, reversals, "VOIDED");

    revalidatePaths(ctx.businessId, order.id);
    return { ok: true, status: "VOIDED", reversedCents };
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
      await applyReversal(tx, ctx.businessId, order.id, order.payments, reversals, "REFUNDED");
      revalidatePaths(ctx.businessId, order.id);
      return { ok: true, status: "REFUNDED", reversedCents };
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
    return { ok: true, status: nextStatus, reversedCents };
  });
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

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
