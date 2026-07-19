/**
 * Hosted-Checkout gateway PORT (PAYMENTS.md §9, PR-C — the QR sale rail).
 *
 * The register/sale orchestration depends on this narrow interface, never on the
 * Stripe SDK directly — exactly like `ConnectGateway`. That keeps the sale
 * ORCHESTRATION (build the success/cancel URLs, recompute the amount, persist the
 * CheckoutSession row) fully unit-testable with the in-memory fake below, and
 * isolates every real network call to `checkout-stripe.ts`.
 *
 * No `import "server-only"` and no SDK import here so tests and node tooling can
 * import it freely.
 *
 * Direction (locked 2026-07-07): a **hosted Stripe Checkout Session created ON
 * the merchant's connected account** (direct charge, no platform fee). The
 * customer scans a QR to the returned URL and pays; a webhook settles it. See
 * docs/PAYMENTS.md §9.
 */

/** Everything the gateway needs to open a hosted Checkout Session. */
export interface CreateCheckoutSessionInput {
  /** Our tenant id — echoed into session metadata for reconciliation only (the
   *  webhook NEVER trusts metadata to resolve the tenant; it uses the returned
   *  `stripeSessionId` → CheckoutSession row). */
  businessId: string;
  /** The OPEN order this session collects payment for. */
  orderId: string;
  /** Register idempotency key — reused across a "Pay" re-tap so a duplicate tap
   *  returns the SAME Stripe session instead of opening a second one. */
  clientUuid: string;
  /** The connected account the session is created on (`acct_…`). */
  stripeAccountId: string;
  /** Server-recomputed order total, integer cents. Never a client amount. */
  amountCents: number;
  /** ISO-4217 currency (e.g. "USD"). Matches `Business.currency`. */
  currency: string;
  /** Where Stripe sends the customer after a successful payment. */
  successUrl: string;
  /** Where Stripe sends the customer if they cancel/abandon. */
  cancelUrl: string;
  /** Reconciliation metadata (businessId/orderId/clientUuid/orderNumber). */
  metadata: Record<string, string>;
}

/** The gateway's view of the opened session. */
export interface CheckoutSessionResult {
  /** Stripe Checkout Session id (`cs_…`) — GLOBALLY unique. */
  stripeSessionId: string;
  /** The hosted Checkout URL the customer scans / opens to pay. */
  url: string;
  /** Unix seconds when the session expires; null when not reported. */
  expiresAt: number | null;
}

/**
 * The port. One method: open a hosted Checkout Session on a connected account.
 * Settlement arrives out-of-band via the webhook, never through this interface.
 */
export interface CheckoutGateway {
  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionResult>;
}

/**
 * Deterministic in-memory fake for unit tests. Ids are derived from a seq (not
 * randomness) so tests stay reproducible; every call is recorded on `calls` so a
 * test can assert the amount/currency/metadata/idempotency inputs the
 * orchestration built. Mirrors `FakeConnectGateway`.
 */
export class FakeCheckoutGateway implements CheckoutGateway {
  private seq = 0;
  readonly calls: CreateCheckoutSessionInput[] = [];

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionResult> {
    this.calls.push(input);
    const n = ++this.seq;
    return {
      stripeSessionId: `cs_fake_${n}`,
      url: `https://checkout.stripe.test/pay/cs_fake_${n}`,
      expiresAt: null,
    };
  }
}
