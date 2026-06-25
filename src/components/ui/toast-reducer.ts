/**
 * Pure toast state + transition, split out of `toast.tsx` so it imports with no
 * JSX (the Vitest config has no React plugin — tests only load plain `.ts`).
 */

export type ToastVariant = "default" | "success" | "error";

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss after N ms (default 4000). */
  duration?: number;
}

export interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

export type ToastAction = { type: "add"; toast: ToastItem } | { type: "remove"; id: number };

export function toastReducer(state: ToastItem[], action: ToastAction): ToastItem[] {
  switch (action.type) {
    case "add":
      return [...state, action.toast];
    case "remove":
      return state.filter((t) => t.id !== action.id);
    default:
      return state;
  }
}
