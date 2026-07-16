// NOTE: server-only by usage (imported only by server actions/route handlers).
// We don't add `import "server-only"` so it stays unit-testable headlessly,
// mirroring pin-throttle.ts / redis.ts.
import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";

/**
 * Generic fixed-window IP (or key) rate limiter.
 *
 * Purpose-built for the PUBLIC, unauthenticated surface (QR self-ordering's
 * `submitOnlineOrder`) where there is no session/PIN to throttle on — the only
 * identity is the caller's IP. Complements `pin-throttle.ts` (which is a
 * failure-counting lockout keyed by membership); this one caps the raw request
 * RATE for anonymous callers.
 *
 * Storage mirrors the project's optional-Redis pattern (redis.ts / pin-throttle.ts):
 * when BOTH Upstash env vars are set we use a shared/persistent Redis counter
 * (correct across serverless instances); when unset we fall back to a per-instance
 * in-memory Map (fine for local dev — real protection on Vercel needs the env vars,
 * which are LIVE in prod). No schema change; state lives in Redis/memory with a TTL.
 *
 * Fixed-window (INCR + EXPIRE-on-first-hit) is deliberately simple and atomic on
 * Redis: the first request in a window sets the TTL; every request increments and
 * is allowed iff the running count is within `limit`.
 */

export interface RateLimitResult {
  /** True when the request is within the limit (allow it); false when it exceeded. */
  ok: boolean;
  /** Requests remaining in the current window (never negative). */
  remaining: number;
  /** Seconds until the current window resets. */
  resetSeconds: number;
}

export interface RateLimitOptions {
  /** Max requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/** Lazily created singleton Redis client, or `null` when Upstash isn't configured. */
let redisClient: Redis | null | undefined;
function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  redisClient = url && token ? new Redis({ url, token, automaticDeserialization: true }) : null;
  return redisClient;
}

// In-memory fallback (module-level so it survives across requests on one instance).
type Window = { count: number; expiresAt: number };
const memStore = new Map<string, Window>();

/**
 * Consume one unit against `key`. Returns whether the request is allowed plus the
 * remaining budget and window reset. Never throws for the caller's flow — on a
 * Redis error it FAILS OPEN (allows the request) so a transient limiter outage
 * can't take down the public endpoint; correctness of the limit is best-effort.
 */
export async function rateLimit(
  key: string,
  { limit, windowSeconds }: RateLimitOptions,
): Promise<RateLimitResult> {
  const redis = getRedis();
  const namespaced = `ratelimit:${key}`;

  if (redis) {
    try {
      const count = await redis.incr(namespaced);
      if (count === 1) {
        // First hit in this window — set the TTL.
        await redis.expire(namespaced, windowSeconds);
      }
      const ttl = await redis.ttl(namespaced);
      const resetSeconds = ttl > 0 ? ttl : windowSeconds;
      return {
        ok: count <= limit,
        remaining: Math.max(0, limit - count),
        resetSeconds,
      };
    } catch {
      // Fail open: never let a limiter outage break the endpoint.
      return { ok: true, remaining: limit, resetSeconds: windowSeconds };
    }
  }

  // In-memory fallback.
  const now = Date.now();
  const existing = memStore.get(namespaced);
  if (!existing || existing.expiresAt <= now) {
    memStore.set(namespaced, { count: 1, expiresAt: now + windowSeconds * 1000 });
    return { ok: 1 <= limit, remaining: Math.max(0, limit - 1), resetSeconds: windowSeconds };
  }
  existing.count += 1;
  return {
    ok: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    resetSeconds: Math.max(1, Math.ceil((existing.expiresAt - now) / 1000)),
  };
}

/** Test-only: clear the in-memory window store between cases. */
export function __resetRateLimitMemory(): void {
  memStore.clear();
}
