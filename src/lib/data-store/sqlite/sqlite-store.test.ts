import { beforeEach, describe, expect, it } from "vitest";
import { SqliteDataStore } from "./sqlite-store";
import type { SqlDriver, SqlRunResult } from "./driver";

/**
 * Test driver: a `node:sqlite`-backed `SqlDriver` so the store runs against REAL
 * SQLite (no mocks, no new deps). The desktop app supplies a `@tauri-apps/plugin-sql`
 * driver of the same shape at Stage 5.
 */
interface RawStmt {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number | bigint };
}
interface RawDb {
  prepare(sql: string): RawStmt;
}

async function makeStore(): Promise<{ store: SqliteDataStore; driver: SqlDriver }> {
  const mod = (await import("node:sqlite")) as unknown as {
    DatabaseSync: new (path: string) => RawDb;
  };
  const db = new mod.DatabaseSync(":memory:");
  const driver: SqlDriver = {
    async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return db.prepare(sql).all(...params) as T[];
    },
    async execute(sql: string, params: unknown[] = []): Promise<SqlRunResult> {
      const info = db.prepare(sql).run(...params);
      return { rowsAffected: Number(info.changes) };
    },
  };
  const store = new SqliteDataStore(driver);
  await store.migrate();
  return { store, driver };
}

const BIZ = "biz1";

async function seedCatalog(driver: SqlDriver) {
  await driver.execute(`INSERT INTO business (id, name) VALUES (?, ?)`, [BIZ, "Taco Truck"]);
  await driver.execute(`INSERT INTO category (id, businessId, name) VALUES (?, ?, ?)`, ["cat1", BIZ, "Drinks"]);
  // Uncategorized item (categoryId NULL) — exercises the "Uncategorized" fallback.
  await driver.execute(
    `INSERT INTO item (id, businessId, categoryId, name, type, active) VALUES (?, ?, ?, ?, ?, ?)`,
    ["itemB", BIZ, null, "Classic Burger", "PRODUCT", 1],
  );
  await driver.execute(
    `INSERT INTO item (id, businessId, categoryId, name, type, active) VALUES (?, ?, ?, ?, ?, ?)`,
    ["itemS", BIZ, "cat1", "Soda", "PRODUCT", 1],
  );
  // Inactive item — must be excluded from the register grid.
  await driver.execute(
    `INSERT INTO item (id, businessId, categoryId, name, type, active) VALUES (?, ?, ?, ?, ?, ?)`,
    ["itemX", BIZ, null, "Retired Item", "PRODUCT", 0],
  );
  await driver.execute(
    `INSERT INTO variation (id, businessId, itemId, name, priceCents, sortOrder) VALUES (?, ?, ?, ?, ?, ?)`,
    ["varB", BIZ, "itemB", "Default", 500, 0],
  );
  await driver.execute(
    `INSERT INTO variation (id, businessId, itemId, name, priceCents, sortOrder) VALUES (?, ?, ?, ?, ?, ?)`,
    ["varS2", BIZ, "itemS", "Large", 300, 1],
  );
  await driver.execute(
    `INSERT INTO variation (id, businessId, itemId, name, priceCents, sortOrder) VALUES (?, ?, ?, ?, ?, ?)`,
    ["varS1", BIZ, "itemS", "Small", 200, 0],
  );
  await driver.execute(
    `INSERT INTO modifier_group (id, businessId, name, minSelect, maxSelect) VALUES (?, ?, ?, ?, ?)`,
    ["grp1", BIZ, "Add-ons", 0, 2],
  );
  await driver.execute(
    `INSERT INTO modifier (id, businessId, groupId, name, priceDeltaCents, sortOrder) VALUES (?, ?, ?, ?, ?, ?)`,
    ["mod2", BIZ, "grp1", "Bacon", 100, 1],
  );
  await driver.execute(
    `INSERT INTO modifier (id, businessId, groupId, name, priceDeltaCents, sortOrder) VALUES (?, ?, ?, ?, ?, ?)`,
    ["mod1", BIZ, "grp1", "Cheese", 50, 0],
  );
  await driver.execute(`INSERT INTO item_modifier_group (itemId, groupId) VALUES (?, ?)`, ["itemB", "grp1"]);
}

describe("SqliteDataStore.getRegisterCatalog", () => {
  let store: SqliteDataStore;
  let driver: SqlDriver;

  beforeEach(async () => {
    ({ store, driver } = await makeStore());
  });

  it("returns an empty list when the business has no catalog", async () => {
    expect(await store.getRegisterCatalog(BIZ)).toEqual([]);
  });

  it("builds one SellableEntry per active variation, sorted + shaped like the cloud query", async () => {
    await seedCatalog(driver);
    const entries = await store.getRegisterCatalog(BIZ);

    // 1 burger variation + 2 soda variations; the inactive item is excluded.
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.label)).toEqual(["Classic Burger", "Soda — Small", "Soda — Large"]);

    const [burger, sodaSmall, sodaLarge] = entries;
    if (!burger || !sodaSmall || !sodaLarge) throw new Error("expected 3 entries");

    expect(burger.category).toBe("Uncategorized"); // NULL categoryId → fallback
    expect(burger.priceCents).toBe(500);
    expect(burger.type).toBe("PRODUCT");
    expect(burger.modifierGroups).toHaveLength(1);
    const group = burger.modifierGroups[0];
    if (!group) throw new Error("expected a modifier group");
    expect(group).toMatchObject({ name: "Add-ons", minSelect: 0, maxSelect: 2 });
    // Modifiers come back ordered by sortOrder (Cheese before Bacon), with cents intact.
    expect(group.modifiers).toEqual([
      { id: "mod1", name: "Cheese", priceDeltaCents: 50 },
      { id: "mod2", name: "Bacon", priceDeltaCents: 100 },
    ]);

    expect(sodaSmall.category).toBe("Drinks");
    expect(sodaSmall.priceCents).toBe(200); // sorted before Large by sortOrder
    expect(sodaSmall.modifierGroups).toEqual([]);
    expect(sodaLarge.priceCents).toBe(300);
  });

  it("scopes strictly by businessId", async () => {
    await seedCatalog(driver);
    expect(await store.getRegisterCatalog("other-biz")).toEqual([]);
  });
});

const BIZ2 = "biz-orders";

async function seedOrders(driver: SqlDriver) {
  await driver.execute(
    `INSERT INTO business (id, name, taxRateBps, taxInclusive, currency, timezone) VALUES (?, ?, ?, ?, ?, ?)`,
    [BIZ2, "Taco Truck", 825, 0, "USD", "America/Chicago"],
  );
  await driver.execute(
    `INSERT INTO "order" (id, businessId, clientUuid, number, customerName, status, subtotalCents, discountCents, taxCents, tipCents, totalCents, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["ord1", BIZ2, "uuid-1", 1, "Alice", "PAID", 500, 0, 41, 100, 641, "2026-07-10T12:00:00.000Z"],
  );
  await driver.execute(
    `INSERT INTO "order" (id, businessId, clientUuid, number, customerName, status, subtotalCents, discountCents, taxCents, tipCents, totalCents, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["ord2", BIZ2, "uuid-2", 2, null, "PAID", 300, 0, 0, 0, 300, "2026-07-11T09:00:00.000Z"],
  );
  await driver.execute(
    `INSERT INTO order_line (id, businessId, orderId, nameSnapshot, unitPriceCents, quantity, discountCents, taxCents, totalCents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["ln1", BIZ2, "ord1", "Classic Burger", 500, 1, 0, 41, 500],
  );
  await driver.execute(
    `INSERT INTO order_line_modifier (id, orderLineId, nameSnapshot, priceDeltaCents) VALUES (?, ?, ?, ?)`,
    ["m1", "ln1", "Cheese", 50],
  );
  await driver.execute(
    `INSERT INTO payment (id, businessId, orderId, method, status, amountCents, tenderedCents, changeCents, processorRef, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["pay1", BIZ2, "ord1", "CASH", "CAPTURED", 641, 700, 59, null, "2026-07-10T12:00:00.000Z"],
  );
  await driver.execute(
    `INSERT INTO payment (id, businessId, orderId, method, status, amountCents, tenderedCents, changeCents, processorRef, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["pay2", BIZ2, "ord2", "CARD", "CAPTURED", 300, null, null, null, "2026-07-11T09:00:00.000Z"],
  );
}

describe("SqliteDataStore order reads", () => {
  let store: SqliteDataStore;
  let driver: SqlDriver;

  beforeEach(async () => {
    ({ store, driver } = await makeStore());
    await seedOrders(driver);
  });

  it("listOrders returns most-recent-first with the first payment's method", async () => {
    const rows = await store.listOrders(BIZ2);
    expect(rows.map((r) => r.id)).toEqual(["ord2", "ord1"]);
    const [first, second] = rows;
    if (!first || !second) throw new Error("expected 2 orders");
    expect(first).toMatchObject({ number: 2, customerName: null, totalCents: 300, method: "CARD", status: "PAID" });
    expect(second).toMatchObject({ number: 1, customerName: "Alice", totalCents: 641, method: "CASH" });
  });

  it("listOrders honors the limit", async () => {
    expect((await store.listOrders(BIZ2, 1)).map((r) => r.id)).toEqual(["ord2"]);
  });

  it("getOrderReceipt returns lines + modifiers + payments + business snapshot", async () => {
    const receipt = await store.getOrderReceipt(BIZ2, "ord1");
    if (!receipt) throw new Error("expected a receipt");
    expect(receipt).toMatchObject({
      number: 1,
      customerName: "Alice",
      subtotalCents: 500,
      taxCents: 41,
      tipCents: 100,
      totalCents: 641,
      businessName: "Taco Truck",
      currency: "USD",
      taxRateBps: 825,
      taxInclusive: false,
      timeZone: "America/Chicago",
    });
    expect(receipt.lines).toHaveLength(1);
    const line = receipt.lines[0];
    if (!line) throw new Error("expected a line");
    expect(line).toMatchObject({ name: "Classic Burger", quantity: 1, unitPriceCents: 500, taxCents: 41 });
    expect(line.modifiers).toEqual([{ id: "m1", name: "Cheese", priceDeltaCents: 50 }]);
    expect(receipt.payments).toEqual([
      { method: "CASH", amountCents: 641, tenderedCents: 700, changeCents: 59, manualNote: null },
    ]);
  });

  it("returns null for a missing order and enforces tenant scope", async () => {
    expect(await store.getOrderReceipt(BIZ2, "nope")).toBeNull();
    expect(await store.getOrderReceipt("other-biz", "ord1")).toBeNull();
  });
});
