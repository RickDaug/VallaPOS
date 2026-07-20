/**
 * Desktop-license ($99 one-time) fulfilment webhook.
 *
 * SECURITY: authenticated by the Stripe SIGNATURE over the RAW body via
 * `constructDesktopEvent` — never a session — against the DISTINCT
 * `DESKTOP_LICENSE_WEBHOOK_SECRET` (not the Connect/subscription secrets). A bad
 * signature → 400 so Stripe retries; a verified event → 200 (handled or ignored).
 *
 * FLOW: verified `checkout.session.completed` (paid, our sku) → sign a perpetual
 * license (idempotent on the session) → deliver the key + download link. Idempotent
 * end-to-end: a re-delivered event returns the same license and does NOT re-email.
 *
 * DORMANT: 503 when Stripe/webhook isn't configured, or when the signer
 * (`LICENSE_SIGNING_SK`) is unset — a misdirected webhook is visibly ignored.
 */

import {
  constructDesktopEvent,
  desktopDownloadUrl,
  isDesktopWebhookConfigured,
} from "@/features/desktop-license/checkout-stripe";
import { loadLicenseSigner } from "@/features/desktop-license/signer";
import { prismaDesktopLicenseStore } from "@/features/desktop-license/prisma-store";
import { resendLicenseDelivery } from "@/features/desktop-license/delivery";
import { processDesktopWebhook } from "@/features/desktop-license/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isDesktopWebhookConfigured()) {
    return json({ error: "desktop license not configured" }, 503);
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return json({ error: "missing stripe-signature" }, 400);

  // Raw body verbatim — required for signature verification, before any parsing.
  const rawBody = await request.text();

  let event;
  try {
    event = await constructDesktopEvent(rawBody, signature);
  } catch (err) {
    console.error("Desktop-license webhook verification failed:", err);
    return json({ error: "invalid signature" }, 400);
  }

  const sign = await loadLicenseSigner();
  if (!sign) {
    // Verified event but we can't sign — 503 so Stripe retries once the key lands.
    console.error("LICENSE_SIGNING_SK is not configured — cannot issue a license.");
    return json({ error: "signer not configured" }, 503);
  }

  try {
    await processDesktopWebhook(
      { type: event.type, object: event.data.object },
      {
        sign,
        store: prismaDesktopLicenseStore,
        deliver: resendLicenseDelivery,
        now: Date.now(),
        downloadUrl: desktopDownloadUrl(),
      },
    );
  } catch (err) {
    // Persist/sign/deliver failure → 500 so Stripe retries (fulfilment is idempotent).
    console.error("Desktop-license fulfilment failed:", err);
    return json({ error: "fulfilment failed" }, 500);
  }

  return json({ received: true }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
