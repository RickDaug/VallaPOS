import { describe, it, expect } from "vitest";
import { extractAccountCapability, HANDLED_ACCOUNT_EVENT_TYPES } from "./connect-webhook";
import { isConnectCountry, CONNECT_COUNTRIES } from "./connect-gateway";

describe("extractAccountCapability", () => {
  it("reads the v1 account.updated shape (charges_enabled + capabilities)", () => {
    const update = extractAccountCapability("account.updated", {
      id: "acct_123",
      charges_enabled: true,
      details_submitted: true,
      capabilities: { card_payments: "active" },
    });
    expect(update).toEqual({
      accountId: "acct_123",
      chargesEnabled: true,
      detailsSubmitted: true,
    });
  });

  it("reads the Accounts v2 nested capability status shape", () => {
    const update = extractAccountCapability("v2.core.account.updated", {
      id: "acct_v2",
      configuration: { merchant: { capabilities: { card_payments: { status: "active" } } } },
    });
    expect(update).toMatchObject({ accountId: "acct_v2", chargesEnabled: true });
    // detailsSubmitted defaults to true once charges are enabled.
    expect(update?.detailsSubmitted).toBe(true);
  });

  it("returns not-charge-ready while the capability is still inactive", () => {
    const update = extractAccountCapability("account.updated", {
      id: "acct_pending",
      charges_enabled: false,
      details_submitted: false,
      capabilities: { card_payments: "pending" },
    });
    expect(update).toEqual({
      accountId: "acct_pending",
      chargesEnabled: false,
      detailsSubmitted: false,
    });
  });

  it("ignores event types we don't handle", () => {
    expect(extractAccountCapability("checkout.session.completed", { id: "acct_123" })).toBeNull();
    expect(extractAccountCapability("payment_intent.succeeded", { id: "acct_123" })).toBeNull();
  });

  it("rejects objects without a valid acct_ id (never a false positive)", () => {
    expect(extractAccountCapability("account.updated", { id: "cus_123" })).toBeNull();
    expect(extractAccountCapability("account.updated", { id: 42 })).toBeNull();
    expect(extractAccountCapability("account.updated", null)).toBeNull();
    expect(extractAccountCapability("account.updated", "nope")).toBeNull();
  });

  it("all handled types are namespaced account events", () => {
    for (const t of HANDLED_ACCOUNT_EVENT_TYPES) {
      expect(t).toMatch(/account/);
    }
  });
});

describe("isConnectCountry", () => {
  it("accepts the launch countries and rejects others", () => {
    for (const c of CONNECT_COUNTRIES) expect(isConnectCountry(c)).toBe(true);
    expect(isConnectCountry("US")).toBe(true);
    expect(isConnectCountry("CA")).toBe(false);
    expect(isConnectCountry("us")).toBe(false); // case-sensitive, uppercased ISO
  });
});
