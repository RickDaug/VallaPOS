/**
 * Multi-sensory tap confirmation for the register: a short haptic buzz, an
 * optional WebAudio click, and (via CSS `active:scale`) a subtle press — so a
 * cashier trusts a press landed without looking down.
 *
 * Design for testability: all browser side effects (`navigator.vibrate`, the
 * WebAudio context, `localStorage`) are isolated behind small, individually
 * optional/injectable functions. `fireTapFeedback`, `playClickOn`, and the
 * storage helpers are pure enough to unit-test by mocking those primitives; the
 * `useTapFeedback` hook is a thin React wrapper that wires the real browser
 * APIs. Everything is guarded so unsupported browsers simply do less, never
 * throw.
 *
 * The sound is OFF by default and opt-in behind a toggle, remembered per device
 * in localStorage (same pattern as the register's favorites/density prefs) — we
 * never ship an autoplaying sound.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const TAP_SOUND_STORAGE_KEY = "vallapos.register.tapSound";

// --- persisted sound preference (pure + thin localStorage wrappers) ---

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** Interpret a persisted value; only an explicit truthy flag enables sound. */
export function parseSoundEnabled(raw: string | null | undefined): boolean {
  return raw === "1" || raw === "true";
}

function safeStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadSoundEnabled(storage: StorageLike | null = safeStorage()): boolean {
  try {
    return storage ? parseSoundEnabled(storage.getItem(TAP_SOUND_STORAGE_KEY)) : false;
  } catch {
    return false;
  }
}

export function saveSoundEnabled(on: boolean, storage: StorageLike | null = safeStorage()): void {
  try {
    storage?.setItem(TAP_SOUND_STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* storage full / disabled — the preference is best-effort */
  }
}

// --- haptic + sound firing (pure, injectable) ---

export type VibrateFn = (pattern: number | number[]) => boolean;

/**
 * Fire the feedback for a single tap. Every side-effecting dependency is
 * injected and optional, so this is trivially unit-testable and safe on
 * browsers lacking vibrate or WebAudio. Both effects are wrapped so a throwing
 * API (e.g. vibrate outside a user gesture) can never break a cart action.
 */
export function fireTapFeedback(opts: {
  vibrate?: VibrateFn | null;
  soundEnabled: boolean;
  playClick?: (() => void) | null;
  hapticMs?: number;
}): void {
  const { vibrate, soundEnabled, playClick, hapticMs = 12 } = opts;
  try {
    vibrate?.(hapticMs);
  } catch {
    /* vibrate can throw if not triggered by a user gesture — ignore */
  }
  if (soundEnabled && playClick) {
    try {
      playClick();
    } catch {
      /* audio unavailable — sound is best-effort */
    }
  }
}

// --- WebAudio click (minimal interface so it mocks cleanly) ---

export interface OscillatorLike {
  type: string;
  frequency: { setValueAtTime(value: number, when: number): void };
  connect(node: unknown): void;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface GainLike {
  gain: {
    setValueAtTime(value: number, when: number): void;
    exponentialRampToValueAtTime(value: number, when: number): void;
  };
  connect(node: unknown): void;
}

export interface AudioContextLike {
  currentTime: number;
  destination: unknown;
  state?: string;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
  resume?(): Promise<void> | void;
}

/** Play a tiny, short click on the given AudioContext-like object. */
export function playClickOn(ctx: AudioContextLike): void {
  if (ctx.state === "suspended" && ctx.resume) {
    try {
      ctx.resume();
    } catch {
      /* best-effort unlock */
    }
  }
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const t = ctx.currentTime;
  osc.type = "square";
  osc.frequency.setValueAtTime(880, t);
  // Quiet and fast — a click, not a beep. Exponential ramp to (near) zero.
  gain.gain.setValueAtTime(0.05, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.06);
}

// --- React hook (thin wrapper over the real browser APIs) ---

type AudioContextCtor = new () => AudioContextLike;

function getVibrateFn(): VibrateFn | null {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return null;
  return (pattern) => navigator.vibrate(pattern);
}

export interface TapFeedback {
  /** Fire haptic + (if enabled) sound. Safe to call from any tap handler. */
  tap: () => void;
  /** Whether the opt-in click sound is on (hydrated from localStorage). */
  soundEnabled: boolean;
  /** Toggle + persist the sound preference (also unlocks audio on enable). */
  toggleSound: () => void;
}

export function useTapFeedback(): TapFeedback {
  const [soundEnabled, setSoundEnabled] = useState(false);
  const ctxRef = useRef<AudioContextLike | null>(null);

  // Hydrate the preference after mount (avoids SSR mismatch).
  useEffect(() => {
    setSoundEnabled(loadSoundEnabled());
  }, []);

  const getCtx = useCallback((): AudioContextLike | null => {
    if (typeof window === "undefined") return null;
    if (ctxRef.current) return ctxRef.current;
    const w = window as unknown as {
      AudioContext?: AudioContextCtor;
      webkitAudioContext?: AudioContextCtor;
    };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctxRef.current = new Ctor();
    } catch {
      return null;
    }
    return ctxRef.current;
  }, []);

  const tap = useCallback(() => {
    fireTapFeedback({
      vibrate: getVibrateFn(),
      soundEnabled,
      playClick: soundEnabled
        ? () => {
            const ctx = getCtx();
            if (ctx) playClickOn(ctx);
          }
        : null,
    });
  }, [soundEnabled, getCtx]);

  const toggleSound = useCallback(() => {
    setSoundEnabled((cur) => {
      const next = !cur;
      saveSoundEnabled(next);
      // Warm up / unlock the context on the enabling gesture so the first real
      // click actually sounds (browser autoplay policy needs a user gesture).
      if (next) {
        const ctx = getCtx();
        if (ctx?.state === "suspended" && ctx.resume) {
          try {
            ctx.resume();
          } catch {
            /* best-effort */
          }
        }
      }
      return next;
    });
  }, [getCtx]);

  return { tap, soundEnabled, toggleSound };
}
