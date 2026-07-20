/**
 * Desktop-license FULFILMENT — the pure orchestration behind a paid one-time
 * ($99) offline-edition purchase (docs/EDITIONS.md §6, SHIP_DESKTOP.md §2).
 *
 * Called by the Stripe webhook after a `checkout.session.completed` with
 * `payment_status:'paid'`. Signs a PERPETUAL offline license (reusing the merged
 * `issueLicense`) and persists it, keyed on the Stripe session for idempotency.
 *
 * PURE + injectable: `sign` (Ed25519 SignFn, backed by `LICENSE_SIGNING_SK` in
 * the real path) and `store` are passed in, so this holds NO secret and is fully
 * unit-testable. `iat` is passed in (never `Date.now()` here) for determinism.
 */
import { issueLicense } from "@/lib/license/issue";
import type { SignFn } from "@/lib/license/license";
import type { DesktopLicenseStore, LicenseRecord } from "./store";

/** The offline desktop edition SKU. */
export const DESKTOP_SKU = "vallapos-desktop";

export interface FulfillDesktopPurchaseInput {
  /** Stripe Checkout `session.id` — the idempotency key + the license id. */
  stripeSessionId: string;
  /** Buyer email (from the paid Stripe session) for delivery. */
  email: string;
  /** Issued-at, epoch ms. Passed in for determinism. */
  iat: number;
  /** Defaults to DESKTOP_SKU. */
  sku?: string;
}

export interface FulfillResult {
  record: LicenseRecord;
  /** False when this session had already been fulfilled (no re-sign, no re-charge). */
  newlyIssued: boolean;
}

export async function fulfillDesktopPurchase(
  input: FulfillDesktopPurchaseInput,
  deps: { sign: SignFn; store: DesktopLicenseStore },
): Promise<FulfillResult> {
  // Idempotency: a re-delivered webhook (or a double event) must return the
  // already-issued license, never sign a second one.
  const existing = await deps.store.findByStripeSession(input.stripeSessionId);
  if (existing) return { record: existing, newlyIssued: false };

  const sku = input.sku ?? DESKTOP_SKU;
  const licenseKey = await issueLicense(
    // Perpetual key (`ex` omitted → null); id = session for a stable, unique id.
    { sku, id: input.stripeSessionId, iat: input.iat },
    deps.sign,
  );

  const record = await deps.store.create({
    sku,
    stripeSessionId: input.stripeSessionId,
    email: input.email,
    licenseKey,
  });
  return { record, newlyIssued: true };
}
