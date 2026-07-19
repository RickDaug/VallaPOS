/**
 * Platform subscription webhook endpoint (PAYMENTS.md §9, PR-D).
 *
 * This is the PLATFORM billing stream — OUR revenue — DISTINCT from the Connect
 * sale webhook at `app/api/payments/webhook`. It is a SEPARATE Stripe webhook
 * endpoint with its OWN signing secret (`STRIPE_SUBSCRIPTION_WEBHOOK_SECRET`); we
 * never reuse the Connect `STRIPE_WEBHOOK_SECRET` here.
 *
 * SECURITY: the request is authenticated by the Stripe SIGNATURE, verified over
 * the RAW body via `constructPlatformEvent` BEFORE any parsing — never a session.
 * An unverified body is 400 so Stripe retries; every VERIFIED event returns 200
 * (handled or safely ignored) so Stripe stops retrying. When billing is not
 * configured the endpoint is 503 (a misdirected webhook is visibly ignored).
 *
 * TENANT SAFETY + IDEMPOTENCY: `extractSubscriptionEvent` is pure; the store
 * resolves the business ONLY by the unique Stripe ids (subscription → customer)
 * or the metadata businessId, and every write is a last-write-wins `updateMany`.
 * An event that matches no business (count 0) is logged and 200'd — never a 500.
 */

import { isBillingConfigured } from "@/features/billing/subscription-access";
import { constructPlatformEvent } from "@/features/billing/billing-stripe";
import { extractSubscriptionEvent } from "@/features/billing/billing-webhook";
import { applySubscriptionState } from "@/features/billing/billing-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // Billing dormant (no keys) → 503 so a misdirected webhook is visibly ignored.
  if (!isBillingConfigured()) {
    return json({ error: "billing not configured" }, 503);
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return json({ error: "missing stripe-signature" }, 400);

  // Raw body is required for signature verification — read it verbatim, before
  // any JSON parsing.
  const rawBody = await request.text();

  let event;
  try {
    event = await constructPlatformEvent(rawBody, signature);
  } catch (err) {
    // Bad signature or misconfigured secret — reject so Stripe retries.
    console.error("Stripe billing webhook verification failed:", err);
    return json({ error: "invalid signature" }, 400);
  }

  const update = extractSubscriptionEvent({ type: event.type, object: event.object });
  if (update) {
    const res = await applySubscriptionState(update);
    if (res.matched === 0) {
      console.warn(
        `Stripe billing webhook ${event.type} matched no business ` +
          `(sub=${update.stripeSubscriptionId ?? "?"} customer=${update.stripeCustomerId ?? "?"} ` +
          `business=${update.businessId ?? "?"}). Ignored.`,
      );
    }
    return json({ received: true }, 200);
  }

  // Verified but not an event we act on — acknowledge.
  return json({ received: true }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
