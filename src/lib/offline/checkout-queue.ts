"use client";

/**
 * Offline checkout queue (IndexedDB).
 *
 * When the register completes a sale while the network is unavailable, the
 * exact server-action payload (a `CheckoutInput`, already carrying its
 * client-generated `clientUuid`) is stashed here. On reconnect we replay every
 * queued sale through the same `checkout` server action. Replay is safe because
 * the action is idempotent on `clientUuid` — a duplicate submit returns the
 * already-recorded order instead of creating a second one (see
 * `src/features/register/actions.ts`).
 *
 * This is a thin, typed wrapper around `idb`. It is client-only: IndexedDB does
 * not exist on the server, so every entry point guards on `typeof window`.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { CheckoutInput } from "@/features/register/schema";
import { checkout } from "@/features/register/actions";

const DB_NAME = "vallapos-offline";
const DB_VERSION = 1;
const STORE = "checkouts";

/** A sale captured offline, waiting to be replayed to the server. */
export interface QueuedCheckout {
  /** Primary key — the idempotency key. Same as `payload.clientUuid`. */
  clientUuid: string;
  /** The untouched server-action payload. */
  payload: CheckoutInput;
  /** When the sale was rung up (epoch ms), for display + FIFO replay. */
  queuedAt: number;
  /** Replay attempts so far (diagnostics only; we keep retrying). */
  attempts: number;
}

interface OfflineDB extends DBSchema {
  [STORE]: {
    key: string;
    value: QueuedCheckout;
    indexes: { queuedAt: number };
  };
}

let dbPromise: Promise<IDBPDatabase<OfflineDB>> | null = null;

function getDB(): Promise<IDBPDatabase<OfflineDB>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available in this environment."));
  }
  if (!dbPromise) {
    dbPromise = openDB<OfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const store = database.createObjectStore(STORE, { keyPath: "clientUuid" });
        store.createIndex("queuedAt", "queuedAt");
      },
    });
  }
  return dbPromise;
}

/** Persist a checkout payload for later replay. Keyed by `clientUuid`. */
export async function enqueueCheckout(payload: CheckoutInput): Promise<QueuedCheckout> {
  const db = await getDB();
  const entry: QueuedCheckout = {
    clientUuid: payload.clientUuid,
    payload,
    queuedAt: Date.now(),
    attempts: 0,
  };
  // `put` is idempotent on the keyPath — re-queuing the same sale just refreshes it.
  await db.put(STORE, entry);
  return entry;
}

/** All pending checkouts, oldest first (FIFO replay order). */
export async function listQueuedCheckouts(): Promise<QueuedCheckout[]> {
  const db = await getDB();
  return db.getAllFromIndex(STORE, "queuedAt");
}

/** How many sales are waiting to sync. */
export async function pendingCount(): Promise<number> {
  if (typeof indexedDB === "undefined") return 0;
  const db = await getDB();
  return db.count(STORE);
}

/** Remove a synced (or permanently-rejected) sale from the queue. */
export async function removeQueuedCheckout(clientUuid: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, clientUuid);
}

/** Record a failed attempt so we can reason about a stuck entry. */
export async function bumpAttempts(clientUuid: string): Promise<void> {
  const db = await getDB();
  const entry = await db.get(STORE, clientUuid);
  if (!entry) return;
  entry.attempts += 1;
  await db.put(STORE, entry);
}

/**
 * Tell a thrown checkout error apart: a *network* failure (we're offline / the
 * fetch never reached the server) means "stop, retry later", whereas a real
 * server rejection means the sale was seen and refused (drop it). Mirrors the
 * same heuristic used by `useOfflineCheckout`.
 */
function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (err instanceof TypeError) return true; // fetch() rejects with TypeError on network loss
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  return (
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("load failed") ||
    msg.includes("connection")
  );
}

/**
 * Replay every queued sale through the idempotent `checkout` server action,
 * oldest first. A sale that already committed is reconciled (not duplicated)
 * thanks to `clientUuid` idempotency. Returns the number of sales still pending
 * afterwards. Stops early on a network error (still offline); drops a sale that
 * the server genuinely rejected so the queue can drain.
 */
export async function replayQueuedCheckouts(): Promise<number> {
  if (typeof indexedDB === "undefined") return 0;
  if (typeof navigator !== "undefined" && !navigator.onLine) return pendingCount();
  const queued = await listQueuedCheckouts();
  for (const entry of queued) {
    try {
      await checkout(entry.payload);
      await removeQueuedCheckout(entry.clientUuid);
    } catch (err) {
      if (isNetworkError(err)) break; // still offline — stop, retry later
      // A real server rejection: record the attempt and drop it so the queue
      // can drain rather than wedging on one bad sale.
      await bumpAttempts(entry.clientUuid);
      await removeQueuedCheckout(entry.clientUuid);
    }
  }
  return pendingCount();
}

/**
 * Destroy the entire offline checkout queue (PII at-rest hygiene, M-4).
 *
 * Deletes the whole IndexedDB database so no order payloads — line items,
 * `customerName`, cash tendered — linger on a shared/borrowed device after
 * sign-out. Callers MUST drain/replay (or get explicit user consent) first:
 * this is an unconditional, irreversible wipe of any un-synced sales.
 */
export async function clearOfflineQueue(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  // Drop our cached connection first; an open handle blocks deleteDatabase.
  if (dbPromise) {
    try {
      (await dbPromise).close();
    } catch {
      // ignore — best effort
    }
    dbPromise = null;
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    // Resolve on every terminal outcome — sign-out must not hang on IDB quirks.
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
