/**
 * Stripe webhook endpoint (PAYMENTS.md §9).
 *
 * Handles TWO event families:
 *   - CONNECTED-ACCOUNT capability (`account.updated`, PR-A): when a business
 *     finishes/regresses onboarding we flip the cached `stripeChargesEnabled`.
 *   - QR SALE SETTLEMENT (PR-C): a hosted Checkout Session on the merchant's
 *     connected account is paid/failed/expired → settle the CheckoutSession row.
 *
 * SECURITY: the request is authenticated by the Stripe SIGNATURE, verified against
 * STRIPE_WEBHOOK_SECRET over the RAW body — never a session (Stripe can't sign in).
 * The body is read verbatim and verified BEFORE any parsing; an unverified body is
 * 400 so Stripe retries. Every VERIFIED event returns 200 (handled or safely
 * ignored) so Stripe stops retrying — 400 is reserved for a bad signature.
 *
 * TENANT SAFETY (invariant #1): a sale event resolves its tenant ONLY from the
 * signed `stripeSessionId` → CheckoutSession row; `event.account` is asserted
 * against that row's `stripeAccountId` inside the store before any write, and the
 * amount/currency are re-verified before the order is ever marked PAID
 * (invariant #3). All of this is idempotent under Stripe's aggressive webhook
 * retries (invariant #2 — compare-and-set + `paymentId @unique`).
 */

import {
  constructStripeEvent,
  isPaymentsConfigured,
} from "@/features/payments/connect-stripe";
import { extractAccountCapability } from "@/features/payments/connect-webhook";
import { applyChargesByAccountId } from "@/features/payments/connect-store";
import { extractSaleSettlement } from "@/features/payments/sale-webhook";
import {
  captureQrSale,
  failQrSale,
  expireQrSale,
  type SettleOutcome,
} from "@/features/payments/sale-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // Feature dormant (no keys) → 503 so a misdirected webhook is visibly ignored.
  if (!isPaymentsConfigured()) {
    return json({ error: "payments not configured" }, 503);
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return json({ error: "missing stripe-signature" }, 400);

  // Raw body is required for signature verification — read it verbatim, before
  // any JSON parsing (invariant #4).
  const rawBody = await request.text();

  let event;
  try {
    event = await constructStripeEvent(rawBody, signature);
  } catch (err) {
    // Bad signature or misconfigured secret — reject so Stripe retries.
    console.error("Stripe webhook verification failed:", err);
    return json({ error: "invalid signature" }, 400);
  }

  // 1) Connected-account capability (PR-A) — unchanged behavior.
  const capability = extractAccountCapability(event.type, event.object);
  if (capability) {
    const affected = await applyChargesByAccountId(capability.accountId, capability.chargesEnabled);
    if (affected === 0) {
      console.warn(`Stripe account webhook for unknown account ${capability.accountId}`);
    }
    return json({ received: true }, 200);
  }

  // 2) QR sale settlement (PR-C). The store resolves the tenant from the signed
  // session id, asserts event.account, re-verifies amount/currency, and settles
  // idempotently. We only LOG the outcome here and always 200.
  const settlement = extractSaleSettlement({ type: event.type, object: event.object });
  if (settlement) {
    const outcome =
      settlement.kind === "capture"
        ? await captureQrSale({ settlement, eventAccount: event.account })
        : settlement.kind === "fail"
          ? await failQrSale({ settlement, eventAccount: event.account })
          : await expireQrSale({ settlement, eventAccount: event.account });
    logSettlement(event.type, settlement.stripeSessionId, outcome);
    return json({ received: true }, 200);
  }

  // Verified but not an event we act on — acknowledge.
  return json({ received: true }, 200);
}

/** Surface the security-relevant no-ops (account/amount mismatch) loudly. */
function logSettlement(eventType: string, sessionId: string, outcome: SettleOutcome): void {
  if (outcome.outcome === "account_mismatch") {
    console.error(
      `⚠ SECURITY: ${eventType} for session ${sessionId} — event.account does not match ` +
        `the stored CheckoutSession account. Ignored (no data touched).`,
    );
  } else if (outcome.outcome === "amount_mismatch") {
    console.error(
      `⚠ ALARM: ${eventType} for session ${sessionId} — Stripe amount_total/currency does ` +
        `not match the recomputed order total. Session marked FAILED; order NOT settled.`,
    );
  } else if (outcome.outcome === "unknown_session") {
    console.warn(`Stripe sale webhook for unknown session ${sessionId} (ignored).`);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
