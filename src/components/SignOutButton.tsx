"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import {
  clearOfflineQueue,
  pendingCount,
  replayQueuedCheckouts,
} from "@/lib/offline/checkout-queue";

/**
 * Sign out and wipe the on-device offline queue (M-4).
 *
 * The IndexedDB queue holds full order payloads (line items, `customerName`,
 * cash tendered), so leaving it behind on a shared/borrowed device is a PII
 * leak. On sign-out we:
 *   1. If un-synced sales exist and we're ONLINE, flush them first (idempotent
 *      replay), then clear.
 *   2. If un-synced sales remain while OFFLINE, do NOT silently destroy them —
 *      confirm with the operator before wiping. If they cancel, abort sign-out.
 *   3. Otherwise clear and sign out.
 *
 * Returns `false` only when the operator cancels the "discard unsynced sales?"
 * prompt, so the caller can abort.
 */
async function clearOfflineQueueForSignOut(): Promise<boolean> {
  let pending = 0;
  try {
    pending = await pendingCount();
  } catch {
    // IndexedDB unavailable (e.g. private mode) — nothing to clear.
    return true;
  }

  // Try to drain anything pending while we still have connectivity.
  if (pending > 0 && typeof navigator !== "undefined" && navigator.onLine) {
    try {
      pending = await replayQueuedCheckouts();
    } catch {
      // Replay failed (e.g. dropped offline mid-flush) — fall through to the
      // pending guard below rather than destroying data silently.
    }
  }

  // Still have un-synced sales we couldn't flush: confirm before wiping.
  if (pending > 0) {
    const ok =
      typeof window === "undefined" ||
      window.confirm(
        `${pending} offline sale${pending === 1 ? "" : "s"} ${
          pending === 1 ? "hasn't" : "haven't"
        } synced yet and will be lost if you sign out now. Sign out and discard ${
          pending === 1 ? "it" : "them"
        }?`,
      );
    if (!ok) return false;
  }

  try {
    await clearOfflineQueue();
  } catch {
    // Best effort — never block sign-out on a wipe failure.
  }
  return true;
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        const proceed = await clearOfflineQueueForSignOut();
        if (!proceed) return; // operator chose to keep unsynced sales
        await authClient.signOut();
        router.push("/sign-in");
      }}
      className="flex w-full items-center gap-2 rounded-md bg-sidebar-accent px-4 py-3 text-sm font-semibold text-sidebar-foreground hover:bg-sidebar-accent/70"
    >
      <LogOut size={16} /> Sign out
    </button>
  );
}
