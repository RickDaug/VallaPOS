/**
 * Connect onboarding ORCHESTRATION — pure, side-effect-free except through the
 * injected `ConnectGateway` (Stripe) and `ConnectStore` (persistence). No DB,
 * no SDK, no `server-only` import, so `connect-service.test.ts` drives the whole
 * flow with the FakeConnectGateway + an in-memory store.
 *
 * PR-A scope: create the connected account on first connect, persist its id,
 * hand back a hosted onboarding link, and reconcile capability status. Nothing
 * here charges money — that is PR-C.
 */

import type {
  ConnectGateway,
  ConnectedAccount,
  ConnectCountry,
} from "./connect-gateway";

/** The business fields the orchestration reads. */
export interface ConnectBusinessState {
  businessId: string;
  displayName: string;
  country: ConnectCountry;
  /** Existing connected account id, or null if never connected. */
  stripeAccountId: string | null;
}

/** Persistence port — the action supplies a Prisma-backed implementation. */
export interface ConnectStore {
  /** Persist the newly created connected account id on the business. */
  saveAccountId(businessId: string, accountId: string): Promise<void>;
  /**
   * Persist the capability status. Includes `accountId` so a stale webhook for a
   * DIFFERENT account can be ignored by the implementation (defense in depth).
   */
  saveChargesEnabled(
    businessId: string,
    accountId: string,
    chargesEnabled: boolean,
  ): Promise<void>;
}

export interface StartOnboardingInput {
  gateway: ConnectGateway;
  store: ConnectStore;
  business: ConnectBusinessState;
  /** Account contact email — the signed-in owner's email (from the session). */
  contactEmail: string;
  /** Absolute URLs Stripe redirects back to (return = done, refresh = expired). */
  returnUrl: string;
  refreshUrl: string;
}

export interface StartOnboardingResult {
  accountId: string;
  onboardingUrl: string;
  /** True when this call created the account (vs. reusing an existing one). */
  created: boolean;
}

/**
 * Begin (or resume) onboarding. Reuses an existing `stripeAccountId` so clicking
 * "Connect" twice never spawns a second account; a fresh business gets one
 * created and its id persisted BEFORE the link is minted, so a crash after
 * creation still leaves us able to resume.
 */
export async function startConnectOnboarding(
  input: StartOnboardingInput,
): Promise<StartOnboardingResult> {
  const { gateway, store, business, contactEmail, returnUrl, refreshUrl } = input;

  let accountId = business.stripeAccountId;
  let created = false;
  if (!accountId) {
    const account = await gateway.createConnectedAccount({
      businessId: business.businessId,
      country: business.country,
      email: contactEmail,
      displayName: business.displayName,
    });
    accountId = account.accountId;
    created = true;
    await store.saveAccountId(business.businessId, accountId);
  }

  const link = await gateway.createOnboardingLink({ accountId, returnUrl, refreshUrl });
  return { accountId, onboardingUrl: link.url, created };
}

/** Status returned to the UI: connected? capable of taking payments yet? */
export interface ConnectStatus {
  connected: boolean;
  accountId: string | null;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
}

export const NOT_CONNECTED: ConnectStatus = {
  connected: false,
  accountId: null,
  chargesEnabled: false,
  detailsSubmitted: false,
};

/**
 * Live-reconcile status from Stripe and persist `chargesEnabled` so reads that
 * don't hit Stripe (the register gate) stay correct between webhooks. A business
 * with no account short-circuits to NOT_CONNECTED without a network call.
 */
export async function refreshConnectStatus(input: {
  gateway: ConnectGateway;
  store: ConnectStore;
  business: ConnectBusinessState;
}): Promise<ConnectStatus> {
  const { gateway, store, business } = input;
  if (!business.stripeAccountId) return NOT_CONNECTED;

  const account = await gateway.getAccount(business.stripeAccountId);
  await store.saveChargesEnabled(
    business.businessId,
    account.accountId,
    account.chargesEnabled,
  );
  return toStatus(account);
}

export function toStatus(account: ConnectedAccount): ConnectStatus {
  return {
    connected: true,
    accountId: account.accountId,
    chargesEnabled: account.chargesEnabled,
    detailsSubmitted: account.detailsSubmitted,
  };
}
