import { afterEach, describe, expect, it } from "vitest";
import { createTauriSqlDriver, type TauriSqlDatabase } from "./sqlite/tauri-driver";
import type { SqlDriver } from "./sqlite/driver";
import {
  getLocalStore,
  initLocalStore,
  isLocalStoreReady,
  resetLocalStoreForTests,
} from "./local-runtime";

/** node:sqlite-backed `TauriSqlDatabase` (mirrors local.test.ts). */
interface RawStmt {
  all(...p: unknown[]): unknown[];
  run(...p: unknown[]): { changes: number | bigint };
}
interface RawDb {
  prepare(sql: string): RawStmt;
}
async function tauriDatabase(): Promise<TauriSqlDatabase> {
  const mod = (await import("node:sqlite")) as unknown as {
    DatabaseSync: new (path: string) => RawDb;
  };
  const raw = new mod.DatabaseSync(":memory:");
  return {
    async select<T>(query: string, bind: unknown[] = []): Promise<T> {
      return raw.prepare(query).all(...bind) as T;
    },
    async execute(query: string, bind: unknown[] = []) {
      return { rowsAffected: Number(raw.prepare(query).run(...bind).changes) };
    },
  };
}

afterEach(() => resetLocalStoreForTests());

describe("local-runtime singleton", () => {
  it("getLocalStore throws before init", () => {
    expect(isLocalStoreReady()).toBe(false);
    expect(() => getLocalStore()).toThrow(/not ready/i);
  });

  it("boots once and shares the same store across calls (later driver/seed ignored)", async () => {
    const first = await initLocalStore(createTauriSqlDriver(await tauriDatabase()), {
      businessName: "Rosa's Tacos",
      operatorName: "Rosa",
      pin: "2468",
    });
    // A second call with a DIFFERENT driver returns the SAME booted store.
    const second = await initLocalStore(createTauriSqlDriver(await tauriDatabase()));
    expect(second).toBe(first);
    expect(isLocalStoreReady()).toBe(true);
    expect(getLocalStore()).toBe(first);
    expect(first.businessId).toBe("local");
    // Seeded exactly once (no duplicate operator from the second boot).
    expect(await getLocalStore().store.listOperators("local")).toHaveLength(1);
  });

  it("collapses concurrent init calls to a single boot", async () => {
    const driver = createTauriSqlDriver(await tauriDatabase());
    const [x, y] = await Promise.all([initLocalStore(driver), initLocalStore(driver)]);
    expect(x).toBe(y);
    expect(await x.store.listOperators("local")).toHaveLength(1);
  });

  it("resets after a failed boot so a later call can retry", async () => {
    const bad = {
      select: async () => [],
      execute: async () => {
        throw new Error("disk full");
      },
    } as unknown as SqlDriver;
    await expect(initLocalStore(bad)).rejects.toThrow(/disk full/);
    expect(isLocalStoreReady()).toBe(false);

    const ok = await initLocalStore(createTauriSqlDriver(await tauriDatabase()));
    expect(ok.businessId).toBe("local");
  });
});
