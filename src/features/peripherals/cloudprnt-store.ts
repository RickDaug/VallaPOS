/**
 * The process-wide CloudPRNT `QueueStore` used by the route handler.
 *
 * ── Durability (findings #19 + R3-#1) ───────────────────────────────────────
 * `getCloudPrntStore()` returns a DURABLE, Upstash-Redis-backed store when the
 * Upstash env vars are configured (`UPSTASH_REDIS_REST_URL` +
 * `UPSTASH_REDIS_REST_TOKEN`), and falls back to the bundled `InMemoryQueueStore`
 * when they are not — mirroring the optional-config pattern in
 * `src/lib/redis.ts` (auth's secondary storage).
 *
 * Why this matters: on Vercel serverless the in-memory store is NOT shared across
 * lambda instances and is lost on cold start, so a receipt enqueued by one
 * request can be invisible to the printer's next poll (which may land on a
 * different instance). Backing the queue with a Redis LIST per
 * `(businessId, deviceToken)` makes the queue shared + persistent, so no receipt
 * is dropped between instances. The in-memory fallback keeps local dev and tests
 * (and single-long-lived-process deployments) working with zero config — with the
 * documented caveat that it is single-instance only.
 *
 * ── R3-#1: the in-memory fallback is now a LOUD, guarded path ────────────────
 * The durable Redis store is the PREFERRED default. If Upstash is absent we still
 * fall back to in-memory (so zero-config dev / a single long-lived Node process
 * keep working), BUT when that fallback happens in a serverless/production
 * environment — where in-memory is genuinely non-durable — `createCloudPrntStore`
 * logs a loud `console.error` so the operator can't silently ship a queue that
 * drops receipts between lambda instances. A DB (Prisma) backed queue remains the
 * tracked FOLLOW-UP for teams that can't run Upstash (it needs a schema/migration,
 * intentionally out of scope here). The selection + "unsafe fallback" predicates
 * are extracted pure below so the choice is unit-tested without env/`process`.
 *
 * The chosen store is memoised on `globalThis` (like the Prisma singleton) so
 * Next.js dev hot-reload doesn't spawn a fresh store on every edit, and so the
 * route keeps a stable instance across requests in one process. Both backends
 * implement the SAME `QueueStore` interface, so the route handler and the pure
 * `cloudprnt.ts` logic are unchanged and storage-agnostic.
 *
 * Kept in its own (non-`server-only`) module so `cloudprnt.ts` and the route can
 * be tested without instantiating a global singleton.
 */

import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";
import {
  InMemoryQueueStore,
  type PrintJob,
  type QueueKey,
  type QueueStore,
} from "./cloudprnt";

const GLOBAL_KEY = "__vallapos_cloudprnt_store__";

type GlobalWithStore = typeof globalThis & { [GLOBAL_KEY]?: QueueStore };

// ---------------------------------------------------------------------------
// Redis-backed durable QueueStore.
// ---------------------------------------------------------------------------

/**
 * The minimal Upstash Redis surface `RedisQueueStore` needs. Declared
 * structurally (rather than importing the concrete class type) so tests can pass
 * a lightweight fake without standing up a real Redis. `@upstash/redis`'s `Redis`
 * satisfies this shape.
 */
export interface RedisListClient {
  rpush(key: string, ...values: string[]): Promise<number>;
  lindex(key: string, index: number): Promise<string | null>;
  lpop(key: string): Promise<string | null>;
  llen(key: string): Promise<number>;
}

/** Namespaced Redis LIST key for one `(businessId, deviceToken)` queue. */
function redisKey(key: QueueKey): string {
  return `cloudprnt:${key.businessId}:${key.deviceToken}`;
}

/** Serialize a `PrintJob` to a JSON string (bytes as base64) for Redis storage. */
function serializeJob(job: PrintJob): string {
  return JSON.stringify({
    id: job.id,
    mediaType: job.mediaType,
    enqueuedAt: job.enqueuedAt,
    // `bytes` is a Uint8Array; base64 round-trips it losslessly through JSON.
    bytesB64: Buffer.from(job.bytes).toString("base64"),
  });
}

/** Parse a job JSON string back into a `PrintJob` (rehydrating the byte stream). */
function deserializeJob(raw: string): PrintJob {
  const o = JSON.parse(raw) as {
    id: string;
    mediaType: string;
    enqueuedAt: number;
    bytesB64: string;
  };
  return {
    id: o.id,
    mediaType: o.mediaType,
    enqueuedAt: o.enqueuedAt,
    bytes: new Uint8Array(Buffer.from(o.bytesB64, "base64")),
  };
}

/**
 * Durable `QueueStore` backed by an Upstash Redis LIST per queue key. FIFO:
 * `enqueue` RPUSHes to the back, `peek`/`dequeue` read/remove the FRONT (index 0).
 * Redis drops a list automatically once it's empty, so no manual cleanup is
 * needed (matching the in-memory store's "delete empty queue" behavior).
 *
 * `dequeue`'s match-then-pop is a read followed by an LPOP — not a single atomic
 * op. That's acceptable here: a CloudPRNT queue is polled by exactly ONE physical
 * printer, so there is no concurrent consumer to race with. Delivery stays
 * at-least-once (a failed print never DELETEs, so the job is re-served).
 */
export class RedisQueueStore implements QueueStore {
  constructor(private readonly redis: RedisListClient) {}

  async enqueue(key: QueueKey, job: PrintJob): Promise<void> {
    await this.redis.rpush(redisKey(key), serializeJob(job));
  }

  async peek(key: QueueKey): Promise<PrintJob | null> {
    const raw = await this.redis.lindex(redisKey(key), 0);
    return raw == null ? null : deserializeJob(raw);
  }

  async dequeue(key: QueueKey, jobId?: string): Promise<PrintJob | null> {
    const k = redisKey(key);
    const raw = await this.redis.lindex(k, 0);
    if (raw == null) return null;
    const job = deserializeJob(raw);
    // Only remove the front if it matches the confirmed id (or no id given) —
    // a stale/duplicate DELETE is a safe no-op, mirroring InMemoryQueueStore.
    if (jobId != null && job.id !== jobId) return null;
    await this.redis.lpop(k);
    return job;
  }

  async size(key: QueueKey): Promise<number> {
    return this.redis.llen(redisKey(key));
  }
}

// ---------------------------------------------------------------------------
// Store selection.
// ---------------------------------------------------------------------------

/**
 * Environment inputs that decide which CloudPRNT store to build. Pulled out as a
 * plain struct so the selection logic is PURE + unit-testable without touching
 * `process.env` or `@/lib/env`.
 */
export interface CloudPrntStoreEnv {
  /** Upstash Redis REST URL (from validated env; undefined when unset). */
  upstashUrl: string | undefined;
  /** Upstash Redis REST token (from validated env; undefined when unset). */
  upstashToken: string | undefined;
  /**
   * True in a multi-instance serverless deployment (Vercel) or any production
   * build — the environments where an in-memory queue is NOT durable (a job can
   * be dropped between lambda instances or lost on cold start). False for local
   * dev / a single long-lived Node process, where in-memory is fine.
   */
  serverless: boolean;
}

/** Which concrete `QueueStore` backend to build. */
export type CloudPrntStoreKind = "redis" | "memory";

/** True when BOTH Upstash env vars are present (a durable Redis store is possible). */
export function hasUpstashConfig(storeEnv: CloudPrntStoreEnv): boolean {
  return Boolean(storeEnv.upstashUrl && storeEnv.upstashToken);
}

/**
 * PURE store selection: prefer the DURABLE Redis store whenever Upstash is
 * configured; only fall back to the in-memory store when it isn't. This is the
 * whole R3-#1 policy — Redis is the default path, not an opt-in.
 */
export function selectCloudPrntStoreKind(storeEnv: CloudPrntStoreEnv): CloudPrntStoreKind {
  return hasUpstashConfig(storeEnv) ? "redis" : "memory";
}

/**
 * True when we're about to use the in-memory store in an environment where it is
 * NOT durable (serverless/production). The caller MUST log a loud warning in this
 * case — a receipt enqueued on one instance can be invisible to the printer's next
 * poll on another. Local dev / a single long-lived process (`serverless: false`)
 * returns false: in-memory is perfectly durable there, so no warning fires.
 */
export function inMemoryStoreIsUnsafe(storeEnv: CloudPrntStoreEnv): boolean {
  return selectCloudPrntStoreKind(storeEnv) === "memory" && storeEnv.serverless;
}

/** Read the store-selection inputs from the validated `env` + the runtime process. */
function readCloudPrntStoreEnv(): CloudPrntStoreEnv {
  return {
    upstashUrl: env.UPSTASH_REDIS_REST_URL,
    upstashToken: env.UPSTASH_REDIS_REST_TOKEN,
    // Vercel sets `VERCEL=1` on every (multi-instance) serverless deployment; a
    // production build is likewise never a single dev process. Either means the
    // in-memory queue is non-durable.
    serverless: Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production",
  };
}

/**
 * Build the store to use for this process: a durable `RedisQueueStore` when
 * Upstash is configured, else the in-memory fallback. Mirrors
 * `createSecondaryStorage()` in src/lib/redis.ts (same env vars, same
 * `automaticDeserialization: false` so we control JSON ourselves). When the
 * fallback is taken in a serverless/production environment it logs a loud
 * `console.error` (R3-#1) — see the module header.
 */
function createCloudPrntStore(): QueueStore {
  const storeEnv = readCloudPrntStoreEnv();
  if (selectCloudPrntStoreKind(storeEnv) === "redis") {
    const redis = new Redis({
      url: storeEnv.upstashUrl!,
      token: storeEnv.upstashToken!,
      automaticDeserialization: false,
    });
    return new RedisQueueStore(redis);
  }
  // No Upstash configured → in-memory. Durable ONLY in a single long-lived process
  // (local dev / self-host). On serverless it is NOT shared across instances and is
  // lost on cold start, so warn LOUDLY — a queued receipt can silently never reach
  // the printer. (A Prisma/DB-backed queue is the tracked follow-up; it needs a
  // migration and is intentionally out of scope here.)
  if (inMemoryStoreIsUnsafe(storeEnv)) {
    console.error(
      "[cloudprnt] ⚠ Falling back to the NON-DURABLE in-memory print-queue store " +
        "in a serverless/production environment. Print jobs enqueued on one " +
        "instance can be invisible to the printer's next poll on another instance " +
        "and are lost on cold start. Set UPSTASH_REDIS_REST_URL + " +
        "UPSTASH_REDIS_REST_TOKEN to enable the durable Redis-backed queue.",
    );
  }
  return new InMemoryQueueStore();
}

/**
 * Return the shared CloudPRNT queue store for this process (durable when Upstash
 * is configured, in-memory otherwise). Memoised on `globalThis`.
 */
export function getCloudPrntStore(): QueueStore {
  const g = globalThis as GlobalWithStore;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = createCloudPrntStore();
  return g[GLOBAL_KEY];
}
