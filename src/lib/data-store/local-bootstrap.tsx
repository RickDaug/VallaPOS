"use client";

import { useEffect } from "react";
import { initLocalStore } from "./local-runtime";
import { createTauriSqlDriver } from "./sqlite/tauri-driver";

/**
 * Boots the local SQLite store ONCE at the offline app root (docs/EDITIONS.md §5b).
 * Loads the Tauri SQL database, adapts it to the store's `SqlDriver`, and runs
 * `initLocalStore` (idempotent migrate + first-run seed). Renders nothing — the
 * converted pages poll `isLocalStoreReady()` and render as soon as this resolves.
 *
 * `@tauri-apps/plugin-sql` is imported DYNAMICALLY and ONLY here, and this component
 * is rendered only by the LOCAL layout (swapped in for the offline build), so the
 * cloud bundle never includes it. Runtime requires the Tauri `sql` plugin registered
 * in the Rust shell (`src-tauri`).
 */
export function LocalStoreBootstrap() {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { default: Database } = await import("@tauri-apps/plugin-sql");
        const db = await Database.load("sqlite:vallapos.db");
        if (cancelled) return;
        await initLocalStore(createTauriSqlDriver(db));
      } catch (err) {
        console.error("Local store boot failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
