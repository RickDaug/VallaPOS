/**
 * Local persistence for the license blob (docs/EDITIONS.md §3/§6). The blob is not
 * a secret — only its Ed25519 signature matters — so a small KV is enough. The KV
 * is INJECTED: the desktop shell backs it with `tauri-plugin-store`
 * (`$APPCONFIG/license.vlk`); tests pass an in-memory fake. No `@tauri-apps`
 * dependency here.
 */

/** The subset of a KV store the license needs. `@tauri-apps/plugin-store` matches. */
export interface LicenseKv {
  get(key: string): Promise<string | null | undefined> | string | null | undefined;
  set(key: string, value: string): Promise<void> | void;
  delete?(key: string): Promise<void> | void;
}

/** Storage key for the license blob. */
export const LICENSE_STORE_KEY = "license.vlk";

export interface LicenseStore {
  /** The stored license blob, or null when none is set. */
  load(): Promise<string | null>;
  /** Persist a license blob (activation). */
  save(blob: string): Promise<void>;
  /** Remove the stored license (deactivate). */
  clear(): Promise<void>;
}

/** Wrap an injected KV as the license store (get/set/clear the blob). */
export function createLicenseStore(kv: LicenseKv, key: string = LICENSE_STORE_KEY): LicenseStore {
  return {
    async load() {
      const v = await kv.get(key);
      return v ? v : null; // treat "" / null / undefined as "no license"
    },
    async save(blob: string) {
      await kv.set(key, blob);
    },
    async clear() {
      if (kv.delete) await kv.delete(key);
      else await kv.set(key, "");
    },
  };
}
