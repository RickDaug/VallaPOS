"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/**
 * Global live poller for incoming online orders. Mounted once in the business
 * layout (only when online ordering is enabled AND the operator can take orders).
 * Mirrors the floor view's poll-on-visible model: every 15s while the tab is
 * visible it fetches `/{businessId}/online/count`, and
 *  - announces a `useToast` when the SUBMITTED count RISES (a new order arrived),
 *  - calls `router.refresh()` when the counts change, which re-renders the server
 *    nav badge and the online board with fresh data.
 * Renders nothing.
 */
export function OnlineOrderAlerts({ businessId }: { businessId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const lastSubmitted = useRef<number | null>(null);
  const lastActive = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/${businessId}/online/count`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const { submitted, active } = (await res.json()) as {
          submitted: number;
          active: number;
        };

        const prevSubmitted = lastSubmitted.current;
        if (prevSubmitted !== null && submitted > prevSubmitted) {
          const delta = submitted - prevSubmitted;
          toast({
            title: delta === 1 ? "New online order" : `${delta} new online orders`,
            description: "Open the Online screen to accept.",
            variant: "success",
          });
        }

        const changed = submitted !== lastSubmitted.current || active !== lastActive.current;
        lastSubmitted.current = submitted;
        lastActive.current = active;
        if (changed && prevSubmitted !== null) router.refresh();
      } catch {
        // Transient network error — ignore; the next tick retries.
      }
    }

    void poll();
    const id = setInterval(poll, 15_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [businessId, router, toast]);

  return null;
}
