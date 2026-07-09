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
 * DURABILITY (HIGH #2): cash is already collected for a queued sale, so replay
 * must NEVER discard one. A *network* failure stops replay (retry later). Any
 * other rejection is treated as transient first — the sale stays queued and is
 * retried on later reconnects — and only after `MAX_REPLAY_ATTEMPTS` is it MOVED
 * (never deleted) to the durable dead-letter store for manual reconciliation.
 *
 * This is a thin, typed wrapper around `idb`. It is client-only: IndexedDB does
 * not exist on the server, so every entry point guards on `typeof window`.
 */

import type { CheckoutInput } from "@/features/register/schema";
import { checkout } from "@/features/register/actions";
import {
  clearOfflineKey,
  decryptJson,
  encryptJson,
  getOrCreateOfflineKey,
  isEncryptedEnvelope,
} from "./crypto";
import { closeDB, DB_NAME, getDB, STORE, type QueuedCheckout } from "./db";
import { deadLetterCount, moveToDeadLetter } from "./dead-letter";
import { isNetworkError, runReplay, type ReplayDeps, type ReplaySummary } from "./replay-core";

export type { QueuedCheckout } from "./db";
export {
  isNetworkError,
  runReplay,
  MAX_REPLAY_ATTEMPTS,
  type ReplayDeps,
  type ReplaySummary,
} from "./replay-core";

/**
 * Recover the original checkout payload from a queued entry, decrypting the
 * current `enc` envelope or — best-effort — falling back to a legacy plaintext
 * `payload`. Returns `null` for an entry whose ciphertext can't be decrypted
 * (wrong/lost key, tampered, or unrecognized): the caller treats it gracefully
 * rather than throwing, so one bad entry can't wedge the queue.
 */
export async function decodeQueuedPayload(
  entry: QueuedCheckout,
): Promise<CheckoutInput | null> {
  if (isEncryptedEnvelope(entry.enc)) {
    try {
      const key = await getOrCreateOfflineKey();
      return await decryptJson<CheckoutInput>(key, entry.enc);
    } catch {
      // Undecryptable (lost key, tampered, format drift) — drop gracefully.
      return null;
    }
  }
  // Legacy plaintext entry queued before R-7 — accept it for replay.
  if (entry.payload) return entry.payload;
  return null;
}

/**
 * Persist a checkout payload for later replay. Keyed by `clientUuid`. The PII
 * payload is encrypted at rest (R-7); only the non-PII idempotency key,
 * timestamp, and attempt counter are stored in the clear.
 */
export async function enqueueCheckout(payload: CheckoutInput): Promise<QueuedCheckout> {
  const db = await getDB();
  const key = await getOrCreateOfflineKey();
  const enc = await encryptJson(key, payload);
  const entry: QueuedCheckout = {
    clientUuid: payload.clientUuid,
    enc,
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

/** Remove a synced sale from the queue. */
export async function removeQueuedCheckout(clientUuid: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, clientUuid);
}

/** Record a failed attempt so we can reason about (and eventually park) a stuck entry. */
export async function bumpAttempts(clientUuid: string): Promise<void> {
  const db = await getDB();
  const entry = await db.get(STORE, clientUuid);
  if (!entry) return;
  entry.attempts += 1;
  await db.put(STORE, entry);
}

/** Real dependency wiring for {@link runReplay} against IndexedDB + the server action. */
function realReplayDeps(): ReplayDeps {
  return {
    isOnline: () => typeof navigator === "undefined" || navigator.onLine,
    list: listQueuedCheckouts,
    decode: decodeQueuedPayload,
    send: checkout,
    remove: removeQueuedCheckout,
    bump: bumpAttempts,
    deadLetter: moveToDeadLetter,
    isNetworkError,
    pendingCount,
    deadLetterCount,
  };
}

/**
 * Replay every queued sale through the idempotent `checkout` server action,
 * oldest first, and report a full {@link ReplaySummary}. A sale that already
 * committed is reconciled (not duplicated) thanks to `clientUuid` idempotency.
 * Nothing is ever deleted on failure — see {@link runReplay}.
 */
export async function replayOfflineQueue(): Promise<ReplaySummary> {
  const empty: ReplaySummary = { committed: 0, deadLettered: 0, pending: 0, needsReconciliation: 0 };
  if (typeof indexedDB === "undefined") return empty;
  return runReplay(realReplayDeps());
}

/**
 * Backwards-compatible wrapper: returns just the number of sales still pending
 * after a replay pass (used by the sign-out flush guard, which only needs to
 * know whether anything remains before wiping the DB).
 */
export async function replayQueuedCheckouts(): Promise<number> {
  return (await replayOfflineQueue()).pending;
}

/**
 * Destroy the entire offline checkout queue AND dead-letter store (PII at-rest
 * hygiene, M-4 + R-7).
 *
 * Deletes the whole IndexedDB database so no order payloads — line items,
 * `customerName`, cash tendered — linger on a shared/borrowed device after
 * sign-out. Also drops the per-browser encryption key so nothing remains that
 * could decrypt a stray envelope. Callers MUST drain/replay (or get explicit
 * user consent) first: this is an unconditional, irreversible wipe of any
 * un-synced sales AND any un-reconciled dead-lettered sales.
 */
export async function clearOfflineQueue(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  // Drop our cached connection first; an open handle blocks deleteDatabase.
  await closeDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    // Resolve on every terminal outcome — sign-out must not hang on IDB quirks.
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
  // Then forget the encryption key (best effort — never block sign-out on it).
  try {
    await clearOfflineKey();
  } catch {
    // ignore — best effort
  }
}
