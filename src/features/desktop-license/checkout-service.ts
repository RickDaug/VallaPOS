/**
 * Pure orchestration for starting a desktop-license checkout: derive the
 * success/cancel URLs from the app base and create the session via the injected
 * gateway. No env, no Stripe — unit-testable with the fake gateway.
 */
import type { DesktopCheckoutGateway } from "./checkout-gateway";

export interface StartDesktopCheckout {
  url: string;
}

/** The Stripe template token it replaces with the real session id on redirect. */
export const SESSION_ID_TEMPLATE = "{CHECKOUT_SESSION_ID}";

export async function createDesktopCheckout(
  gateway: DesktopCheckoutGateway,
  appUrl: string,
): Promise<StartDesktopCheckout> {
  const base = appUrl.replace(/\/+$/, "");
  const session = await gateway.createCheckoutSession({
    // The success page (Slice: download) reads `session_id` to show the key +
    // download link; Stripe substitutes the template with the real session id.
    successUrl: `${base}/desktop/license?session_id=${SESSION_ID_TEMPLATE}`,
    cancelUrl: `${base}/#pricing`,
  });
  return { url: session.url };
}
