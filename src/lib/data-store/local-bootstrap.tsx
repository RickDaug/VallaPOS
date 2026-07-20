"use client";

import { useEffect } from "react";
import { initLocalStore } from "./local-runtime";
import { createTauriSqlDriver } from "./sqlite/tauri-driver";
import { loadLicenseKv } from "@/lib/license/tauri-kv";
import { createLicenseStore } from "@/lib/license/store";
import { nativeCheckLicense } from "@/lib/license/native";

/**
 * Boots the local SQLite store ONCE at the offline app root (docs/EDITIONS.md §5b/§6).
 *
 * This is the AUTHORITATIVE boot-gate: before opening the database it asks the Rust
 * trust anchor (`check_license` → `src-tauri/src/license.rs`, Ed25519 `verify_strict`
 * against the embedded public key) to verify the stored license, and opens the store
 * ONLY on a valid signature. So reaching the data requires a real license even if the
 * in-JS `LocalLicenseGate` (the UX layer) were bypassed. If Rust rejects — or no
 * license is stored, or this isn't the Tauri runtime — the store is never opened and
 * the pages stay on their loading state. Renders nothing.
 *
 * `@tauri-apps/plugin-sql` + `plugin-store` + `api/core` are imported DYNAMICALLY and
 * ONLY here / in the license bridge, and this component renders only in the LOCAL
 * layout, so the cloud bundle never includes `@tauri-apps`. Runtime needs the Tauri
 * `sql` + `store` plugins registered in `src-tauri` (they are).
 */
export function LocalStoreBootstrap() {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const blob = await createLicenseStore(await loadLicenseKv()).load();
        const verdict = await nativeCheckLicense(blob, Date.now());
        if (!verdict.ok) {
          console.error(`Local store boot-gate: license ${verdict.reason} — store not opened.`);
          return;
        }
        if (cancelled) return;
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
