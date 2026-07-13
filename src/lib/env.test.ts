import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * env.ts validates and parses process.env at import time, so each case sets the
 * desired environment, resets the module cache, and dynamically re-imports it.
 *
 * The contract under test: the REQUIRED vars fail fast (throw), but the OPTIONAL
 * Upstash enhancement vars must DEGRADE to undefined on a blank/malformed value
 * — a misconfigured optional must never take down the whole app at boot.
 */
const VALID_REQUIRED = {
  DATABASE_URL: "postgres://user:pass@host:5432/db",
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "https://app.example.com",
  NEXT_PUBLIC_APP_URL: "https://app.example.com",
};

let snapshot: NodeJS.ProcessEnv;

beforeEach(() => {
  snapshot = { ...process.env };
  // Start from a clean slate for the keys we control.
  for (const k of [
    ...Object.keys(VALID_REQUIRED),
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  ]) {
    delete process.env[k];
  }
  vi.resetModules();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env = snapshot;
  vi.restoreAllMocks();
});

async function loadEnv() {
  return (await import("./env")).env;
}

describe("env — required vars", () => {
  it("parses when all required vars are valid", async () => {
    Object.assign(process.env, VALID_REQUIRED);
    const env = await loadEnv();
    expect(env.DATABASE_URL).toBe(VALID_REQUIRED.DATABASE_URL);
  });

  it("throws when a required var is missing", async () => {
    Object.assign(process.env, VALID_REQUIRED);
    delete process.env.DATABASE_URL;
    await expect(loadEnv()).rejects.toThrow(/Invalid environment variables/);
  });

  it("throws when a required URL is malformed (no graceful degrade for required)", async () => {
    Object.assign(process.env, VALID_REQUIRED, { BETTER_AUTH_URL: "not-a-url" });
    await expect(loadEnv()).rejects.toThrow(/Invalid environment variables/);
  });
});

describe("env — optional Upstash degrades instead of crashing", () => {
  it("drops a malformed UPSTASH url to undefined without throwing", async () => {
    Object.assign(process.env, VALID_REQUIRED, {
      UPSTASH_REDIS_REST_URL: "not-a-url",
      UPSTASH_REDIS_REST_TOKEN: "sometoken",
    });
    const env = await loadEnv();
    expect(env.UPSTASH_REDIS_REST_URL).toBeUndefined();
  });

  it("treats an empty-string UPSTASH url as unset (the Vercel blank-var case)", async () => {
    Object.assign(process.env, VALID_REQUIRED, { UPSTASH_REDIS_REST_URL: "" });
    const env = await loadEnv();
    expect(env.UPSTASH_REDIS_REST_URL).toBeUndefined();
  });

  it("keeps a valid Upstash url + token", async () => {
    Object.assign(process.env, VALID_REQUIRED, {
      UPSTASH_REDIS_REST_URL: "https://redis.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "validtoken",
    });
    const env = await loadEnv();
    expect(env.UPSTASH_REDIS_REST_URL).toBe("https://redis.upstash.io");
    expect(env.UPSTASH_REDIS_REST_TOKEN).toBe("validtoken");
  });

  it("raises a LOUD security alarm (console.error) when Upstash is set but invalid", async () => {
    // audit R4 #4: a misconfigured shared limiter guts brute-force lockout on
    // serverless, so the quiet warn was upgraded to a ⚠ SECURITY console.error.
    Object.assign(process.env, VALID_REQUIRED, { UPSTASH_REDIS_REST_URL: "not-a-url" });
    await loadEnv();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("⚠ SECURITY"),
    );
  });
});

describe("env — production fails fast on a broken security config (audit R4 #4)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws in production when Upstash is SET-but-invalid (lockout would be off)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    Object.assign(process.env, VALID_REQUIRED, {
      UPSTASH_REDIS_REST_URL: "not-a-url",
      UPSTASH_REDIS_REST_TOKEN: "tok",
    });
    await expect(loadEnv()).rejects.toThrow(/Refusing to boot in production/);
  });

  it("does NOT throw in production when Upstash is simply UNSET (only alarms)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    Object.assign(process.env, VALID_REQUIRED);
    const env = await loadEnv();
    expect(env.UPSTASH_REDIS_REST_URL).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("⚠ SECURITY"));
  });

  it("does NOT throw in development when Upstash is set-but-invalid", async () => {
    vi.stubEnv("NODE_ENV", "development");
    Object.assign(process.env, VALID_REQUIRED, { UPSTASH_REDIS_REST_URL: "not-a-url" });
    const env = await loadEnv();
    expect(env.UPSTASH_REDIS_REST_URL).toBeUndefined();
  });
});

describe("env — local edition boots without cloud config (docs/EDITIONS.md §4)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses placeholder defaults when Neon / Better Auth vars are absent", async () => {
    // beforeEach already deleted every cloud-required var; only flip the edition.
    vi.stubEnv("NEXT_PUBLIC_VALLA_EDITION", "local");
    const env = await loadEnv();
    expect(env.DATABASE_URL).toBe("file:vallapos.db");
    expect(env.BETTER_AUTH_SECRET).toBe("local-edition-better-auth-secret-unused");
    expect(env.BETTER_AUTH_URL).toBe("http://localhost");
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost");
  });

  it("does NOT fail-fast on missing Upstash in production (cloud-only concern)", async () => {
    vi.stubEnv("NEXT_PUBLIC_VALLA_EDITION", "local");
    vi.stubEnv("NODE_ENV", "production");
    const env = await loadEnv(); // must not throw
    expect(env.UPSTASH_REDIS_REST_URL).toBeUndefined();
  });

  it("accepts the on-device operator secret when provided", async () => {
    vi.stubEnv("NEXT_PUBLIC_VALLA_EDITION", "local");
    vi.stubEnv("VALLA_LOCAL_DEVICE_SECRET", "device-secret-abcdef0123");
    const env = await loadEnv();
    expect(env.VALLA_LOCAL_DEVICE_SECRET).toBe("device-secret-abcdef0123");
  });
});

describe("env — Stripe key shape validation (audit R4 #4)", () => {
  it("keeps well-formed Stripe keys", async () => {
    Object.assign(process.env, VALID_REQUIRED, {
      STRIPE_SECRET_KEY: "sk_test_abc123",
      STRIPE_WEBHOOK_SECRET: "whsec_abc123",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_abc123",
    });
    const env = await loadEnv();
    expect(env.STRIPE_SECRET_KEY).toBe("sk_test_abc123");
    expect(env.STRIPE_WEBHOOK_SECRET).toBe("whsec_abc123");
    expect(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY).toBe("pk_test_abc123");
  });

  it("accepts a restricted secret key (rk_)", async () => {
    Object.assign(process.env, VALID_REQUIRED, { STRIPE_SECRET_KEY: "rk_live_xyz789" });
    const env = await loadEnv();
    expect(env.STRIPE_SECRET_KEY).toBe("rk_live_xyz789");
  });

  it("drops a wrong-shape STRIPE_SECRET_KEY to undefined and alarms", async () => {
    Object.assign(process.env, VALID_REQUIRED, { STRIPE_SECRET_KEY: "totally-not-a-key" });
    const env = await loadEnv();
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("STRIPE_SECRET_KEY"));
  });

  it("drops a wrong-shape STRIPE_WEBHOOK_SECRET to undefined and alarms", async () => {
    Object.assign(process.env, VALID_REQUIRED, { STRIPE_WEBHOOK_SECRET: "nope" });
    const env = await loadEnv();
    expect(env.STRIPE_WEBHOOK_SECRET).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("STRIPE_WEBHOOK_SECRET"));
  });
});
