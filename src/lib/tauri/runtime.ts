/**
 * Tiny shared Tauri-runtime helpers for the offline edition. Kept dependency-free
 * (no `@tauri-apps` import at module load) so anything can import it — the actual
 * `@tauri-apps/*` modules are dynamic-imported at call sites behind these guards.
 */

/** True only inside the Tauri webview (vs. a plain browser / SSR / test). */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
