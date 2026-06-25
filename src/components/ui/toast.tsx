"use client";

/**
 * Toast notifications — a tiny, dependency-free system in the same hand-rolled
 * spirit as `useConfirm` (confirm-dialog.tsx). `ToastProvider` is mounted once
 * at the app root; any client component calls `useToast().toast({...})` to pop
 * an accessible, auto-dismissing notification.
 *
 * Accessibility: the live region is `aria-live="polite"`; an `error` toast is
 * announced as `role="alert"`. Entrance motion is intentionally CSS-light and
 * the global `prefers-reduced-motion` rule (globals.css) flattens it.
 */

import { createContext, useCallback, useContext, useReducer, useRef } from "react";
import { Check, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toastReducer, type ToastOptions, type ToastVariant } from "./toast-reducer";

export type { ToastOptions, ToastVariant, ToastItem } from "./toast-reducer";

const ToastContext = createContext<{ toast: (opts: ToastOptions) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a <ToastProvider>.");
  return ctx;
}

const VARIANT_STYLES: Record<ToastVariant, string> = {
  default: "border-border bg-card text-foreground",
  success: "border-success/30 bg-success/10 text-foreground",
  error: "border-destructive/40 bg-destructive/10 text-foreground",
};

const VARIANT_ICON = {
  default: Info,
  success: Check,
  error: TriangleAlert,
} as const;

const VARIANT_ICON_COLOR: Record<ToastVariant, string> = {
  default: "text-muted-foreground",
  success: "text-success",
  error: "text-destructive",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, dispatch] = useReducer(toastReducer, []);
  const idRef = useRef(0);

  const toast = useCallback((opts: ToastOptions) => {
    const id = (idRef.current += 1);
    dispatch({
      type: "add",
      toast: {
        id,
        title: opts.title,
        description: opts.description,
        variant: opts.variant ?? "default",
      },
    });
    const duration = opts.duration ?? 4000;
    setTimeout(() => dispatch({ type: "remove", id }), duration);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        {toasts.map((t) => {
          const Icon = VARIANT_ICON[t.variant];
          return (
            <div
              key={t.id}
              role={t.variant === "error" ? "alert" : "status"}
              className={cn(
                "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border p-4 shadow-lg",
                VARIANT_STYLES[t.variant],
              )}
            >
              <Icon size={18} className={cn("mt-0.5 shrink-0", VARIANT_ICON_COLOR[t.variant])} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-tight">{t.title}</p>
                {t.description && (
                  <p className="mt-0.5 text-sm text-muted-foreground">{t.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dispatch({ type: "remove", id: t.id })}
                aria-label="Dismiss notification"
                className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
