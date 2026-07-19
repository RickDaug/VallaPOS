import { describe, it, expect, beforeEach, vi } from "vitest";

// Force the in-memory fallback path (no Upstash) so the test is deterministic and
// never touches the network — mirrors pin-throttle.test.ts.
vi.mock("@/lib/env", () => ({
  env: { UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined },
}));

import { rateLimit, __resetRateLimitMemory } from "./rate-limit";

// With no Upstash env vars set (the test environment), the limiter uses its
// in-memory fallback — deterministic and per-key.
describe("rateLimit (in-memory fallback)", () => {
  beforeEach(() => __resetRateLimitMemory());

  it("allows up to `limit` requests then blocks", async () => {
    const opts = { limit: 2, windowSeconds: 60 };
    const a = await rateLimit("k1", opts);
    expect(a.ok).toBe(true);
    expect(a.remaining).toBe(1);

    const b = await rateLimit("k1", opts);
    expect(b.ok).toBe(true);
    expect(b.remaining).toBe(0);

    const c = await rateLimit("k1", opts);
    expect(c.ok).toBe(false);
    expect(c.remaining).toBe(0);
  });

  it("tracks separate keys independently", async () => {
    const opts = { limit: 1, windowSeconds: 60 };
    expect((await rateLimit("ip-a", opts)).ok).toBe(true);
    expect((await rateLimit("ip-a", opts)).ok).toBe(false);
    // A different key has its own fresh budget.
    expect((await rateLimit("ip-b", opts)).ok).toBe(true);
  });

  it("reports a positive resetSeconds within the window", async () => {
    const r = await rateLimit("k2", { limit: 5, windowSeconds: 30 });
    expect(r.resetSeconds).toBeGreaterThan(0);
    expect(r.resetSeconds).toBeLessThanOrEqual(30);
  });
});
