/**
 * Desktop-license webhook logic — PURE (no Stripe SDK, no env, no Prisma) so it's
 * unit-testable. The route does the SDK signature verification, then hands the
 * already-verified event here.
 */
import type { SignFn } from "@/lib/license/license";
import { DESKTOP_SKU, fulfillDesktopPurchase } from "./issue-service";
import type { DesktopLicenseStore } from "./store";

export interface DesktopPurchase {
  stripeSessionId: string;
  email: string;
}

interface CheckoutSessionShape {
  id?: unknown;
  payment_status?: unknown;
  metadata?: { sku?: unknown } | null;
  customer_details?: { email?: unknown } | null;
  customer_email?: unknown;
}

/**
 * Extract a fulfillable desktop purchase from a verified webhook event, or null.
 * Accepts ONLY a `checkout.session.completed` that is `paid`, tagged with our
 * `sku`, and carries a buyer email — so unrelated events on the same endpoint (or
 * other products) are safely ignored, never fulfilled.
 */
export function extractDesktopPurchase(event: { type: string; object: unknown }): DesktopPurchase | null {
  if (event.type !== "checkout.session.completed") return null;
  const s = event.object as CheckoutSessionShape;
  if (typeof s.id !== "string") return null;
  if (s.payment_status !== "paid") return null;
  if (!s.metadata || s.metadata.sku !== DESKTOP_SKU) return null;

  const email =
    (typeof s.customer_details?.email === "string" && s.customer_details.email) ||
    (typeof s.customer_email === "string" && s.customer_email) ||
    null;
  if (!email) return null;

  return { stripeSessionId: s.id, email };
}

export type DeliverLicenseFn = (input: {
  email: string;
  licenseKey: string;
  downloadUrl: string;
}) => Promise<void>;

export interface ProcessDesktopWebhookResult {
  /** False for an event that isn't our paid desktop purchase (safely ignored). */
  handled: boolean;
  /** True only when this call issued a NEW license (vs a re-delivered event). */
  newlyIssued: boolean;
}

/**
 * Fulfil a verified webhook: extract → sign+persist a license (idempotent on the
 * session) → deliver the key + download link, but ONLY on a newly-issued license
 * (so Stripe retries never re-email). Pure: sign/store/deliver/now/downloadUrl are
 * injected.
 */
export async function processDesktopWebhook(
  event: { type: string; object: unknown },
  deps: {
    sign: SignFn;
    store: DesktopLicenseStore;
    deliver: DeliverLicenseFn;
    now: number;
    downloadUrl: string;
  },
): Promise<ProcessDesktopWebhookResult> {
  const purchase = extractDesktopPurchase(event);
  if (!purchase) return { handled: false, newlyIssued: false };

  const { record, newlyIssued } = await fulfillDesktopPurchase(
    { stripeSessionId: purchase.stripeSessionId, email: purchase.email, iat: deps.now },
    { sign: deps.sign, store: deps.store },
  );

  if (newlyIssued) {
    await deps.deliver({
      email: record.email,
      licenseKey: record.licenseKey,
      downloadUrl: deps.downloadUrl,
    });
  }
  return { handled: true, newlyIssued };
}
