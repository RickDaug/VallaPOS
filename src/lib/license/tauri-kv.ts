import type { LicenseKv } from "./store";

/**
 * Back the license KV with `@tauri-apps/plugin-store` (`$APPCONFIG/vallapos-license.json`).
 * The `@tauri-apps/plugin-store` import is DYNAMIC so the cloud bundle never pulls in
 * `@tauri-apps` — Tauri/client only. Shared by the UX gate (`LocalLicenseGate`) and the
 * SQLite boot-gate (`local-bootstrap.tsx`) so both read/write the SAME stored blob.
 */
export async function loadLicenseKv(): Promise<LicenseKv> {
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load("vallapos-license.json");
  return {
    get: (key) => store.get<string>(key),
    set: async (key, value) => {
      await store.set(key, value);
      await store.save();
    },
    delete: async (key) => {
      await store.delete(key);
      await store.save();
    },
  };
}
