// NOTE: server-only by usage (imported solely by src/lib/auth.ts). We don't add
// `import "server-only"` here because auth.ts is also loaded headlessly by
// seed.ts / smoke-auth.ts under tsx, where the server-only guard throws. The
// Upstash token is a non-NEXT_PUBLIC env var, so Next never ships it client-side.
import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";
import type { SecondaryStorage } from "better-auth";

/**
 * Better Auth `secondaryStorage` backed by Upstash Redis — used for the shared,
 * persistent rate-limit store (and session cache). Returns `null` when Upstash
 * isn't configured so auth gracefully falls back to per-instance in-memory
 * limiting (fine for local dev; on Vercel set both env vars for real protection).
 *
 * `automaticDeserialization: false` keeps values as the exact strings Better
 * Auth writes (it stores its own JSON), avoiding double-parse round-trips.
 */
export function createSecondaryStorage(): SecondaryStorage | null {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const redis = new Redis({ url, token, automaticDeserialization: false });

  // "Degrade, never crash": a transient Upstash timeout must not throw into the
  // auth path. On error we log and fall back to cache-miss (get) / no-op
  // (set/delete) — the same behavior as Upstash being unconfigured.
  return {
    get: async (key) => {
      try {
        return (await redis.get<string>(key)) ?? null;
      } catch (err) {
        console.error("Upstash secondaryStorage get failed:", err);
        return null;
      }
    },
    set: async (key, value, ttl) => {
      try {
        // ttl is in seconds (Better Auth passes it for rate-limit/session expiry).
        if (ttl) await redis.set(key, value, { ex: ttl });
        else await redis.set(key, value);
      } catch (err) {
        console.error("Upstash secondaryStorage set failed:", err);
      }
    },
    delete: async (key) => {
      try {
        await redis.del(key);
      } catch (err) {
        console.error("Upstash secondaryStorage delete failed:", err);
      }
    },
  };
}
