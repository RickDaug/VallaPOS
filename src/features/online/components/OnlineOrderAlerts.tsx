"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";

/**
 * Global live alerter for incoming online orders. Mounted once in the business
 * layout (only when online ordering is enabled AND the operator can take orders).
 * Mirrors the floor view's poll-on-visible model: every 15s while the tab is
 * visible it fetches `/{businessId}/online/count`, and when the SUBMITTED count
 * RISES (new orders arrived) it:
 *  - plays a short AUDIO CHIME (Web Audio, no asset) so staff notice even when not
 *    looking at the screen (#6 — a transient toast alone was missable), and
 *  - bumps a PERSISTENT unacknowledged counter rendered as a fixed banner that
 *    stays until staff act on / dismiss it (not an auto-dismissing toast).
 * It also `router.refresh()`es when counts change so the nav badge + board update.
 *
 * Accessibility: the banner is an `aria-live="assertive"` region with a real link
 * (to the board) and a dismiss button, so the alert is conveyed visually and to
 * assistive tech — the chime is an enhancement, never the only signal.
 */
export function OnlineOrderAlerts({ businessId }: { businessId: string }) {
  const router = useRouter();
  const lastSubmitted = useRef<number | null>(null);
  const lastActive = useRef<number | null>(null);
  // Reused AudioContext (lazily created on the first chime; browsers gate it on a
  // user gesture — a blocked play is swallowed).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [unacked, setUnacked] = useState(0);

  const chime = useCallback(() => {
    try {
      type WithWebkit = typeof globalThis & { webkitAudioContext?: typeof AudioContext };
      const Ctor = window.AudioContext ?? (window as WithWebkit).webkitAudioContext;
      if (!Ctor) return;
      const ctx = (audioCtxRef.current ??= new Ctor());
      if (ctx.state === "suspended") void ctx.resume();
      // Two short ascending beeps — friendly, unmistakable, brief.
      const now = ctx.currentTime;
      [0, 0.18].forEach((offset, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = i === 0 ? 880 : 1174.7; // A5 → D6
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.2, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.15);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.16);
      });
    } catch {
      // Audio unavailable / autoplay-blocked — the visual banner still fires.
    }
  }, []);

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
          setUnacked((n) => n + delta);
          chime();
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
  }, [businessId, router, chime]);

  return (
    <div
      aria-live="assertive"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[110] flex justify-center p-3 sm:justify-end"
    >
      {unacked > 0 && (
        <div
          role="status"
          className="pointer-events-auto flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 shadow-lg backdrop-blur"
        >
          <Bell size={18} className="shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="font-semibold leading-tight">
              {unacked === 1 ? "New online order" : `${unacked} new online orders`}
            </p>
            <Link
              href={`/${businessId}/online`}
              onClick={() => setUnacked(0)}
              className="text-sm font-medium text-primary underline"
            >
              Open the Online screen
            </Link>
          </div>
          <button
            type="button"
            onClick={() => setUnacked(0)}
            aria-label="Dismiss new-order alert"
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
