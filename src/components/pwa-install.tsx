"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * PWA "Add to Home Screen" affordance (audit R4 #5).
 *
 * Two paths, because the platforms differ:
 *  - Chromium (Android/desktop): the browser fires `beforeinstallprompt`, which
 *    we capture and defer so we can trigger the native install dialog from our
 *    own button (browsers only allow `prompt()` from a stored event + a user
 *    gesture). Keeping a home-screen icon is what makes the till feel like an app
 *    to a merchant.
 *  - iOS Safari: never fires `beforeinstallprompt` and has no programmatic
 *    install, so we show a short hint pointing at the Share → "Add to Home
 *    Screen" flow instead.
 *
 * The banner hides itself when already installed (display-mode: standalone) and
 * remembers a dismissal in localStorage so it isn't nagging on every shift.
 */

const DISMISS_KEY = "vallapos:pwa-install-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari's non-standard flag when launched from the home screen.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as Mac but is touch-capable.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua);
  // Exclude Chrome/Firefox-on-iOS (they can't install either, but they're not
  // the Safari share-sheet flow).
  const notOtherBrowser = !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return iOS && webkit && notOtherBrowser;
}

export function PwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(true); // start hidden until we decide

  useEffect(() => {
    if (isStandalone()) return; // already installed — nothing to prompt
    if (localStorage.getItem(DISMISS_KEY) === "1") return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // stop Chrome's mini-infobar; we drive it ourselves
      setDeferred(e as BeforeInstallPromptEvent);
      setDismissed(false);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // Once installed, drop the banner and don't show it again.
    const onInstalled = () => {
      setDeferred(null);
      setIosHint(false);
      setDismissed(true);
    };
    window.addEventListener("appinstalled", onInstalled);

    // iOS never fires beforeinstallprompt — show the manual hint there.
    if (isIosSafari()) {
      setIosHint(true);
      setDismissed(false);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function close() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Private mode / storage disabled — a per-session hide is fine.
    }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    // A stored beforeinstallprompt event can only be used once.
    setDeferred(null);
    close();
  }

  if (dismissed || (!deferred && !iosHint)) return null;

  return (
    <div className="fixed inset-x-0 bottom-20 z-40 mx-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-border bg-card p-4 shadow-lg lg:bottom-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Download size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Add VallaPOS to your home screen</p>
          {iosHint ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Tap the Share{" "}
              <Share size={12} className="inline-block align-[-1px]" /> button, then choose{" "}
              <span className="font-medium text-foreground">Add to Home Screen</span> to keep the
              register one tap away.
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Install it like an app so the register is always one tap away — no browser tabs, works
              offline.
            </p>
          )}
          {deferred && (
            <Button size="sm" className="mt-3" onClick={install}>
              Add to home screen
            </Button>
          )}
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
