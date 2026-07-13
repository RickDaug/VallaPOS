/**
 * Adapt `@tauri-apps/plugin-sql`'s `Database` to the store's `SqlDriver` port
 * (docs/EDITIONS.md §3/§5). This is the desktop-shell driver for `SqliteDataStore`
 * — the counterpart to the `node:sqlite` test driver.
 *
 * NO `@tauri-apps` IMPORT: this module declares only the MINIMAL `TauriSqlDatabase`
 * shape it needs (which the plugin's `Database` class satisfies), so it pulls in no
 * Tauri dependency and can be unit-tested against a fake. The desktop shell
 * constructs a real `Database` (via `Database.load("sqlite:…")`) and passes it here
 * — that thin wiring is the one piece that needs the Tauri runtime (Stage 5-finish).
 */
import type { SqlDriver, SqlRunResult } from "./driver";

/**
 * The subset of `@tauri-apps/plugin-sql`'s `Database` this adapter uses. The real
 * class matches: `select` resolves the rows array; `execute` resolves
 * `{ rowsAffected, lastInsertId }`.
 */
export interface TauriSqlDatabase {
  select<T = unknown>(query: string, bindValues?: unknown[]): Promise<T>;
  execute(
    query: string,
    bindValues?: unknown[],
  ): Promise<{ rowsAffected: number; lastInsertId?: number }>;
}

/**
 * Wrap a Tauri `Database` as a `SqlDriver`. Placeholders pass through as positional
 * `?` — the store's SQL uses `?` throughout and never a literal `?` inside a string
 * literal, so no escaping is involved.
 *
 * ⚠ PLACEHOLDER STYLE: if the shell's pinned `tauri-plugin-sql` build binds
 * parameters as `$1, $2` (sqlx/Postgres style) rather than `?`, wrap each SQL
 * string with `toPositionalDollarSql()` (below) when constructing the driver. The
 * two are kept separate + tested so the shell can pick the right one against the
 * real plugin without touching the store.
 */
export function createTauriSqlDriver(
  db: TauriSqlDatabase,
  opts: { dollarPlaceholders?: boolean } = {},
): SqlDriver {
  const prep = opts.dollarPlaceholders ? toPositionalDollarSql : (sql: string) => sql;
  return {
    async select<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      // The plugin resolves the rows array directly; guard null for an empty result.
      return (await db.select<T[]>(prep(sql), params)) ?? [];
    },
    async execute(sql: string, params: unknown[] = []): Promise<SqlRunResult> {
      const r = await db.execute(prep(sql), params);
      return { rowsAffected: r.rowsAffected };
    },
  };
}

/**
 * Rewrite positional `?` placeholders to `$1, $2, …` for a driver build that
 * expects the sqlx/Postgres placeholder style. The store's SQL contains no `?`
 * inside string literals, so a straight left-to-right substitution is exact.
 */
export function toPositionalDollarSql(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}
