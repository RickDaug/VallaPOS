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
 * - Replay NEVER discards a cash-collected sale (HIGH #2): a sale that keeps
 *   failing is eventually parked in the dead-letter store. The hook exposes
 *   `needsReconciliation` (the parked count) and `lastReplay` (committed vs
 *   dead-lettered this pass) so the register can show the right feedback: a
 *   success toast ONLY for genuinely committed sales, and a persistent warning
 *   when any sale needs a human to reconcile it.
 *
 * Background Sync is intentionally not used: Safari/iOS lack it, and the
 * `online`-event fallback covers every target browser uniformly.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isReceipt,
  type CheckoutInput,
  type Receipt,
  type CheckoutRejection,
} from "@/features/register/schema";
import { checkout } from "@/features/register/actions";
import { enqueueCheckout, pendingCount, replayOfflineQueue } from "./checkout-queue";
import { deadLetterCount } from "./dead-letter";

export type SubmitResult =
  | { status: "completed"; receipt: Receipt }
  | { status: "queued" }
  // The server declined the sale pending manager approval of an unverified
  // (QR/MANUAL) tender. The register prompts for / re-prompts for a manager PIN.
  | { status: "rejected"; rejection: CheckoutRejection };

/** Outcome of the most recent replay pass, for one-shot UI feedback. */
export interface ReplayOutcome {
  /** Sales that committed on the server this pass. */
  committed: number;
  /** Sales moved to the dead-letter store this pass. */
  deadLettered: number;
  /** Monotonic marker so consumers can react to each distinct pass exactly once. */
  at: number;
}

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
  const [needsReconciliation, setNeedsReconciliation] = useState(0);
  const [lastReplay, setLastReplay] = useState<ReplayOutcome | null>(null);
  const replayingRef = useRef(false);

  const refreshCounts = useCallback(async () => {
    try {
      setPending(await pendingCount());
    } catch {
      // IndexedDB unavailable (e.g. private mode) — treat as no queue.
      setPending(0);
    }
    try {
      setNeedsReconciliation(await deadLetterCount());
    } catch {
      setNeedsReconciliation(0);
    }
  }, []);

  /** Replay every queued sale, oldest first. Safe to call repeatedly. */
  const replayQueue = useCallback(async () => {
    if (replayingRef.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    replayingRef.current = true;
    setSyncing(true);
    try {
      const summary = await replayOfflineQueue();
      setPending(summary.pending);
      setNeedsReconciliation(summary.needsReconciliation);
      // Only announce a pass that actually did something, so the register can
      // fire exactly-once feedback (committed → success, dead-lettered → warn).
      if (summary.committed > 0 || summary.deadLettered > 0) {
        setLastReplay({
          committed: summary.committed,
          deadLettered: summary.deadLettered,
          at: Date.now(),
        });
      }
    } catch {
      // Replay itself blew up (IndexedDB unavailable, etc.) — just refresh counts.
      await refreshCounts();
    } finally {
      setSyncing(false);
      replayingRef.current = false;
    }
  }, [refreshCounts]);

  const submit = useCallback(
    async (payload: CheckoutInput): Promise<SubmitResult> => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        // Offline: keep the price snapshot — it's what the customer was quoted.
        await enqueueCheckout(payload);
        await refreshCounts();
        return { status: "queued" };
      }
      try {
        // Online: send WITHOUT the snapshot so checkout stays server-authoritative.
        const result = await checkout(withoutSnapshot(payload));
        // The server may decline pending manager approval of an unverified tender;
        // surface that to the register WITHOUT queuing (it's a live decision).
        if (!isReceipt(result)) {
          return { status: "rejected", rejection: result };
        }
        // Opportunistically drain anything that was waiting.
        void replayQueue();
        return { status: "completed", receipt: result };
      } catch (err) {
        if (isNetworkError(err)) {
          // The send failed mid-flight (we just went offline) — queue the sale
          // WITH its snapshot so the quoted price survives the deferred replay.
          await enqueueCheckout(payload);
          await refreshCounts();
          return { status: "queued" };
        }
        throw err; // genuine server rejection — let the caller surface it
      }
    },
    [refreshCounts, replayQueue],
  );

  useEffect(() => {
    setOnline(navigator.onLine);
    void refreshCounts();

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
  }, [refreshCounts, replayQueue]);

  return { online, pending, syncing, needsReconciliation, lastReplay, submit, replayQueue };
}
