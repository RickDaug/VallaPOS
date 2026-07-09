"use client";

/**
 * Durable dead-letter store for offline sales that could not be replayed.
 *
 * THE INVARIANT: a sale for which cash was already collected is NEVER silently
 * discarded. When the replay loop exhausts its retries on a non-network error
 * (a validation/500/ambiguous rejection), or when a queued entry can no longer
 * be decoded, the entry is MOVED here instead of deleted. The register surfaces
 * the count as a persistent "needs reconciliation" indicator so a human can
 * settle it, rather than the money quietly vanishing.
 *
 * Entries stay encrypted at rest (they carry over the queue's `enc` envelope)
 * and live in the same `vallapos-offline` database, so sign-out's single
 * `deleteDatabase` wipes them together with the live queue (PII hygiene, M-4).
 */

import { DEAD_STORE, getDB, type DeadLetterCheckout, type QueuedCheckout } from "./db";
import { removeQueuedCheckout } from "./checkout-queue";

/** Turn an unknown thrown value into a short, storable reason string. */
function describeError(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown replay error";
  }
}

/**
 * Move a queued sale into the dead-letter store, then remove it from the live
 * queue. Writes the dead-letter record FIRST so a crash between the two steps
 * leaves the sale in the queue (retried) rather than lost.
 */
export async function moveToDeadLetter(
  entry: QueuedCheckout,
  err: unknown,
  attempts: number,
): Promise<void> {
  const db = await getDB();
  const record: DeadLetterCheckout = {
    clientUuid: entry.clientUuid,
    enc: entry.enc,
    payload: entry.payload,
    queuedAt: entry.queuedAt,
    attempts,
    deadLetteredAt: Date.now(),
    lastError: describeError(err),
  };
  await db.put(DEAD_STORE, record);
  await removeQueuedCheckout(entry.clientUuid);
}

/** How many sales are parked awaiting manual reconciliation. */
export async function deadLetterCount(): Promise<number> {
  if (typeof indexedDB === "undefined") return 0;
  const db = await getDB();
  return db.count(DEAD_STORE);
}

/** All dead-lettered sales, oldest-dead-lettered first. */
export async function listDeadLetters(): Promise<DeadLetterCheckout[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await getDB();
  return db.getAllFromIndex(DEAD_STORE, "deadLetteredAt");
}

/** Drop a single reconciled dead-letter entry. */
export async function removeDeadLetter(clientUuid: string): Promise<void> {
  const db = await getDB();
  await db.delete(DEAD_STORE, clientUuid);
}
