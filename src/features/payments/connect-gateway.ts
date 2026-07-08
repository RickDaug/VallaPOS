/**
 * Stripe Connect gateway PORT (PAYMENTS.md §9).
 *
 * The register/settings code depends on this narrow interface, never on the
 * Stripe SDK directly. That keeps the onboarding ORCHESTRATION (create account
 * on first connect, persist the id, surface capability status) fully unit-
 * testable with the in-memory fake below, and isolates every real network call
 * to `connect-stripe.ts`. No `import "server-only"` and no SDK import here so
 * tests and node tooling can import it freely.
 *
 * Direction (locked 2026-07-07): multi-merchant Connect, **Accounts v2**, SaaS /
 * DIRECT charges — the connected account is merchant of record; the platform
 * takes NO application fee. See docs/PAYMENTS.md §9.
 */

/** Countries we onboard at launch. ISO-3166 alpha-2, uppercased. */
export const CONNECT_COUNTRIES = ["US", "MX", "BR"] as const;
export type ConnectCountry = (typeof CONNECT_COUNTRIES)[number];

export function isConnectCountry(value: string): value is ConnectCountry {
  return (CONNECT_COUNTRIES as readonly string[]).includes(value);
}

export interface CreateConnectedAccountInput {
  /** Our tenant id — echoed into account metadata for reconciliation. */
  businessId: string;
  country: ConnectCountry;
  email: string;
  displayName: string;
}

/**
 * The subset of a connected account's state we care about. `chargesEnabled` is
 * the load-bearing flag: it mirrors the Accounts v2 `card_payments` capability
 * being `active`, and ONLY when true may a future sale rail charge the account.
 */
export interface ConnectedAccount {
  accountId: string; // acct_...
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
}

/** A hosted onboarding redirect (Stripe Account Link). */
export interface OnboardingLink {
  url: string;
  /** Unix seconds; links are short-lived. Null when the gateway doesn't report it. */
  expiresAt: number | null;
}

export interface CreateOnboardingLinkInput {
  accountId: string;
  /** Where Stripe sends the merchant back after finishing/abandoning onboarding. */
  returnUrl: string;
  /** Where Stripe sends them if the link expired and must be regenerated. */
  refreshUrl: string;
}

/**
 * The port. One method per real Stripe operation PR-A needs. Charging, refunds,
 * and Checkout Sessions are deliberately absent — they arrive with the QR rail
 * (PR-C), so nothing here can move money.
 */
export interface ConnectGateway {
  createConnectedAccount(input: CreateConnectedAccountInput): Promise<ConnectedAccount>;
  getAccount(accountId: string): Promise<ConnectedAccount>;
  createOnboardingLink(input: CreateOnboardingLinkInput): Promise<OnboardingLink>;
}

/**
 * Deterministic in-memory fake for unit tests. Accounts start NOT charges-
 * enabled (onboarding incomplete); call `markCharges` to simulate the webhook
 * flipping a capability to active. Ids are derived from a seq, not randomness,
 * so tests stay reproducible.
 */
export class FakeConnectGateway implements ConnectGateway {
  private seq = 0;
  readonly accounts = new Map<string, ConnectedAccount>();
  readonly created: CreateConnectedAccountInput[] = [];

  async createConnectedAccount(input: CreateConnectedAccountInput): Promise<ConnectedAccount> {
    this.created.push(input);
    const accountId = `acct_fake_${++this.seq}`;
    const account: ConnectedAccount = {
      accountId,
      chargesEnabled: false,
      detailsSubmitted: false,
    };
    this.accounts.set(accountId, account);
    return account;
  }

  async getAccount(accountId: string): Promise<ConnectedAccount> {
    const account = this.accounts.get(accountId);
    if (!account) throw new Error(`unknown account ${accountId}`);
    return account;
  }

  async createOnboardingLink(input: CreateOnboardingLinkInput): Promise<OnboardingLink> {
    if (!this.accounts.has(input.accountId)) {
      throw new Error(`unknown account ${input.accountId}`);
    }
    return {
      url: `https://connect.stripe.test/onboard/${input.accountId}?return=${encodeURIComponent(input.returnUrl)}`,
      expiresAt: null,
    };
  }

  /** Test helper — simulate the account webhook flipping capability state. */
  markCharges(accountId: string, chargesEnabled: boolean, detailsSubmitted = chargesEnabled): void {
    const account = this.accounts.get(accountId);
    if (!account) throw new Error(`unknown account ${accountId}`);
    account.chargesEnabled = chargesEnabled;
    account.detailsSubmitted = detailsSubmitted;
  }
}
