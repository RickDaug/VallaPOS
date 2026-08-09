/**
 * Pricing shape for the desktop edition ($99 one-time offline license).
 *
 * Deliberately a SEPARATE module from checkout-stripe.ts: that file pulls in
 * `server-only` and `@/lib/env`, and env.ts throws when the four required vars
 * are absent — which is the case under vitest. Keeping this logic env-free is
 * what makes it unit-testable.
 */

/** The one-time offline-desktop license price (integer cents). */
export const DESKTOP_PRICE_CENTS = 9900;

/**
 * The single Checkout line item for the desktop license.
 *
 * Prefers the CATALOG Price when `DESKTOP_PRICE_ID` is set: inline `price_data`
 * with `product_data` makes Stripe mint a BRAND-NEW ad-hoc Product on every sale
 * (they pile up in the Dashboard and can't be reported on as one product line),
 * whereas a Price id keeps the desktop edition to one catalog entry and lets the
 * amount change without a deploy. Falls back to the inline price so the feature
 * still runs with only STRIPE_SECRET_KEY set.
 */
export function desktopLineItem(priceId?: string) {
  if (priceId) return { quantity: 1, price: priceId } as const;
  return {
    quantity: 1,
    price_data: {
      currency: "usd",
      unit_amount: DESKTOP_PRICE_CENTS,
      product_data: { name: "VallaPOS Desktop — Lifetime License (Offline)" },
    },
  } as const;
}
