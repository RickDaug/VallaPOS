import { describe, expect, it } from "vitest";
import { createLocalDataStore } from "./local";
import { createTauriSqlDriver, type TauriSqlDatabase } from "./sqlite/tauri-driver";
import type { SqlDriver } from "./sqlite/driver";

/**
 * End-to-end proof of the DESKTOP chain: a `node:sqlite`-backed database shaped
 * like `@tauri-apps/plugin-sql`'s `Database` → `createTauriSqlDriver` → the
 * `createLocalDataStore` factory → a real `SqliteDataStore`. If the Tauri driver
 * adapter and the factory are correct, a real sale round-trips through them.
 */
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

describe("createLocalDataStore over the Tauri SQL driver", () => {
  it("migrates + seeds one business/operator and is idempotent across boots", async () => {
    const driver = createTauriSqlDriver(await tauriDatabase());
    const first = await createLocalDataStore(driver, {
      businessName: "Rosa's Tacos",
      operatorName: "Rosa",
      pin: "2468",
    });
    expect(first.businessId).toBe("local");
    const operators = await first.store.listOperators("local");
    expect(operators).toEqual([{ id: expect.any(String), name: "Rosa", active: true }]);
    expect(await first.store.verifyOperatorPin("local", operators[0]!.id, "2468")).toBe(true);

    // A second boot on the SAME db is a no-op — no duplicate business/operator.
    const second = await createLocalDataStore(driver, { operatorName: "Ignored" });
    expect(second.businessId).toBe("local");
    expect(await second.store.listOperators("local")).toHaveLength(1);
  });

  it("rings a real cash sale through the adapter (BEGIN IMMEDIATE + reads)", async () => {
    const driver: SqlDriver = createTauriSqlDriver(await tauriDatabase());
    const { store, businessId } = await createLocalDataStore(driver);

    // Seed a taxable $5 item straight through the same adapter.
    await driver.execute(`UPDATE business SET taxRateBps = 825 WHERE id = ?`, [businessId]);
    await driver.execute(
      `INSERT INTO item (id, businessId, name, type, active) VALUES (?, ?, 'Burger', 'PRODUCT', 1)`,
      ["it1", businessId],
    );
    await driver.execute(
      `INSERT INTO variation (id, businessId, itemId, name, priceCents, sortOrder) VALUES (?, ?, ?, 'Default', 500, 0)`,
      ["v1", businessId, "it1"],
    );

    const receipt = await store.checkout({
      businessId,
      clientUuid: globalThis.crypto.randomUUID(),
      lines: [{ variationId: "v1", quantity: 1 }],
      tipCents: 0,
      cartDiscountCents: 0,
      method: "CASH",
      cashTenderedCents: 1000,
    });
    if ("error" in receipt) throw new Error("expected a receipt");
    // 500 → tax round(41.25)=41 → total 541, change 459.
    expect(receipt).toMatchObject({ number: 1, subtotalCents: 500, taxCents: 41, totalCents: 541, changeCents: 459 });

    expect((await store.listOrders(businessId)).map((o) => o.number)).toEqual([1]);
    expect((await store.getOrderReceipt(businessId, receipt.orderId))?.totalCents).toBe(541);
  });
});
