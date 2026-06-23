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

  it("warns when a non-empty Upstash value was provided but rejected", async () => {
    // console.warn is already mocked in beforeEach.
    Object.assign(process.env, VALID_REQUIRED, { UPSTASH_REDIS_REST_URL: "not-a-url" });
    await loadEnv();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("falling back to per-instance"),
    );
  });
});
