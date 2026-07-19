import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isBillingEnforceGateOn, BILLING_ENFORCE_GATE_DEFAULT } from "./flags";

/**
 * `subscription-access.ts` imports `@/lib/env`, which validates process.env at
 * import time. So — like `connect-stripe.test.ts` — we set a valid base env in
 * beforeEach and DYNAMICALLY import the module inside each test (with
 * vi.resetModules) so the env (and edition) reflect that test's process.env.
 * `flags.ts` is pure (no env) and can be imported statically.
 */

const BASE_ENV = {
  DATABASE_URL: "postgres://user:pass@host:5432/db",
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "https://app.example.com",
  NEXT_PUBLIC_APP_URL: "https://app.example.com",
};

const BILLING_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_SUBSCRIPTION_PRICE_ID",
  "STRIPE_SUBSCRIPTION_WEBHOOK_SECRET",
  "BILLING_ENFORCE_GATE",
  "NEXT_PUBLIC_VALLA_EDITION",
];

let snapshot: NodeJS.ProcessEnv;

beforeEach(() => {
  snapshot = { ...process.env };
  for (const k of BILLING_KEYS) delete process.env[k];
  Object.assign(process.env, BASE_ENV);
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env = snapshot;
  vi.restoreAllMocks();
});

async function load() {
  return import("./subscription-access");
}

function setConfigured() {
  process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
  process.env.STRIPE_SUBSCRIPTION_PRICE_ID = "price_abc123";
  process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET = "whsec_abc123";
}

describe("resolveSubscriptionAccess (pure status → access)", () => {
  it("active / trialing → allowed", async () => {
    const { resolveSubscriptionAccess } = await load();
    expect(resolveSubscriptionAccess("active")).toBe("allowed");
    expect(resolveSubscriptionAccess("trialing")).toBe("allowed");
  });

  it("past_due → grace (app usable + banner)", async () => {
    const { resolveSubscriptionAccess } = await load();
    expect(resolveSubscriptionAccess("past_due")).toBe("grace");
  });

  it("everything else incl. null → blocked (fail closed)", async () => {
    const { resolveSubscriptionAccess } = await load();
    for (const s of [
      "canceled",
      "unpaid",
      "incomplete",
      "incomplete_expired",
      "paused",
      "weird_unknown",
    ]) {
      expect(resolveSubscriptionAccess(s)).toBe("blocked");
    }
    expect(resolveSubscriptionAccess(null)).toBe("blocked");
  });
});

describe("isBillingEnforceGateOn (enforcement flag)", () => {
  it("ships OFF by default", () => {
    expect(BILLING_ENFORCE_GATE_DEFAULT).toBe(false);
  });

  it("is OFF when unset", () => {
    expect(isBillingEnforceGateOn({})).toBe(false);
  });

  it("is ON only for explicit truthy strings", () => {
    expect(isBillingEnforceGateOn({ BILLING_ENFORCE_GATE: "true" })).toBe(true);
    expect(isBillingEnforceGateOn({ BILLING_ENFORCE_GATE: "1" })).toBe(true);
  });

  it("treats any other value as OFF", () => {
    for (const v of ["false", "0", "yes", "", "TRUE"]) {
      expect(isBillingEnforceGateOn({ BILLING_ENFORCE_GATE: v })).toBe(false);
    }
  });
});

describe("isBillingConfigured", () => {
  it("is false when nothing is set (billing dormant, no UI)", async () => {
    const { isBillingConfigured } = await load();
    expect(isBillingConfigured()).toBe(false);
  });

  it("is false when only some keys are present", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
    process.env.STRIPE_SUBSCRIPTION_PRICE_ID = "price_abc123";
    // missing webhook secret
    const { isBillingConfigured } = await load();
    expect(isBillingConfigured()).toBe(false);
  });

  it("is true only when secret + price + webhook secret are all present", async () => {
    setConfigured();
    const { isBillingConfigured } = await load();
    expect(isBillingConfigured()).toBe(true);
  });
});

describe("isBillingEnforced (the hard-block gate)", () => {
  it("is false when configured but the enforce gate is unarmed (INVARIANT: no lock-out)", async () => {
    setConfigured();
    const { isBillingConfigured, isBillingEnforced } = await load();
    expect(isBillingConfigured()).toBe(true);
    expect(isBillingEnforced()).toBe(false);
  });

  it("is false when the gate is armed but billing is NOT configured", async () => {
    process.env.BILLING_ENFORCE_GATE = "true";
    const { isBillingEnforced } = await load();
    expect(isBillingEnforced()).toBe(false);
  });

  it("is true only when configured AND armed AND cloud", async () => {
    setConfigured();
    process.env.BILLING_ENFORCE_GATE = "true";
    const { isBillingEnforced } = await load();
    expect(isBillingEnforced()).toBe(true);
  });

  it("is false on the local edition even when configured + armed (billing is cloud-only)", async () => {
    setConfigured();
    process.env.BILLING_ENFORCE_GATE = "true";
    process.env.NEXT_PUBLIC_VALLA_EDITION = "local";
    const { isBillingEnforced } = await load();
    expect(isBillingEnforced()).toBe(false);
  });
});
