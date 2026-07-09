"use client";

/**
 * Pure offline-replay algorithm + error classification.
 *
 * Deliberately dependency-free: it imports NO server action, no IndexedDB, and
 * only a *type* from the register schema. That keeps the durability logic
 * (HIGH #2 — never discard a cash-collected sale) unit-testable over an
 * in-memory store, without dragging in the server graph (env validation, auth).
 * `checkout-queue.ts` wires the real IndexedDB + server-action dependencies into
 * {@link runReplay}.
 */

import type { CheckoutInput } from "@/features/register/schema";
import type { QueuedCheckout } from "./db";

/**
 * How many replay attempts a sale gets before it is parked in the dead-letter
 * store. Attempts accrue across reconnect events (one bump per failed run), so
 * this is a "give up on auto-replay after N reconnects", not a tight retry loop.
 */
export const MAX_REPLAY_ATTEMPTS = 5;

/** Outcome of a replay pass — lets the UI distinguish committed from stuck sales. */
export interface ReplaySummary {
  /** Sales that replayed and committed on the server this pass. */
  committed: number;
  /** Sales moved to the dead-letter store this pass (retries exhausted / undecodable). */
  deadLettered: number;
  /** Sales still in the live queue afterwards (network stop, or below the threshold). */
  pending: number;
  /** Total sales parked in the dead-letter store needing manual reconciliation. */
  needsReconciliation: number;
}

/**
 * Tell a thrown checkout error apart: a *network* failure (we're offline / the
 * fetch never reached the server) means "stop, retry later", whereas anything
 * else is a rejection we retry a bounded number of times before dead-lettering.
 */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (err instanceof TypeError) return true; // fetch() rejects with TypeError on network loss
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  return (
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("load failed") ||
    msg.includes("connection") ||
    msg.includes("fetch failed") ||
    msg.includes("timeout") ||
    msg.includes("timed out")
  );
}

/**
 * An OperatorLockedError thrown by the checkout action because the replaying
 * DEVICE is locked (no active operator) — NOT the queued sale's fault (Round-3
 * #3). It's device-wide and transient: like a network stop, we halt the pass
 * WITHOUT consuming a replay attempt, so the queue retries intact once someone
 * unlocks. Detected by the error name/message the guard throws (`LOCKED`).
 *
 * RESIDUAL (documented, accepted): a Next.js server action redacts a thrown
 * error's message in PRODUCTION, so a locked-device replay error may not be
 * recognizable here and would then be treated as an ordinary transient rejection
 * — bumping the attempt count and, after MAX_REPLAY_ATTEMPTS, dead-lettering
 * (never deleting — the cash stays reconcilable). A robust fix would return a
 * typed "locked" result from checkout instead of throwing across the boundary.
 */
export function isOperatorLocked(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "OperatorLockedError" || err.message === "LOCKED";
}

/**
 * Injectable dependencies for {@link runReplay}. Extracting them keeps the
 * durability logic (never-delete, retry-then-dead-letter, count committed vs
 * needs-reconciliation) unit-testable with an in-memory store — no IndexedDB.
 */
export interface ReplayDeps {
  isOnline: () => boolean;
  list: () => Promise<QueuedCheckout[]>;
  decode: (entry: QueuedCheckout) => Promise<CheckoutInput | null>;
  send: (payload: CheckoutInput) => Promise<unknown>;
  remove: (clientUuid: string) => Promise<void>;
  bump: (clientUuid: string) => Promise<void>;
  deadLetter: (entry: QueuedCheckout, err: unknown, attempts: number) => Promise<void>;
  isNetworkError: (err: unknown) => boolean;
  pendingCount: () => Promise<number>;
  deadLetterCount: () => Promise<number>;
  maxAttempts?: number;
}

/**
 * Pure(ish) replay algorithm over injected dependencies. Oldest sale first:
 *  - success → remove from queue, count as committed;
 *  - network error → STOP (still offline), keep the sale queued, retry later;
 *  - any other rejection → keep the sale queued and bump its attempt count; once
 *    it has failed `maxAttempts` times, MOVE it to the dead-letter store (never
 *    delete) so the collected cash is reconcilable;
 *  - undecodable entry → park it in the dead-letter store too (we can't replay it
 *    and can't read it, but we must not silently erase the record of a sale).
 */
export async function runReplay(deps: ReplayDeps): Promise<ReplaySummary> {
  const maxAttempts = deps.maxAttempts ?? MAX_REPLAY_ATTEMPTS;
  let committed = 0;
  let deadLettered = 0;

  if (deps.isOnline()) {
    const queued = await deps.list();
    for (const entry of queued) {
      const payload = await deps.decode(entry);
      if (!payload) {
        await deps.deadLetter(
          entry,
          "undecodable (lost key / tampered / format drift)",
          entry.attempts,
        );
        deadLettered += 1;
        continue;
      }
      try {
        // Thread the queue entry's ring-up time onto the replayed payload so the
        // server dates the order to when it was RUNG, not when it replayed
        // (Round-3 #4). `queuedAt` lives on the (clear-text) envelope, not the
        // encrypted payload, so it's injected here rather than at enqueue.
        await deps.send({ ...payload, offlineQueuedAt: entry.queuedAt });
        await deps.remove(entry.clientUuid);
        committed += 1;
      } catch (err) {
        if (deps.isNetworkError(err)) break; // still offline — stop, keep FIFO, retry later
        // Device locked mid-replay — halt the pass without consuming an attempt;
        // the whole queue is intact and retries once someone unlocks (Round-3 #3).
        if (isOperatorLocked(err)) break;
        const attempts = (entry.attempts ?? 0) + 1;
        if (attempts >= maxAttempts) {
          // Retries exhausted — park it, DO NOT delete a cash-collected sale.
          await deps.deadLetter(entry, err, attempts);
          deadLettered += 1;
        } else {
          // Transient/ambiguous — keep it queued and try again on the next reconnect.
          await deps.bump(entry.clientUuid);
        }
      }
    }
  }

  return {
    committed,
    deadLettered,
    pending: await deps.pendingCount(),
    needsReconciliation: await deps.deadLetterCount(),
  };
}
