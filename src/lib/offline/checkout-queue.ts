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
