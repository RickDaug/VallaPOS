import type { LicenseKv } from "./store";
import { loadTauriKv } from "@/lib/tauri/store-kv";

/**
 * Back the license KV with `@tauri-apps/plugin-store` (`$APPCONFIG/vallapos-license.json`).
 * Thin wrapper over the shared `loadTauriKv`; Tauri/client only. Shared by the UX gate
 * (`LocalLicenseGate`) and the SQLite boot-gate (`local-bootstrap.tsx`) so both read/write
 * the SAME stored blob.
 */
export async function loadLicenseKv(): Promise<LicenseKv> {
  return loadTauriKv("vallapos-license.json");
}
