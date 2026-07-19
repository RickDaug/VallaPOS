/**
 * Flat SaaS subscription (PAYMENTS.md §9, PR-D) — PURE access resolution + the
 * two independent gate flags. No SDK, no DB, no `server-only`, so it is safe to
 * import from the layout (server) AND the settings/gate components (client) and
 * fully unit-testable.
 *
 * TWO GATES, deliberately independent (invariant #1 + #4):
 *   - `isBillingConfigured()` — platform has the subscription keys + Price wired.
 *     Controls whether the Subscribe / Manage-billing UI is shown at all. When
 *     unset the whole billing surface is invisible and the app is byte-for-byte
 *     the current app.
 *   - `isBillingEnforced()`  — the SEPARATE `BILLING_ENFORCE_GATE` flag (default
 *     OFF) AND the cloud edition AND `isBillingConfigured()`. ONLY when this is
 *     true does the hard block screen render. This lets us turn billing ON
 *     (collect voluntary subs, backfill trials) WITHOUT locking anyone out, then
 *     arm enforcement later. Unset ⇒ nobody is ever blocked.
 */

import { env } from "@/lib/env";
import { isCloud } from "@/lib/edition";
import { isBillingEnforceGateOn } from "./flags";

/** App access derived from Stripe's raw subscription status string. */
export type SubscriptionAccess = "allowed" | "grace" | "blocked";

/**
 * Map Stripe's raw subscription status → app access. PURE.
 *   - `active` / `trialing`            → allowed (full app)
 *   - `past_due`                       → grace   (app usable + a banner to fix billing)
 *   - everything else incl. `canceled`/`unpaid`/`incomplete`/`incomplete_expired`
 *     and `null`                       → blocked (hard block, only when enforced)
 *
 * Unknown strings default to blocked (fail closed), but note the hard block ONLY
 * renders when `isBillingEnforced()` is true — so a null status on an existing
 * tenant is harmless until enforcement is deliberately armed.
 */
export function resolveSubscriptionAccess(status: string | null): SubscriptionAccess {
  switch (status) {
    case "active":
    case "trialing":
      return "allowed";
    case "past_due":
      return "grace";
    default:
      return "blocked";
  }
}

/**
 * True when the platform subscription is FULLY configured: the platform secret
 * key, the flat-plan Price id, AND the (separate) subscription webhook signing
 * secret are all present. Gates whether the Subscribe/Manage UI is shown — an
 * owner should never see a Subscribe button we can't actually fulfill or verify.
 * Env-level shape validation already guarantees each value looks real.
 */
export function isBillingConfigured(): boolean {
  return Boolean(
    env.STRIPE_SECRET_KEY &&
      env.STRIPE_SUBSCRIPTION_PRICE_ID &&
      env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET,
  );
}

/**
 * True ONLY when the hard block is armed: the `BILLING_ENFORCE_GATE` flag is on
 * AND this is the cloud edition (billing is cloud-only — the offline desktop
 * edition is a one-time license, never gated) AND billing is configured. This is
 * the sole switch the layout consults before rendering the block screen, so
 * turning billing ON can never lock anyone out until this is explicitly set.
 */
export function isBillingEnforced(): boolean {
  return isBillingEnforceGateOn() && isCloud && isBillingConfigured();
}
