import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * isPaymentsConfigured now requires BOTH the secret key AND the webhook signing
 * secret (audit R4 #4): activating Connect without a verifiable webhook is a
 * misleading half-setup. env-level shape validation guarantees the keys look
 * real, so this gate is simply "both present".
 */
const BASE_ENV = {
  DATABASE_URL: "postgres://user:pass@host:5432/db",
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "https://app.example.com",
  NEXT_PUBLIC_APP_URL: "https://app.example.com",
};

let snapshot: NodeJS.ProcessEnv;

beforeEach(() => {
  snapshot = { ...process.env };
  for (const k of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]) delete process.env[k];
  Object.assign(process.env, BASE_ENV);
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env = snapshot;
  vi.restoreAllMocks();
});

async function isConfigured() {
  const mod = await import("./connect-stripe");
  return mod.isPaymentsConfigured();
}

describe("isPaymentsConfigured", () => {
  it("is false when nothing is set", async () => {
    expect(await isConfigured()).toBe(false);
  });

  it("is false with only the secret key (no verifiable webhook)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
    expect(await isConfigured()).toBe(false);
  });

  it("is false with only the webhook secret", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_abc123";
    expect(await isConfigured()).toBe(false);
  });

  it("is true only when BOTH secret + webhook secret are present", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_abc123";
    expect(await isConfigured()).toBe(true);
  });
});
