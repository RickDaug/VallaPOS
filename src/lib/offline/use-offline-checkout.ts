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
import { enqueueCheckout, pendingCount, replayQueuedCheckouts } from "./checkout-queue";

export type SubmitResult =
  | { status: "completed"; receipt: Receipt }
  | { status: "queued" };

/**
 * Strip the offline price snapshot from a payload before an ONLINE send. The
 * snapshot is a deliberate trust relaxation that the server honors ONLY for a
 * replayed OFFLINE sale (cash already collected at a quoted price). An online
 * checkout must stay byte-for-byte server-authoritative, so we never send it —
 * the snapshot rides along ONLY on the offline-queued copy (see checkout-queue).
 */
function withoutSnapshot(payload: CheckoutInput): CheckoutInput {
  if (!payload.priceSnapshot) return payload;
  const { priceSnapshot: _omit, ...rest } = payload;
  void _omit;
  return rest;
}

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
      // Shared replay logic (also used by the sign-out hygiene path).
      await replayQueuedCheckouts();
    } finally {
      await refreshPending();
      setSyncing(false);
      replayingRef.current = false;
    }
  }, [refreshPending]);

  const submit = useCallback(
    async (payload: CheckoutInput): Promise<SubmitResult> => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        // Offline: keep the price snapshot — it's what the customer was quoted.
        await enqueueCheckout(payload);
        await refreshPending();
        return { status: "queued" };
      }
      try {
        // Online: send WITHOUT the snapshot so checkout stays server-authoritative.
        const receipt = await checkout(withoutSnapshot(payload));
        // Opportunistically drain anything that was waiting.
        void replayQueue();
        return { status: "completed", receipt };
      } catch (err) {
        if (isNetworkError(err)) {
          // The send failed mid-flight (we just went offline) — queue the sale
          // WITH its snapshot so the quoted price survives the deferred replay.
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
