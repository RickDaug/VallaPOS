/**
 * Local (offline-edition) composition root for the DataStore seam
 * (docs/EDITIONS.md §5). The CLOUD root lives in `./index.ts` (`getDataStore()`,
 * `server-only`, Prisma) — this is its DELIBERATE counterpart: it is client-safe
 * (NO `server-only`), because the desktop edition runs entirely in the Tauri
 * webview with no Node server.
 *
 * It opens a `SqliteDataStore` over an INJECTED `SqlDriver` (the Tauri SQL driver
 * in the shell; `node:sqlite` in tests), runs the idempotent schema migration +
 * first-run seed, and hands back the ready store. Because the driver is injected,
 * this module pulls in NO `@tauri-apps` dependency and is fully unit-testable.
 */
import { SqliteDataStore } from "./sqlite/sqlite-store";
import type { SqlDriver } from "./sqlite/driver";

/** Options for the first-run seed (one business + operator). @see SqliteDataStore.seedFirstRun */
export type LocalSeedOptions = Parameters<SqliteDataStore["seedFirstRun"]>[0];

export interface LocalDataStore {
  store: SqliteDataStore;
  /** The single local business id the install collapses to (LOCAL_BUSINESS_ID). */
  businessId: string;
}

/**
 * Open the local store: migrate (idempotent `CREATE TABLE IF NOT EXISTS`) then seed
 * the first-run business + operator (idempotent — a no-op once seeded). Safe to call
 * on every app boot. Returns the ready store plus the resolved businessId to scope
 * every subsequent call with.
 */
export async function createLocalDataStore(
  driver: SqlDriver,
  seed?: LocalSeedOptions,
): Promise<LocalDataStore> {
  const store = new SqliteDataStore(driver);
  await store.migrate();
  const { businessId } = await store.seedFirstRun(seed);
  return { store, businessId };
}
