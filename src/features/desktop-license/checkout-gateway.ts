/**
 * PORT for creating the one-time ($99) desktop-license Stripe Checkout Session.
 * The pure `checkout-service.ts` depends on this, so it's testable with the fake
 * and the real `server-only` Stripe impl (`checkout-stripe.ts`) stays out of the
 * tested path — mirroring the billing gateway split.
 */
export interface CreateDesktopCheckoutInput {
  /** Where Stripe returns the buyer after payment (carries the session id). */
  successUrl: string;
  /** Where Stripe returns the buyer if they cancel. */
  cancelUrl: string;
}

export interface DesktopCheckoutSession {
  /** The Stripe-hosted checkout URL to send the buyer to. */
  url: string;
}

export interface DesktopCheckoutGateway {
  createCheckoutSession(input: CreateDesktopCheckoutInput): Promise<DesktopCheckoutSession>;
}

/** Deterministic in-memory gateway for unit tests. */
export class FakeDesktopCheckoutGateway implements DesktopCheckoutGateway {
  public lastInput: CreateDesktopCheckoutInput | null = null;

  async createCheckoutSession(input: CreateDesktopCheckoutInput): Promise<DesktopCheckoutSession> {
    this.lastInput = input;
    return { url: `https://checkout.stripe.test/session?success=${encodeURIComponent(input.successUrl)}` };
  }
}
