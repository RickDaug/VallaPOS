import { describe, it, expect, beforeEach, vi } from "vitest";

// cloudprnt-store imports `@/lib/env` (to decide Redis vs in-memory). Mock it so
// importing the module doesn't trip env.ts's startup validation under Vitest; we
// test `RedisQueueStore` directly with a fake client, so the values are unused.
vi.mock("@/lib/env", () => ({
  env: { UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined },
}));

import {
  RedisQueueStore,
  hasUpstashConfig,
  selectCloudPrntStoreKind,
  inMemoryStoreIsUnsafe,
  type RedisListClient,
  type CloudPrntStoreEnv,
} from "./cloudprnt-store";
import type { PrintJob, QueueKey } from "./cloudprnt";

/**
 * Unit tests for the DURABLE CloudPRNT store abstraction (finding #19). We drive
 * `RedisQueueStore` against a lightweight in-memory FAKE of the Upstash Redis
 * LIST surface it uses (rpush/lindex/lpop/llen) — no real Redis, no network — so
 * we can assert both the FIFO/queue semantics AND that a `PrintJob` (with its
 * binary `bytes`) round-trips losslessly through JSON+base64 serialization.
 *
 * `getCloudPrntStore()`'s env-driven selection (Redis when Upstash is configured,
 * in-memory otherwise) is exercised indirectly: the route tests run with Upstash
 * unset and get the in-memory fallback; here we test the Redis backend directly.
 */

/** Minimal fake of the Redis LIST ops RedisQueueStore calls. */
class FakeRedisList implements RedisListClient {
  readonly lists = new Map<string, string[]>();

  async rpush(key: string, ...values: string[]): Promise<number> {
    const list = this.lists.get(key) ?? [];
    list.push(...values);
    this.lists.set(key, list);
    return list.length;
  }

  async lindex(key: string, index: number): Promise<string | null> {
    const list = this.lists.get(key);
    if (!list) return null;
    const i = index < 0 ? list.length + index : index;
    return list[i] ?? null;
  }

  async lpop(key: string): Promise<string | null> {
    const list = this.lists.get(key);
    if (!list || list.length === 0) return null;
    const [head] = list.splice(0, 1);
    if (list.length === 0) this.lists.delete(key); // Redis drops empty lists
    return head ?? null;
  }

  async llen(key: string): Promise<number> {
    return this.lists.get(key)?.length ?? 0;
  }
}

const key: QueueKey = { businessId: "biz-1", deviceToken: "tok-A" };
const otherKey: QueueKey = { businessId: "biz-2", deviceToken: "tok-A" };

function job(id: string, bytes: number[] = [0x1b, 0x40, 0x41]): PrintJob {
  return {
    id,
    bytes: new Uint8Array(bytes),
    mediaType: "application/vnd.star.line",
    enqueuedAt: 1_700_000_000_000,
  };
}

describe("RedisQueueStore", () => {
  let redis: FakeRedisList;
  let store: RedisQueueStore;

  beforeEach(() => {
    redis = new FakeRedisList();
    store = new RedisQueueStore(redis);
  });

  it("enqueues, peeks (without removing), and reports size", async () => {
    expect(await store.size(key)).toBe(0);
    expect(await store.peek(key)).toBeNull();

    await store.enqueue(key, job("j1"));
    expect(await store.size(key)).toBe(1);

    const peeked = await store.peek(key);
    expect(peeked?.id).toBe("j1");
    // peek does not remove
    expect(await store.size(key)).toBe(1);
  });

  it("round-trips the binary byte stream losslessly through Redis", async () => {
    const original = job("j-bytes", [0x00, 0x1b, 0x40, 0xff, 0x7f, 0x80]);
    await store.enqueue(key, original);
    const peeked = await store.peek(key);
    expect(peeked).not.toBeNull();
    expect(peeked!.bytes).toEqual(original.bytes);
    expect(peeked!.mediaType).toBe(original.mediaType);
    expect(peeked!.enqueuedAt).toBe(original.enqueuedAt);
  });

  it("is FIFO: enqueue order is preserved front-to-back", async () => {
    await store.enqueue(key, job("j1"));
    await store.enqueue(key, job("j2"));
    expect((await store.peek(key))?.id).toBe("j1");
    await store.dequeue(key, "j1");
    expect((await store.peek(key))?.id).toBe("j2");
    expect(await store.size(key)).toBe(1);
  });

  it("dequeue with a matching id removes the front job", async () => {
    await store.enqueue(key, job("j1"));
    const removed = await store.dequeue(key, "j1");
    expect(removed?.id).toBe("j1");
    expect(await store.size(key)).toBe(0);
    expect(await store.peek(key)).toBeNull();
  });

  it("dequeue with no id removes the front unconditionally", async () => {
    await store.enqueue(key, job("j1"));
    const removed = await store.dequeue(key);
    expect(removed?.id).toBe("j1");
    expect(await store.size(key)).toBe(0);
  });

  it("dequeue with a stale/mismatched id is a no-op (job stays)", async () => {
    await store.enqueue(key, job("j1"));
    const removed = await store.dequeue(key, "does-not-match");
    expect(removed).toBeNull();
    expect(await store.size(key)).toBe(1);
    expect((await store.peek(key))?.id).toBe("j1");
  });

  it("dequeue on an empty queue returns null", async () => {
    expect(await store.dequeue(key)).toBeNull();
    expect(await store.dequeue(key, "whatever")).toBeNull();
  });

  it("isolates queues by (businessId, deviceToken) key", async () => {
    await store.enqueue(key, job("j1"));
    // a different businessId (same token) sees nothing
    expect(await store.size(otherKey)).toBe(0);
    expect(await store.peek(otherKey)).toBeNull();
    // the isolation is realised as distinct Redis keys
    expect([...redis.lists.keys()]).toContain("cloudprnt:biz-1:tok-A");
  });
});

/**
 * R3-#1: store SELECTION policy. The durable Redis store must be the DEFAULT path
 * whenever Upstash is configured; the in-memory fallback is only for a missing
 * Upstash config, and is flagged as UNSAFE (so the caller warns loudly) whenever
 * that fallback happens in a serverless/production environment.
 */
describe("cloudprnt store selection (R3-#1)", () => {
  const withUpstash = (serverless: boolean): CloudPrntStoreEnv => ({
    upstashUrl: "https://example.upstash.io",
    upstashToken: "tok",
    serverless,
  });
  const noUpstash = (serverless: boolean): CloudPrntStoreEnv => ({
    upstashUrl: undefined,
    upstashToken: undefined,
    serverless,
  });

  it("hasUpstashConfig requires BOTH url and token", () => {
    expect(hasUpstashConfig(withUpstash(true))).toBe(true);
    expect(hasUpstashConfig(noUpstash(true))).toBe(false);
    expect(hasUpstashConfig({ upstashUrl: "https://x", upstashToken: undefined, serverless: true })).toBe(false);
    expect(hasUpstashConfig({ upstashUrl: undefined, upstashToken: "tok", serverless: true })).toBe(false);
    expect(hasUpstashConfig({ upstashUrl: "", upstashToken: "tok", serverless: true })).toBe(false);
  });

  it("prefers Redis whenever Upstash is configured (serverless or not)", () => {
    expect(selectCloudPrntStoreKind(withUpstash(true))).toBe("redis");
    expect(selectCloudPrntStoreKind(withUpstash(false))).toBe("redis");
  });

  it("falls back to in-memory only when Upstash is absent", () => {
    expect(selectCloudPrntStoreKind(noUpstash(true))).toBe("memory");
    expect(selectCloudPrntStoreKind(noUpstash(false))).toBe("memory");
  });

  it("flags the in-memory fallback as UNSAFE only in a serverless/prod env", () => {
    // Unsafe: no Upstash AND serverless → the fallback drops jobs between instances.
    expect(inMemoryStoreIsUnsafe(noUpstash(true))).toBe(true);
    // Safe: no Upstash but a single long-lived process (local dev / self-host).
    expect(inMemoryStoreIsUnsafe(noUpstash(false))).toBe(false);
    // Never unsafe when the durable Redis store is selected, regardless of env.
    expect(inMemoryStoreIsUnsafe(withUpstash(true))).toBe(false);
    expect(inMemoryStoreIsUnsafe(withUpstash(false))).toBe(false);
  });
});
