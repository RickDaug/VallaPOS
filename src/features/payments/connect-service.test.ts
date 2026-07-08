import { describe, it, expect } from "vitest";
import { FakeConnectGateway, type ConnectCountry } from "./connect-gateway";
import {
  startConnectOnboarding,
  refreshConnectStatus,
  NOT_CONNECTED,
  type ConnectStore,
  type ConnectBusinessState,
} from "./connect-service";

/** In-memory ConnectStore that records the last writes for assertions. */
function memStore() {
  const state = { accountId: null as string | null, chargesEnabled: false };
  const store: ConnectStore = {
    async saveAccountId(_businessId, accountId) {
      state.accountId = accountId;
    },
    async saveChargesEnabled(_businessId, _accountId, chargesEnabled) {
      state.chargesEnabled = chargesEnabled;
    },
  };
  return { store, state };
}

function business(overrides: Partial<ConnectBusinessState> = {}): ConnectBusinessState {
  return {
    businessId: "biz_1",
    displayName: "Taquería Valla",
    country: "MX" as ConnectCountry,
    stripeAccountId: null,
    ...overrides,
  };
}

const urls = {
  contactEmail: "owner@valla.test",
  returnUrl: "https://app.test/biz_1/settings/payments?connect=return",
  refreshUrl: "https://app.test/biz_1/settings/payments?connect=refresh",
};

describe("startConnectOnboarding", () => {
  it("creates a connected account on first connect and persists the id", async () => {
    const gateway = new FakeConnectGateway();
    const { store, state } = memStore();

    const result = await startConnectOnboarding({
      gateway,
      store,
      business: business(),
      ...urls,
    });

    expect(result.created).toBe(true);
    expect(result.accountId).toBe("acct_fake_1");
    expect(result.onboardingUrl).toContain("acct_fake_1");
    // Persisted BEFORE the link so a crash mid-flow can resume.
    expect(state.accountId).toBe("acct_fake_1");
    // The account was created with the business's country + owner email.
    expect(gateway.created).toEqual([
      {
        businessId: "biz_1",
        country: "MX",
        email: "owner@valla.test",
        displayName: "Taquería Valla",
      },
    ]);
  });

  it("reuses an existing account (no second account on a repeat connect)", async () => {
    const gateway = new FakeConnectGateway();
    const { store } = memStore();
    // Seed the gateway as if the account already exists.
    const existing = await gateway.createConnectedAccount({
      businessId: "biz_1",
      country: "US",
      email: "owner@valla.test",
      displayName: "Taquería Valla",
    });
    const createdCountBefore = gateway.created.length;

    const result = await startConnectOnboarding({
      gateway,
      store,
      business: business({ stripeAccountId: existing.accountId, country: "US" }),
      ...urls,
    });

    expect(result.created).toBe(false);
    expect(result.accountId).toBe(existing.accountId);
    // No new account was created.
    expect(gateway.created.length).toBe(createdCountBefore);
  });
});

describe("refreshConnectStatus", () => {
  it("short-circuits to NOT_CONNECTED without a network call when no account", async () => {
    const gateway = new FakeConnectGateway();
    const { store, state } = memStore();

    const status = await refreshConnectStatus({
      gateway,
      store,
      business: business({ stripeAccountId: null }),
    });

    expect(status).toEqual(NOT_CONNECTED);
    expect(status.connected).toBe(false);
    // Nothing persisted.
    expect(state.accountId).toBeNull();
  });

  it("reflects and persists capability once the account can charge", async () => {
    const gateway = new FakeConnectGateway();
    const { store, state } = memStore();
    const acct = await gateway.createConnectedAccount({
      businessId: "biz_1",
      country: "US",
      email: "owner@valla.test",
      displayName: "Taquería Valla",
    });

    // Before onboarding completes: connected but not charge-ready.
    const before = await refreshConnectStatus({
      gateway,
      store,
      business: business({ stripeAccountId: acct.accountId }),
    });
    expect(before).toMatchObject({ connected: true, chargesEnabled: false });
    expect(state.chargesEnabled).toBe(false);

    // Simulate the webhook flipping card_payments -> active.
    gateway.markCharges(acct.accountId, true);
    const after = await refreshConnectStatus({
      gateway,
      store,
      business: business({ stripeAccountId: acct.accountId }),
    });
    expect(after).toMatchObject({
      connected: true,
      chargesEnabled: true,
      detailsSubmitted: true,
      accountId: acct.accountId,
    });
    // Cached flag persisted for the non-Stripe read path.
    expect(state.chargesEnabled).toBe(true);
  });
});
