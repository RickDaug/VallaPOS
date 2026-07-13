import { beforeEach, describe, expect, it } from "vitest";
import { SqliteDataStore, LOCAL_BUSINESS_ID } from "./sqlite-store";
import type { SqlDriver, SqlRunResult } from "./driver";
import type { CheckoutInput, CheckoutResult } from "@/features/register/schema";

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

// ─────────────────────────────── Stage 3c ───────────────────────────────────

/** A random valid uuid for the checkout idempotency key (schema requires uuid). */
function uuid(): string {
  return globalThis.crypto.randomUUID();
}

/** Monotonic counter so directly-seeded orders get unique ids + order numbers. */
let seedSaleSeq = 0;

// `CheckoutInput` is the schema's OUTPUT type, so the `.default()` fields are
// required. This helper fills them so the tests only spell out what they exercise.
type CoArgs = Omit<CheckoutInput, "tipCents" | "cartDiscountCents" | "method" | "cashTenderedCents"> &
  Partial<Pick<CheckoutInput, "tipCents" | "cartDiscountCents" | "method" | "cashTenderedCents">>;

function co(store: SqliteDataStore, args: CoArgs): Promise<CheckoutResult> {
  const full: CheckoutInput = {
    tipCents: 0,
    cartDiscountCents: 0,
    method: "CASH",
    cashTenderedCents: 0,
    ...args,
  };
  return store.checkout(full);
}

/** seedCatalog (BIZ = the burger/soda catalog) + set an 8.25% tax rate on it. */
async function seedTaxableCatalog(driver: SqlDriver) {
  await seedCatalog(driver);
  await driver.execute(`UPDATE business SET taxRateBps = ? WHERE id = ?`, [825, BIZ]);
}

describe("SqliteDataStore.getManagedCatalog", () => {
  let store: SqliteDataStore;
  let driver: SqlDriver;

  beforeEach(async () => {
    ({ store, driver } = await makeStore());
  });

  it("returns empty sections for a business with no catalog", async () => {
    expect(await store.getManagedCatalog(BIZ)).toEqual({
      categories: [],
      items: [],
      modifierGroups: [],
    });
  });

  it("returns categories, items (active first, incl. archived), variations, and modifier groups", async () => {
    await seedCatalog(driver);
    const catalog = await store.getManagedCatalog(BIZ);

    expect(catalog.categories).toEqual([{ id: "cat1", name: "Drinks", sortOrder: 0 }]);

    // Active items first (by name), then archived: Classic Burger, Soda, then Retired Item.
    expect(catalog.items.map((i) => i.name)).toEqual(["Classic Burger", "Soda", "Retired Item"]);
    const [burger, soda, retired] = catalog.items;
    if (!burger || !soda || !retired) throw new Error("expected 3 items");

    expect(retired.active).toBe(false);
    expect(burger.active).toBe(true);
    expect(burger.categoryId).toBeNull();
    expect(burger.categoryName).toBeNull();
    expect(burger.modifierGroupIds).toEqual(["grp1"]);
    expect(burger.variations).toEqual([
      { id: "varB", name: "Default", priceCents: 500, sku: null, sortOrder: 0 },
    ]);

    // Soda's variations come back sorted by sortOrder (Small before Large).
    expect(soda.categoryName).toBe("Drinks");
    expect(soda.variations.map((v) => v.name)).toEqual(["Small", "Large"]);
    expect(soda.modifierGroupIds).toEqual([]);

    expect(catalog.modifierGroups).toEqual([
      {
        id: "grp1",
        name: "Add-ons",
        minSelect: 0,
        maxSelect: 2,
        modifiers: [
          { id: "mod1", name: "Cheese", priceDeltaCents: 50 },
          { id: "mod2", name: "Bacon", priceDeltaCents: 100 },
        ],
      },
    ]);
  });

  it("scopes strictly by businessId", async () => {
    await seedCatalog(driver);
    expect(await store.getManagedCatalog("other-biz")).toEqual({
      categories: [],
      items: [],
      modifierGroups: [],
    });
  });
});

describe("SqliteDataStore.checkout", () => {
  let store: SqliteDataStore;
  let driver: SqlDriver;

  beforeEach(async () => {
    ({ store, driver } = await makeStore());
    await seedTaxableCatalog(driver);
  });

  it("prices a cash sale server-authoritatively (8.25% tax) and returns change", async () => {
    const receipt = await co(store, {
      businessId: BIZ,
      clientUuid: uuid(),
      lines: [{ variationId: "varB", quantity: 1 }],
      method: "CASH",
      cashTenderedCents: 1000,
    });
    if ("error" in receipt) throw new Error("expected a receipt");
    // Burger 500 → tax round(500 * 0.0825) = 41 → total 541, change 459.
    expect(receipt).toMatchObject({
      number: 1,
      subtotalCents: 500,
      taxCents: 41,
      totalCents: 541,
      method: "CASH",
      cashTenderedCents: 1000,
      changeCents: 459,
      manualNote: null,
    });

    // It persisted: the order + line + cash payment read back.
    const stored = await store.getOrderReceipt(BIZ, receipt.orderId);
    expect(stored?.totalCents).toBe(541);
    expect(stored?.payments).toEqual([
      { method: "CASH", amountCents: 541, tenderedCents: 1000, changeCents: 459, manualNote: null },
    ]);
  });

  it("folds chosen modifiers into the taxable base and snapshots them on the line", async () => {
    const receipt = await co(store, {
      businessId: BIZ,
      clientUuid: uuid(),
      lines: [{ variationId: "varB", quantity: 1, modifierIds: ["mod1"] }], // + Cheese 50
      method: "CASH",
      cashTenderedCents: 600,
    });
    if ("error" in receipt) throw new Error("expected a receipt");
    // (500 + 50) = 550 → tax round(45.375) = 45 → total 595.
    expect(receipt).toMatchObject({ subtotalCents: 550, taxCents: 45, totalCents: 595, changeCents: 5 });
    const stored = await store.getOrderReceipt(BIZ, receipt.orderId);
    expect(stored?.lines[0]?.modifiers).toEqual([{ id: expect.any(String), name: "Cheese", priceDeltaCents: 50 }]);
  });

  it("allocates a contiguous per-business order number", async () => {
    const r1 = await co(store, {
      businessId: BIZ,
      clientUuid: uuid(),
      lines: [{ variationId: "varB", quantity: 1 }],
      cashTenderedCents: 1000,
    });
    const r2 = await co(store, {
      businessId: BIZ,
      clientUuid: uuid(),
      lines: [{ variationId: "varS1", quantity: 1 }],
      cashTenderedCents: 1000,
    });
    if ("error" in r1 || "error" in r2) throw new Error("expected receipts");
    expect([r1.number, r2.number]).toEqual([1, 2]);
    expect((await store.listOrders(BIZ)).map((o) => o.number)).toEqual([2, 1]);
  });

  it("is idempotent on clientUuid — a resubmit returns the same order, no duplicate", async () => {
    const key = uuid();
    const input = {
      businessId: BIZ,
      clientUuid: key,
      lines: [{ variationId: "varB", quantity: 1 }],
      cashTenderedCents: 1000,
    };
    const first = await co(store, input);
    const second = await co(store, input);
    if ("error" in first || "error" in second) throw new Error("expected receipts");
    expect(second.orderId).toBe(first.orderId);
    expect(second.number).toBe(first.number);
    expect(await store.listOrders(BIZ)).toHaveLength(1);
  });

  it("records a non-cash MANUAL tender with no change and the reference note", async () => {
    const receipt = await co(store, {
      businessId: BIZ,
      clientUuid: uuid(),
      lines: [{ variationId: "varS1", quantity: 1 }], // soda 200
      method: "MANUAL",
      manualNote: "Check #1234",
    });
    if ("error" in receipt) throw new Error("expected a receipt");
    expect(receipt).toMatchObject({ method: "MANUAL", cashTenderedCents: 0, changeCents: 0, manualNote: "Check #1234" });
    const stored = await store.getOrderReceipt(BIZ, receipt.orderId);
    expect(stored?.payments[0]).toMatchObject({ method: "MANUAL", manualNote: "Check #1234" });
  });

  it("rejects cash under the total and an unknown item", async () => {
    await expect(
      co(store, {
        businessId: BIZ,
        clientUuid: uuid(),
        lines: [{ variationId: "varB", quantity: 1 }],
        method: "CASH",
        cashTenderedCents: 100, // < 541
      }),
    ).rejects.toThrow(/less than the total/);

    await expect(
      co(store, {
        businessId: BIZ,
        clientUuid: uuid(),
        lines: [{ variationId: "does-not-exist", quantity: 1 }],
        cashTenderedCents: 1000,
      }),
    ).rejects.toThrow(/Unknown item/);
  });
});

describe("SqliteDataStore drawer + reports", () => {
  let store: SqliteDataStore;
  let driver: SqlDriver;

  beforeEach(async () => {
    ({ store, driver } = await makeStore());
    await seedTaxableCatalog(driver);
  });

  async function ringCashBurger() {
    return co(store, {
      businessId: BIZ,
      clientUuid: uuid(),
      lines: [{ variationId: "varB", quantity: 1 }], // 541 total (500 + 41 tax)
      cashTenderedCents: 1000,
    });
  }

  /**
   * Backdate an open drawer's `openedAt` and seed a CASH sale at a FIXED past
   * instant, so the drawer's `[openedAt, closedAt)` window math is deterministic
   * (a real sale and a manual close are always seconds apart; only synthetic
   * sub-millisecond test runs could collide on the half-open upper bound).
   */
  async function seedPastCashSale(amountCents: number, at: string) {
    seedSaleSeq += 1;
    const oid = `seed-ord-${seedSaleSeq}`;
    await driver.execute(
      `INSERT INTO "order" (id, businessId, clientUuid, number, status, subtotalCents, discountCents, taxCents, tipCents, totalCents, createdAt)
       VALUES (?, ?, ?, ?, 'PAID', ?, 0, 0, 0, ?, ?)`,
      [oid, BIZ, uuid(), 1000 + seedSaleSeq, amountCents, amountCents, at],
    );
    await driver.execute(
      `INSERT INTO payment (id, businessId, orderId, method, status, amountCents, createdAt)
       VALUES (?, ?, ?, 'CASH', 'CAPTURED', ?, ?)`,
      [`seed-pay-${seedSaleSeq}`, BIZ, oid, amountCents, at],
    );
  }

  const PAST_OPEN = "2020-01-01T00:00:00.000Z";

  async function openBackdatedDrawer(openingFloatCents: number) {
    const opened = await store.openDrawer({ businessId: BIZ, openingFloatCents });
    await driver.execute(`UPDATE cash_drawer_session SET openedAt = ? WHERE id = ?`, [
      PAST_OPEN,
      opened.sessionId,
    ]);
    return opened;
  }

  it("opens, tracks cash collected, and reconciles the drawer at close", async () => {
    const opened = await openBackdatedDrawer(5000);
    expect(opened.openingFloatCents).toBe(5000);

    // A second open is rejected while one is live.
    await expect(store.openDrawer({ businessId: BIZ, openingFloatCents: 100 })).rejects.toThrow(
      /already open/,
    );

    await seedPastCashSale(541, "2020-01-01T01:00:00.000Z");
    await seedPastCashSale(541, "2020-01-01T02:00:00.000Z");

    const open = await store.getOpenSession(BIZ);
    expect(open?.openingFloatCents).toBe(5000);
    // Two cash sales of 541 collected since open (end defaults to now, well after).
    expect(await store.getCashCollectedSince(BIZ, new Date(PAST_OPEN))).toBe(1082);

    // Blind count matches expected (5000 float + 1082) → variance 0.
    const closed = await store.closeDrawer({
      businessId: BIZ,
      sessionId: opened.sessionId,
      countedCents: 6082,
    });
    expect(closed).toMatchObject({ expectedCents: 6082, countedCents: 6082, varianceCents: 0 });

    // Closed now; a double close is rejected.
    expect(await store.getOpenSession(BIZ)).toBeNull();
    await expect(
      store.closeDrawer({ businessId: BIZ, sessionId: opened.sessionId, countedCents: 6082 }),
    ).rejects.toThrow(/No matching open drawer session/);
  });

  it("reports a short drawer variance and summarizes the day", async () => {
    const opened = await openBackdatedDrawer(10000);
    await seedPastCashSale(541, "2020-01-01T01:00:00.000Z"); // expected 10541
    const closed = await store.closeDrawer({
      businessId: BIZ,
      sessionId: opened.sessionId,
      countedCents: 10500, // 41 short
    });
    expect(closed.varianceCents).toBe(-41);

    const summary = await store.getDrawerDaySummary(
      BIZ,
      new Date("2019-01-01T00:00:00.000Z"),
      new Date(Date.now() + 60_000),
    );
    expect(summary).toEqual({ closedCount: 1, openCount: 0, netVarianceCents: -41 });
  });

  it("a real cash checkout feeds the drawer's collected cash", async () => {
    await openBackdatedDrawer(0);
    await ringCashBurger(); // real checkout → CASH payment of 541 at ~now
    // Query with an explicit future end so the just-made sale (createdAt ≈ now)
    // is inside the half-open window regardless of sub-ms timing.
    const collected = await store.getCashCollectedSince(
      BIZ,
      new Date(PAST_OPEN),
      new Date(Date.now() + 60_000),
    );
    expect(collected).toBe(541);
  });

  it("getDailyReport counts cash sales and classifies tenders (verified vs unverified)", async () => {
    await ringCashBurger(); // CASH 541
    await co(store, {
      businessId: BIZ,
      clientUuid: uuid(),
      lines: [{ variationId: "varS1", quantity: 1 }], // soda 200 → tax 17 → 217
      method: "MANUAL",
      manualNote: "Zelle",
    });

    const report = await store.getDailyReport(
      BIZ,
      new Date(Date.now() - 60_000),
      new Date(Date.now() + 60_000),
    );
    expect(report.orderCount).toBe(2);
    expect(report.grossSalesCents).toBe(700); // 500 + 200 subtotals
    expect(report.taxCents).toBe(58); // 41 + 17
    expect(report.cashCollectedCents).toBe(541); // MANUAL is not cash
    expect(report.tenders.verifiedCollectedCents).toBe(541);
    expect(report.tenders.unverifiedCollectedCents).toBe(217);
    const cash = report.byMethod.find((m) => m.method === "CASH");
    expect(cash).toMatchObject({ count: 1, amountCents: 541 });
  });

  it("getItemSalesReport rolls up by item and category", async () => {
    await co(store, {
      businessId: BIZ,
      clientUuid: uuid(),
      lines: [{ variationId: "varB", quantity: 2 }], // 2 burgers, net 1000
      cashTenderedCents: 5000,
    });
    const report = await store.getItemSalesReport(
      BIZ,
      new Date(Date.now() - 60_000),
      new Date(Date.now() + 60_000),
    );
    expect(report.byItem).toEqual([
      { name: "Classic Burger", quantity: 2, netSalesCents: 1000, taxCents: 83 },
    ]);
    // Burger has a null category → "Uncategorized".
    expect(report.byCategory).toEqual([
      { category: "Uncategorized", quantity: 2, netSalesCents: 1000 },
    ]);
  });

  it("getCashierSalesReport attributes to the operator, else Unattributed", async () => {
    // Local checkout leaves cashierId null → Unattributed.
    await ringCashBurger();
    const unattributed = await store.getCashierSalesReport(
      BIZ,
      new Date(Date.now() - 60_000),
      new Date(Date.now() + 60_000),
    );
    expect(unattributed).toEqual([{ cashier: "Unattributed", orderCount: 1, netSalesCents: 500 }]);

    // An order stamped with a real operator resolves the operator's name.
    await driver.execute(`INSERT INTO operator (id, businessId, name) VALUES (?, ?, ?)`, [
      "op1",
      BIZ,
      "Rosa",
    ]);
    await driver.execute(
      `INSERT INTO "order" (id, businessId, clientUuid, number, cashierId, status, subtotalCents, discountCents, taxCents, tipCents, totalCents, createdAt)
       VALUES (?, ?, ?, ?, ?, 'PAID', ?, ?, ?, ?, ?, ?)`,
      ["ordR", BIZ, uuid(), 99, "op1", 800, 100, 0, 0, 700, new Date().toISOString()],
    );
    const attributed = await store.getCashierSalesReport(
      BIZ,
      new Date(Date.now() - 60_000),
      new Date(Date.now() + 60_000),
    );
    expect(attributed).toContainEqual({ cashier: "Rosa", orderCount: 1, netSalesCents: 700 });
  });
});

describe("SqliteDataStore operators + first-run seed", () => {
  let store: SqliteDataStore;

  beforeEach(async () => {
    ({ store } = await makeStore());
  });

  it("seeds one business + operator on first run, and is idempotent", async () => {
    const first = await store.seedFirstRun();
    expect(first.businessId).toBe(LOCAL_BUSINESS_ID);

    const operators = await store.listOperators(LOCAL_BUSINESS_ID);
    expect(operators).toEqual([{ id: expect.any(String), name: "Owner", active: true }]);

    // A second call is a no-op that returns the same business (no duplicates).
    const second = await store.seedFirstRun({ operatorName: "Ignored" });
    expect(second.businessId).toBe(LOCAL_BUSINESS_ID);
    expect(await store.listOperators(LOCAL_BUSINESS_ID)).toHaveLength(1);
  });

  it("verifies an operator PIN (scrypt round-trip) and rejects a wrong/absent PIN", async () => {
    await store.seedFirstRun({ operatorName: "Rosa", pin: "1357" });
    const [op] = await store.listOperators(LOCAL_BUSINESS_ID);
    if (!op) throw new Error("expected an operator");

    expect(await store.verifyOperatorPin(LOCAL_BUSINESS_ID, op.id, "1357")).toBe(true);
    expect(await store.verifyOperatorPin(LOCAL_BUSINESS_ID, op.id, "0000")).toBe(false);
    expect(await store.verifyOperatorPin(LOCAL_BUSINESS_ID, "no-such-op", "1357")).toBe(false);
  });

  it("returns false when the operator has no PIN set", async () => {
    await store.seedFirstRun(); // Owner, no PIN
    const [op] = await store.listOperators(LOCAL_BUSINESS_ID);
    if (!op) throw new Error("expected an operator");
    expect(await store.verifyOperatorPin(LOCAL_BUSINESS_ID, op.id, "1234")).toBe(false);
  });
});
