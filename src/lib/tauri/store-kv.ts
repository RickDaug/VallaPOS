/**
 * Generic string KV backed by `@tauri-apps/plugin-store` (a JSON file under
 * `$APPCONFIG`). The plugin import is DYNAMIC so the cloud bundle never pulls in
 * `@tauri-apps`. Used by the license blob (`vallapos-license.json`) and the printer
 * config (`vallapos-printer.json`); each file is an independent store.
 */

/** The subset of a KV both the license store and the printer config need. */
export interface TauriKv {
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Open (or create) the named plugin-store file as a `TauriKv`. Tauri/client only. */
export async function loadTauriKv(filename: string): Promise<TauriKv> {
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load(filename);
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
