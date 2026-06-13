"use client";

/**
 * React hook that wires the register checkout into the offline queue.
 *
 * - `submit(payload)` runs the `checkout` server action. If the network is down
 *   (or the action throws a fetch/network error), the sale is stashed in
 *   IndexedDB and reported as `queued` instead of failing the cashier.
 * - When connectivity returns (the `online` event) — or when the hook mounts
 *   already online with a non-empty queue — every queued sale is replayed FIFO.
 *   Replay leans on the server action's `clientUuid` idempotency, so a sale that
 *   actually committed before we lost the response is reconciled, not duplicated.
 *
 * Background Sync is intentionally not used: Safari/iOS lack it, and the
 * `online`-event fallback covers every target browser uniformly.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CheckoutInput } from "@/features/register/schema";
import { checkout, type Receipt } from "@/features/register/actions";
import {
  bumpAttempts,
  enqueueCheckout,
  pendingCount,
  listQueuedCheckouts,
  removeQueuedCheckout,
} from "./checkout-queue";

export type SubmitResult =
  | { status: "completed"; receipt: Receipt }
  | { status: "queued" };

/**
 * A thrown checkout error is a *network* failure (queue it) rather than a
 * server rejection (surface it) when we're offline or the error looks like a
 * failed fetch. Server-action validation/business errors arrive with a real
 * message and while we're online — those must not be swallowed.
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

export function useOfflineCheckout() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const replayingRef = useRef(false);

  const refreshPending = useCallback(async () => {
    try {
      setPending(await pendingCount());
    } catch {
      // IndexedDB unavailable (e.g. private mode) — treat as no queue.
      setPending(0);
    }
  }, []);

  /** Replay every queued sale, oldest first. Safe to call repeatedly. */
  const replayQueue = useCallback(async () => {
    if (replayingRef.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    replayingRef.current = true;
    setSyncing(true);
    try {
      const queued = await listQueuedCheckouts();
      for (const entry of queued) {
        try {
          // Idempotent on clientUuid: if this already committed, the server
          // returns the existing order instead of creating a duplicate.
          await checkout(entry.payload);
          await removeQueuedCheckout(entry.clientUuid);
        } catch (err) {
          if (isNetworkError(err)) break; // still offline — stop, retry later
          // A real server rejection (e.g. validation). Don't loop forever on it;
          // record the attempt and drop it so the queue can drain. The sale is
          // preserved in the cashier's session via the surfaced error elsewhere.
          await bumpAttempts(entry.clientUuid);
          await removeQueuedCheckout(entry.clientUuid);
        }
      }
    } finally {
      await refreshPending();
      setSyncing(false);
      replayingRef.current = false;
    }
  }, [refreshPending]);

  const submit = useCallback(
    async (payload: CheckoutInput): Promise<SubmitResult> => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await enqueueCheckout(payload);
        await refreshPending();
        return { status: "queued" };
      }
      try {
        const receipt = await checkout(payload);
        // Opportunistically drain anything that was waiting.
        void replayQueue();
        return { status: "completed", receipt };
      } catch (err) {
        if (isNetworkError(err)) {
          await enqueueCheckout(payload);
          await refreshPending();
          return { status: "queued" };
        }
        throw err; // genuine server rejection — let the caller surface it
      }
    },
    [refreshPending, replayQueue],
  );

  useEffect(() => {
    setOnline(navigator.onLine);
    void refreshPending();

    const goOnline = () => {
      setOnline(true);
      void replayQueue();
    };
    const goOffline = () => setOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    // If we mounted already online with a backlog, drain it now.
    if (navigator.onLine) void replayQueue();

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [refreshPending, replayQueue]);

  return { online, pending, syncing, submit, replayQueue };
}
