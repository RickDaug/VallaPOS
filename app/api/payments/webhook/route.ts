/**
 * Stripe webhook endpoint (PAYMENTS.md §9).
 *
 * PR-A handles ONLY connected-account capability events: when a business finishes
 * (or regresses) onboarding, Stripe fires an account event and we flip the cached
 * `stripeChargesEnabled` flag so the (future) sale rail knows whether the account
 * can take payments. Payment/charge events arrive with the QR rail (PR-C).
 *
 * SECURITY: the request is authenticated by the Stripe SIGNATURE, verified against
 * STRIPE_WEBHOOK_SECRET — never by a session (Stripe can't sign in). An unverified
 * body is rejected 400 so Stripe retries. The handler is idempotent: re-delivering
 * the same account event just re-writes the same flag.
 */

import {
  constructConnectEvent,
  isPaymentsConfigured,
} from "@/features/payments/connect-stripe";
import { extractAccountCapability } from "@/features/payments/connect-webhook";
import { applyChargesByAccountId } from "@/features/payments/connect-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // Feature dormant (no keys) → 503 so a misdirected webhook is visibly ignored.
  if (!isPaymentsConfigured()) {
    return json({ error: "payments not configured" }, 503);
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return json({ error: "missing stripe-signature" }, 400);

  // Raw body is required for signature verification — read it verbatim.
  const rawBody = await request.text();

  let event: { type: string; object: unknown };
  try {
    event = await constructConnectEvent(rawBody, signature);
  } catch (err) {
    // Bad signature or misconfigured secret — reject so Stripe retries.
    console.error("Stripe webhook verification failed:", err);
    return json({ error: "invalid signature" }, 400);
  }

  const update = extractAccountCapability(event.type, event.object);
  if (update) {
    const affected = await applyChargesByAccountId(update.accountId, update.chargesEnabled);
    if (affected === 0) {
      // Unknown account — acknowledge (200) so Stripe stops retrying, but log it.
      console.warn(`Stripe account webhook for unknown account ${update.accountId}`);
    }
  }

  // Always 200 for a verified event we understood (or safely ignored).
  return json({ received: true }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
