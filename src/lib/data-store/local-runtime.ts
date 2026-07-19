/**
 * Process-singleton boot for the local (offline-edition) DataStore.
 *
 * The desktop app is a single Tauri webview process, so the SQLite store is
 * created ONCE and shared: the local app root calls `initLocalStore(driver)` at
 * boot (with the real `@tauri-apps/plugin-sql`-backed driver), and client page
 * islands read it synchronously via `getLocalStore()` after that promise
 * resolves. Because the driver is INJECTED, this module pulls in no `@tauri-apps`
 * dependency and is fully unit-testable (see the test's `node:sqlite` driver).
 *
 * Cloud is unaffected: cloud callers use `getDataStore()` (`./index.ts`,
 * `server-only`). This module is imported only by the local build's shell/pages
 * and is client-safe (no `server-only`), mirroring `./local.ts`.
 */
import { createLocalDataStore, type LocalDataStore, type LocalSeedOptions } from "./local";
import type { SqlDriver } from "./sqlite/driver";

let bootPromise: Promise<LocalDataStore> | null = null;
let ready: LocalDataStore | null = null;

/**
 * Boot the local store once. Idempotent: repeat calls (or concurrent mounts)
 * return the SAME in-flight/resolved promise, so the store is never migrated,
 * seeded, or opened twice — the `driver`/`seed` on calls after the first are
 * ignored (there is exactly one local DB per install). If the first boot
 * rejects, the singleton resets so a later call can retry.
 */
export function initLocalStore(driver: SqlDriver, seed?: LocalSeedOptions): Promise<LocalDataStore> {
  if (!bootPromise) {
    bootPromise = createLocalDataStore(driver, seed).then(
      (local) => {
        ready = local;
        return local;
      },
      (err) => {
        bootPromise = null; // allow a retry after a failed boot
        throw err;
      },
    );
  }
  return bootPromise;
}

/** True once `initLocalStore` has resolved. */
export function isLocalStoreReady(): boolean {
  return ready !== null;
}

/**
 * Synchronous access to the booted store. Throws if called before
 * `initLocalStore()` has resolved — the app root awaits `initLocalStore` at boot
 * (or callers gate on `isLocalStoreReady()`).
 */
export function getLocalStore(): LocalDataStore {
  if (!ready) {
    throw new Error(
      "Local store not ready — await initLocalStore(driver) at app boot before getLocalStore().",
    );
  }
  return ready;
}

/** Test-only: clear the process singleton between cases. */
export function resetLocalStoreForTests(): void {
  bootPromise = null;
  ready = null;
}
