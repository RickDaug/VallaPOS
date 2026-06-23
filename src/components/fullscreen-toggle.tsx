"use client";

import { useCallback, useEffect, useState } from "react";
import { Maximize, Minimize } from "lucide-react";
import { cn } from "@/lib/utils";

// One-tap fullscreen via the browser Fullscreen API. (An installed PWA already
// launches fullscreen via the manifest `display: "fullscreen"`; this button lets
// a browser-tab user go fullscreen on demand and toggle back out — browsers don't
// allow programmatic fullscreen without a user gesture, so a button is required.)
export function FullscreenToggle({ className }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setMounted(true);
    setSupported(typeof document !== "undefined" && !!document.documentElement.requestFullscreen);
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    onChange();
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  // Hide entirely where the API isn't available (e.g. iOS Safari) rather than
  // showing a dead button.
  if (mounted && !supported) return null;

  return (
    <button
      type="button"
      aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      aria-pressed={isFullscreen}
      onClick={toggle}
      className={cn(
        "inline-flex h-11 w-11 items-center justify-center rounded-md text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground",
        className,
      )}
    >
      {mounted && isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
    </button>
  );
}
