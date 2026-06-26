/**
 * The process-wide CloudPRNT `QueueStore` SINGLETON used by the route handler.
 *
 * ⚠ This is the **in-memory** store — see the big durability warning in
 * `cloudprnt.ts`. On Vercel serverless this is NOT shared across instances and is
 * lost on cold start; it is correct only for a single long-lived Node process.
 * Production must replace `getCloudPrntStore()`'s return with an Upstash/DB-backed
 * `QueueStore` (the route handler and `cloudprnt.ts` are storage-agnostic).
 *
 * Kept in its own (non-`server-only`) module so the pure `cloudprnt.ts` logic and
 * the route handler can be tested without instantiating a global singleton, while
 * still giving the route a stable instance across requests in one process. The
 * singleton is stashed on `globalThis` so Next.js dev hot-reload doesn't spawn a
 * fresh empty queue on every edit (mirrors the Prisma singleton pattern).
 */

import { InMemoryQueueStore, type QueueStore } from "./cloudprnt";

const GLOBAL_KEY = "__vallapos_cloudprnt_store__";

type GlobalWithStore = typeof globalThis & { [GLOBAL_KEY]?: QueueStore };

/** Return the shared in-memory CloudPRNT queue store (one per process). */
export function getCloudPrntStore(): QueueStore {
  const g = globalThis as GlobalWithStore;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new InMemoryQueueStore();
  return g[GLOBAL_KEY];
}
