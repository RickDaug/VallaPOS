/**
 * License ISSUANCE (docs/EDITIONS.md §3/§6) — the vallahub.com side. Builds +
 * signs a distributable license blob from a paid order. The Ed25519 `SignFn` is
 * INJECTED (the vallahub server provides one backed by `LICENSE_SIGNING_SK` via
 * `webcryptoEd25519Signer`), so this module holds NO secret and is unit-testable.
 *
 * Issuance flow it plugs into (vallahub, reusing the app/api/payments/webhook
 * pattern): one-time Stripe Checkout → `checkout.session.completed` → verify the
 * event + require `payment_status:'paid'` → `issueLicense({ id: session.id, … })` →
 * idempotent-upsert a `License` row keyed on `session.id` → deliver via Resend +
 * a success-page download. The desktop app never queries that DB.
 */
import {
  signLicense,
  licenseClaimsSchema,
  LICENSE_VERSION,
  type LicenseClaims,
  type SignFn,
} from "./license";

export interface IssueLicenseInput {
  /** SKU / plan identifier (e.g. "vallapos-desktop"). */
  sku: string;
  /** Unique, stable license id — use the Stripe `session.id` for idempotency. */
  id: string;
  /** Issued-at, epoch ms (pass a real timestamp; kept injectable for determinism). */
  iat: number;
  /** Expiry epoch ms; omit/null for a PERPETUAL key (the recommended default). */
  ex?: number | null;
}

/** Build the validated, canonical claims for a one-time offline license. */
export function buildLicenseClaims(input: IssueLicenseInput): LicenseClaims {
  return licenseClaimsSchema.parse({
    v: LICENSE_VERSION,
    p: "offline",
    sku: input.sku,
    id: input.id,
    iat: input.iat,
    ex: input.ex ?? null,
    dev: null, // device binding reserved but off for v1
  });
}

/** Build + sign a distributable license blob. */
export async function issueLicense(input: IssueLicenseInput, sign: SignFn): Promise<string> {
  return signLicense(buildLicenseClaims(input), sign);
}
