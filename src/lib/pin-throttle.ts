// NOTE: server-only by usage (imported only by server actions that verify PINs).
// We don't add `import "server-only"` so it stays unit-testable / importable
// headlessly (mirrors pin.ts), and it touches only `node`/Upstash at call time.
import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";

/**
 * Per-membership failed-PIN-attempt throttling + lockout.
 *
 * `verifyMemberPin` is a Next server action that sits OUTSIDE Better Auth's rate
 * limiter, so without this any active member could brute-force a co-member's
 * short numeric PIN. We count consecutive failures within a sliding window and,
 * once they cross a threshold, lock that membership for a cool-down. scrypt only
 * slows each guess; this caps how many guesses are even allowed.
 *
 * Storage mirrors the project's optional-Redis pattern (see `redis.ts`): when
 * BOTH Upstash env vars are set we use a shared/persistent Redis counter; when
 * unset we fall back to a per-instance in-memory Map (fine for local dev, real
 * protection on Vercel needs the env vars set). Keys are scoped by
 * businessId + membershipId so isolation is preserved.
 *
 * No schema change: state lives in Redis/memory with a TTL, never in the DB.
 */

/** Consecutive failures within the window before a membership is locked. */
const MAX_FAILURES = 5;
/** Sliding window over which failures accumulate (seconds). */
const WINDOW_SECONDS = 5 * 60;
/** Cool-down once locked; the membership can't be verified until it elapses (seconds). */
const LOCKOUT_SECONDS = 60;

function key(businessId: string, membershipId: string): string {
  return `pin-throttle:${businessId}:${membershipId}`;
}

type Entry = { count: number; lockedUntil: number; expiresAt: number };

/** Lazily created singleton Redis client, or `null` when Upstash isn't configured. */
let redisClient: Redis | null | undefined;
function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  redisClient =
    url && token ? new Redis({ url, token, automaticDeserialization: true }) : null;
  return redisClient;
}

/**
 * In-memory fallback. Module-level so it survives across requests on the same
 * instance (Next may reuse the action module). Entries self-expire on read.
 */
const memStore = new Map<string, Entry>();

function readMem(k: string): Entry | null {
  const e = memStore.get(k);
  if (!e) return null;
  if (e.expiresAt <= Date.now()) {
    memStore.delete(k);
    return null;
  }
  return e;
}

/**
 * Throws if the membership is currently locked out. Call BEFORE verifying a PIN.
 * The thrown message is generic so a brute-forcer learns nothing actionable, and
 * callers translate it into a plain `{ valid: false }`.
 */
export async function assertNotLocked(
  businessId: string,
  membershipId: string,
): Promise<void> {
  const k = key(businessId, membershipId);
  const redis = getRedis();
  const now = Date.now();

  if (redis) {
    const entry = await redis.get<Entry>(k);
    if (entry && entry.lockedUntil > now) throw new Error("PIN entry temporarily locked.");
    return;
  }

  const entry = readMem(k);
  if (entry && entry.lockedUntil > now) throw new Error("PIN entry temporarily locked.");
}

/**
 * Record a failed PIN attempt. Increments the consecutive-failure counter within
 * the sliding window and locks the membership once it reaches `MAX_FAILURES`.
 */
export async function recordFailure(
  businessId: string,
  membershipId: string,
): Promise<void> {
  const k = key(businessId, membershipId);
  const redis = getRedis();
  const now = Date.now();

  if (redis) {
    const existing = (await redis.get<Entry>(k)) ?? null;
    const count = (existing?.count ?? 0) + 1;
    const locked = count >= MAX_FAILURES;
    const lockedUntil = locked ? now + LOCKOUT_SECONDS * 1000 : (existing?.lockedUntil ?? 0);
    // TTL covers whichever lasts longer: the failure window or the active lockout.
    const ttl = locked ? Math.max(WINDOW_SECONDS, LOCKOUT_SECONDS) : WINDOW_SECONDS;
    const entry: Entry = { count, lockedUntil, expiresAt: now + ttl * 1000 };
    await redis.set(k, entry, { ex: ttl });
    return;
  }

  const existing = readMem(k);
  const count = (existing?.count ?? 0) + 1;
  const locked = count >= MAX_FAILURES;
  const lockedUntil = locked ? now + LOCKOUT_SECONDS * 1000 : (existing?.lockedUntil ?? 0);
  const ttl = locked ? Math.max(WINDOW_SECONDS, LOCKOUT_SECONDS) : WINDOW_SECONDS;
  memStore.set(k, { count, lockedUntil, expiresAt: now + ttl * 1000 });
}

/** Reset the counter/lockout after a successful PIN verification. */
export async function recordSuccess(
  businessId: string,
  membershipId: string,
): Promise<void> {
  const k = key(businessId, membershipId);
  const redis = getRedis();
  if (redis) {
    await redis.del(k);
    return;
  }
  memStore.delete(k);
}
