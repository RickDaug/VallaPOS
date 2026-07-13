import { describe, expect, it, vi } from "vitest";
import { createTauriSqlDriver, toPositionalDollarSql, type TauriSqlDatabase } from "./tauri-driver";

describe("toPositionalDollarSql", () => {
  it("rewrites ? to $1, $2, … left to right", () => {
    expect(toPositionalDollarSql("SELECT * FROM t WHERE a = ? AND b = ? AND c = ?")).toBe(
      "SELECT * FROM t WHERE a = $1 AND b = $2 AND c = $3",
    );
  });

  it("leaves a placeholder-free statement unchanged", () => {
    expect(toPositionalDollarSql("SELECT 1")).toBe("SELECT 1");
  });
});

describe("createTauriSqlDriver", () => {
  it("maps select/execute onto the Tauri Database API (pass-through placeholders)", async () => {
    const select = vi.fn(async () => [{ n: 1 }]);
    const execute = vi.fn(async () => ({ rowsAffected: 3, lastInsertId: 9 }));
    // Cast: the fakes are concrete while TauriSqlDatabase.select is generic.
    const db = { select, execute } as unknown as TauriSqlDatabase;
    const driver = createTauriSqlDriver(db);

    expect(await driver.select("SELECT ?", [5])).toEqual([{ n: 1 }]);
    expect(select).toHaveBeenCalledWith("SELECT ?", [5]);

    // Only rowsAffected is surfaced (SqlRunResult shape); lastInsertId is dropped.
    expect(await driver.execute("DELETE FROM t WHERE a = ?", [1])).toEqual({ rowsAffected: 3 });
    expect(execute).toHaveBeenCalledWith("DELETE FROM t WHERE a = ?", [1]);
  });

  it("coerces a null select result to an empty array", async () => {
    const db = {
      select: async () => null,
      execute: async () => ({ rowsAffected: 0 }),
    } as unknown as TauriSqlDatabase;
    expect(await createTauriSqlDriver(db).select("SELECT 1")).toEqual([]);
  });

  it("rewrites placeholders to $n when the driver opts into dollar style", async () => {
    const select = vi.fn(async () => []);
    const db = { select, execute: async () => ({ rowsAffected: 0 }) } as unknown as TauriSqlDatabase;
    await createTauriSqlDriver(db, { dollarPlaceholders: true }).select("SELECT ? , ?", [1, 2]);
    expect(select).toHaveBeenCalledWith("SELECT $1 , $2", [1, 2]);
  });
});
