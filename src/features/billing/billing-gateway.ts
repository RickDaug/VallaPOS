/**
 * Platform Billing gateway PORT (PAYMENTS.md §9, PR-D — the flat SaaS subscription).
 *
 * OUR monetization, entirely SEPARATE from the Connect sale rail: the Business is
 * a Customer of VallaPOS's PLATFORM Stripe account and pays a flat $19.99/mo
 * subscription. There is NO `stripeAccount` param anywhere on this rail — every
 * call hits the platform account directly.
 *
 * The billing orchestration depends on this narrow interface, never on the Stripe
 * SDK directly — exactly like `ConnectGateway`/`CheckoutGateway`. That keeps the
 * orchestration (build success/cancel/return URLs, pick customer vs email) fully
 * unit-testable with the in-memory fake below, and isolates every real network
 * call to `billing-stripe.ts`. No `import "server-only"` and no SDK import here so
 * tests and node tooling can import it freely.
 */

/** Everything the gateway needs to open a subscription Checkout Session. */
export interface CreateSubscriptionCheckoutInput {
  /** Our tenant id — `client_reference_id` + metadata for webhook reconciliation. */
  businessId: string;
  /** Shown to Stripe / used in the customer record (display only). */
  businessName: string;
  /** The signed-in owner's email — used as `customer_email` when there is no
   *  existing customer yet (Stripe then creates the Customer). */
  ownerEmail: string;
  /** The platform flat-plan Price id (`price_…`). */
  priceId: string;
  /** Where Stripe returns the owner after a successful subscribe. */
  successUrl: string;
  /** Where Stripe returns the owner if they cancel/abandon. */
  cancelUrl: string;
  /** Reuse an existing platform Customer (`cus_…`) so a re-subscribe doesn't
   *  spawn a duplicate. Null/undefined ⇒ Stripe creates one from `ownerEmail`. */
  existingCustomerId?: string | null;
}

/** The gateway's view of the opened subscription Checkout Session. */
export interface SubscriptionCheckoutResult {
  /** The hosted Checkout URL the owner is redirected to. */
  url: string;
  /** The platform Customer id if the session already resolved one; else null. */
  customerId?: string | null;
}

/** Everything the gateway needs to open a Customer Portal session. */
export interface CreateBillingPortalInput {
  /** The platform Customer (`cus_…`) whose billing the owner manages. */
  customerId: string;
  /** Where the portal returns the owner when they're done. */
  returnUrl: string;
}

export interface BillingPortalResult {
  /** The hosted Customer Portal URL. */
  url: string;
}

/**
 * The port. Two methods: open a subscription Checkout (onboard/re-subscribe) and
 * open a Customer Portal (self-service manage/cancel). Webhook-driven state
 * arrives out-of-band, never through this interface.
 */
export interface BillingGateway {
  createSubscriptionCheckout(
    input: CreateSubscriptionCheckoutInput,
  ): Promise<SubscriptionCheckoutResult>;
  createBillingPortalSession(input: CreateBillingPortalInput): Promise<BillingPortalResult>;
}

/**
 * Deterministic in-memory fake for unit tests. Ids/URLs are derived from a seq
 * (not randomness) so tests stay reproducible; every call is recorded so a test
 * can assert exactly the inputs the orchestration built. Mirrors
 * `FakeConnectGateway` / `FakeCheckoutGateway`.
 */
export class FakeBillingGateway implements BillingGateway {
  private seq = 0;
  readonly checkoutCalls: CreateSubscriptionCheckoutInput[] = [];
  readonly portalCalls: CreateBillingPortalInput[] = [];

  async createSubscriptionCheckout(
    input: CreateSubscriptionCheckoutInput,
  ): Promise<SubscriptionCheckoutResult> {
    this.checkoutCalls.push(input);
    const n = ++this.seq;
    return {
      url: `https://billing.stripe.test/checkout/${n}?business=${encodeURIComponent(input.businessId)}`,
      customerId: input.existingCustomerId ?? null,
    };
  }

  async createBillingPortalSession(input: CreateBillingPortalInput): Promise<BillingPortalResult> {
    this.portalCalls.push(input);
    const n = ++this.seq;
    return {
      url: `https://billing.stripe.test/portal/${n}?customer=${encodeURIComponent(input.customerId)}`,
    };
  }
}
