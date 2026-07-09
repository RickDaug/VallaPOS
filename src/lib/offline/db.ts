"use client";

/**
 * Shared IndexedDB plumbing for the offline subsystem.
 *
 * Both the live replay queue (`checkout-queue.ts`) and the durable dead-letter
 * store (`dead-letter.ts`) live in the SAME `vallapos-offline` database so that
 * sign-out hygiene (a single `deleteDatabase`) wipes all order PII at once. This
 * module owns the schema + the memoized connection so those two files don't have
 * to coordinate a version bump between them (and so we avoid an import cycle).
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { CheckoutInput } from "@/features/register/schema";
import type { EncryptedEnvelope } from "./crypto";

export const DB_NAME = "vallapos-offline";
/** v1: `checkouts`. v2: added the `dead-letter` store. */
export const DB_VERSION = 2;
export const STORE = "checkouts";
export const DEAD_STORE = "dead-letter";

/**
 * A sale captured offline, waiting to be replayed to the server.
 *
 * R-7: the order PII (`customerName`, line items, cash tendered, discounts) is
 * NOT stored in the clear. It's AES-GCM encrypted under a per-browser
 * non-extractable key and persisted as the `enc` envelope. `clientUuid`,
 * `queuedAt`, and `attempts` stay in the clear because they carry no PII and are
 * needed for the primary key, the FIFO index, and diagnostics respectively.
 *
 * `payload` (legacy plaintext) is retained as optional for backward-compat with
 * any entries queued before this change — readers fall back to it gracefully.
 */
export interface QueuedCheckout {
  /** Primary key — the idempotency key. Same as `payload.clientUuid`. */
  clientUuid: string;
  /** Encrypted server-action payload (current format). */
  enc?: EncryptedEnvelope;
  /** Legacy plaintext payload — only present on entries queued before R-7. */
  payload?: CheckoutInput;
  /** When the sale was rung up (epoch ms), for display + FIFO replay. */
  queuedAt: number;
  /** Replay attempts so far. Drives the move-to-dead-letter threshold. */
  attempts: number;
}

/**
 * A queued sale that repeatedly failed to replay (or can no longer be decoded).
 *
 * It is NEVER deleted by the replay loop — cash was already collected for it, so
 * losing it would lose money. It's parked here (still encrypted at rest) so a
 * merchant can see the count and reconcile it manually. It carries the original
 * `enc`/`payload` plus diagnostics about why it failed.
 */
export interface DeadLetterCheckout extends QueuedCheckout {
  /** When it was moved out of the live queue (epoch ms). */
  deadLetteredAt: number;
  /** Best-effort human-readable reason (server message / classification). */
  lastError: string;
}

interface OfflineDB extends DBSchema {
  [STORE]: {
    key: string;
    value: QueuedCheckout;
    indexes: { queuedAt: number };
  };
  [DEAD_STORE]: {
    key: string;
    value: DeadLetterCheckout;
    indexes: { deadLetteredAt: number };
  };
}

export type OfflineDatabase = IDBPDatabase<OfflineDB>;

let dbPromise: Promise<OfflineDatabase> | null = null;

export function getDB(): Promise<OfflineDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available in this environment."));
  }
  if (!dbPromise) {
    dbPromise = openDB<OfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          const store = database.createObjectStore(STORE, { keyPath: "clientUuid" });
          store.createIndex("queuedAt", "queuedAt");
        }
        if (oldVersion < 2) {
          const dead = database.createObjectStore(DEAD_STORE, { keyPath: "clientUuid" });
          dead.createIndex("deadLetteredAt", "deadLetteredAt");
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Close + forget the cached connection (an open handle blocks `deleteDatabase`).
 * Best effort — callers wiping the DB on sign-out must not hang on IDB quirks.
 */
export async function closeDB(): Promise<void> {
  if (!dbPromise) return;
  try {
    (await dbPromise).close();
  } catch {
    // ignore — best effort
  }
  dbPromise = null;
}
